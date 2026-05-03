const VALID_CATEGORIES = new Set(['support', 'general', 'summaries', 'purchasing'])
const VALID_MODEL_QUALITIES = new Set(['fast', 'better', 'deep'])

export function registerAiRoutes(app, deps) {
  const {
    requireFirebaseAuth,
    requireAdminRole,
    getCollections,
    generateSupportReply,
    batchSummarizeComments,
    chatForRules,
    fetchZendeskTicketConversation,
    toPublicAuthUser,
  } = deps

  async function getAiRules(category) {
    const { aiRulesCollection } = await getCollections()
    const doc = await aiRulesCollection.findOne(
      { category },
      { projection: { _id: 0, content: 1 } },
    )
    return doc?.content ? String(doc.content).trim() : ''
  }

  async function saveAiRules(category, content) {
    const { aiRulesCollection } = await getCollections()
    const now = new Date().toISOString()
    await aiRulesCollection.updateOne(
      { category },
      {
        $set: { content: String(content ?? '').trim(), updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    )
  }

  function normalizeModelQuality(value) {
    const normalized = String(value ?? '').trim().toLowerCase()
    return VALID_MODEL_QUALITIES.has(normalized) ? normalized : 'better'
  }

  async function safeCount(collection, filter = {}) {
    try {
      return await collection.countDocuments(filter)
    } catch (error) {
      console.warn('Unable to count AI context collection.', error)
      return null
    }
  }

  async function safeDistinctValues(collection, field, filter = {}, limit = 12) {
    try {
      return (await collection.distinct(field, filter))
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .slice(0, limit)
    } catch (error) {
      console.warn('Unable to load AI context distinct values.', error)
      return []
    }
  }

  async function safeStatusCounts(collection, field = 'status') {
    try {
      return await collection
        .aggregate([
          { $group: { _id: `$${field}`, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 8 },
        ])
        .toArray()
    } catch (error) {
      console.warn('Unable to load AI context status counts.', error)
      return []
    }
  }

  async function safeFindDocuments(collection, { filter = {}, projection = {}, sort = {}, limit = 8 } = {}) {
    try {
      let cursor = collection.find(filter, { projection: { _id: 0, ...projection } })

      if (sort && Object.keys(sort).length > 0) {
        cursor = cursor.sort(sort)
      }

      return await cursor.limit(limit).toArray()
    } catch (error) {
      console.warn('Unable to load AI context documents.', error)
      return []
    }
  }

  function formatValue(value) {
    if (Array.isArray(value)) {
      return value.map(formatValue).filter(Boolean).join('/')
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value.toLocaleString() : ''
    }

    if (typeof value === 'boolean') {
      return value ? 'yes' : 'no'
    }

    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function formatFields(fields) {
    return Object.entries(fields)
      .map(([label, value]) => {
        const formattedValue = formatValue(value)
        return formattedValue ? `${label} ${formattedValue}` : null
      })
      .filter(Boolean)
      .join(', ')
  }

  function formatPreviewRows(label, rows, formatter) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return null
    }

    const preview = rows.map(formatter).filter(Boolean).join(' | ')
    return preview ? `${label}: ${preview}` : null
  }

  function shouldUseDeepBusinessContext(modelQuality, messages) {
    if (modelQuality === 'deep') {
      return true
    }

    const latestMessage = String(messages.at(-1)?.content ?? '').toLowerCase()

    return /deep search|dep search|deap search|greater research|full business|full picture|business picture|whole business|everything|all data|database|full context/.test(
      latestMessage,
    )
  }

  function extractReferencedTicketIds(messages) {
    const ids = []
    const seen = new Set()
    const text = messages.map((message) => String(message.content ?? '')).join('\n')
    const pattern = /(?:ticket|zendesk)\s*(?:#|id|number|no\.)?\s*:?\s*#?(\d{4,})/gi
    let match = pattern.exec(text)

    while (match && ids.length < 3) {
      const ticketId = match[1]
      if (!seen.has(ticketId)) {
        ids.push(ticketId)
        seen.add(ticketId)
      }
      match = pattern.exec(text)
    }

    return ids
  }

  async function buildReferencedTicketContext(messages) {
    const ticketIds = extractReferencedTicketIds(messages)

    if (ticketIds.length === 0) {
      return ''
    }

    const conversations = await Promise.all(
      ticketIds.map(async (ticketId) => {
        try {
          return await fetchZendeskTicketConversation(ticketId)
        } catch (error) {
          console.warn('Unable to load referenced ticket for AI context.', error)
          return null
        }
      }),
    )

    return conversations
      .filter(Boolean)
      .map((conversation) => {
        const ticket = conversation.ticket ?? {}
        const commentPreview = (conversation.comments ?? [])
          .slice(-8)
          .map((comment) => {
            const visibility = comment.public === false ? 'internal' : 'public'
            const body = formatValue(comment.body).slice(0, 350)
            return `${comment.authorName ?? 'Unknown'} (${visibility}): ${body}`
          })
          .filter(Boolean)
          .join(' | ')

        return [
          `Referenced Zendesk ticket ${ticket.id}: ${formatFields({
            subject: ticket.subject,
            status: ticket.statusLabel ?? ticket.status,
            order: ticket.orderNumber,
            requester: ticket.requesterName,
            assignee: ticket.assigneeName,
            updated: ticket.updatedAt,
          })}`,
          commentPreview ? `Recent ticket conversation: ${commentPreview}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      })
      .filter(Boolean)
      .join('\n\n')
  }

  function formatCount(label, value) {
    return Number.isFinite(value) ? `${label}: ${Number(value).toLocaleString()}` : null
  }

  function formatList(label, values) {
    if (!Array.isArray(values) || values.length === 0) {
      return null
    }

    return `${label}: ${values.join(', ')}`
  }

  function formatStatusCounts(label, rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return null
    }

    const summary = rows
      .map((row) => {
        const status = String(row?._id ?? 'unknown').trim() || 'unknown'
        const count = Number(row?.count)
        return Number.isFinite(count) ? `${status} ${count}` : null
      })
      .filter(Boolean)
      .join(', ')

    return summary ? `${label}: ${summary}` : null
  }

  async function buildBusinessContextSummary({ detailLevel = 'standard' } = {}) {
    const useDeepContext = detailLevel === 'deep'
    const {
      workersCollection,
      entriesCollection,
      stagesCollection,
      orderProgressCollection,
      missingWorkerReviewsCollection,
      dashboardSnapshotsCollection,
      mondayOrdersCollection,
      authUsersCollection,
      crmAccountsCollection,
      crmContactsCollection,
      crmSalesRepsCollection,
      crmQuotesCollection,
      crmOrdersCollection,
    } = await getCollections()
    const recentCutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    const [
      workerCount,
      stageNames,
      entryCount,
      recentEntryCount,
      recentJobNames,
      readyUpdateCount,
      openMissingReviewsCount,
      mondayOrderCount,
      approvedUserCount,
      crmAccountCount,
      crmContactCount,
      crmSalesRepCount,
      quoteStatusCounts,
      orderStatusCounts,
      supportAlertsDoc,
      supportTicketsDoc,
    ] = await Promise.all([
      safeCount(workersCollection),
      safeDistinctValues(stagesCollection, 'name'),
      safeCount(entriesCollection),
      safeCount(entriesCollection, { date: { $gte: recentCutoffDate } }),
      safeDistinctValues(entriesCollection, 'jobName', { date: { $gte: recentCutoffDate } }, 15),
      safeCount(orderProgressCollection),
      safeCount(missingWorkerReviewsCollection, { approved: { $ne: true } }),
      safeCount(mondayOrdersCollection),
      safeCount(authUsersCollection, { approvalStatus: 'approved' }),
      safeCount(crmAccountsCollection, { deletedAt: { $exists: false } }),
      safeCount(crmContactsCollection, { deletedAt: { $exists: false } }),
      safeCount(crmSalesRepsCollection, { isDeleted: { $ne: true } }),
      safeStatusCounts(crmQuotesCollection),
      safeStatusCounts(crmOrdersCollection),
      dashboardSnapshotsCollection.findOne(
        { snapshotKey: 'support_alerts' },
        { projection: { _id: 0, snapshot: 1 } },
      ),
      dashboardSnapshotsCollection.findOne(
        { snapshotKey: 'support_tickets_100' },
        { projection: { _id: 0, snapshot: 1 } },
      ),
    ])
    const deepContext = useDeepContext
      ? await Promise.all([
          safeFindDocuments(workersCollection, {
            projection: { workerNumber: 1, fullName: 1, role: 1 },
            sort: { workerNumber: 1, fullName: 1 },
            limit: 30,
          }),
          safeFindDocuments(entriesCollection, {
            filter: { date: { $gte: recentCutoffDate } },
            projection: { date: 1, jobName: 1, workerId: 1, stageId: 1, hours: 1, overtimeHours: 1, notes: 1 },
            sort: { date: -1 },
            limit: 30,
          }),
          safeFindDocuments(orderProgressCollection, {
            projection: { date: 1, jobName: 1, readyPercent: 1, updatedAt: 1 },
            sort: { date: -1, updatedAt: -1 },
            limit: 20,
          }),
          safeFindDocuments(missingWorkerReviewsCollection, {
            projection: { date: 1, workerId: 1, approved: 1, note: 1, updatedAt: 1 },
            sort: { date: -1, updatedAt: -1 },
            limit: 20,
          }),
          safeFindDocuments(mondayOrdersCollection, {
            projection: {
              mondayItemId: 1,
              orderName: 1,
              groupTitle: 1,
              statusLabel: 1,
              stageLabel: 1,
              readyLabel: 1,
              progressPercent: 1,
              effectiveDueDate: 1,
              isLate: 1,
              daysLate: 1,
            },
            sort: { lastSeenAt: -1, mondayUpdatedAt: -1 },
            limit: 30,
          }),
          safeFindDocuments(authUsersCollection, {
            filter: { approvalStatus: 'approved' },
            projection: {
              displayName: 1,
              role: 1,
              clientAccessMode: 1,
              linkedWorkerName: 1,
              linkedZendeskUserName: 1,
            },
            sort: { displayName: 1 },
            limit: 30,
          }),
          safeFindDocuments(crmAccountsCollection, {
            filter: { deletedAt: { $exists: false } },
            projection: { name: 1, city: 1, state: 1, industry: 1, accountType: 1, salesRep: 1, owner: 1 },
            sort: { modifiedDateSource: -1, updatedAt: -1 },
            limit: 25,
          }),
          safeFindDocuments(crmContactsCollection, {
            filter: { deletedAt: { $exists: false } },
            projection: { name: 1, accountName: 1, salesUnit: 1, city: 1, state: 1, contactOrigin: 1 },
            sort: { modifiedDateSource: -1, updatedAt: -1 },
            limit: 25,
          }),
          safeFindDocuments(crmSalesRepsCollection, {
            filter: { isDeleted: { $ne: true } },
            projection: { name: 1, companyName: 1, states: 1 },
            sort: { name: 1 },
            limit: 30,
          }),
          safeFindDocuments(crmQuotesCollection, {
            projection: {
              dealerName: 1,
              salesRep: 1,
              quoteNumber: 1,
              title: 1,
              opportunityStage: 1,
              status: 1,
              totalAmount: 1,
              updatedAt: 1,
            },
            sort: { updatedAt: -1, createdAt: -1 },
            limit: 25,
          }),
          safeFindDocuments(crmOrdersCollection, {
            projection: {
              dealerName: 1,
              orderNumber: 1,
              title: 1,
              status: 1,
              progressPercent: 1,
              orderValue: 1,
              dueDate: 1,
              updatedAt: 1,
            },
            sort: { updatedAt: -1, createdAt: -1 },
            limit: 25,
          }),
        ])
      : null
    const supportAlerts = supportAlertsDoc?.snapshot?.alerts ?? null
    const supportTickets = Array.isArray(supportTicketsDoc?.snapshot?.tickets)
      ? supportTicketsDoc.snapshot.tickets
      : []
    const [
      workerSamples = [],
      recentEntries = [],
      readyProgressSamples = [],
      missingReviewSamples = [],
      mondayOrderSamples = [],
      approvedUserSamples = [],
      crmAccountSamples = [],
      crmContactSamples = [],
      crmSalesRepSamples = [],
      crmQuoteSamples = [],
      crmOrderSamples = [],
    ] = deepContext ?? []

    return [
      `Business context depth: ${useDeepContext ? 'deep database scan' : 'standard database summary'}`,
      formatCount('Approved app users', approvedUserCount),
      formatCount('Timesheet workers', workerCount),
      formatList('Timesheet stages', stageNames),
      formatCount('Timesheet entries all-time', entryCount),
      formatCount('Timesheet entries last 90 days', recentEntryCount),
      formatList('Active jobs last 90 days', recentJobNames),
      formatCount('Ready-percent manager updates', readyUpdateCount),
      formatCount('Unapproved missing-worker reviews', openMissingReviewsCount),
      formatCount('Monday orders cached', mondayOrderCount),
      formatCount('CRM dealers/accounts', crmAccountCount),
      formatCount('CRM contacts', crmContactCount),
      formatCount('CRM sales reps', crmSalesRepCount),
      formatStatusCounts('CRM quote statuses', quoteStatusCounts),
      formatStatusCounts('CRM order statuses', orderStatusCounts),
      supportAlerts
        ? `Support overdue alerts: new>24h ${supportAlerts.newOver24Hours ?? 0}, open>24h ${supportAlerts.openOver24Hours ?? 0}, in-progress>48h ${supportAlerts.inProgressOver48Hours ?? 0}, pending>48h ${supportAlerts.pendingOver48Hours ?? 0}`
        : null,
      supportTickets.length > 0
        ? `Support open ticket sample count in cache: ${supportTickets.length}`
        : null,
      useDeepContext
        ? formatPreviewRows('Approved user context', approvedUserSamples, (user) =>
            formatFields({
              name: user.displayName,
              role: user.role,
              access: user.clientAccessMode,
              worker: user.linkedWorkerName,
              zendesk: user.linkedZendeskUserName,
            }),
          )
        : null,
      useDeepContext
        ? formatPreviewRows('Timesheet worker context', workerSamples, (worker) =>
            formatFields({ number: worker.workerNumber, name: worker.fullName, role: worker.role }),
          )
        : null,
      useDeepContext
        ? formatPreviewRows('Recent timesheet entries', recentEntries, (entry) =>
            formatFields({
              date: entry.date,
              job: entry.jobName,
              worker: entry.workerId,
              stage: entry.stageId,
              hours: entry.hours,
              overtime: entry.overtimeHours,
              notes: entry.notes,
            }),
          )
        : null,
      useDeepContext
        ? formatPreviewRows('Recent ready-percent updates', readyProgressSamples, (progress) =>
            formatFields({ date: progress.date, job: progress.jobName, ready: `${progress.readyPercent}%` }),
          )
        : null,
      useDeepContext
        ? formatPreviewRows('Missing-worker review context', missingReviewSamples, (review) =>
            formatFields({ date: review.date, worker: review.workerId, approved: review.approved, note: review.note }),
          )
        : null,
      useDeepContext
        ? formatPreviewRows('Monday order context', mondayOrderSamples, (order) =>
            formatFields({
              id: order.mondayItemId,
              order: order.orderName,
              group: order.groupTitle,
              status: order.statusLabel,
              stage: order.stageLabel,
              ready: order.readyLabel,
              progress: order.progressPercent,
              due: order.effectiveDueDate,
              late: order.isLate,
              daysLate: order.daysLate,
            }),
          )
        : null,
      useDeepContext
        ? formatPreviewRows('CRM account context', crmAccountSamples, (account) =>
            formatFields({
              name: account.name,
              city: account.city,
              state: account.state,
              industry: account.industry,
              type: account.accountType,
              salesRep: account.salesRep,
              owner: account.owner,
            }),
          )
        : null,
      useDeepContext
        ? formatPreviewRows('CRM contact context', crmContactSamples, (contact) =>
            formatFields({
              name: contact.name,
              account: contact.accountName,
              salesUnit: contact.salesUnit,
              city: contact.city,
              state: contact.state,
              origin: contact.contactOrigin,
            }),
          )
        : null,
      useDeepContext
        ? formatPreviewRows('CRM sales rep context', crmSalesRepSamples, (rep) =>
            formatFields({ name: rep.name, company: rep.companyName, states: rep.states }),
          )
        : null,
      useDeepContext
        ? formatPreviewRows('CRM quote context', crmQuoteSamples, (quote) =>
            formatFields({
              quote: quote.quoteNumber,
              dealer: quote.dealerName,
              title: quote.title,
              stage: quote.opportunityStage,
              status: quote.status,
              amount: quote.totalAmount,
              salesRep: quote.salesRep,
            }),
          )
        : null,
      useDeepContext
        ? formatPreviewRows('CRM order context', crmOrderSamples, (order) =>
            formatFields({
              order: order.orderNumber,
              dealer: order.dealerName,
              title: order.title,
              status: order.status,
              progress: order.progressPercent,
              value: order.orderValue,
              due: order.dueDate,
            }),
          )
        : null,
      useDeepContext && supportTickets.length > 0
        ? formatPreviewRows('Support ticket context', supportTickets.slice(0, 25), (ticket) =>
            formatFields({
              ticket: ticket.id,
              order: ticket.orderNumber,
              subject: ticket.subject,
              status: ticket.statusLabel ?? ticket.status,
              requester: ticket.requesterName,
              assignee: ticket.assigneeName,
              updated: ticket.updatedAt,
            }),
          )
        : null,
    ]
      .filter(Boolean)
      .join('\n')
  }

  // Generate an AI draft reply for a support ticket.
  // Signs as the logged-in agent's linked Zendesk display name.
  // Body: { ticketId: number }
  app.post('/api/ai/support/generate-reply', requireFirebaseAuth, async (req, res, next) => {
    try {
      const ticketId = String(req.body?.ticketId ?? '').trim()

      if (!ticketId || !/^[0-9]+$/.test(ticketId)) {
        return res.status(400).json({ error: 'ticketId must be numeric.' })
      }

      const publicUser = toPublicAuthUser(req.authUser)
      const authorName =
        String(publicUser?.linkedZendeskUserName ?? '').trim() ||
        String(publicUser?.displayName ?? '').trim() ||
        ''

      const draftHint = String(req.body?.draftHint ?? '').trim() || null

      const [conversation, supportRules, generalRules, businessContext] = await Promise.all([
        fetchZendeskTicketConversation(ticketId),
        getAiRules('support'),
        getAiRules('general'),
        buildBusinessContextSummary({ detailLevel: 'deep' }),
      ])

      const reply = await generateSupportReply({
        subject: conversation.ticket.subject,
        requesterName: conversation.ticket.requesterName,
        comments: conversation.comments,
        generalRules,
        supportRules,
        businessContext,
        authorName,
        draftHint,
      })

      return res.json({ reply })
    } catch (error) {
      next(error)
    }
  })

  // Fetch AI-generated one-sentence summaries for every comment in a ticket.
  // Summaries are generated once and cached in MongoDB — never re-generated.
  // Returns: { summaries: { [commentId]: string } }
  app.get(
    '/api/ai/support/tickets/:ticketId/comment-summaries',
    requireFirebaseAuth,
    async (req, res, next) => {
      try {
        const ticketId = String(req.params.ticketId ?? '').trim()

        if (!/^[0-9]+$/.test(ticketId)) {
          return res.status(400).json({ error: 'ticketId must be numeric.' })
        }

        const { aiCommentSummariesCollection } = await getCollections()
        const [conversation, summaryRules, generalRules, businessContext] = await Promise.all([
          fetchZendeskTicketConversation(ticketId),
          getAiRules('summaries'),
          getAiRules('general'),
          buildBusinessContextSummary(),
        ])
        const comments = conversation.comments
        const commentIds = comments.map((c) => Number(c.id))

        // Load any existing summaries from DB
        const existingDocs = await aiCommentSummariesCollection
          .find(
            { commentId: { $in: commentIds } },
            { projection: { _id: 0, commentId: 1, summary: 1 } },
          )
          .toArray()

        const summaryMap = {}
        for (const doc of existingDocs) {
          summaryMap[doc.commentId] = doc.summary
        }

        // Find comments that still need a summary
        const needsSummary = comments.filter((c) => !summaryMap[Number(c.id)])

        if (needsSummary.length > 0) {
          const newSummaries = await batchSummarizeComments(needsSummary, {
            generalRules,
            summaryRules,
            businessContext,
          })

          const now = new Date().toISOString()
          const bulkOps = Object.entries(newSummaries)
            .map(([idStr, summary]) => {
              const commentId = Number(idStr)

              if (!Number.isFinite(commentId) || commentId <= 0) {
                return null
              }

              summaryMap[commentId] = summary

              return {
                updateOne: {
                  filter: { commentId },
                  update: {
                    $set: { summary },
                    $setOnInsert: { commentId, createdAt: now },
                  },
                  upsert: true,
                },
              }
            })
            .filter((op) => op !== null)

          if (bulkOps.length > 0) {
            await aiCommentSummariesCollection.bulkWrite(bulkOps, { ordered: false })
          }
        }

        return res.json({ summaries: summaryMap })
      } catch (error) {
        next(error)
      }
    },
  )

  // Get saved rules for a category (admin only).
  app.get('/api/ai/rules/:category', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const category = String(req.params.category ?? '').trim().toLowerCase()

      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({
          error: `category must be one of: ${[...VALID_CATEGORIES].join(', ')}.`,
        })
      }

      const content = await getAiRules(category)
      return res.json({ category, content })
    } catch (error) {
      next(error)
    }
  })

  // Save rules for a category (admin only).
  // Body: { content: string }
  app.put('/api/ai/rules/:category', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const category = String(req.params.category ?? '').trim().toLowerCase()

      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({
          error: `category must be one of: ${[...VALID_CATEGORIES].join(', ')}.`,
        })
      }

      const content = String(req.body?.content ?? '').trim()
      const contentLimit =
        category === 'general'
          ? 20000
          : category === 'purchasing'
            ? 6000
            : 2000

      if (content.length > contentLimit) {
        return res.status(400).json({ error: `Rules content exceeds ${contentLimit} character limit.` })
      }

      await saveAiRules(category, content)
      return res.json({ category, content })
    } catch (error) {
      next(error)
    }
  })

  // Chat with AI to develop proposed rules for a category (admin only).
  // Body: { category: string, messages: [{ role: 'user'|'assistant', content: string }] }
  app.post('/api/ai/rules/chat', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const category = String(req.body?.category ?? '').trim().toLowerCase()

      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({
          error: `category must be one of: ${[...VALID_CATEGORIES].join(', ')}.`,
        })
      }

      const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : []

      if (rawMessages.length === 0) {
        return res.status(400).json({ error: 'messages array is required and must not be empty.' })
      }

      if (rawMessages.length > 60) {
        return res.status(400).json({ error: 'messages array exceeds 60 message limit.' })
      }

      const messages = rawMessages.map((m) => ({
        role: String(m?.role ?? '').trim(),
        content: String(m?.content ?? '').trim(),
      }))

      const invalidMessage = messages.find(
        (m) => !['user', 'assistant'].includes(m.role) || !m.content,
      )

      if (invalidMessage) {
        return res.status(400).json({
          error: 'Each message must have role (user|assistant) and non-empty content.',
        })
      }

      const modelQuality = normalizeModelQuality(req.body?.modelQuality)
      const currentRules = await getAiRules(category)
      const useDeepContext = shouldUseDeepBusinessContext(modelQuality, messages)
      const [generalRules, businessContextSummary, referencedTicketContext] = await Promise.all([
        category === 'general' ? Promise.resolve(currentRules) : getAiRules('general'),
        buildBusinessContextSummary({ detailLevel: useDeepContext ? 'deep' : 'standard' }),
        buildReferencedTicketContext(messages),
      ])
      const businessContext = [businessContextSummary, referencedTicketContext]
        .filter(Boolean)
        .join('\n\n')

      const { message, newRules } = await chatForRules({
        category,
        messages,
        currentRules,
        generalRules,
        businessContext,
        modelQuality,
      })

      return res.json({
        message,
        rules: currentRules,
        proposedRules: newRules ?? null,
        rulesUpdated: false,
        modelQuality,
      })
    } catch (error) {
      next(error)
    }
  })
}

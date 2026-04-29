const VALID_CATEGORIES = new Set(['support', 'orders', 'crm', 'general'])

export function registerAiRoutes(app, deps) {
  const {
    requireFirebaseAuth,
    requireAdminRole,
    getCollections,
    generateSupportReply,
    chatForRules,
    fetchZendeskTicketConversation,
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

  // Generate an AI draft reply for a support ticket.
  // Requires a valid ticketId; uses saved support rules as context.
  // Body: { ticketId: number }
  app.post('/api/ai/support/generate-reply', requireFirebaseAuth, async (req, res, next) => {
    try {
      const ticketId = String(req.body?.ticketId ?? '').trim()

      if (!ticketId || !/^[0-9]+$/.test(ticketId)) {
        return res.status(400).json({ error: 'ticketId must be numeric.' })
      }

      const [conversation, supportRules] = await Promise.all([
        fetchZendeskTicketConversation(ticketId),
        getAiRules('support'),
      ])

      const reply = await generateSupportReply({
        subject: conversation.ticket.subject,
        requesterName: conversation.ticket.requesterName,
        comments: conversation.comments,
        rules: supportRules,
      })

      return res.json({ reply })
    } catch (error) {
      next(error)
    }
  })

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

      if (content.length > 2000) {
        return res.status(400).json({ error: 'Rules content exceeds 2000 character limit.' })
      }

      await saveAiRules(category, content)
      return res.json({ category, content })
    } catch (error) {
      next(error)
    }
  })

  // Chat with AI to develop rules for a category (admin only).
  // AI auto-saves rules when it generates them.
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

      // Always read current rules from DB (not trusting client input)
      const currentRules = await getAiRules(category)

      const { message, newRules } = await chatForRules({
        category,
        messages,
        currentRules,
      })

      // Auto-save if AI produced updated rules
      if (newRules) {
        await saveAiRules(category, newRules)
      }

      return res.json({
        message,
        rules: newRules ?? currentRules,
        rulesUpdated: Boolean(newRules),
      })
    } catch (error) {
      next(error)
    }
  })
}

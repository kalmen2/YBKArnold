export function createZendeskDashboardService({
  buildZendeskAgentUrl,
  buildZendeskApiBaseUrl,
  buildZendeskAuthorizationHeader,
  ensureZendeskConfiguration,
  buildZendeskCustomStatusMap,
  buildZendeskStatusQueries,
  isZendeskOrderNumberTicketField,
  normalizeZendeskSupportTicket,
  resolveZendeskCustomStatusId,
  toBoundedInteger,
  zendeskEmail,
  zendeskTicketFieldCacheTtlMs,
  zendeskTicketFieldErrorCacheTtlMs,
}) {
  let zendeskOrderNumberFieldId = null
  let zendeskOrderNumberFieldExpiresAt = 0
  let zendeskOrderNumberFieldPromise = null
  const zendeskAssignableRoles = new Set(['agent', 'admin'])

  async function fetchZendeskTicketSummary() {
    ensureZendeskConfiguration()

    const statusContext = await fetchZendeskStatusContext()
    const {
      openTotalQuery,
      inProgressQuery,
      openCustomStatusQuery,
      pendingQuery,
      solvedQuery,
    } = buildZendeskStatusQueries(statusContext)

    const [
      newTickets,
      openTotalTickets,
      inProgressTickets,
      openCustomStatusTickets,
      pendingTickets,
      solvedTickets,
    ] = await Promise.all([
      fetchZendeskTicketCount('type:ticket status:new'),
      fetchZendeskTicketCount(openTotalQuery),
      fetchZendeskTicketCount(inProgressQuery),
      openCustomStatusQuery
        ? fetchZendeskTicketCount(openCustomStatusQuery)
        : Promise.resolve(null),
      fetchZendeskTicketCount(pendingQuery),
      fetchZendeskTicketCount(solvedQuery),
    ])
    const normalizedOpenTotalTickets = Number.isFinite(openTotalTickets)
      ? Math.max(Math.round(openTotalTickets), 0)
      : 0
    const normalizedInProgressTickets = Number.isFinite(inProgressTickets)
      ? Math.max(Math.round(inProgressTickets), 0)
      : 0
    const normalizedOpenCustomStatusTickets = Number.isFinite(openCustomStatusTickets)
      ? Math.max(Math.round(openCustomStatusTickets), 0)
      : null
    const normalizedOpenTickets =
      normalizedOpenCustomStatusTickets !== null
        ? normalizedOpenCustomStatusTickets
        : statusContext.inProgressCustomStatusId
          ? Math.max(normalizedOpenTotalTickets - normalizedInProgressTickets, 0)
          : normalizedOpenTotalTickets

    return {
      generatedAt: new Date().toISOString(),
      agentUrl: buildZendeskAgentUrl(),
      metrics: {
        newTickets,
        inProgressTickets: normalizedInProgressTickets,
        openTickets: normalizedOpenTickets,
        pendingTickets,
        solvedTickets,
        openTotalTickets: normalizedOpenTickets + normalizedInProgressTickets,
      },
    }
  }

  async function fetchZendeskSupportAlerts() {
    ensureZendeskConfiguration()

    const statusContext = await fetchZendeskStatusContext()
    const {
      inProgressQuery,
      openCustomStatusQuery,
      pendingQuery,
    } = buildZendeskStatusQueries(statusContext)

    const openQuery = openCustomStatusQuery || 'type:ticket status:open'

    const [
      newOver24Hours,
      openOver24Hours,
      inProgressOver48Hours,
      pendingOver48Hours,
    ] = await Promise.all([
      countZendeskTicketsOlderThanHours('type:ticket status:new', 24),
      countZendeskTicketsOlderThanHours(openQuery, 24),
      countZendeskTicketsOlderThanHours(inProgressQuery, 48),
      countZendeskTicketsOlderThanHours(pendingQuery, 48),
    ])

    return {
      generatedAt: new Date().toISOString(),
      agentUrl: buildZendeskAgentUrl(),
      alerts: {
        newOver24Hours,
        openOver24Hours,
        inProgressOver48Hours,
        pendingOver48Hours,
      },
    }
  }

  async function fetchZendeskSupportAlertTicketsSnapshot(limitPerBucket = 100) {
    ensureZendeskConfiguration()

    const [statusContext, orderNumberFieldId] = await Promise.all([
      fetchZendeskStatusContext(),
      resolveZendeskOrderNumberFieldId(),
    ])
    const {
      inProgressQuery,
      openCustomStatusQuery,
      pendingQuery,
    } = buildZendeskStatusQueries(statusContext)
    const openQuery = openCustomStatusQuery || 'type:ticket status:open'

    const [
      newOver24HoursRaw,
      openOver24HoursRaw,
      inProgressOver48HoursRaw,
      pendingOver48HoursRaw,
    ] = await Promise.all([
      fetchZendeskTicketsOlderThanHours('type:ticket status:new', 24, limitPerBucket),
      fetchZendeskTicketsOlderThanHours(openQuery, 24, limitPerBucket),
      fetchZendeskTicketsOlderThanHours(inProgressQuery, 48, limitPerBucket),
      fetchZendeskTicketsOlderThanHours(pendingQuery, 48, limitPerBucket),
    ])

    const userIds = new Set()
    const allRawTickets = [
      ...newOver24HoursRaw,
      ...openOver24HoursRaw,
      ...inProgressOver48HoursRaw,
      ...pendingOver48HoursRaw,
    ]

    allRawTickets.forEach((ticket) => {
      const requesterId = Number(ticket?.requester_id)
      const assigneeId = Number(ticket?.assignee_id)

      if (Number.isFinite(requesterId) && requesterId > 0) {
        userIds.add(requesterId)
      }

      if (Number.isFinite(assigneeId) && assigneeId > 0) {
        userIds.add(assigneeId)
      }
    })

    const usersById = await fetchZendeskUsersByIds([...userIds])
    const normalize = (ticket) =>
      normalizeZendeskSupportTicket(
        ticket,
        statusContext,
        usersById,
        orderNumberFieldId,
      )

    return {
      generatedAt: new Date().toISOString(),
      agentUrl: buildZendeskAgentUrl(),
      buckets: {
        newOver24Hours: newOver24HoursRaw.map(normalize),
        openOver24Hours: openOver24HoursRaw.map(normalize),
        inProgressOver48Hours: inProgressOver48HoursRaw.map(normalize),
        pendingOver48Hours: pendingOver48HoursRaw.map(normalize),
      },
    }
  }

  async function fetchZendeskSupportTicketsSnapshot(limit = 50) {
    ensureZendeskConfiguration()

    const [statusContext, orderNumberFieldId] = await Promise.all([
      fetchZendeskStatusContext(),
      resolveZendeskOrderNumberFieldId(),
    ])
    const tickets = await fetchZendeskSearchTickets('type:ticket status<solved', {
      page: 1,
      perPage: toBoundedInteger(limit, 10, 100, 50),
      sortBy: 'updated_at',
      sortOrder: 'desc',
    })

    const userIds = new Set()

    tickets.forEach((ticket) => {
      const requesterId = Number(ticket?.requester_id)
      const assigneeId = Number(ticket?.assignee_id)

      if (Number.isFinite(requesterId) && requesterId > 0) {
        userIds.add(requesterId)
      }

      if (Number.isFinite(assigneeId) && assigneeId > 0) {
        userIds.add(assigneeId)
      }
    })

    const usersById = await fetchZendeskUsersByIds([...userIds])
    const normalizedTickets = tickets.map((ticket) =>
      normalizeZendeskSupportTicket(
        ticket,
        statusContext,
        usersById,
        orderNumberFieldId,
      ),
    )

    return {
      generatedAt: new Date().toISOString(),
      agentUrl: buildZendeskAgentUrl(),
      tickets: normalizedTickets,
    }
  }

  async function fetchZendeskTicketConversation(ticketId) {
    ensureZendeskConfiguration()

    const [statusContext, orderNumberFieldId, ticketPayload, commentsPayload] =
      await Promise.all([
        fetchZendeskStatusContext(),
        resolveZendeskOrderNumberFieldId(),
        callZendeskApi(`/tickets/${encodeURIComponent(ticketId)}.json`, {
          method: 'GET',
        }),
        callZendeskApi(`/tickets/${encodeURIComponent(ticketId)}/comments.json`, {
          method: 'GET',
        }),
      ])

    const ticket = ticketPayload?.ticket ?? null

    if (!ticket) {
      throw {
        status: 404,
        message: 'Zendesk ticket was not found.',
      }
    }

    const comments = Array.isArray(commentsPayload?.comments)
      ? commentsPayload.comments
      : []
    const userIds = new Set()
    const requesterId = Number(ticket?.requester_id)
    const assigneeId = Number(ticket?.assignee_id)

    if (Number.isFinite(requesterId) && requesterId > 0) {
      userIds.add(requesterId)
    }

    if (Number.isFinite(assigneeId) && assigneeId > 0) {
      userIds.add(assigneeId)
    }

    comments.forEach((comment) => {
      const authorId = Number(comment?.author_id)

      if (Number.isFinite(authorId) && authorId > 0) {
        userIds.add(authorId)
      }
    })

    const usersById = await fetchZendeskUsersByIds([...userIds])
    const normalizedTicket = normalizeZendeskSupportTicket(
      ticket,
      statusContext,
      usersById,
      orderNumberFieldId,
    )
    const normalizedComments = comments
      .map((comment) => {
        const authorId = Number(comment?.author_id)
        const author = usersById.get(authorId)
        const plainBody = String(comment?.plain_body ?? '').trim()
        const htmlBody = String(comment?.html_body ?? '').trim()
        const fallbackBody = String(comment?.body ?? '').trim()
        const rawAttachments = Array.isArray(comment?.attachments)
          ? comment.attachments
          : []
        const attachments = rawAttachments
          .map((attachment) => {
            const id = Number(attachment?.id)
            const fileName = String(attachment?.file_name ?? '').trim() || 'Attachment'
            const url = String(
              attachment?.content_url
              ?? attachment?.mapped_content_url
              ?? '',
            ).trim()
            const contentType = String(attachment?.content_type ?? '').trim() || null
            const sizeValue = Number(attachment?.size)
            const thumbnails = Array.isArray(attachment?.thumbnails)
              ? attachment.thumbnails
              : []
            const thumbnailUrl = String(
              thumbnails.find((thumbnail) => String(thumbnail?.content_url ?? '').trim())?.content_url
              ?? '',
            ).trim() || null

            if (!url) {
              return null
            }

            return {
              id: Number.isFinite(id) && id > 0 ? id : null,
              fileName,
              url,
              contentType,
              sizeBytes: Number.isFinite(sizeValue) && sizeValue > 0 ? Math.round(sizeValue) : null,
              thumbnailUrl,
            }
          })
          .filter(Boolean)

        return {
          id: Number(comment?.id),
          authorName: String(author?.name ?? 'Unknown user'),
          createdAt: String(comment?.created_at ?? ''),
          body: plainBody || fallbackBody || htmlBody,
          htmlBody: htmlBody || null,
          public: Boolean(comment?.public),
          attachments,
        }
      })
      .filter((comment) => Number.isFinite(comment.id) && comment.id > 0)
      .sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      )

    return {
      generatedAt: new Date().toISOString(),
      ticket: normalizedTicket,
      comments: normalizedComments,
    }
  }

  async function createZendeskSupportTicket(input) {
    ensureZendeskConfiguration()

    const ticketPayload = {
      ticket: {
        subject: input.subject,
        comment: {
          body: input.description,
        },
      },
    }

    if (input.priority) {
      ticketPayload.ticket.priority = input.priority
    }

    if (input.requesterName && input.requesterEmail) {
      ticketPayload.ticket.requester = {
        name: input.requesterName,
        email: input.requesterEmail,
      }
    }

    const payload = await callZendeskApi('/tickets.json', {
      method: 'POST',
      body: JSON.stringify(ticketPayload),
    })
    const ticket = payload?.ticket ?? null

    if (!ticket) {
      throw {
        status: 502,
        message: 'Zendesk create ticket response did not include a ticket.',
      }
    }

    const [statusContext, orderNumberFieldId] = await Promise.all([
      fetchZendeskStatusContext(),
      resolveZendeskOrderNumberFieldId(),
    ])
    const requesterId = Number(ticket?.requester_id)
    const assigneeId = Number(ticket?.assignee_id)
    const userIds = [requesterId, assigneeId].filter(
      (id) => Number.isFinite(id) && id > 0,
    )
    const usersById = await fetchZendeskUsersByIds(userIds)

    return {
      ticket: normalizeZendeskSupportTicket(
        ticket,
        statusContext,
        usersById,
        orderNumberFieldId,
      ),
    }
  }

  function normalizeZendeskReplyStatus(value) {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')

    if (!normalized) {
      return null
    }

    if (['new', 'open'].includes(normalized)) {
      return 'open'
    }

    if (normalized === 'pending') {
      return 'pending'
    }

    if (['hold', 'in_progress', 'inprocess', 'processing', 'process'].includes(normalized)) {
      return 'in_progress'
    }

    if (['solved', 'closed', 'resolved', 'done'].includes(normalized)) {
      return 'solved'
    }

    return null
  }

  async function resolveZendeskReplyStatusUpdate(targetStatus) {
    if (!targetStatus) {
      return {
        statusContext: null,
        ticketStatusUpdate: {},
      }
    }

    const normalizedStatus = normalizeZendeskReplyStatus(targetStatus)

    if (!normalizedStatus) {
      throw {
        status: 400,
        message: 'status must be one of open, pending, in_progress, solved.',
      }
    }

    const statusContext = await fetchZendeskStatusContext()

    if (normalizedStatus === 'open') {
      return {
        statusContext,
        ticketStatusUpdate: {
          status: 'open',
          ...(statusContext.openCustomStatusId
            ? { custom_status_id: statusContext.openCustomStatusId }
            : {}),
        },
      }
    }

    if (normalizedStatus === 'pending') {
      return {
        statusContext,
        ticketStatusUpdate: {
          status: 'pending',
          ...(statusContext.pendingCustomStatusId
            ? { custom_status_id: statusContext.pendingCustomStatusId }
            : {}),
        },
      }
    }

    if (normalizedStatus === 'solved') {
      return {
        statusContext,
        ticketStatusUpdate: {
          status: 'solved',
          ...(statusContext.solvedCustomStatusId
            ? { custom_status_id: statusContext.solvedCustomStatusId }
            : {}),
        },
      }
    }

    if (normalizedStatus === 'in_progress') {
      if (statusContext.inProgressCustomStatusId) {
        return {
          statusContext,
          ticketStatusUpdate: {
            status: 'open',
            custom_status_id: statusContext.inProgressCustomStatusId,
          },
        }
      }

      return {
        statusContext,
        ticketStatusUpdate: {
          status: 'hold',
        },
      }
    }

    return {
      statusContext,
      ticketStatusUpdate: {},
    }
  }

  async function createZendeskTicketReply(ticketId, input) {
    ensureZendeskConfiguration()

    const normalizedTicketId = Number(ticketId)

    if (!Number.isFinite(normalizedTicketId) || normalizedTicketId <= 0) {
      throw {
        status: 400,
        message: 'ticketId must be numeric.',
      }
    }

    const body = String(input?.body ?? '').trim()

    if (!body) {
      throw {
        status: 400,
        message: 'body is required.',
      }
    }

    const isPublic = input?.isPublic !== false
    const normalizedAuthorId = Number(input?.authorId)
    const authorId = Number.isFinite(normalizedAuthorId) && normalizedAuthorId > 0
      ? normalizedAuthorId
      : null
    const hasStatusInput =
      input?.status !== undefined
      && input?.status !== null
      && String(input?.status).trim() !== ''
    const targetStatus = hasStatusInput
      ? normalizeZendeskReplyStatus(input?.status)
      : null

    if (hasStatusInput && !targetStatus) {
      throw {
        status: 400,
        message: 'status must be one of open, pending, in_progress, solved.',
      }
    }

    const { ticketStatusUpdate, statusContext } = await resolveZendeskReplyStatusUpdate(targetStatus)
    const commentPayload = {
      body,
      public: isPublic,
      ...(authorId ? { author_id: authorId } : {}),
    }

    const payload = await callZendeskApi(`/tickets/${encodeURIComponent(normalizedTicketId)}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        ticket: {
          comment: commentPayload,
          ...ticketStatusUpdate,
        },
      }),
    })
    const ticket = payload?.ticket ?? null

    if (!ticket) {
      throw {
        status: 502,
        message: 'Zendesk update ticket response did not include a ticket.',
      }
    }

    const ticketCustomStatusId = Number(ticket?.custom_status_id)
    let appliedStatus = normalizeZendeskReplyStatus(ticket?.status)

    if (Number.isFinite(ticketCustomStatusId) && ticketCustomStatusId > 0 && statusContext) {
      if (ticketCustomStatusId === statusContext.inProgressCustomStatusId) {
        appliedStatus = 'in_progress'
      } else if (ticketCustomStatusId === statusContext.openCustomStatusId) {
        appliedStatus = 'open'
      } else if (ticketCustomStatusId === statusContext.pendingCustomStatusId) {
        appliedStatus = 'pending'
      } else if (ticketCustomStatusId === statusContext.solvedCustomStatusId) {
        appliedStatus = 'solved'
      }
    }

    return {
      ticketId: normalizedTicketId,
      public: isPublic,
      authorId,
      requestedStatus: targetStatus,
      appliedStatus,
      updatedAt: String(ticket?.updated_at ?? '').trim() || new Date().toISOString(),
    }
  }

  function toZendeskAgentSummary(userEntry) {
    const id = Number(userEntry?.id)

    if (!Number.isFinite(id) || id <= 0) {
      return null
    }

    const role = String(userEntry?.role ?? '').trim().toLowerCase()

    if (!zendeskAssignableRoles.has(role)) {
      return null
    }

    return {
      id,
      name: String(userEntry?.name ?? '').trim() || `Zendesk User #${id}`,
      email: String(userEntry?.email ?? '').trim() || null,
      role,
    }
  }

  async function fetchZendeskSupportAgentById(userId) {
    ensureZendeskConfiguration()

    const normalizedUserId = Number(userId)

    if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
      throw {
        status: 400,
        message: 'zendeskUserId must be numeric.',
      }
    }

    const payload = await callZendeskApi(`/users/${encodeURIComponent(normalizedUserId)}.json`, {
      method: 'GET',
    })
    const normalizedAgent = toZendeskAgentSummary(payload?.user)

    if (!normalizedAgent) {
      throw {
        status: 400,
        message: 'Selected Zendesk user must be an agent or admin.',
      }
    }

    return normalizedAgent
  }

  async function fetchZendeskSupportAgents(limit = 300) {
    ensureZendeskConfiguration()

    const maxResults = toBoundedInteger(limit, 25, 1000, 300)
    const perPage = 100
    const maxPages = 20
    const agents = []
    const seenAgentIds = new Set()

    for (let page = 1; page <= maxPages && agents.length < maxResults; page += 1) {
      const searchParams = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      })
      searchParams.append('role[]', 'agent')
      searchParams.append('role[]', 'admin')

      const payload = await callZendeskApi(`/users.json?${searchParams.toString()}`, {
        method: 'GET',
      })
      const users = Array.isArray(payload?.users) ? payload.users : []

      for (const userEntry of users) {
        const agent = toZendeskAgentSummary(userEntry)

        if (!agent || seenAgentIds.has(agent.id)) {
          continue
        }

        seenAgentIds.add(agent.id)
        agents.push(agent)

        if (agents.length >= maxResults) {
          break
        }
      }

      if (users.length < perPage) {
        break
      }
    }

    return agents
      .slice(0, maxResults)
      .sort((left, right) => {
        const leftName = String(left.name ?? '').trim().toLowerCase()
        const rightName = String(right.name ?? '').trim().toLowerCase()

        if (leftName && rightName && leftName !== rightName) {
          return leftName.localeCompare(rightName)
        }

        const leftEmail = String(left.email ?? '').trim().toLowerCase()
        const rightEmail = String(right.email ?? '').trim().toLowerCase()

        return leftEmail.localeCompare(rightEmail)
      })
  }

  async function fetchZendeskStatusContext() {
    const customStatuses = await fetchZendeskCustomStatuses()

    return {
      customStatuses,
      customStatusById: buildZendeskCustomStatusMap(customStatuses),
      inProgressCustomStatusId:
        resolveZendeskCustomStatusId(customStatuses, 'In Progress', 'open') ||
        resolveZendeskCustomStatusId(customStatuses, 'In Progress'),
      openCustomStatusId:
        resolveZendeskCustomStatusId(customStatuses, 'Open', 'open') ||
        resolveZendeskCustomStatusId(customStatuses, 'Open'),
      pendingCustomStatusId:
        resolveZendeskCustomStatusId(customStatuses, 'Pending', 'pending') ||
        resolveZendeskCustomStatusId(customStatuses, 'Pending'),
      solvedCustomStatusId:
        resolveZendeskCustomStatusId(customStatuses, 'Solved', 'solved') ||
        resolveZendeskCustomStatusId(customStatuses, 'Solved'),
    }
  }

  async function countZendeskTicketsOlderThanHours(query, thresholdHours) {
    const maxPages = 40
    const perPage = 100
    const cutoffMs = Date.now() - thresholdHours * 60 * 60 * 1000
    let page = 1
    let total = 0

    while (page <= maxPages) {
      const pageResults = await fetchZendeskSearchTickets(query, {
        page,
        perPage,
        sortBy: 'created_at',
        sortOrder: 'asc',
      })

      if (pageResults.length === 0) {
        break
      }

      let shouldStop = false

      for (const ticket of pageResults) {
        const createdAtMs = Date.parse(String(ticket?.created_at ?? ''))

        if (!Number.isFinite(createdAtMs)) {
          continue
        }

        if (createdAtMs <= cutoffMs) {
          total += 1
        } else {
          shouldStop = true
          break
        }
      }

      if (shouldStop || pageResults.length < perPage) {
        break
      }

      page += 1
    }

    return total
  }

  async function fetchZendeskTicketsOlderThanHours(query, thresholdHours, limit = 100) {
    const maxPages = 40
    const perPage = 100
    const cutoffMs = Date.now() - thresholdHours * 60 * 60 * 1000
    let page = 1
    const tickets = []

    while (page <= maxPages && tickets.length < limit) {
      const pageResults = await fetchZendeskSearchTickets(query, {
        page,
        perPage,
        sortBy: 'created_at',
        sortOrder: 'asc',
      })

      if (pageResults.length === 0) {
        break
      }

      let shouldStop = false

      for (const ticket of pageResults) {
        const createdAtMs = Date.parse(String(ticket?.created_at ?? ''))

        if (!Number.isFinite(createdAtMs)) {
          continue
        }

        if (createdAtMs <= cutoffMs) {
          tickets.push(ticket)

          if (tickets.length >= limit) {
            break
          }
        } else {
          shouldStop = true
          break
        }
      }

      if (shouldStop || pageResults.length < perPage || tickets.length >= limit) {
        break
      }

      page += 1
    }

    return tickets.sort(
      (left, right) =>
        new Date(String(right?.updated_at ?? '')).getTime() -
        new Date(String(left?.updated_at ?? '')).getTime(),
    )
  }

  async function fetchZendeskSearchTickets(query, options = {}) {
    const page = toBoundedInteger(options.page, 1, 1000, 1)
    const perPage = toBoundedInteger(options.perPage, 1, 100, 50)
    const sortBy = String(options.sortBy ?? 'updated_at').trim() || 'updated_at'
    const sortOrder =
      String(options.sortOrder ?? 'desc').trim().toLowerCase() === 'asc'
        ? 'asc'
        : 'desc'
    const searchParams = new URLSearchParams({
      query,
      page: String(page),
      per_page: String(perPage),
      sort_by: sortBy,
      sort_order: sortOrder,
    })
    const payload = await callZendeskApi(
      `/search.json?${searchParams.toString()}`,
      {
        method: 'GET',
      },
    )
    const results = Array.isArray(payload?.results) ? payload.results : []

    return results.filter((result) => {
      const resultType = String(result?.result_type ?? 'ticket').toLowerCase()
      return resultType === 'ticket'
    })
  }

  async function fetchZendeskUsersByIds(userIds) {
    const normalizedIds = [
      ...new Set(
        userIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ]
    const usersById = new Map()

    if (normalizedIds.length === 0) {
      return usersById
    }

    const chunkSize = 100

    for (let start = 0; start < normalizedIds.length; start += chunkSize) {
      const chunk = normalizedIds.slice(start, start + chunkSize)
      const payload = await callZendeskApi(
        `/users/show_many.json?ids=${encodeURIComponent(chunk.join(','))}`,
        {
          method: 'GET',
        },
      )
      const users = Array.isArray(payload?.users) ? payload.users : []

      users.forEach((entry) => {
        const id = Number(entry?.id)

        if (!Number.isFinite(id) || id <= 0) {
          return
        }

        usersById.set(id, {
          id,
          name: String(entry?.name ?? '').trim() || 'Unknown user',
          email: String(entry?.email ?? '').trim(),
        })
      })
    }

    return usersById
  }

  async function resolveZendeskOrderNumberFieldId() {
    const now = Date.now()

    if (zendeskOrderNumberFieldPromise) {
      return zendeskOrderNumberFieldPromise
    }

    if (zendeskOrderNumberFieldExpiresAt > now) {
      return zendeskOrderNumberFieldId
    }

    zendeskOrderNumberFieldPromise = (async () => {
      try {
        const resolvedFieldId = await fetchZendeskOrderNumberFieldId()

        zendeskOrderNumberFieldId =
          Number.isFinite(Number(resolvedFieldId)) && Number(resolvedFieldId) > 0
            ? Number(resolvedFieldId)
            : null
        zendeskOrderNumberFieldExpiresAt = Date.now() + zendeskTicketFieldCacheTtlMs
        return zendeskOrderNumberFieldId
      } catch (error) {
        zendeskOrderNumberFieldId = null
        zendeskOrderNumberFieldExpiresAt = Date.now() + zendeskTicketFieldErrorCacheTtlMs
        console.warn('Unable to resolve Zendesk order-number field.', error)
        return null
      } finally {
        zendeskOrderNumberFieldPromise = null
      }
    })()

    return zendeskOrderNumberFieldPromise
  }

  async function fetchZendeskOrderNumberFieldId() {
    const perPage = 100
    const maxPages = 10

    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await callZendeskApi(
        `/ticket_fields.json?page=${page}&per_page=${perPage}`,
        {
          method: 'GET',
        },
      )
      const ticketFields = Array.isArray(payload?.ticket_fields)
        ? payload.ticket_fields
        : []
      const orderNumberField = ticketFields.find(isZendeskOrderNumberTicketField)

      if (orderNumberField) {
        const id = Number(orderNumberField?.id)
        return Number.isFinite(id) && id > 0 ? id : null
      }

      if (!payload?.next_page || ticketFields.length < perPage) {
        break
      }
    }

    return null
  }

  async function fetchZendeskCustomStatuses() {
    const apiBaseUrl = buildZendeskApiBaseUrl()

    if (!apiBaseUrl) {
      return []
    }

    const response = await fetch(`${apiBaseUrl}/custom_statuses.json`, {
      method: 'GET',
      headers: {
        Authorization: buildZendeskAuthorizationHeader(),
        'Content-Type': 'application/json',
      },
    })

    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      // Custom statuses can be unavailable by plan/permissions; fallback to status queries.
      if ([401, 403, 404].includes(response.status)) {
        return []
      }

      throw {
        status: 502,
        message: `Zendesk custom status request failed with status ${response.status}.`,
      }
    }

    return (Array.isArray(payload?.custom_statuses) ? payload.custom_statuses : [])
      .map((entry) => ({
        id: Number(entry?.id),
        agentLabel: String(entry?.agent_label ?? entry?.name ?? '').trim(),
        endUserLabel: String(entry?.end_user_label ?? '').trim(),
        statusCategory: String(entry?.status_category ?? '').trim(),
      }))
      .filter((entry) => Number.isFinite(entry.id) && entry.id > 0)
  }

  async function callZendeskApi(path, options = {}) {
    const apiBaseUrl = buildZendeskApiBaseUrl()

    if (!apiBaseUrl) {
      throw {
        status: 500,
        message: 'Missing or invalid ZENDESK_URL in environment configuration.',
      }
    }

    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: 'GET',
      ...options,
      headers: {
        Authorization: buildZendeskAuthorizationHeader(),
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      const rawMessage =
        String(payload?.description || payload?.error || '').trim() ||
        `Zendesk API request failed with status ${response.status}.`
      const message =
        rawMessage === 'invalid_token' && !zendeskEmail
          ? 'Zendesk rejected ZENDESK_API_TOKEN. If this is an API token, also set ZENDESK_EMAIL.'
          : rawMessage

      throw {
        status: 502,
        message,
      }
    }

    return payload
  }

  async function fetchZendeskTicketCount(query) {
    const payload = await callZendeskApi(
      `/search/count.json?query=${encodeURIComponent(query)}`,
      {
        method: 'GET',
      },
    )

    const numericCount =
      Number(payload?.count?.value ?? payload?.count ?? payload?.total ?? 0)

    return Number.isFinite(numericCount) && numericCount >= 0
      ? Math.round(numericCount)
      : 0
  }

  return {
    createZendeskTicketReply,
    createZendeskSupportTicket,
    fetchZendeskSupportAgentById,
    fetchZendeskSupportAgents,
    fetchZendeskSupportAlertTicketsSnapshot,
    fetchZendeskSupportAlerts,
    fetchZendeskSupportTicketsSnapshot,
    fetchZendeskTicketConversation,
    fetchZendeskTicketSummary,
  }
}

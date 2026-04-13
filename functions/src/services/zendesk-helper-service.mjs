export function createZendeskHelperService({
  buildZendeskOrigin,
  normalizeLookupValue,
}) {
  function buildZendeskStatusQueries(statusContext) {
    const inProgressQuery = statusContext.inProgressCustomStatusId
      ? buildZendeskCustomStatusCountQuery(statusContext.inProgressCustomStatusId)
      : 'type:ticket status:hold'
    const openCustomStatusQuery = statusContext.openCustomStatusId
      ? buildZendeskCustomStatusCountQuery(statusContext.openCustomStatusId)
      : null

    return {
      openTotalQuery: 'type:ticket status:open',
      inProgressQuery,
      openCustomStatusQuery,
      pendingQuery: statusContext.pendingCustomStatusId
        ? buildZendeskCustomStatusCountQuery(statusContext.pendingCustomStatusId)
        : 'type:ticket status:pending',
      solvedQuery: statusContext.solvedCustomStatusId
        ? buildZendeskCustomStatusCountQuery(statusContext.solvedCustomStatusId)
        : 'type:ticket status:solved',
    }
  }

  function buildZendeskCustomStatusMap(customStatuses) {
    const map = new Map()

    customStatuses.forEach((entry) => {
      const id = Number(entry?.id)

      if (!Number.isFinite(id) || id <= 0) {
        return
      }

      map.set(id, {
        id,
        agentLabel: String(entry?.agentLabel ?? '').trim(),
        endUserLabel: String(entry?.endUserLabel ?? '').trim(),
        statusCategory: String(entry?.statusCategory ?? '').trim(),
      })
    })

    return map
  }

  function normalizeZendeskSupportTicket(
    ticket,
    statusContext,
    usersById,
    orderNumberFieldId = null,
  ) {
    const id = Number(ticket?.id)
    const requesterId = Number(ticket?.requester_id)
    const assigneeId = Number(ticket?.assignee_id)
    const requester = usersById.get(requesterId)
    const assignee = usersById.get(assigneeId)
    const statusLabel = resolveZendeskTicketStatusLabel(ticket, statusContext)
    const orderNumber = resolveZendeskOrderNumber(ticket, orderNumberFieldId)

    return {
      id: Number.isFinite(id) ? id : 0,
      subject: String(ticket?.subject ?? '').trim() || `Ticket #${id}`,
      orderNumber,
      status: String(ticket?.status ?? '').trim().toLowerCase(),
      statusLabel,
      priority: String(ticket?.priority ?? '').trim().toLowerCase() || 'normal',
      requesterName: String(requester?.name ?? 'Unknown requester'),
      assigneeName: String(assignee?.name ?? 'Unassigned'),
      createdAt: String(ticket?.created_at ?? ''),
      updatedAt: String(ticket?.updated_at ?? ''),
      url: buildZendeskTicketUrl(id),
    }
  }

  function resolveZendeskTicketStatusLabel(ticket, statusContext) {
    const customStatusId = Number(ticket?.custom_status_id)

    if (Number.isFinite(customStatusId) && customStatusId > 0) {
      const customStatus = statusContext.customStatusById.get(customStatusId)

      if (customStatus?.agentLabel) {
        return customStatus.agentLabel
      }
    }

    return formatZendeskStatusLabel(ticket?.status)
  }

  function formatZendeskStatusLabel(statusValue) {
    const normalized = normalizeLookupValue(statusValue)

    if (!normalized) {
      return 'Unknown'
    }

    return normalized
      .split(' ')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ')
  }

  function buildZendeskTicketUrl(ticketId) {
    const origin = buildZendeskOrigin()

    if (!origin || !Number.isFinite(Number(ticketId)) || Number(ticketId) <= 0) {
      return null
    }

    return `${origin}/agent/tickets/${Number(ticketId)}`
  }

  function resolveZendeskOrderNumber(ticket, orderNumberFieldId) {
    const normalizedFieldId = Number(orderNumberFieldId)

    if (!Number.isFinite(normalizedFieldId) || normalizedFieldId <= 0) {
      return null
    }

    const customFields = Array.isArray(ticket?.custom_fields) ? ticket.custom_fields : []
    const matchingField = customFields.find(
      (entry) => Number(entry?.id) === normalizedFieldId,
    )
    const rawValue = matchingField?.value

    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return String(rawValue)
    }

    if (typeof rawValue === 'string') {
      const trimmedValue = rawValue.trim()
      return trimmedValue || null
    }

    return null
  }

  function isZendeskOrderNumberTicketField(ticketField) {
    const candidateLabels = [
      ticketField?.title,
      ticketField?.raw_title,
      ticketField?.title_in_portal,
      ticketField?.raw_title_in_portal,
      ticketField?.tag,
      ticketField?.key,
    ]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)

    if (candidateLabels.length === 0) {
      return false
    }

    return candidateLabels.some((label) => {
      const rawLabel = label.toLowerCase()
      const normalizedLabel = normalizeLookupValue(label)

      return (
        /\border\s*#/.test(rawLabel) ||
        /\border\s*(number|num|no|nr)\b/.test(rawLabel) ||
        normalizedLabel.includes('order number') ||
        normalizedLabel.includes('order num') ||
        normalizedLabel.includes('order no')
      )
    })
  }

  function resolveZendeskCustomStatusId(customStatuses, label, statusCategory = null) {
    const normalizedTarget = normalizeLookupValue(label)

    if (!normalizedTarget || !Array.isArray(customStatuses) || customStatuses.length === 0) {
      return null
    }

    const filteredStatuses = statusCategory
      ? customStatuses.filter(
          (entry) =>
            normalizeLookupValue(entry?.statusCategory) ===
            normalizeLookupValue(statusCategory),
        )
      : customStatuses

    const exactMatch = filteredStatuses.find((entry) => {
      const candidateLabels = [entry?.agentLabel, entry?.endUserLabel]
        .map((value) => normalizeLookupValue(value))
        .filter(Boolean)

      return candidateLabels.includes(normalizedTarget)
    })

    if (exactMatch) {
      return Number(exactMatch.id)
    }

    const containsMatch = filteredStatuses.find((entry) => {
      const candidateLabels = [entry?.agentLabel, entry?.endUserLabel]
        .map((value) => normalizeLookupValue(value))
        .filter(Boolean)

      return candidateLabels.some((candidate) => candidate.includes(normalizedTarget))
    })

    return containsMatch ? Number(containsMatch.id) : null
  }

  function buildZendeskCustomStatusCountQuery(customStatusId) {
    return `type:ticket custom_status_id:${Number(customStatusId)}`
  }

  return {
    buildZendeskCustomStatusCountQuery,
    buildZendeskCustomStatusMap,
    buildZendeskStatusQueries,
    buildZendeskTicketUrl,
    formatZendeskStatusLabel,
    isZendeskOrderNumberTicketField,
    normalizeZendeskSupportTicket,
    resolveZendeskCustomStatusId,
    resolveZendeskOrderNumber,
    resolveZendeskTicketStatusLabel,
  }
}

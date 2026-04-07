export type SupportAlertsSnapshot = {
  generatedAt: string
  agentUrl: string | null
  alerts: {
    newOver24Hours: number
    openOver24Hours: number
    inProgressOver48Hours: number
    pendingOver48Hours: number
  }
}

export type SupportTicket = {
  id: number
  subject: string
  orderNumber: string | null
  status: string
  statusLabel: string
  priority: string
  requesterName: string
  assigneeName: string
  createdAt: string
  updatedAt: string
  url: string | null
}

export type SupportTicketsSnapshot = {
  generatedAt: string
  agentUrl: string | null
  tickets: SupportTicket[]
}

export type SupportAlertTicketsSnapshot = {
  generatedAt: string
  agentUrl: string | null
  buckets: {
    newOver24Hours: SupportTicket[]
    openOver24Hours: SupportTicket[]
    inProgressOver48Hours: SupportTicket[]
    pendingOver48Hours: SupportTicket[]
  }
}

export type SupportTicketComment = {
  id: number
  authorName: string
  createdAt: string
  body: string
  public: boolean
}

export type SupportTicketConversationSnapshot = {
  generatedAt: string
  ticket: SupportTicket
  comments: SupportTicketComment[]
}

export type CreateSupportTicketInput = {
  subject: string
  description: string
  requesterName?: string
  requesterEmail?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

type SupportFetchOptions = {
  refresh?: boolean
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error ?? 'Request failed.')
  }

  return payload as T
}

function withRefreshQuery(path: string, refresh = false) {
  if (!refresh) {
    return path
  }

  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}refresh=1`
}

export function fetchSupportAlerts(options: SupportFetchOptions = {}) {
  return request<SupportAlertsSnapshot>(
    withRefreshQuery('/api/support/alerts', options.refresh === true),
  )
}

export function fetchSupportAlertTickets(limitPerBucket = 100, options: SupportFetchOptions = {}) {
  return request<SupportAlertTicketsSnapshot>(
    withRefreshQuery(
      `/api/support/alerts/tickets?limitPerBucket=${limitPerBucket}`,
      options.refresh === true,
    ),
  )
}

export function fetchSupportTickets(limit = 50, options: SupportFetchOptions = {}) {
  return request<SupportTicketsSnapshot>(
    withRefreshQuery(`/api/support/tickets?limit=${limit}`, options.refresh === true),
  )
}

export function fetchSupportTicketConversation(ticketId: number) {
  return request<SupportTicketConversationSnapshot>(
    `/api/support/tickets/${ticketId}/conversation`,
  )
}

export function createSupportTicket(input: CreateSupportTicketInput) {
  return request<{ ticket: SupportTicket }>('/api/support/tickets', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

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
  htmlBody: string | null
  public: boolean
  attachments: Array<{
    id: number | null
    fileName: string
    url: string
    contentType: string | null
    sizeBytes: number | null
    thumbnailUrl: string | null
  }>
}

export type ZendeskSupportAgent = {
  id: number
  name: string
  email: string | null
  role: string
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

export type ReplySupportTicketInput = {
  body: string
  isPublic: boolean
  status?: SupportReplyStatus
}

export type SupportReplyStatus = 'open' | 'pending' | 'in_progress' | 'solved'

type SupportFetchOptions = {
  refresh?: boolean
}

import { apiRequest } from '../api-client'

function withRefreshQuery(path: string, refresh = false) {
  if (!refresh) {
    return path
  }

  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}refresh=1`
}

export function fetchSupportAlerts(options: SupportFetchOptions = {}) {
  return apiRequest<SupportAlertsSnapshot>(
    withRefreshQuery('/api/support/alerts', options.refresh === true),
  )
}

export function fetchSupportAlertTickets(limitPerBucket = 100, options: SupportFetchOptions = {}) {
  return apiRequest<SupportAlertTicketsSnapshot>(
    withRefreshQuery(
      `/api/support/alerts/tickets?limitPerBucket=${limitPerBucket}`,
      options.refresh === true,
    ),
  )
}

export function fetchSupportTickets(limit = 50, options: SupportFetchOptions = {}) {
  return apiRequest<SupportTicketsSnapshot>(
    withRefreshQuery(`/api/support/tickets?limit=${limit}`, options.refresh === true),
  )
}

export function fetchSupportTicketConversation(ticketId: number) {
  return apiRequest<SupportTicketConversationSnapshot>(
    `/api/support/tickets/${ticketId}/conversation`,
  )
}

export function fetchZendeskSupportAgents(limit = 300) {
  return apiRequest<{ generatedAt: string; agents: ZendeskSupportAgent[] }>(
    `/api/support/zendesk-agents?limit=${limit}`,
  )
}

export function replySupportTicket(ticketId: number, input: ReplySupportTicketInput) {
  return apiRequest<{
    conversation: SupportTicketConversationSnapshot | null
    reply: {
      ticketId: number
      isPublic: boolean
      authorId: number
      authorName: string
      status: SupportReplyStatus | null
      appliedStatus: SupportReplyStatus | null
      updatedAt: string
    }
  }>(`/api/support/tickets/${ticketId}/replies`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function createSupportTicket(input: CreateSupportTicketInput) {
  return apiRequest<{ ticket: SupportTicket }>('/api/support/tickets', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

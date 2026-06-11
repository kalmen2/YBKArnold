import { apiRequest } from '../api-client'

export type SmsBridgeLog = {
  id: string
  status: string
  createdAt: string | null
  updatedAt: string | null
  fromPhone: string | null
  toPhone: string | null
  inboundText: string | null
  telegramForwardText: string | null
  telegramReplyText: string | null
  telegramReplyFrom: string | null
  twilioMessageSid: string | null
  twilioReplySid: string | null
  telegramRequestMessageId: number | null
  telegramReplyMessageId: number | null
  errorMessage: string | null
  manusBotUsername: string | null
}

export type AdminSmsBridgeLogsResponse = {
  logs: SmsBridgeLog[]
}

function withQuery(path: string, query: Record<string, string | number | null | undefined>) {
  const url = new URL(path, window.location.origin)

  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      return
    }

    url.searchParams.set(key, String(value))
  })

  return `${url.pathname}${url.search}`
}

export function fetchAdminSmsBridgeLogs(limit = 120) {
  return apiRequest<AdminSmsBridgeLogsResponse>(
    withQuery('/api/admin/sms-bridge/logs', { limit }),
  )
}

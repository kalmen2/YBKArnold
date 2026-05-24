import { apiRequest } from '../api-client'

export type AppAlert = {
  id: string
  title: string
  message: string
  isUpdate?: boolean
  createdAt: string | null
  createdByEmail: string | null
  isRead: boolean
  readAt: string | null
}

export function fetchMyAlerts(limit = 30) {
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(200, Number(limit)))
    : 30

  return apiRequest<{
    alerts: AppAlert[]
    unreadCount: number
  }>(`/api/alerts/my?limit=${encodeURIComponent(String(normalizedLimit))}`)
}

export function markMyAlertRead(alertId: string) {
  const normalizedAlertId = String(alertId ?? '').trim()

  return apiRequest<{
    ok: boolean
    alertId: string
    isRead: boolean
    readAt: string
  }>(`/api/alerts/${encodeURIComponent(normalizedAlertId)}/read`, {
    method: 'POST',
  })
}

export function markMyAlertUnread(alertId: string) {
  const normalizedAlertId = String(alertId ?? '').trim()

  return apiRequest<{
    ok: boolean
    alertId: string
    isRead: boolean
    readAt: string | null
  }>(`/api/alerts/${encodeURIComponent(normalizedAlertId)}/unread`, {
    method: 'POST',
  })
}

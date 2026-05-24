import { apiRequest } from '../api-client'

export type VisitorVisitType = 'delivery' | 'vendor' | 'service' | 'inspection' | 'other'

export type VisitorLogEntry = {
  id: string
  name: string
  company: string
  visitType: VisitorVisitType
  otherVisitType: string | null
  durationMinutes: number
  createdAt: string | null
  expiresAt: string | null
  createdBy: {
    uid: string | null
    email: string | null
    displayName: string | null
  }
}

export type VisitorSavedShortcut = {
  id: string
  name: string
  company: string
  visitType: VisitorVisitType
  otherVisitType: string | null
  createdAt: string | null
  updatedAt: string | null
  updatedBy: {
    uid: string | null
    email: string | null
    displayName: string | null
  }
}

export type VisitorsSavedResponse = {
  shortcuts: VisitorSavedShortcut[]
}

export type VisitorsRecentResponse = {
  windowMinutes: number
  generatedAt: string
  entries: VisitorLogEntry[]
}

export type AdminVisitorsHistoryUser = {
  uid: string
  displayName: string | null
  email: string | null
  role: string | null
  isOwner: boolean
  approvalStatus: string | null
  totalEntries: number
  totalMinutes: number
  totalHours: number
  activeEntries: number
  lastVisitAt: string | null
  entries: VisitorLogEntry[]
}

export type AdminVisitorsHistoryResponse = {
  generatedAt: string
  users: AdminVisitorsHistoryUser[]
  meta: {
    totalUsers: number
    usersLimit: number
    entriesPerUser: number
  }
}

export type CreateVisitorLogInput = {
  name: string
  company: string
  visitType: VisitorVisitType
  otherVisitType?: string | null
  durationMinutes: number
}

export type CreateVisitorSavedShortcutInput = {
  name: string
  company: string
  visitType: VisitorVisitType
  otherVisitType?: string | null
}

export function createVisitorLog(input: CreateVisitorLogInput) {
  return apiRequest<{ entry: VisitorLogEntry }>('/api/visitors/logs', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function fetchSavedVisitorShortcuts(limit = 120) {
  return apiRequest<VisitorsSavedResponse>(`/api/visitors/saved?limit=${limit}`)
}

export function createSavedVisitorShortcut(input: CreateVisitorSavedShortcutInput) {
  return apiRequest<{ shortcut: VisitorSavedShortcut }>('/api/visitors/saved', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteSavedVisitorShortcut(shortcutId: string) {
  return apiRequest<{ ok: boolean, shortcutId: string }>(
    `/api/visitors/saved/${encodeURIComponent(shortcutId)}`,
    {
      method: 'DELETE',
    },
  )
}

export function fetchRecentVisitorLogs(windowMinutes = 60, limit = 120) {
  return apiRequest<VisitorsRecentResponse>(
    `/api/visitors/logs/recent?minutes=${windowMinutes}&limit=${limit}`,
  )
}

export function fetchAdminVisitorsHistory(options?: {
  uid?: string | null
  search?: string | null
  usersLimit?: number
  entriesPerUser?: number
}) {
  const params = new URLSearchParams()

  if (options?.uid) {
    params.set('uid', String(options.uid))
  }

  if (options?.search) {
    params.set('search', String(options.search))
  }

  if (typeof options?.usersLimit === 'number' && Number.isFinite(options.usersLimit)) {
    params.set('usersLimit', String(options.usersLimit))
  }

  if (typeof options?.entriesPerUser === 'number' && Number.isFinite(options.entriesPerUser)) {
    params.set('entriesPerUser', String(options.entriesPerUser))
  }

  const queryString = params.toString()

  return apiRequest<AdminVisitorsHistoryResponse>(
    `/api/admin/visitors/history${queryString ? `?${queryString}` : ''}`,
  )
}

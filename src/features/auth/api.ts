import { apiRequest } from '../api-client'
import type { AppAuthUser } from '../../auth/types'

export type AdminWorkerOption = {
  id: string
  workerNumber: string | null
  fullName: string
  role: string
  email: string
}

export type AuthBootstrapResponse = {
  users: AppAuthUser[]
  ownerEmail: string
  workers: AdminWorkerOption[]
}

export type AdminAlertRecord = {
  id: string
  title: string
  message: string
  isUpdate?: boolean
  targetMode: 'all' | 'selected'
  targetUserCount: number
  pushTokenCount: number
  pushAcceptedCount: number
  pushErrorCount: number
  createdAt: string | null
  createdByEmail: string | null
}

export type AdminBootstrapResponse = {
  users: AppAuthUser[]
  ownerEmail: string
  alerts: AdminAlertRecord[]
}

export type ListLogUsersResponse = {
  users: unknown[]
}

export function fetchAuthBootstrap() {
  return apiRequest<AuthBootstrapResponse>('/api/auth/bootstrap')
}

export function fetchAdminBootstrap(alertsLimit = 80) {
  return apiRequest<AdminBootstrapResponse>(`/api/admin/bootstrap?alertsLimit=${alertsLimit}`)
}

export function fetchAuthLogs(limit = 300) {
  return apiRequest<{ users: unknown[] }>(`/api/auth/logs/users?limit=${limit}`)
}

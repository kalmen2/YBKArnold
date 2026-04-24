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

export type AdminUserSignInLog = {
  user: AppAuthUser
  lastLoginAt: string | null
  lastActivityAt: string | null
  signIns: Array<{
    signedInAt: string | null
    clientPlatform: 'web' | 'app' | null
    ipAddress: string | null
    localIpAddress: string | null
    userAgent: string | null
  }>
}

export type AuthSignInLogsResponse = {
  users: AdminUserSignInLog[]
}

export function fetchAuthBootstrap() {
  return apiRequest<AuthBootstrapResponse>('/api/auth/bootstrap')
}

export function fetchAdminBootstrap(alertsLimit = 80) {
  return apiRequest<AdminBootstrapResponse>(`/api/admin/bootstrap?alertsLimit=${alertsLimit}`)
}

export function fetchAuthLogs(limit = 300, signInsLimit = 20) {
  return apiRequest<AuthSignInLogsResponse>(`/api/auth/logs/users?limit=${limit}&signInsLimit=${signInsLimit}`)
}

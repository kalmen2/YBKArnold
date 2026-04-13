export type AppAuthRole = 'standard' | 'manager' | 'admin'

export type AppAuthApprovalStatus = 'pending' | 'approved'

export type AppAuthUser = {
  uid: string
  email: string
  displayName: string | null
  photoURL: string | null
  role: AppAuthRole
  approvalStatus: AppAuthApprovalStatus
  isOwner: boolean
  isAdmin: boolean
  isManager: boolean
  isApproved: boolean
  approvedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  lastLoginAt: string | null
  accessStartHourUtc: number | null
  accessEndHourUtc: number | null
  accessTimeZone: string | null
  hasLoginHoursRestriction: boolean
  linkedWorkerId: string | null
  linkedWorkerNumber: string | null
  linkedWorkerName: string | null
  clientPlatforms: Array<'web' | 'app'>
  lastLoginClientPlatform: 'web' | 'app' | null
  clientAccessMode: 'web_and_app' | 'web_only' | 'app_only'
  allowedClientPlatforms: Array<'web' | 'app'>
  hasWebAccess: boolean
  hasAppAccess: boolean
  hasWebSignIn: boolean
  hasAppSignIn: boolean
}

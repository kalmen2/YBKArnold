export type AppAuthRole =
  | 'shop_worker'
  | 'office_worker'
  | 'manager'
  | 'sales_rep'
  | 'admin'

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
  isSalesRep: boolean
  isShopWorker: boolean
  isOfficeWorker: boolean
  canViewOrderValue: boolean
  canViewLaborCost: boolean
  canViewFullFinancials: boolean
  isApproved: boolean
  approvedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  lastLoginAt: string | null
  lastActivityAt: string | null
  lastSignInIpAddress: string | null
  lastSignInLocalIpAddress: string | null
  lastSignInUserAgent: string | null
  signInHistory: Array<{
    signedInAt: string | null
    clientPlatform: 'web' | 'app' | null
    ipAddress: string | null
    localIpAddress: string | null
    userAgent: string | null
  }>
  accessStartHourUtc: number | null
  accessEndHourUtc: number | null
  accessTimeZone: string | null
  hasLoginHoursRestriction: boolean
  linkedWorkerId: string | null
  linkedWorkerNumber: string | null
  linkedWorkerName: string | null
  linkedZendeskUserId: number | null
  linkedZendeskUserEmail: string | null
  linkedZendeskUserName: string | null
  linkedSalesRepId: string | null
  linkedSalesRepName: string | null
  salesTerritoryStates: string[]
  clientPlatforms: Array<'web' | 'app'>
  lastLoginClientPlatform: 'web' | 'app' | null
  clientAccessMode: 'web_and_app' | 'web_only' | 'app_only'
  allowedClientPlatforms: Array<'web' | 'app'>
  hasWebAccess: boolean
  hasAppAccess: boolean
  hasWebSignIn: boolean
  hasAppSignIn: boolean
}

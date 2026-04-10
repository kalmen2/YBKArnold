export type AppAuthRole = 'standard' | 'admin'

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
}

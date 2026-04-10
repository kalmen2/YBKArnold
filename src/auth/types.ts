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
}

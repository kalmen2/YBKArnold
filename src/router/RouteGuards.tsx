import type { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

export function RequireAdminRoute({ children }: { children: ReactElement }) {
  const { appUser } = useAuth()

  if (!appUser?.isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

export function RequireManagerRoute({ children }: { children: ReactElement }) {
  const { appUser } = useAuth()

  if (!appUser?.isManager) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

export function RequireManagerOrAdminRoute({ children }: { children: ReactElement }) {
  const { appUser } = useAuth()

  if (!appUser?.isManager && !appUser?.isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
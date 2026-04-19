import { createContext } from 'react'
import type { User } from 'firebase/auth'
import type { AppAuthUser } from './types'

export type AuthContextValue = {
  firebaseUser: User | null
  appUser: AppAuthUser | null
  isInitializing: boolean
  isAuthenticated: boolean
  profileError: string | null
  ownerEmail: string
  isFirebaseConfigured: boolean
  signInWithGoogle: () => Promise<void>
  signOutFromApp: () => Promise<void>
  refreshProfile: () => Promise<void>
  getIdToken: () => Promise<string>
  logActivity: (input: {
    action: string
    target?: string | null
    path?: string | null
    metadata?: unknown
  }) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

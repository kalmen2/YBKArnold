import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import {
  firebaseAuth,
  googleAuthProvider,
  isFirebaseAuthConfigured,
} from './firebase'
import type { AppAuthUser } from './types'

const ownerEmail = 'kal@ybkarnold.com'

type AuthContextValue = {
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
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function requestCurrentUser(idToken: string) {
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  })

  const payload = await response.json().catch(() => ({}))

  return {
    response,
    payload,
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Authentication failed.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [appUser, setAppUser] = useState<AppAuthUser | null>(null)
  const [isFirebaseResolved, setIsFirebaseResolved] = useState(false)
  const [isProfileLoading, setIsProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [ownerEmailValue, setOwnerEmailValue] = useState(ownerEmail)

  const syncProfile = useCallback(async (user: User) => {
    setIsProfileLoading(true)

    try {
      let idToken = await user.getIdToken()
      let { response, payload } = await requestCurrentUser(idToken)

      if (response.status === 401) {
        idToken = await user.getIdToken(true)
        const retryResult = await requestCurrentUser(idToken)
        response = retryResult.response
        payload = retryResult.payload
      }

      const nextOwnerEmail = String(payload?.ownerEmail ?? '').trim().toLowerCase()

      if (nextOwnerEmail) {
        setOwnerEmailValue(nextOwnerEmail)
      }

      if (!response.ok) {
        if (payload?.user) {
          setAppUser(payload.user as AppAuthUser)
          setProfileError(
            typeof payload.error === 'string' ? payload.error : null,
          )
          return
        }

        throw new Error(
          typeof payload?.error === 'string'
            ? payload.error
            : 'Unable to sync profile.',
        )
      }

      setAppUser((payload?.user as AppAuthUser | undefined) ?? null)
      setProfileError(null)
    } catch (error) {
      setAppUser(null)
      setProfileError(getErrorMessage(error))
    } finally {
      setIsProfileLoading(false)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
      setFirebaseUser(nextUser)
      setIsFirebaseResolved(true)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isFirebaseResolved) {
      return
    }

    if (!firebaseUser) {
      setAppUser(null)
      setProfileError(null)
      setIsProfileLoading(false)
      setOwnerEmailValue(ownerEmail)
      return
    }

    void syncProfile(firebaseUser)
  }, [isFirebaseResolved, firebaseUser, syncProfile])

  const signInWithGoogle = useCallback(async () => {
    if (!isFirebaseAuthConfigured) {
      throw new Error('Firebase Auth configuration is missing.')
    }

    setProfileError(null)
    await signInWithPopup(firebaseAuth, googleAuthProvider)
  }, [])

  const signOutFromApp = useCallback(async () => {
    await signOut(firebaseAuth)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!firebaseUser) {
      setAppUser(null)
      setProfileError(null)
      return
    }

    await syncProfile(firebaseUser)
  }, [firebaseUser, syncProfile])

  const getIdToken = useCallback(async () => {
    const activeUser = firebaseAuth.currentUser

    if (!activeUser) {
      throw new Error('You must sign in first.')
    }

    return activeUser.getIdToken()
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const isInitializing =
      !isFirebaseResolved || (Boolean(firebaseUser) && isProfileLoading)

    return {
      firebaseUser,
      appUser,
      isInitializing,
      isAuthenticated: Boolean(firebaseUser),
      profileError,
      ownerEmail: ownerEmailValue,
      isFirebaseConfigured: isFirebaseAuthConfigured,
      signInWithGoogle,
      signOutFromApp,
      refreshProfile,
      getIdToken,
    }
  }, [
    appUser,
    firebaseUser,
    getIdToken,
    isProfileLoading,
    isFirebaseResolved,
    ownerEmailValue,
    profileError,
    refreshProfile,
    signInWithGoogle,
    signOutFromApp,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.')
  }

  return context
}

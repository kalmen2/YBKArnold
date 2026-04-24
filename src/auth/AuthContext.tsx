import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { AuthContext, type AuthContextValue } from './auth-context.ts'
import { clearCachedToken } from '../features/api-client'
import type { AppAuthUser } from './types'

const ownerEmail = 'kal@ybkarnold.com'
const authProfileRequestTimeoutMs = 7000
const clickProfileSyncIntervalMs = 60000
const cachedAuthUserStorageKey = 'arnold.auth.cached-user.v1'
// Send an activity heartbeat at a low fixed cadence while the user is active.
const ACTIVITY_FLUSH_INTERVAL_MS = 30_000

function readCachedAuthUser() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(cachedAuthUserStorageKey)

    if (!rawValue) {
      return null
    }

    const parsedValue = JSON.parse(rawValue) as AppAuthUser | null

    return parsedValue && typeof parsedValue === 'object'
      ? parsedValue
      : null
  } catch {
    return null
  }
}

function persistCachedAuthUser(user: AppAuthUser | null) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (user) {
      window.localStorage.setItem(cachedAuthUserStorageKey, JSON.stringify(user))
      return
    }

    window.localStorage.removeItem(cachedAuthUserStorageKey)
  } catch {
    // Cache writes are best-effort only.
  }
}

async function requestCurrentUser(idToken: string) {
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => {
    abortController.abort()
  }, authProfileRequestTimeoutMs)

  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'x-client-platform': 'web',
      },
      signal: abortController.signal,
    })

    const payload = await response.json().catch(() => ({}))

    return {
      response,
      payload,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Access check timed out. Please refresh.')
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Authentication failed.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialCachedUserRef = useRef<AppAuthUser | null>(readCachedAuthUser())
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [appUser, setAppUser] = useState<AppAuthUser | null>(initialCachedUserRef.current)
  const [isFirebaseResolved, setIsFirebaseResolved] = useState(false)
  const [hasResolvedProfile, setHasResolvedProfile] = useState(Boolean(initialCachedUserRef.current))
  const [profileError, setProfileError] = useState<string | null>(null)
  const [ownerEmailValue, setOwnerEmailValue] = useState(ownerEmail)
  const hasPendingActivityRef = useRef(false)

  const flushActivityQueue = useCallback(async () => {
    if (!hasPendingActivityRef.current) {
      return
    }

    const activeUser = firebaseAuth.currentUser

    if (!activeUser) {
      hasPendingActivityRef.current = false
      return
    }

    hasPendingActivityRef.current = false

    try {
      const idToken = await activeUser.getIdToken()

      const response = await fetch('/api/auth/activity', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'x-client-platform': 'web',
        },
      })

      if (response.status === 401 || response.status === 403) {
        clearCachedToken()
        await signOut(firebaseAuth)
      }
    } catch {
      // Best-effort heartbeat only; never block UX.
    }
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void flushActivityQueue()
    }, ACTIVITY_FLUSH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [flushActivityQueue])

  const logActivity = useCallback((input: {
    action: string
    target?: string | null
    path?: string | null
    metadata?: unknown
  }) => {
    void input

    if (!firebaseAuth.currentUser) {
      return
    }

    hasPendingActivityRef.current = true
  }, [])

  const syncProfile = useCallback(async (user: User) => {

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
        const responseErrorMessage =
          typeof payload?.error === 'string'
            ? payload.error
            : ''

        if (response.status === 401) {
          setAppUser(null)
          persistCachedAuthUser(null)
          setProfileError(responseErrorMessage || 'Session expired. Please sign in again.')
          clearCachedToken()
          await signOut(firebaseAuth)
          return
        }

        const isHoursBlockedError =
          response.status === 403
          && responseErrorMessage.toLowerCase().includes('access is currently blocked')

        if (isHoursBlockedError) {
          setAppUser(null)
          persistCachedAuthUser(null)
          setProfileError(responseErrorMessage || 'Access is currently blocked.')
          clearCachedToken()
          await signOut(firebaseAuth)
          return
        }

        if (payload?.user) {
          const nextUser = payload.user as AppAuthUser

          setAppUser(nextUser)
          persistCachedAuthUser(nextUser)
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

      const nextUser = (payload?.user as AppAuthUser | undefined) ?? null

      setAppUser(nextUser)
      persistCachedAuthUser(nextUser)
      setProfileError(null)
    } catch (error) {
      setProfileError(getErrorMessage(error))
    } finally {
      setHasResolvedProfile(true)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
      setFirebaseUser(nextUser)

      if (!nextUser) {
        setAppUser(null)
        // Keep local cached profile across sign-outs so repeat logins can
        // hydrate instantly while we re-validate with /api/auth/me.
        setHasResolvedProfile(true)
        setIsFirebaseResolved(true)
        return
      }

      const cachedUser = readCachedAuthUser()
      const cachedEmail = String(cachedUser?.email ?? '').trim().toLowerCase()
      const firebaseEmail = String(nextUser.email ?? '').trim().toLowerCase()
      const canUseCachedUser = Boolean(cachedUser && cachedEmail && cachedEmail === firebaseEmail)

      if (canUseCachedUser) {
        setAppUser(cachedUser)
        setHasResolvedProfile(true)
      } else {
        setAppUser(null)
        setHasResolvedProfile(false)
      }

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
      setHasResolvedProfile(true)
      setOwnerEmailValue(ownerEmail)
      return
    }

    void syncProfile(firebaseUser)
  }, [isFirebaseResolved, firebaseUser, syncProfile])

  useEffect(() => {
    if (!firebaseUser) {
      return
    }
    const intervalId = window.setInterval(() => {
      void syncProfile(firebaseUser)
    }, clickProfileSyncIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [firebaseUser, syncProfile])

  const signInWithGoogle = useCallback(async () => {
    if (!isFirebaseAuthConfigured) {
      throw new Error('Firebase Auth configuration is missing.')
    }

    setProfileError(null)
    await signInWithPopup(firebaseAuth, googleAuthProvider)
  }, [])

  const signOutFromApp = useCallback(async () => {
    setProfileError(null)
    clearCachedToken()
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
      !isFirebaseResolved || (Boolean(firebaseUser) && !hasResolvedProfile)

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
      logActivity,
    }
  }, [
    appUser,
    firebaseUser,
    getIdToken,
    isFirebaseResolved,
    hasResolvedProfile,
    ownerEmailValue,
    profileError,
    refreshProfile,
    logActivity,
    signInWithGoogle,
    signOutFromApp,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

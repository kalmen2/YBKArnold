import {
  createContext,
  useCallback,
  useContext,
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
  logActivity: (input: {
    action: string
    target?: string | null
    path?: string | null
    metadata?: unknown
  }) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function requestCurrentUser(idToken: string) {
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'x-client-platform': 'web',
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
  const [hasResolvedProfile, setHasResolvedProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [ownerEmailValue, setOwnerEmailValue] = useState(ownerEmail)
  const activityCooldownByKeyRef = useRef<Map<string, number>>(new Map())

  const logActivity = useCallback(async (input: {
    action: string
    target?: string | null
    path?: string | null
    metadata?: unknown
  }) => {
    const action = String(input?.action ?? '').trim().slice(0, 120)

    if (!action) {
      return
    }

    const activeUser = firebaseAuth.currentUser

    if (!activeUser) {
      return
    }

    const target = String(input?.target ?? '').trim().slice(0, 180)
    if (action !== 'click') {
      const key = `${action}:${target}`
      const now = Date.now()
      const lastSentAt = activityCooldownByKeyRef.current.get(key) ?? 0

      if (now - lastSentAt < 1200) {
        return
      }

      activityCooldownByKeyRef.current.set(key, now)
    }

    try {
      const idToken = await activeUser.getIdToken()

      const response = await fetch('/api/auth/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          'x-client-platform': 'web',
        },
        body: JSON.stringify({
          action,
          target: target || null,
          path: String(input?.path ?? '').trim().slice(0, 240) || window.location.pathname,
          metadata: input?.metadata,
        }),
      })

      if (response.status === 401 || response.status === 403) {
        await signOut(firebaseAuth)
      }
    } catch {
      // Best-effort telemetry only; never block UX.
    }
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
        const isHoursBlockedError =
          response.status === 403
          && responseErrorMessage.toLowerCase().includes('access is currently blocked')

        if (isHoursBlockedError) {
          setAppUser(null)
          setProfileError(responseErrorMessage || 'Access is currently blocked.')
          await signOut(firebaseAuth)
          return
        }

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
      setHasResolvedProfile(true)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
      setFirebaseUser(nextUser)
      setHasResolvedProfile(!nextUser)
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

    const handleDocumentClick = (event: MouseEvent) => {
      const eventTarget = event.target

      if (!(eventTarget instanceof Element)) {
        return
      }

      const clickableElement = eventTarget.closest(
        'button, a, [role="button"], [data-log-action]',
      )

      if (!clickableElement) {
        return
      }

      const inferredTarget = String(
        clickableElement.getAttribute('data-log-action')
          ?? clickableElement.getAttribute('aria-label')
          ?? clickableElement.textContent
          ?? clickableElement.id
          ?? clickableElement.tagName.toLowerCase(),
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180)

      void logActivity({
        action: 'click',
        target: inferredTarget || clickableElement.tagName.toLowerCase(),
        metadata: {
          tag: clickableElement.tagName.toLowerCase(),
        },
      })

      void syncProfile(firebaseUser)
    }

    document.addEventListener('click', handleDocumentClick, true)

    return () => {
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [firebaseUser, logActivity, syncProfile])

  const signInWithGoogle = useCallback(async () => {
    if (!isFirebaseAuthConfigured) {
      throw new Error('Firebase Auth configuration is missing.')
    }

    setProfileError(null)
    await signInWithPopup(firebaseAuth, googleAuthProvider)
  }, [])

  const signOutFromApp = useCallback(async () => {
    setProfileError(null)
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

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.')
  }

  return context
}

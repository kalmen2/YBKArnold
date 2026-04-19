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
const clickActivityCooldownMs = 20000
const cachedAuthUserStorageKey = 'arnold.auth.cached-user.v1'
// Collect activity events in memory and flush them in a single request every
// ACTIVITY_FLUSH_INTERVAL_MS instead of firing one request per event. This
// reduces activity-logging API calls from ~1 per click to ~1 per 30 seconds.
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
  const activityCooldownByKeyRef = useRef<Map<string, number>>(new Map())
  const lastClickProfileSyncAtRef = useRef(0)
  // Pending activity events waiting to be flushed. We keep only the most
  // recent event per key so a burst of clicks collapses to a single request.
  const activityQueueRef = useRef<Map<string, {
    action: string
    target: string | null
    path: string
    metadata: unknown
  }>>(new Map())

  const flushActivityQueue = useCallback(async () => {
    const queue = activityQueueRef.current

    if (queue.size === 0) {
      return
    }

    const activeUser = firebaseAuth.currentUser

    if (!activeUser) {
      queue.clear()
      return
    }

    const events = Array.from(queue.values())
    queue.clear()

    try {
      const idToken = await activeUser.getIdToken()

      // Send each queued event. In practice after throttling this is 1–3
      // events per flush window, far fewer than firing on every interaction.
      for (const event of events) {
        const response = await fetch('/api/auth/activity', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
            'x-client-platform': 'web',
          },
          body: JSON.stringify(event),
        })

        if (response.status === 401 || response.status === 403) {
          clearCachedToken()
          await signOut(firebaseAuth)
          return
        }
      }
    } catch {
      // Best-effort telemetry only; never block UX.
    }
  }, [])

  // Flush the activity queue on a fixed interval instead of immediately on
  // every event. This batches bursts of clicks into a single network round-trip.
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
    const action = String(input?.action ?? '').trim().slice(0, 120)

    if (!action) {
      return
    }

    if (!firebaseAuth.currentUser) {
      return
    }

    const target = String(input?.target ?? '').trim().slice(0, 180)
    const key = action === 'click'
      ? 'click-global'
      : `${action}:${target}`
    const cooldownMs = action === 'click' ? clickActivityCooldownMs : 1200
    const now = Date.now()
    const lastSentAt = activityCooldownByKeyRef.current.get(key) ?? 0

    if (now - lastSentAt < cooldownMs) {
      return
    }

    activityCooldownByKeyRef.current.set(key, now)

    // Enqueue (overwrite any prior event with same key so only the latest wins).
    activityQueueRef.current.set(key, {
      action,
      target: target || null,
      path: String(input?.path ?? '').trim().slice(0, 240) || window.location.pathname,
      metadata: input?.metadata,
    })
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

      const now = Date.now()

      if (now - lastClickProfileSyncAtRef.current >= clickProfileSyncIntervalMs) {
        lastClickProfileSyncAtRef.current = now
        void syncProfile(firebaseUser)
      }
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

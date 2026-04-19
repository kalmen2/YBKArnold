/**
 * CrmDealersContext
 *
 * Fetches the full dealer list ONCE per session and shares it across every CRM
 * page (CrmPage, CrmDealersPage, CrmContactsPage). Previously every page made
 * its own independent request for up to 2 500 dealers — this eliminates that
 * duplication entirely.
 *
 * A module-level cache with a 10-minute TTL means navigating between pages
 * never re-fetches; only an explicit `refetch()` call or a cache expiry will
 * hit the network again.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { firebaseAuth } from '../../auth/firebase'
import { fetchCrmDealers, type CrmDealer } from './api'

const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

// Module-level cache so it survives context re-mounts during navigation.
let cachedDealers: CrmDealer[] | null = null
let cacheExpiresAt = 0

export type CrmDealersContextValue = {
  dealers: CrmDealer[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const CrmDealersContext = createContext<CrmDealersContextValue | null>(null)

export function CrmDealersProvider({ children }: { children: ReactNode }) {
  const [dealers, setDealers] = useState<CrmDealer[]>(cachedDealers ?? [])
  const [isLoading, setIsLoading] = useState(!cachedDealers || Date.now() >= cacheExpiresAt)
  const [error, setError] = useState<string | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const load = useCallback(async (force = false) => {
    // Return cached data if still fresh and not forcing a reload.
    if (!force && cachedDealers && Date.now() < cacheExpiresAt) {
      setDealers(cachedDealers)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const user = firebaseAuth.currentUser

      if (!user) {
        if (isMountedRef.current) {
          setIsLoading(false)
        }
        return
      }

      const idToken = await user.getIdToken()
      const response = await fetchCrmDealers(idToken, {
        includeArchived: true,
        limit: 2500,
      })

      const next = Array.isArray(response.dealers) ? response.dealers : []

      // Update module-level cache
      cachedDealers = next
      cacheExpiresAt = Date.now() + CACHE_TTL_MS

      if (isMountedRef.current) {
        setDealers(next)
        setError(null)
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load dealers.')
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  // Re-trigger load when Firebase auth resolves. On a fresh page load,
  // currentUser is null for ~500ms while the SDK restores the session from
  // IndexedDB. The effect above fires too early and bails out. This listener
  // catches the auth-ready event and retries — the cache check inside load()
  // makes it a no-op if dealers are already populated.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      if (user) {
        void load(false)
      }
    })
    return unsubscribe
  }, [load])

  const refetch = useCallback(() => {
    void load(true)
  }, [load])

  return (
    <CrmDealersContext.Provider value={{ dealers, isLoading, error, refetch }}>
      {children}
    </CrmDealersContext.Provider>
  )
}

export function useCrmDealers(): CrmDealersContextValue {
  const ctx = useContext(CrmDealersContext)

  if (!ctx) {
    throw new Error('useCrmDealers must be used within CrmDealersProvider')
  }

  return ctx
}

/** Invalidate the module-level cache (e.g. after a CRM import). */
export function invalidateCrmDealersCache() {
  cachedDealers = null
  cacheExpiresAt = 0
}

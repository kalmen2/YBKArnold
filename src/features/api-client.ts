import { firebaseAuth } from '../auth/firebase'

// Cache the Firebase ID token in memory. Firebase tokens are valid for 1 hour,
// so we reuse the same token for 55 minutes before forcing a refresh. This
// avoids the repeated async overhead of calling getIdToken() on every request.
let cachedToken: string | null = null
let cachedTokenExpiresAt = 0
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000 // Refresh 5 min before expiry

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = firebaseAuth.currentUser

  if (!user) {
    return {}
  }

  const now = Date.now()
  const tokenStillValid = cachedToken && now < cachedTokenExpiresAt - TOKEN_REFRESH_BUFFER_MS

  if (!tokenStillValid) {
    cachedToken = await user.getIdToken()
    // Firebase tokens are valid for 1 hour
    cachedTokenExpiresAt = now + 60 * 60 * 1000
  }

  return { Authorization: `Bearer ${cachedToken}` }
}

// Call this whenever the user signs out so stale tokens are never reused.
export function clearCachedToken() {
  cachedToken = null
  cachedTokenExpiresAt = 0
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const authHeaders = await getAuthHeaders()

  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    // If the server says the token is invalid, clear our cache so the next
    // request gets a fresh token.
    if (response.status === 401) {
      clearCachedToken()
    }
    throw new Error(payload.error ?? 'Request failed.')
  }

  return payload as T
}

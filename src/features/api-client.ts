import { firebaseAuth } from '../auth/firebase'

// Cache the Firebase ID token until its real JWT expiry, with a small buffer.
// This avoids repeated getIdToken() overhead without reusing stale tokens.
let cachedToken: string | null = null
let cachedTokenExpiresAt = 0
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000 // Refresh 5 min before expiry
const FALLBACK_TOKEN_TTL_MS = 55 * 60 * 1000

function getTokenExpiresAt(token: string) {
  try {
    const payload = token.split('.')[1]

    if (!payload) {
      return Date.now() + FALLBACK_TOKEN_TTL_MS
    }

    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/')
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=')
    const parsedPayload = JSON.parse(window.atob(paddedPayload)) as { exp?: unknown }
    const expiresAtSeconds = Number(parsedPayload.exp)

    return Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0
      ? expiresAtSeconds * 1000
      : Date.now() + FALLBACK_TOKEN_TTL_MS
  } catch {
    return Date.now() + FALLBACK_TOKEN_TTL_MS
  }
}

async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const user = firebaseAuth.currentUser

  if (!user) {
    return {}
  }

  const now = Date.now()
  const tokenStillValid = cachedToken && now < cachedTokenExpiresAt - TOKEN_REFRESH_BUFFER_MS

  if (forceRefresh || !tokenStillValid) {
    cachedToken = await user.getIdToken(forceRefresh)
    cachedTokenExpiresAt = getTokenExpiresAt(cachedToken)
  }

  return { Authorization: `Bearer ${cachedToken}` }
}

// Call this whenever the user signs out so stale tokens are never reused.
export function clearCachedToken() {
  cachedToken = null
  cachedTokenExpiresAt = 0
}

type ApiRequestOptions = {
  timeoutMs?: number
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  requestOptions: ApiRequestOptions = {},
): Promise<T> {
  async function send(forceRefresh = false) {
    const authHeaders = await getAuthHeaders(forceRefresh)
    const timeoutMs = Number(requestOptions.timeoutMs)
    const hasTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    const abortController = hasTimeout ? new AbortController() : null
    let timeoutId: number | null = null

    if (hasTimeout && abortController) {
      timeoutId = window.setTimeout(() => {
        abortController.abort()
      }, timeoutMs)

      if (options.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            abortController.abort()
          },
          { once: true },
        )
      }
    }

    try {
      return await fetch(path, {
        ...options,
        signal: abortController?.signal ?? options.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-client-platform': 'web',
          ...authHeaders,
          ...(options.headers ?? {}),
        },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError' && hasTimeout) {
        throw new Error('Request timed out. Please try again.')
      }

      throw error
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }

  let response = await send()
  let payload = await response.json().catch(() => ({}))

  if (response.status === 401 && firebaseAuth.currentUser) {
    clearCachedToken()
    response = await send(true)
    payload = await response.json().catch(() => ({}))
  }

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

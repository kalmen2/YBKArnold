import { firebaseAuth } from '../auth/firebase'
import { finishAppProcess, startAppProcess } from '../lib/appProcesses'

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
  processTracking?: false | {
    label: string
    detail?: string | null
  }
}

type ApiRequestError = Error & {
  status?: number
  payload?: unknown
}

async function requestWithAuth(
  path: string,
  options: RequestInit,
  requestOptions: ApiRequestOptions,
  defaultHeaders: Record<string, string>,
): Promise<Response> {
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
          ...defaultHeaders,
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

  if (response.status === 401 && firebaseAuth.currentUser) {
    clearCachedToken()
    response = await send(true)
  }

  // If the server says the token is invalid, clear our cache so the next
  // request gets a fresh token.
  if (response.status === 401) {
    clearCachedToken()
  }

  return response
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  requestOptions: ApiRequestOptions = {},
): Promise<T> {
  const method = String(options.method || 'GET').trim().toUpperCase()
  const shouldTrackProcess = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    && requestOptions.processTracking !== false
  const processDescription = requestOptions.processTracking || describeApiProcess(path, method)
  const processId = shouldTrackProcess
    ? startAppProcess(processDescription)
    : null

  try {
    const response = await requestWithAuth(path, options, requestOptions, {
      'Content-Type': 'application/json',
      'x-client-platform': 'web',
    })
    const payload = await response.json().catch(() => ({}))
    const payloadError = typeof (payload as { error?: unknown }).error === 'string'
      ? String((payload as { error?: unknown }).error).trim()
      : ''

    if (!response.ok || payloadError) {
      const requestError: ApiRequestError = new Error(payloadError || 'Request failed.')
      requestError.status = response.status
      requestError.payload = payload
      throw requestError
    }

    return payload as T
  } finally {
    if (processId) {
      finishAppProcess(processId)
    }
  }
}

function decodePathPart(value: string | undefined) {
  if (!value) return ''

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function describeApiProcess(path: string, method: string) {
  const normalizedPath = String(path || '').split('?')[0]
  const quoteMatch = normalizedPath.match(/\/api\/crm\/quotes\/([^/]+)/)
  const orderMatch = normalizedPath.match(/\/api\/orders\/([^/]+)/)
  const quoteId = decodePathPart(quoteMatch?.[1])
  const orderId = decodePathPart(orderMatch?.[1])

  if (/\/convert-to-order$/.test(normalizedPath)) {
    return { label: 'Converting quote to order', detail: quoteId ? `Quote ${quoteId}` : null }
  }

  if (/\/cancel-order$/.test(normalizedPath)) {
    return { label: 'Canceling order', detail: quoteId ? `Quote ${quoteId}` : null }
  }

  if (/\/revisions(?:\/|$)/.test(normalizedPath)) {
    return {
      label: method === 'DELETE' ? 'Deleting quote revision' : 'Creating quote revision',
      detail: quoteId ? `Quote ${quoteId}` : null,
    }
  }

  if (normalizedPath === '/api/orders/refresh') {
    return { label: 'Refreshing orders', detail: 'Syncing order information' }
  }

  if (/shop-drawing/i.test(normalizedPath)) {
    return { label: method === 'DELETE' ? 'Deleting shop drawing' : 'Saving shop drawing', detail: orderId || null }
  }

  if (/cut-list/i.test(normalizedPath)) {
    return { label: method === 'DELETE' ? 'Deleting cut list' : 'Saving cut list', detail: orderId || null }
  }

  if (/shipping|ship$/i.test(normalizedPath)) {
    return { label: 'Updating shipping', detail: orderId || null }
  }

  if (/photos/i.test(normalizedPath)) {
    return { label: method === 'DELETE' ? 'Deleting picture' : 'Saving picture', detail: orderId || null }
  }

  if (quoteId) {
    return { label: method === 'DELETE' ? 'Deleting quote' : 'Saving quote', detail: `Quote ${quoteId}` }
  }

  if (orderId) {
    return { label: method === 'DELETE' ? 'Deleting order' : 'Updating order', detail: orderId }
  }

  return {
    label: method === 'DELETE' ? 'Deleting information' : 'Saving changes',
    detail: null,
  }
}

// Authenticated fetch for non-JSON responses (file/blob downloads). Shares the
// cached-token and 401-retry behavior of apiRequest but returns the raw
// Response so the caller can stream or read a blob. Throws the same shaped
// error as apiRequest on non-OK responses.
export async function apiFetch(
  path: string,
  options: RequestInit = {},
  requestOptions: ApiRequestOptions = {},
): Promise<Response> {
  const response = await requestWithAuth(path, options, requestOptions, {
    'x-client-platform': 'web',
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const requestError: ApiRequestError = new Error(
      typeof (payload as { error?: unknown }).error === 'string'
        ? String((payload as { error?: unknown }).error)
        : 'Request failed.',
    )
    requestError.status = response.status
    requestError.payload = payload
    throw requestError
  }

  return response
}

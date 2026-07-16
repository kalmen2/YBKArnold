export const API_BASE_URL = 'https://us-central1-ybkarnold-b7ec0.cloudfunctions.net/apiV1'
const API_REQUEST_TIMEOUT_MS = 15000
const API_FALLBACK_BASE_URLS = [
  'https://ybkarnold-b7ec0.web.app',
  'https://ybkarnold-b7ec0.firebaseapp.com',
] as const

function withRefreshQuery(baseUrl: string, path: string, refreshRequested: boolean) {
  const normalizedBaseUrl = String(baseUrl ?? '').trim().replace(/\/+$/, '')
  const normalizedPath = String(path ?? '').trim().startsWith('/')
    ? String(path ?? '').trim()
    : `/${String(path ?? '').trim()}`
  const requestUrl = `${normalizedBaseUrl}${normalizedPath}`

  if (!refreshRequested) {
    return requestUrl
  }

  const separator = requestUrl.includes('?') ? '&' : '?'
  return `${requestUrl}${separator}refresh=1`
}

function isRetryableNetworkError(error: unknown) {
  if (error instanceof TypeError) {
    return true
  }

  return error instanceof Error && error.name === 'AbortError'
}

export async function request<T>(
  path: string,
  refreshRequested = false,
  init: RequestInit = {},
) {
  const baseUrlsToTry = [API_BASE_URL, ...API_FALLBACK_BASE_URLS]
  let lastError: unknown = null

  for (let index = 0; index < baseUrlsToTry.length; index += 1) {
    const timeoutController = init.signal ? null : new AbortController()
    const timeoutId = timeoutController
      ? setTimeout(() => {
          timeoutController.abort()
        }, API_REQUEST_TIMEOUT_MS)
      : null

    try {
      const response = await fetch(withRefreshQuery(baseUrlsToTry[index], path, refreshRequested), {
        ...init,
        signal: init.signal ?? timeoutController?.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        const requestError = new Error(
          String((payload as { error?: string }).error ?? 'Request failed.'),
        ) as Error & { status?: number }
        requestError.status = response.status

        const shouldRetryWithFallback =
          response.status >= 500
          && index < baseUrlsToTry.length - 1

        if (shouldRetryWithFallback) {
          lastError = requestError
          continue
        }

        throw requestError
      }

      return payload as T
    } catch (error) {
      const shouldRetryWithFallback =
        isRetryableNetworkError(error)
        && !init.signal
        && index < baseUrlsToTry.length - 1

      if (shouldRetryWithFallback) {
        lastError = error
        continue
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out. Check your network connection and try again.')
      }

      throw error
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  if (lastError instanceof Error && lastError.name === 'AbortError') {
    throw new Error('Request timed out. Check your network connection and try again.')
  }

  throw (lastError instanceof Error ? lastError : new Error('Request failed.'))
}

export function withBuildQuery(updateUrl: string, buildNumber: number) {
  const normalizedUrl = String(updateUrl ?? '').trim()

  if (!normalizedUrl || !Number.isFinite(buildNumber)) {
    return normalizedUrl
  }

  const separator = normalizedUrl.includes('?') ? '&' : '?'

  return `${normalizedUrl}${separator}build=${Math.floor(buildNumber)}`
}

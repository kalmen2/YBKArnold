const API_BASE_URL = 'https://us-central1-ybkarnold-b7ec0.cloudfunctions.net/apiV1'
const API_REQUEST_TIMEOUT_MS = 15000

function withRefreshQuery(path: string, refreshRequested: boolean) {
  if (!refreshRequested) {
    return `${API_BASE_URL}${path}`
  }

  const separator = path.includes('?') ? '&' : '?'
  return `${API_BASE_URL}${path}${separator}refresh=1`
}

export async function request<T>(
  path: string,
  refreshRequested = false,
  init: RequestInit = {},
) {
  const timeoutController = init.signal ? null : new AbortController()
  const timeoutId = timeoutController
    ? setTimeout(() => {
        timeoutController.abort()
      }, API_REQUEST_TIMEOUT_MS)
    : null

  let response: Response
  let payload: unknown = {}

  try {
    response = await fetch(withRefreshQuery(path, refreshRequested), {
      ...init,
      signal: init.signal ?? timeoutController?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    payload = await response.json().catch(() => ({}))
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. Check your network connection and try again.')
    }

    throw error
  }

  if (timeoutId) {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const requestError = new Error(
      String((payload as { error?: string }).error ?? 'Request failed.'),
    ) as Error & { status?: number }
    requestError.status = response.status
    throw requestError
  }

  return payload as T
}

export function extractFirstUrlFromText(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return null
  }

  const match = normalized.match(/https?:\/\/[^\s)]+/i)

  return match?.[0] ?? null
}

export function withBuildQuery(updateUrl: string, buildNumber: number) {
  const normalizedUrl = String(updateUrl ?? '').trim()

  if (!normalizedUrl || !Number.isFinite(buildNumber)) {
    return normalizedUrl
  }

  const separator = normalizedUrl.includes('?') ? '&' : '?'

  return `${normalizedUrl}${separator}build=${Math.floor(buildNumber)}`
}

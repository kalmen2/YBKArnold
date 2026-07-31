const MAX_CONSOLE_EVENTS = 400
const MAX_NETWORK_EVENTS = 150
const MAX_INTERACTIONS = 500
const MAX_TEXT_LENGTH = 4000
const SENSITIVE_KEY_PATTERN = /authorization|cookie|token|secret|password|passwd|api[-_]?key|credential|session/i

export type DiagnosticSession = {
  id: string
  startedAt: string
  context: unknown
  console: unknown[]
  network: unknown[]
  interactions: unknown[]
}

let activeSession: DiagnosticSession | null = null
let collectorsInstalled = false
let fetchInterceptorInstalled = false

const isoNow = () => new Date().toISOString()

function truncate(value: unknown, limit = MAX_TEXT_LENGTH) {
  const text = String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit)}… [truncated]` : text
}

function sanitizeUrl(rawUrl: unknown) {
  try {
    const parsed = new URL(String(rawUrl || ''), window.location.origin)
    parsed.searchParams.forEach((_value, key) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) parsed.searchParams.set(key, '[REDACTED]')
    })
    return truncate(parsed.toString(), 2000)
  } catch {
    return truncate(rawUrl, 2000)
  }
}

export function sanitizeDiagnosticValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return truncate(value)
  if (value instanceof Error) {
    return {
      name: truncate(value.name, 100),
      message: truncate(value.message),
      stack: truncate(value.stack),
    }
  }
  if (value instanceof Headers) {
    const result: Record<string, unknown> = {}
    value.forEach((headerValue, key) => {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : truncate(headerValue, 2000)
    })
    return result
  }
  if (depth >= 5) return '[Maximum depth reached]'
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    if (Array.isArray(value)) {
      return value.slice(0, 100).map((entry) => sanitizeDiagnosticValue(entry, depth + 1, seen))
    }
    const result: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>).slice(0, 150).forEach(([key, entry]) => {
      result[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : sanitizeDiagnosticValue(entry, depth + 1, seen)
    })
    return result
  }
  return truncate(value)
}

function pushBounded(target: unknown[], entry: unknown, maximum: number) {
  target.push(entry)
  if (target.length > maximum) target.splice(0, target.length - maximum)
}

async function readRequestBody(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const body = init?.body
    if (body instanceof FormData) {
      const fields: Record<string, unknown> = {}
      body.forEach((value, key) => {
        fields[key] = value instanceof File
          ? { fileName: value.name, size: value.size, type: value.type }
          : value
      })
      return sanitizeDiagnosticValue(fields)
    }
    if (typeof body === 'string') {
      try {
        return sanitizeDiagnosticValue(JSON.parse(body))
      } catch {
        return truncate(body)
      }
    }
    if (body && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
      return sanitizeDiagnosticValue(body)
    }
    if (input instanceof Request && !body) {
      const contentType = input.headers.get('content-type') || ''
      if (contentType.includes('json') || contentType.startsWith('text/')) {
        return truncate(await input.clone().text())
      }
    }
  } catch {
    return '[Unable to inspect request body]'
  }
  return null
}

async function readResponse(response: Response) {
  try {
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('json') && !contentType.startsWith('text/')) {
      return `[${contentType || 'binary response'} not captured]`
    }
    const text = await response.clone().text()
    try {
      return sanitizeDiagnosticValue(JSON.parse(text))
    } catch {
      return truncate(text)
    }
  } catch {
    return '[Unable to inspect response]'
  }
}

function installFetchInterceptor() {
  if (fetchInterceptorInstalled || typeof window === 'undefined') return
  fetchInterceptorInstalled = true
  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    let parsedUrl: URL
    try {
      parsedUrl = new URL(rawUrl, window.location.origin)
    } catch {
      return originalFetch(input, init)
    }

    if (!parsedUrl.pathname.startsWith('/api/')) {
      return originalFetch(input, init)
    }

    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const startedAt = performance.now()
    const requestBodyPromise = readRequestBody(input, init)
    const sessionId = activeSession?.id || ''
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
    if (sessionId) headers.set('X-Diagnostic-Session-Id', sessionId)

    try {
      const response = input instanceof Request
        ? await originalFetch(new Request(input, { ...init, headers }))
        : await originalFetch(input, { ...init, headers })
      if (activeSession) {
        const [requestBody, responseBody] = await Promise.all([
          requestBodyPromise,
          readResponse(response),
        ])
        pushBounded(activeSession.network, {
          at: isoNow(),
          method,
          url: sanitizeUrl(rawUrl),
          requestHeaders: sanitizeDiagnosticValue(headers),
          requestBody,
          status: response.status,
          ok: response.ok,
          durationMs: Math.round(performance.now() - startedAt),
          requestId: response.headers.get('x-request-id') || '',
          responseHeaders: sanitizeDiagnosticValue(response.headers),
          responseBody,
        }, MAX_NETWORK_EVENTS)
      }
      return response
    } catch (error) {
      if (activeSession) {
        pushBounded(activeSession.network, {
          at: isoNow(),
          method,
          url: sanitizeUrl(rawUrl),
          requestHeaders: sanitizeDiagnosticValue(headers),
          requestBody: await requestBodyPromise,
          durationMs: Math.round(performance.now() - startedAt),
          networkError: sanitizeDiagnosticValue(error),
        }, MAX_NETWORK_EVENTS)
      }
      throw error
    }
  }
}

export function installDiagnosticCollectors() {
  if (collectorsInstalled || typeof window === 'undefined') return
  collectorsInstalled = true
  installFetchInterceptor()

  ;(['log', 'info', 'warn', 'error', 'debug'] as const).forEach((level) => {
    const original = console[level]?.bind(console)
    if (!original) return
    console[level] = (...args: unknown[]) => {
      if (activeSession) {
        pushBounded(activeSession.console, {
          at: isoNow(),
          level,
          arguments: sanitizeDiagnosticValue(args),
        }, MAX_CONSOLE_EVENTS)
      }
      original(...args)
    }
  })

  window.addEventListener('error', (event) => {
    if (!activeSession) return
    pushBounded(activeSession.console, {
      at: isoNow(),
      level: 'uncaught-error',
      message: truncate(event.message),
      source: sanitizeUrl(event.filename),
      line: event.lineno || null,
      column: event.colno || null,
      error: sanitizeDiagnosticValue(event.error),
    }, MAX_CONSOLE_EVENTS)
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (!activeSession) return
    pushBounded(activeSession.console, {
      at: isoNow(),
      level: 'unhandled-rejection',
      reason: sanitizeDiagnosticValue(event.reason),
    }, MAX_CONSOLE_EVENTS)
  })
}

export function beginDiagnosticSession(context: Record<string, unknown> = {}) {
  activeSession = {
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    startedAt: isoNow(),
    context: sanitizeDiagnosticValue(context),
    console: [],
    network: [],
    interactions: [],
  }
  return activeSession.id
}

export function recordDiagnosticInteraction(type: string, details: Record<string, unknown> = {}) {
  if (!activeSession) return
  pushBounded(activeSession.interactions, {
    at: isoNow(),
    type: truncate(type, 100),
    details: sanitizeDiagnosticValue(details),
  }, MAX_INTERACTIONS)
}

export function finishDiagnosticSession(extra: Record<string, unknown> = {}) {
  if (!activeSession) return null
  const result = {
    ...activeSession,
    finishedAt: isoNow(),
    page: {
      url: sanitizeUrl(window.location.href),
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: window.screen?.width, height: window.screen?.height },
      userAgent: navigator.userAgent,
      language: navigator.language,
      online: navigator.onLine,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    ...sanitizeDiagnosticValue(extra) as Record<string, unknown>,
  }
  activeSession = null
  return result
}

export function cancelDiagnosticSession() {
  activeSession = null
}

export function createAuthActivityService({
  authActivityTypeApiRequest,
  authActivityTypeUiEvent,
  getCollections,
  randomUUID,
}) {
  function extractRequestIpAddress(req) {
    const rawForwardedFor = req.headers?.['x-forwarded-for']
    const forwardedValue = Array.isArray(rawForwardedFor)
      ? rawForwardedFor[0]
      : rawForwardedFor
    const forwardedIp = String(forwardedValue ?? '')
      .split(',')[0]
      .trim()

    if (forwardedIp) {
      return forwardedIp
    }

    const ip = String(req.ip ?? req.socket?.remoteAddress ?? '').trim()

    if (!ip) {
      return null
    }

    return ip.replace('::ffff:', '')
  }

  function extractRequestUserAgent(req) {
    const userAgent = String(req.headers?.['user-agent'] ?? '').trim()

    return userAgent || null
  }

  function normalizeActivityMetadata(value) {
    if (value === undefined) {
      return null
    }

    try {
      const serialized = JSON.stringify(value)

      if (!serialized) {
        return null
      }

      if (serialized.length > 4000) {
        return {
          truncated: true,
        }
      }

      return JSON.parse(serialized)
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Write-batching queue
  // Activity logs are best-effort telemetry. Instead of one insertOne per event
  // we buffer entries and flush with insertMany every 10 seconds, capped at 100
  // entries per batch to avoid oversized writes. SIGTERM flushes the remainder.
  // ---------------------------------------------------------------------------
  const _writeQueue = []
  const BATCH_FLUSH_INTERVAL_MS = 10_000
  const BATCH_MAX_SIZE = 100

  async function flushWriteQueue() {
    if (_writeQueue.length === 0) {
      return
    }

    const batch = _writeQueue.splice(0, BATCH_MAX_SIZE)

    try {
      const { authActivityLogsCollection } = await getCollections()
      await authActivityLogsCollection.insertMany(batch, { ordered: false })
    } catch (error) {
      console.error('Failed to flush auth activity log batch:', error)
    }
  }

  const _flushInterval = setInterval(() => {
    void flushWriteQueue()
  }, BATCH_FLUSH_INTERVAL_MS)

  // Allow the process to exit cleanly — don't hold the event loop open
  _flushInterval.unref?.()

  process.on('SIGTERM', () => {
    void flushWriteQueue()
  })

  function buildLogDocument(entry) {
    const now = new Date().toISOString()
    const rawStatusCode = entry?.statusCode
    const parsedStatusCode =
      rawStatusCode === null || rawStatusCode === undefined || String(rawStatusCode).trim() === ''
        ? null
        : Number(rawStatusCode)

    return {
      id: randomUUID(),
      uid: String(entry?.uid ?? '').trim(),
      email: String(entry?.email ?? '').trim() || null,
      type: String(entry?.type ?? authActivityTypeUiEvent).trim() || authActivityTypeUiEvent,
      action: String(entry?.action ?? '').trim() || 'unknown_action',
      target: String(entry?.target ?? '').trim() || null,
      path: String(entry?.path ?? '').trim() || null,
      method: String(entry?.method ?? '').trim().toUpperCase() || null,
      statusCode: Number.isInteger(parsedStatusCode) ? parsedStatusCode : null,
      ipAddress: String(entry?.ipAddress ?? '').trim() || null,
      userAgent: String(entry?.userAgent ?? '').trim() || null,
      metadata: normalizeActivityMetadata(entry?.metadata),
      requestStartedAt: String(entry?.requestStartedAt ?? '').trim() || null,
      createdAt: String(entry?.createdAt ?? '').trim() || now,
    }
  }

  function writeAuthActivityLog(entry) {
    _writeQueue.push(buildLogDocument(entry))

    // Safety cap: flush immediately if the queue is at the batch limit
    if (_writeQueue.length >= BATCH_MAX_SIZE) {
      void flushWriteQueue()
    }
  }

  async function writeAuthApiRequestLog(req, publicUser) {
    if (!publicUser?.uid) {
      return
    }

    const requestMethod = String(req.method ?? '').trim().toUpperCase()

    // Skip read-heavy traffic to keep auth telemetry costs under control.
    if (requestMethod === 'GET' || requestMethod === 'HEAD' || requestMethod === 'OPTIONS') {
      return
    }

    const requestStartedAt = new Date().toISOString()
    const actionPath = String(req.path ?? req.originalUrl ?? '/').trim() || '/'

    if (actionPath.startsWith('/api/auth/activity')) {
      return
    }

    writeAuthActivityLog({
      uid: publicUser.uid,
      email: publicUser.email,
      type: authActivityTypeApiRequest,
      action: `${String(req.method ?? '').toUpperCase()} ${actionPath}`,
      path: actionPath,
      method: req.method,
      statusCode: null,
      ipAddress: extractRequestIpAddress(req),
      userAgent: extractRequestUserAgent(req),
      metadata: {
        originalUrl: String(req.originalUrl ?? '').trim() || null,
      },
      requestStartedAt,
    })
  }

  return {
    extractRequestIpAddress,
    extractRequestUserAgent,
    writeAuthActivityLog,
    writeAuthApiRequestLog,
  }
}

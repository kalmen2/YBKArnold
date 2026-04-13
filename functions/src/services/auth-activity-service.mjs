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

  async function writeAuthActivityLog(entry) {
    try {
      const { authActivityLogsCollection } = await getCollections()
      const now = new Date().toISOString()
      const rawStatusCode = entry?.statusCode
      const parsedStatusCode =
        rawStatusCode === null || rawStatusCode === undefined || String(rawStatusCode).trim() === ''
          ? null
          : Number(rawStatusCode)

      await authActivityLogsCollection.insertOne({
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
      })
    } catch (error) {
      console.error('Failed to write auth activity log:', error)
    }
  }

  async function writeAuthApiRequestLog(req, publicUser) {
    if (!publicUser?.uid) {
      return
    }

    const requestStartedAt = new Date().toISOString()
    const actionPath = String(req.path ?? req.originalUrl ?? '/').trim() || '/'

    if (actionPath.startsWith('/api/auth/activity')) {
      return
    }

    await writeAuthActivityLog({
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

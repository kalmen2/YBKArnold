export function createAuthActivityService() {
  function extractRequestLocalIpAddress(req) {
    const ip = String(req.ip ?? req.socket?.remoteAddress ?? '').trim()

    if (!ip) {
      return null
    }

    return ip.replace('::ffff:', '')
  }

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

    return extractRequestLocalIpAddress(req)
  }

  function extractRequestUserAgent(req) {
    const userAgent = String(req.headers?.['user-agent'] ?? '').trim()

    return userAgent || null
  }

  return {
    extractRequestIpAddress,
    extractRequestLocalIpAddress,
    extractRequestUserAgent,
  }
}

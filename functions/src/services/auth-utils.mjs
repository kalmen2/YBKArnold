export function createAuthUtils({
  authAccessTimeZoneNewJersey,
  authAccessTimeZoneUtc,
  authApprovalApproved,
  authApprovalPending,
  authClientAccessModeAppOnly,
  authClientAccessModeWebAndApp,
  authClientAccessModeWebOnly,
  authClientPlatformApp,
  authClientPlatformWeb,
  authRoleAdmin,
  authRoleManager,
  authRoleStandard,
  normalizeWorkerNumber,
  ownerEmail,
  reviewerLoginEmails,
}) {
  function normalizeEmail(value) {
    const normalized = String(value ?? '').trim().toLowerCase()

    return normalized || null
  }

  const reviewerLoginEmailSet = new Set(
    String(reviewerLoginEmails ?? '')
      .split(',')
      .map((value) => normalizeEmail(value))
      .filter(Boolean),
  )

  function isReviewerLoginEmail(value) {
    const normalized = normalizeEmail(value)

    if (!normalized) {
      return false
    }

    return reviewerLoginEmailSet.has(normalized)
  }

  function normalizeAuthRole(value) {
    const normalized = String(value ?? '').trim().toLowerCase()

    if (normalized === authRoleAdmin || normalized === authRoleManager || normalized === authRoleStandard) {
      return normalized
    }

    return null
  }

  function normalizeAuthHour(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10)

    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
      return null
    }

    return parsed
  }

  function parseOptionalAuthHour(value, fieldName) {
    const normalized = String(value ?? '').trim()

    if (!normalized) {
      return null
    }

    const parsed = Number.parseInt(normalized, 10)

    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
      throw {
        status: 400,
        message: `${fieldName} must be an integer between 0 and 23.`,
      }
    }

    return parsed
  }

  function normalizeAuthAccessTimeZone(value) {
    const normalized = String(value ?? '').trim()

    if ([authAccessTimeZoneUtc, authAccessTimeZoneNewJersey].includes(normalized)) {
      return normalized
    }

    return null
  }

  function normalizeAuthClientPlatform(value) {
    const normalized = String(value ?? '').trim().toLowerCase()

    if ([authClientPlatformWeb, authClientPlatformApp].includes(normalized)) {
      return normalized
    }

    return null
  }

  function normalizeAuthClientAccessMode(value) {
    const normalized = String(value ?? '').trim().toLowerCase()

    if ([
      authClientAccessModeWebAndApp,
      authClientAccessModeWebOnly,
      authClientAccessModeAppOnly,
    ].includes(normalized)) {
      return normalized
    }

    return null
  }

  function resolveAuthClientAccessMode(document) {
    const normalized = normalizeAuthClientAccessMode(document?.clientAccessMode)

    if (normalized) {
      return normalized
    }

    // Backward compatibility for older records that may have only this boolean.
    if (document?.webAccessEnabled === false) {
      return authClientAccessModeAppOnly
    }

    return authClientAccessModeWebAndApp
  }

  function getAllowedAuthClientPlatforms(clientAccessMode) {
    if (clientAccessMode === authClientAccessModeWebOnly) {
      return [authClientPlatformWeb]
    }

    return clientAccessMode === authClientAccessModeAppOnly
      ? [authClientPlatformApp]
      : [authClientPlatformWeb, authClientPlatformApp]
  }

  function resolveAuthClientPlatformFromRequest(req) {
    const rawHeaderValue = req.headers?.['x-client-platform']
    const headerValue = Array.isArray(rawHeaderValue)
      ? rawHeaderValue[0]
      : rawHeaderValue
    const normalizedFromHeader = normalizeAuthClientPlatform(headerValue)

    if (normalizedFromHeader) {
      return normalizedFromHeader
    }

    const userAgent = String(req.headers?.['user-agent'] ?? '').toLowerCase()

    if (/react\s*native|expo|okhttp|cfnetwork|darwin|iphone|android/i.test(userAgent)) {
      return authClientPlatformApp
    }

    return authClientPlatformWeb
  }

  function parseOptionalAuthAccessTimeZone(value) {
    const normalized = String(value ?? '').trim()

    if (!normalized) {
      return null
    }

    const parsed = normalizeAuthAccessTimeZone(normalized)

    if (!parsed) {
      throw {
        status: 400,
        message: `timeZone must be '${authAccessTimeZoneUtc}' or '${authAccessTimeZoneNewJersey}'.`,
      }
    }

    return parsed
  }

  function getAuthHourForTimeZone(now, timeZone) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        hour12: false,
        timeZone,
      })
      const hourPart = formatter
        .formatToParts(now)
        .find((part) => part.type === 'hour')
        ?.value
      const parsed = Number.parseInt(String(hourPart ?? ''), 10)

      if (Number.isInteger(parsed)) {
        return parsed % 24
      }
    } catch {
      // Fallback to UTC if timezone parsing fails.
    }

    return now.getUTCHours()
  }

  function formatAuthTimeZoneLabel(timeZone) {
    if (timeZone === authAccessTimeZoneNewJersey) {
      return 'New Jersey time (ET)'
    }

    return 'UTC'
  }

  function hasAuthLoginHourRestriction(startHourUtc, endHourUtc) {
    return Number.isInteger(startHourUtc) && Number.isInteger(endHourUtc) && startHourUtc !== endHourUtc
  }

  function isAllowedByAuthLoginHours(document, now = new Date()) {
    const startHourUtc = normalizeAuthHour(document?.accessStartHourUtc)
    const endHourUtc = normalizeAuthHour(document?.accessEndHourUtc)
    const accessTimeZone = normalizeAuthAccessTimeZone(document?.accessTimeZone) ?? authAccessTimeZoneUtc

    if (!hasAuthLoginHourRestriction(startHourUtc, endHourUtc)) {
      return true
    }

    const currentHour = getAuthHourForTimeZone(now, accessTimeZone)

    if (startHourUtc < endHourUtc) {
      return currentHour >= startHourUtc && currentHour < endHourUtc
    }

    return currentHour >= startHourUtc || currentHour < endHourUtc
  }

  function formatAuthLoginHoursWindow(document) {
    const startHourUtc = normalizeAuthHour(document?.accessStartHourUtc)
    const endHourUtc = normalizeAuthHour(document?.accessEndHourUtc)
    const accessTimeZone = normalizeAuthAccessTimeZone(document?.accessTimeZone) ?? authAccessTimeZoneUtc

    if (!hasAuthLoginHourRestriction(startHourUtc, endHourUtc)) {
      return 'any time'
    }

    return `${String(startHourUtc).padStart(2, '0')}:00 to ${String(endHourUtc).padStart(2, '0')}:00 ${formatAuthTimeZoneLabel(accessTimeZone)}`
  }

  function toPublicAuthUser(document) {
    if (!document) {
      return null
    }

    const isOwner = normalizeEmail(document.emailLower) === ownerEmail
    const normalizedRole = normalizeAuthRole(document.role) ?? authRoleStandard
    const isAdmin = normalizedRole === authRoleAdmin
    const isManager = normalizedRole === authRoleManager
    const normalizedApprovalStatus =
      String(document.approvalStatus ?? '').trim().toLowerCase() === authApprovalApproved
        ? authApprovalApproved
        : authApprovalPending
    const accessStartHourUtc = normalizeAuthHour(document.accessStartHourUtc)
    const accessEndHourUtc = normalizeAuthHour(document.accessEndHourUtc)
    const accessTimeZone = normalizeAuthAccessTimeZone(document.accessTimeZone) ?? authAccessTimeZoneUtc
    const linkedWorkerId = String(document.linkedWorkerId ?? '').trim() || null
    const linkedWorkerNumber = normalizeWorkerNumber(document.linkedWorkerNumber)
    const linkedWorkerName = String(document.linkedWorkerName ?? '').trim() || null
    const normalizedZendeskUserId = Number(document.linkedZendeskUserId)
    const linkedZendeskUserId =
      Number.isFinite(normalizedZendeskUserId) && normalizedZendeskUserId > 0
        ? normalizedZendeskUserId
        : null
    const linkedZendeskUserEmail = String(document.linkedZendeskUserEmail ?? '').trim() || null
    const linkedZendeskUserName = String(document.linkedZendeskUserName ?? '').trim() || null
    const rawClientPlatforms = Array.isArray(document.clientPlatforms)
      ? document.clientPlatforms
      : []
    const normalizedClientPlatforms = Array.from(
      new Set(
        rawClientPlatforms
          .map((platform) => normalizeAuthClientPlatform(platform))
          .filter(Boolean),
      ),
    )
    const clientPlatforms =
      normalizedClientPlatforms.length > 0
        ? normalizedClientPlatforms
        : [authClientPlatformWeb]
    const lastLoginClientPlatform =
      normalizeAuthClientPlatform(document.lastLoginClientPlatform)
      ?? clientPlatforms[clientPlatforms.length - 1]
    const clientAccessMode = isOwner
      ? authClientAccessModeWebAndApp
      : resolveAuthClientAccessMode(document)
    const allowedClientPlatforms = getAllowedAuthClientPlatforms(clientAccessMode)

    return {
      uid: String(document.uid ?? ''),
      email: String(document.email ?? ''),
      displayName: String(document.displayName ?? '').trim() || null,
      photoURL: String(document.photoURL ?? '').trim() || null,
      role: normalizedRole,
      approvalStatus: normalizedApprovalStatus,
      isOwner,
      isAdmin,
      isManager,
      isApproved: normalizedApprovalStatus === authApprovalApproved,
      approvedAt: String(document.approvedAt ?? '').trim() || null,
      createdAt: String(document.createdAt ?? '').trim() || null,
      updatedAt: String(document.updatedAt ?? '').trim() || null,
      lastLoginAt: String(document.lastLoginAt ?? '').trim() || null,
      accessStartHourUtc,
      accessEndHourUtc,
      accessTimeZone,
      hasLoginHoursRestriction: hasAuthLoginHourRestriction(accessStartHourUtc, accessEndHourUtc),
      linkedWorkerId,
      linkedWorkerNumber,
      linkedWorkerName,
      linkedZendeskUserId,
      linkedZendeskUserEmail,
      linkedZendeskUserName,
      clientPlatforms,
      lastLoginClientPlatform,
      clientAccessMode,
      allowedClientPlatforms,
      hasWebAccess: allowedClientPlatforms.includes(authClientPlatformWeb),
      hasAppAccess: allowedClientPlatforms.includes(authClientPlatformApp),
      hasWebSignIn: clientPlatforms.includes(authClientPlatformWeb),
      hasAppSignIn: clientPlatforms.includes(authClientPlatformApp),
    }
  }

  function isApprovedAdminUser(document) {
    const publicUser = toPublicAuthUser(document)

    return Boolean(publicUser?.isApproved && publicUser?.isAdmin)
  }

  return {
    formatAuthLoginHoursWindow,
    getAllowedAuthClientPlatforms,
    hasAuthLoginHourRestriction,
    isAllowedByAuthLoginHours,
    isApprovedAdminUser,
    isReviewerLoginEmail,
    normalizeAuthAccessTimeZone,
    normalizeAuthClientAccessMode,
    normalizeAuthClientPlatform,
    normalizeAuthHour,
    normalizeAuthRole,
    normalizeEmail,
    parseOptionalAuthAccessTimeZone,
    parseOptionalAuthHour,
    resolveAuthClientAccessMode,
    resolveAuthClientPlatformFromRequest,
    toPublicAuthUser,
  }
}

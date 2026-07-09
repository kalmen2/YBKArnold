export const nowIso = () => new Date().toISOString()
export const NO_ID = Object.freeze({ projection: { _id: 0 } })

export function normalizeText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength)
}

// Like normalizeText, but also collapses internal whitespace runs to single
// spaces. For single-line values (labels, chat/message text, config strings).
export function normalizeInlineText(value, maxLength = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export function normalizeOptionalShortText(value, maxLength = 240) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return null
  }

  return normalized.slice(0, maxLength)
}

export function normalizeLookupValue(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function normalizeLookupToken(value) {
  return normalizeText(value, 500)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function toIsoOrNull(value) {
  return normalizeText(value, 80) || null
}

export function toTimestampMs(value) {
  const parsed = Date.parse(normalizeText(value, 80))
  return Number.isFinite(parsed) ? parsed : null
}

export function isExpiredAt(isoTimestamp, skewMs = 0) {
  const timestampMs = toTimestampMs(isoTimestamp)

  if (!Number.isFinite(timestampMs)) {
    return true
  }

  return Date.now() >= timestampMs - skewMs
}

export function toMoneyOrZero(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

export function toMoneyOrNull(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null
}

export function buildFirebaseStorageDownloadUrl(bucketName, objectPath, downloadToken) {
  const encodedObjectPath = encodeURIComponent(String(objectPath ?? '').trim())
  const encodedToken = encodeURIComponent(String(downloadToken ?? '').trim())

  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodedObjectPath}?alt=media&token=${encodedToken}`
}

export function toNonNegativeInteger(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }

  return Math.floor(parsed)
}

export function normalizeOptionalBuildNumber(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return Math.floor(parsed)
}

export function toBoundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  if (parsed < min) {
    return min
  }

  if (parsed > max) {
    return max
  }

  return parsed
}

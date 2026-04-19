export const nowIso = () => new Date().toISOString()
export const NO_ID = Object.freeze({ projection: { _id: 0 } })

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

// Shared QuickBooks helpers used by the QB-routes, purchasing-routes, and
// projects-service modules. Pure string/URL helpers — no I/O, no error types
// of their own, so each caller can wrap them in its preferred error class.

import { normalizeText } from './value-utils.mjs'

export const QUICKBOOKS_TOKEN_URL =
  'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const QUICKBOOKS_API_BASE_URL_DEFAULT = 'https://quickbooks.api.intuit.com'

export function normalizeQuickBooksApiBaseUrl(value) {
  const normalized = normalizeText(value, 400)

  if (!normalized) {
    return QUICKBOOKS_API_BASE_URL_DEFAULT
  }

  return normalized.replace(/\/$/, '')
}

export function toIsoTimeFromNow(secondsFromNow) {
  const seconds = Number(secondsFromNow)

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null
  }

  return new Date(Date.now() + seconds * 1000).toISOString()
}

export function resolveQuickBooksErrorMessage(payload, fallbackMessage) {
  const faultError = payload?.Fault?.Error?.[0]
  const faultMessage = normalizeText(faultError?.Detail || faultError?.Message, 700)

  if (faultMessage) {
    return faultMessage
  }

  return normalizeText(payload?.error_description || payload?.error, 700) || fallbackMessage
}

export function extractQuickBooksRefValue(refValue) {
  if (typeof refValue === 'string') {
    return normalizeText(refValue, 160)
  }

  if (!refValue || typeof refValue !== 'object') {
    return ''
  }

  return (
    normalizeText(refValue.value, 160)
    || normalizeText(refValue.id, 160)
    || ''
  )
}

export function extractQuickBooksRefName(refValue) {
  if (!refValue || typeof refValue !== 'object') {
    return null
  }

  return normalizeText(refValue.name, 260) || null
}

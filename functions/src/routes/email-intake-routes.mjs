import { createTokenCryptoService } from '../services/token-crypto-service.mjs'
import {
  isExpiredAt,
  normalizeText,
  nowIso,
} from '../utils/value-utils.mjs'

const googleProviderId = 'google'
const microsoftProviderId = 'microsoft'
const emailReviewStatusPending = 'pending'
const emailReviewStatusApproved = 'approved'
const emailReviewStatusRejected = 'rejected'
const emailReviewStatuses = new Set([
  emailReviewStatusPending,
  emailReviewStatusApproved,
  emailReviewStatusRejected,
])
const emailReviewLaneGreen = 'green'
const emailReviewLaneYellow = 'yellow'
const emailReviewLaneRed = 'red'
const emailReviewSureMatchConfidenceThreshold = 0.8
const emailReviewLanes = new Set([
  emailReviewLaneGreen,
  emailReviewLaneYellow,
  emailReviewLaneRed,
])
const googleTokenUrl = 'https://oauth2.googleapis.com/token'
const microsoftGraphApiBaseUrl = 'https://graph.microsoft.com/v1.0'
const googleGmailProfileUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
const googleAccessTokenRefreshSkewMs = 2 * 60 * 1000
const microsoftAccessTokenRefreshSkewMs = 2 * 60 * 1000
const googleRequiredReadScope = 'https://www.googleapis.com/auth/gmail.readonly'
const microsoftRequiredReadScope = 'Mail.Read'
const emailIntakeSyncLookbackDaysMax = 120
const emailIntakeBootstrapLookbackDaysDefault = 30
const emailIntakeManualSyncLookbackDaysDefault = 3
const emailIntakeManualSyncLookbackDaysMax = 3
const emailIntakeManualSyncMaxRuntimeMs = 57 * 1000
const emailIntakeManualSyncPerConnectionTimeoutMs = 55 * 1000
const emailIntakeManualSyncMaxMessagesPerConnectionDefault = 400
const emailIntakeManualSyncMaxMessagesPerConnectionMax = 1200
const emailIntakeAiClassificationTimeoutMs = 12 * 1000
const emailIntakeRuntimeReserveMs = 5 * 1000
const emailIntakePerEmailRuntimeEstimateMs = 800
const emailIntakeDefaultSyncTimeZone = 'UTC'
const emailIntakeSyncRunStatusQueued = 'queued'
const emailIntakeSyncRunStatusRunning = 'running'
const emailIntakeSyncRunStatusCompleted = 'completed'
const emailIntakeSyncRunStatusFailed = 'failed'
const emailIntakeSyncRunStatusesTerminal = new Set([
  emailIntakeSyncRunStatusCompleted,
  emailIntakeSyncRunStatusFailed,
])
const emailIntakeSyncRunLogsMax = 600

const timeZonePartsFormatterCache = new Map()

const { decryptSecret, encryptSecret } = createTokenCryptoService()

function resolveGoogleServiceConfig() {
  const clientId = normalizeText(
    process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID,
    320,
  )
  const clientSecret = normalizeText(
    process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET,
    320,
  )

  if (!clientId || !clientSecret) {
    throw {
      status: 500,
      message: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    }
  }

  return {
    clientId,
    clientSecret,
  }
}

function resolveMicrosoftServiceConfig() {
  const clientId = normalizeText(
    process.env.MICROSOFT_CLIENT_ID || process.env.OUTLOOK_CLIENT_ID,
    320,
  )
  const clientSecret = normalizeText(
    process.env.MICROSOFT_CLIENT_SECRET || process.env.OUTLOOK_CLIENT_SECRET,
    320,
  )
  const tenantId = normalizeText(process.env.MICROSOFT_TENANT_ID, 200)
    || normalizeText(process.env.OUTLOOK_TENANT_ID, 200)
    || 'common'

  if (!clientId || !clientSecret) {
    throw {
      status: 500,
      message: 'Microsoft OAuth is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.',
    }
  }

  return {
    clientId,
    clientSecret,
    tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    scopes: 'openid email profile offline_access User.Read Mail.Read Mail.Send',
  }
}

function resolveGoogleErrorMessage(payload, fallbackMessage) {
  const topLevel = normalizeText(payload?.error_description, 500)

  if (topLevel) {
    return topLevel
  }

  const nestedMessage = normalizeText(payload?.error?.message, 500)

  if (nestedMessage) {
    return nestedMessage
  }

  const nestedError = normalizeText(payload?.error, 500)

  if (nestedError) {
    return nestedError
  }

  return fallbackMessage
}

function resolveMicrosoftErrorMessage(payload, fallbackMessage) {
  const topLevel = normalizeText(payload?.error_description, 500)

  if (topLevel) {
    return topLevel
  }

  const nestedDescription = normalizeText(payload?.error?.error_description, 500)

  if (nestedDescription) {
    return nestedDescription
  }

  const nestedMessage = normalizeText(payload?.error?.message, 500)

  if (nestedMessage) {
    return nestedMessage
  }

  const nestedError = normalizeText(payload?.error, 500)

  if (nestedError) {
    return nestedError
  }

  return fallbackMessage
}

function parseScopeSet(scopeValue) {
  return new Set(
    String(scopeValue ?? '')
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

function getMissingGoogleScopes(scopeValue) {
  const aliases = new Map([
    ['https://www.googleapis.com/auth/userinfo.email', 'email'],
    ['https://www.googleapis.com/auth/userinfo.profile', 'profile'],
  ])
  const grantedScopes = new Set(
    [...parseScopeSet(scopeValue)]
      .map((scope) => aliases.get(scope) || scope)
      .filter(Boolean),
  )

  return [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.settings.basic',
    'https://www.googleapis.com/auth/contacts.readonly',
  ].filter((scope) => !grantedScopes.has(scope))
}

function getMissingMicrosoftScopes(scopeValue) {
  const grantedScopes = parseScopeSet(scopeValue)

  return [
    'openid',
    'email',
    'profile',
    'offline_access',
    'User.Read',
    'Mail.Read',
    'Mail.Send',
  ].filter((scope) => !grantedScopes.has(scope))
}

function normalizeEmailReviewStatus(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()

  if (emailReviewStatuses.has(normalizedValue)) {
    return normalizedValue
  }

  return emailReviewStatusPending
}

function normalizeEmailDestinationType(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()

  if (
    normalizedValue === 'account'
    || normalizedValue === 'order'
    || normalizedValue === 'quote'
    || normalizedValue === 'none'
  ) {
    return normalizedValue
  }

  return 'none'
}

function normalizeEmailReviewLane(value, fallbackLane = emailReviewLaneRed) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()

  if (emailReviewLanes.has(normalizedValue)) {
    return normalizedValue
  }

  return fallbackLane
}

function normalizeDirection(value) {
  return String(value ?? '').trim().toLowerCase() === 'outbound'
    ? 'outbound'
    : 'inbound'
}

function normalizeSyncProvider(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()

  if (normalizedValue === googleProviderId || normalizedValue === microsoftProviderId) {
    return normalizedValue
  }

  return null
}

function resolveEmailConversationIdentity(message) {
  const provider = normalizeSyncProvider(message?.provider)
  const threadId = normalizeText(message?.threadId, 220) || null
  const conversationId = normalizeText(message?.conversationId, 220) || null
  const internetMessageId = (normalizeText(message?.internetMessageId, 320) || '').toLowerCase() || null
  const externalMessageId = normalizeText(message?.externalMessageId, 220) || null

  let conversationReference = null

  if (provider === googleProviderId) {
    conversationReference = threadId
      ? `thread:${threadId}`
      : internetMessageId
        ? `internet:${internetMessageId}`
        : externalMessageId
          ? `external:${externalMessageId}`
          : null
  } else if (provider === microsoftProviderId) {
    conversationReference = conversationId
      ? `conversation:${conversationId}`
      : internetMessageId
        ? `internet:${internetMessageId}`
        : externalMessageId
          ? `external:${externalMessageId}`
          : null
  }

  return {
    provider,
    threadId,
    conversationId,
    conversationReference,
    conversationKey: provider && conversationReference
      ? `${provider}:${conversationReference}`
      : null,
  }
}

function normalizeSyncTimeZone(value, fallbackTimeZone = emailIntakeDefaultSyncTimeZone) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return fallbackTimeZone
  }

  if (normalizedValue.toUpperCase() === 'UTC') {
    return 'UTC'
  }

  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: normalizedValue,
    }).format(new Date(0))

    return normalizedValue
  } catch {
    return fallbackTimeZone
  }
}

function getTimeZonePartsFormatter(timeZone) {
  const normalizedTimeZone = normalizeSyncTimeZone(timeZone)

  if (timeZonePartsFormatterCache.has(normalizedTimeZone)) {
    return timeZonePartsFormatterCache.get(normalizedTimeZone)
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizedTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  timeZonePartsFormatterCache.set(normalizedTimeZone, formatter)

  return formatter
}

function parseIsoDateParts(value) {
  const normalizedValue = String(value ?? '').trim()
  const match = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (
    !Number.isFinite(year)
    || !Number.isFinite(month)
    || !Number.isFinite(day)
    || month < 1
    || month > 12
    || day < 1
    || day > 31
  ) {
    return null
  }

  const parsedMs = Date.parse(`${normalizedValue}T00:00:00.000Z`)

  if (!Number.isFinite(parsedMs)) {
    return null
  }

  const parsedDate = new Date(parsedMs)

  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() + 1 !== month
    || parsedDate.getUTCDate() !== day
  ) {
    return null
  }

  return {
    year,
    month,
    day,
    isoDate: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

function addDaysToIsoDate(value, dayOffset = 0) {
  const parsedDate = parseIsoDateParts(value)

  if (!parsedDate) {
    return null
  }

  const baseMs = Date.UTC(parsedDate.year, parsedDate.month - 1, parsedDate.day)
  const nextMs = baseMs + Number(dayOffset) * 24 * 60 * 60 * 1000

  if (!Number.isFinite(nextMs)) {
    return null
  }

  const nextDate = new Date(nextMs)

  return `${String(nextDate.getUTCFullYear()).padStart(4, '0')}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDate.getUTCDate()).padStart(2, '0')}`
}

function resolveTimeZoneOffsetMs(timeZone, timestampMs) {
  const formatter = getTimeZonePartsFormatter(timeZone)
  const parts = formatter.formatToParts(new Date(timestampMs))
  const partMap = {}

  parts.forEach((part) => {
    partMap[part.type] = part.value
  })

  const year = Number(partMap.year)
  const month = Number(partMap.month)
  const day = Number(partMap.day)
  const hour = Number(partMap.hour)
  const minute = Number(partMap.minute)
  const second = Number(partMap.second)

  if (
    !Number.isFinite(year)
    || !Number.isFinite(month)
    || !Number.isFinite(day)
    || !Number.isFinite(hour)
    || !Number.isFinite(minute)
    || !Number.isFinite(second)
  ) {
    return 0
  }

  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second)

  return asUtcMs - timestampMs
}

function resolveTimeZoneMidnightUtcMs(syncDate, timeZone) {
  const parsedDate = parseIsoDateParts(syncDate)

  if (!parsedDate) {
    return Number.NaN
  }

  const utcGuessMs = Date.UTC(parsedDate.year, parsedDate.month - 1, parsedDate.day, 0, 0, 0)
  const initialOffsetMs = resolveTimeZoneOffsetMs(timeZone, utcGuessMs)
  let resolvedUtcMs = utcGuessMs - initialOffsetMs
  const refinedOffsetMs = resolveTimeZoneOffsetMs(timeZone, resolvedUtcMs)

  if (refinedOffsetMs !== initialOffsetMs) {
    resolvedUtcMs = utcGuessMs - refinedOffsetMs
  }

  return resolvedUtcMs
}

function resolveCurrentIsoDateInTimeZone(timeZone) {
  const normalizedTimeZone = normalizeSyncTimeZone(timeZone)

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: normalizedTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = formatter.formatToParts(new Date())
    const partMap = {}

    parts.forEach((part) => {
      partMap[part.type] = part.value
    })

    const year = Number(partMap.year)
    const month = Number(partMap.month)
    const day = Number(partMap.day)

    if (
      Number.isFinite(year)
      && Number.isFinite(month)
      && Number.isFinite(day)
      && year > 0
      && month > 0
      && day > 0
    ) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  } catch {
    // Fallback to UTC date below.
  }

  return nowIso().slice(0, 10)
}

function isTimestampWithinIsoRange(value, startIso, endIso) {
  const targetMs = Date.parse(String(value ?? ''))
  const startMs = Date.parse(String(startIso ?? ''))
  const endMs = Date.parse(String(endIso ?? ''))

  if (!Number.isFinite(targetMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return false
  }

  return targetMs >= startMs && targetMs < endMs
}

function normalizeSyncDateValue(value) {
  return parseIsoDateParts(value)?.isoDate || null
}

function resolveSyncDateRange(value, timeZone = emailIntakeDefaultSyncTimeZone) {
  const syncDate = normalizeSyncDateValue(value)

  if (!syncDate) {
    return null
  }

  const normalizedTimeZone = normalizeSyncTimeZone(timeZone)

  if (normalizedTimeZone === 'UTC') {
    const startMs = Date.parse(`${syncDate}T00:00:00.000Z`)

    if (!Number.isFinite(startMs)) {
      return null
    }

    const endMs = startMs + 24 * 60 * 60 * 1000

    return {
      syncDate,
      timeZone: normalizedTimeZone,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
    }
  }

  const nextSyncDate = addDaysToIsoDate(syncDate, 1)

  if (!nextSyncDate) {
    return null
  }

  const startMs = resolveTimeZoneMidnightUtcMs(syncDate, normalizedTimeZone)
  const endMs = resolveTimeZoneMidnightUtcMs(nextSyncDate, normalizedTimeZone)

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null
  }

  return {
    syncDate,
    timeZone: normalizedTimeZone,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  }
}

function formatGoogleQueryDate(syncDate, dayOffset = 0) {
  const targetDate = addDaysToIsoDate(syncDate, dayOffset)

  if (!targetDate) {
    return ''
  }

  const [year = '', month = '', day = ''] = targetDate.split('-')

  return `${year}/${month}/${day}`
}

function toIsoDateSafe(value) {
  const candidate = String(value ?? '').trim()

  if (!candidate) {
    return null
  }

  const parsedMs = Date.parse(candidate)

  if (!Number.isFinite(parsedMs)) {
    return null
  }

  return new Date(parsedMs).toISOString()
}

function clampInteger(value, minValue, maxValue, fallback) {
  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue)) {
    return fallback
  }

  return Math.min(maxValue, Math.max(minValue, Math.floor(parsedValue)))
}

function resolveSyncLookbackDays(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  return clampInteger(value, 0, emailIntakeSyncLookbackDaysMax, fallback)
}

function createSyncTimeoutError(message) {
  const error = new Error(message)
  error.code = 'email_intake_sync_timeout'
  return error
}

async function withOperationTimeout(promise, timeoutMs, label) {
  const resolvedTimeoutMs = clampInteger(timeoutMs, 0, 5 * 60 * 1000, 0)

  if (resolvedTimeoutMs <= 0) {
    return promise
  }

  let timeoutHandle = null

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(createSyncTimeoutError(`${label} timed out after ${Math.ceil(resolvedTimeoutMs / 1000)}s.`))
        }, resolvedTimeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

function resolveAdaptivePerConnectionTimeoutMs({
  requestedTimeoutMs,
  maxRuntimeMs,
  totalConnections,
}) {
  const resolvedRequestedTimeoutMs = clampInteger(requestedTimeoutMs, 0, 60000, 0)
  const resolvedMaxRuntimeMs = clampInteger(maxRuntimeMs, 0, 120000, 0)
  const resolvedTotalConnections = clampInteger(totalConnections, 1, 200, 1)

  if (resolvedRequestedTimeoutMs <= 0 || resolvedMaxRuntimeMs <= 0) {
    return resolvedRequestedTimeoutMs
  }

  // Let one mailbox use most of the request budget while still keeping headroom.
  const runtimeBasedTimeoutMs = Math.floor(resolvedMaxRuntimeMs / resolvedTotalConnections) - 1500

  return clampInteger(
    Math.max(resolvedRequestedTimeoutMs, runtimeBasedTimeoutMs),
    resolvedRequestedTimeoutMs,
    60000,
    resolvedRequestedTimeoutMs,
  )
}

function normalizeSyncRunStatus(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()

  if (
    normalizedValue === emailIntakeSyncRunStatusQueued
    || normalizedValue === emailIntakeSyncRunStatusRunning
    || normalizedValue === emailIntakeSyncRunStatusCompleted
    || normalizedValue === emailIntakeSyncRunStatusFailed
  ) {
    return normalizedValue
  }

  return emailIntakeSyncRunStatusQueued
}

function normalizeSyncRunLogLevel(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()

  if (normalizedValue === 'warn' || normalizedValue === 'error') {
    return normalizedValue
  }

  return 'info'
}

function buildSyncRunLogEntry({
  sequence,
  level = 'info',
  message,
  data = null,
}) {
  return {
    sequence: clampInteger(sequence, 1, Number.MAX_SAFE_INTEGER, 1),
    level: normalizeSyncRunLogLevel(level),
    at: nowIso(),
    message: normalizeText(message, 800) || 'Sync event.',
    data: data && typeof data === 'object'
      ? data
      : null,
  }
}

function emitEmailSyncTrace(onTrace, level, message, data = null) {
  if (typeof onTrace !== 'function') {
    return
  }

  try {
    onTrace(level, message, data)
  } catch {
    // Ignore trace handler failures so sync flow keeps running.
  }
}

function toPublicEmailIntakeSyncRun(run) {
  const details = Array.isArray(run?.details)
    ? run.details
      .map((detail) => ({
        provider: normalizeSyncProvider(detail?.provider),
        uid: normalizeText(detail?.uid, 200) || null,
        skipped: Boolean(detail?.skipped),
        failed: Boolean(detail?.failed),
        timedOut: Boolean(detail?.timedOut),
        reason: normalizeText(detail?.reason, 600) || undefined,
        error: normalizeText(detail?.error, 1200) || undefined,
        processingStoppedReason: normalizeText(detail?.processingStoppedReason, 600) || undefined,
        bootstrapped: Boolean(detail?.bootstrapped),
        rebaselined: Boolean(detail?.rebaselined),
        syncDateApplied: normalizeSyncDateValue(detail?.syncDateApplied),
        lookbackDaysApplied: clampInteger(detail?.lookbackDaysApplied, 0, 120, 0),
        messagesCaught: clampInteger(detail?.messagesCaught, 0, 20000, 0),
        messagesPlannedForProcessing: clampInteger(detail?.messagesPlannedForProcessing, 0, 20000, 0),
        messagesVisitedForProcessing: clampInteger(detail?.messagesVisitedForProcessing, 0, 20000, 0),
        lookbackMessagesCollected: clampInteger(detail?.lookbackMessagesCollected, 0, 10000, 0),
        messagesSkippedNoDestination: clampInteger(detail?.messagesSkippedNoDestination, 0, 10000, 0),
        messagesSkippedByPolicy: clampInteger(detail?.messagesSkippedByPolicy, 0, 10000, 0),
        messagesIngested: clampInteger(detail?.messagesIngested, 0, 10000, 0),
        suggestionsCreated: clampInteger(detail?.suggestionsCreated, 0, 10000, 0),
      }))
      .slice(-400)
    : []

  return {
    id: normalizeText(run?.id, 160) || null,
    status: normalizeSyncRunStatus(run?.status),
    startedAt: toIsoDateSafe(run?.startedAt),
    completedAt: toIsoDateSafe(run?.completedAt),
    createdAt: toIsoDateSafe(run?.createdAt),
    updatedAt: toIsoDateSafe(run?.updatedAt),
    requestedByUid: normalizeText(run?.requestedByUid, 200) || null,
    providerFilter: normalizeSyncProvider(run?.providerFilter),
    syncDateRequested: normalizeSyncDateValue(run?.syncDateRequested),
    syncTimeZoneRequested: normalizeSyncDateValue(run?.syncDateRequested)
      ? normalizeSyncTimeZone(run?.syncTimeZoneRequested)
      : null,
    lookbackDaysRequested: clampInteger(run?.lookbackDaysRequested, 0, emailIntakeSyncLookbackDaysMax, 0),
    maxMessagesPerConnection: clampInteger(
      run?.maxMessagesPerConnection,
      20,
      emailIntakeManualSyncMaxMessagesPerConnectionMax,
      emailIntakeManualSyncMaxMessagesPerConnectionDefault,
    ),
    maxRuntimeMs: clampInteger(run?.maxRuntimeMs, 0, 120000, 0) || null,
    perConnectionTimeoutMs: clampInteger(run?.perConnectionTimeoutMs, 0, 60000, 0) || null,
    scannedConnections: clampInteger(run?.scannedConnections, 0, 500, 0),
    processedConnections: clampInteger(run?.processedConnections, 0, 500, 0),
    succeededConnections: clampInteger(run?.succeededConnections, 0, 500, 0),
    failedConnections: clampInteger(run?.failedConnections, 0, 500, 0),
    skippedConnections: clampInteger(run?.skippedConnections, 0, 500, 0),
    truncated: Boolean(run?.truncated),
    truncationReason: normalizeText(run?.truncationReason, 600) || null,
    messagesCaught: clampInteger(run?.messagesCaught, 0, 200000, 0),
    messagesIngested: clampInteger(run?.messagesIngested, 0, 100000, 0),
    suggestionsCreated: clampInteger(run?.suggestionsCreated, 0, 100000, 0),
    logSequence: clampInteger(run?.logSequence, 0, Number.MAX_SAFE_INTEGER, 0),
    details,
  }
}

function toPublicEmailIntakeSyncRunLogs(logs) {
  if (!Array.isArray(logs)) {
    return []
  }

  return logs
    .map((log) => ({
      sequence: clampInteger(log?.sequence, 1, Number.MAX_SAFE_INTEGER, 1),
      level: normalizeSyncRunLogLevel(log?.level),
      at: toIsoDateSafe(log?.at) || nowIso(),
      message: normalizeText(log?.message, 800) || 'Sync event.',
      data: log?.data && typeof log.data === 'object'
        ? log.data
        : null,
    }))
    .slice(-emailIntakeSyncRunLogsMax)
}

function canActorAccessSyncRun(actor, run) {
  if (actor?.isAdmin) {
    return true
  }

  const actorUid = normalizeText(actor?.uid, 200)
  const requestedByUid = normalizeText(run?.requestedByUid, 200)

  return Boolean(actorUid) && actorUid === requestedByUid
}

function resolveBootstrapLookbackDays() {
  return resolveSyncLookbackDays(
    process.env.EMAIL_INTAKE_BOOTSTRAP_LOOKBACK_DAYS,
    emailIntakeBootstrapLookbackDaysDefault,
  )
}

function buildGoogleLookbackQuery(lookbackDays) {
  const resolvedLookbackDays = clampInteger(
    lookbackDays,
    1,
    emailIntakeSyncLookbackDaysMax,
    emailIntakeBootstrapLookbackDaysDefault,
  )

  return `newer_than:${resolvedLookbackDays}d -in:trash -in:spam`
}

function buildGoogleExactDayQuery(syncDate, timeZone = emailIntakeDefaultSyncTimeZone) {
  const resolvedTimeZone = normalizeSyncTimeZone(timeZone)
  const shouldWidenWindow = resolvedTimeZone !== 'UTC'
  const startDate = formatGoogleQueryDate(syncDate, shouldWidenWindow ? -1 : 0)
  const endDate = formatGoogleQueryDate(syncDate, shouldWidenWindow ? 2 : 1)

  if (!startDate || !endDate) {
    return null
  }

  return `after:${startDate} before:${endDate} -in:trash -in:spam`
}

function escapeRegexLiteral(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeQuoteComparableValue(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function resolveQuoteRevisionFamilyToken(value) {
  const normalizedValue = normalizeQuoteComparableValue(value)

  if (!normalizedValue) {
    return null
  }

  const revisionMatch = normalizedValue.match(/^(.*?R)\d+$/)

  if (!revisionMatch) {
    return null
  }

  return revisionMatch[1] || null
}

function buildQuoteFlexibleRegex(value, { allowRevisionFamily = true } = {}) {
  const trimmedValue = String(value ?? '').trim()

  if (!trimmedValue) {
    return null
  }

  const escapedValue = escapeRegexLiteral(trimmedValue)
    .replace(/[-_\s]+/g, '[-_\\s]*')
  const normalizedFamilyToken = allowRevisionFamily
    ? resolveQuoteRevisionFamilyToken(trimmedValue)
    : null

  if (normalizedFamilyToken) {
    const familyPattern = escapeRegexLiteral(normalizedFamilyToken)
      .replace(/[-_\s]+/g, '[-_\\s]*')

    return `^${familyPattern}\\d*$`
  }

  return `^${escapedValue}$`
}

function buildQuoteLookupClauses(tokens) {
  const tokenList = Array.isArray(tokens) ? tokens : []
  const clauses = []
  const seenPatterns = new Set()

  tokenList.forEach((token) => {
    const pattern = buildQuoteFlexibleRegex(token)

    if (!pattern || seenPatterns.has(pattern)) {
      return
    }

    seenPatterns.add(pattern)
    clauses.push({
      quoteNumber: {
        $regex: pattern,
        $options: 'i',
      },
    })
  })

  return clauses
}

function buildGoogleHeaderMap(headers) {
  const map = new Map()

  ;(Array.isArray(headers) ? headers : []).forEach((header) => {
    const key = String(header?.name ?? '').trim().toLowerCase()

    if (!key || map.has(key)) {
      return
    }

    map.set(key, String(header?.value ?? '').trim())
  })

  return map
}

function parseEmailAddressList(value, normalizeEmail) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return []
  }

  const parsed = []
  const addressRegex = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/ig
  let match = null

  while ((match = addressRegex.exec(normalized)) !== null) {
    const normalizedEmailAddress = normalizeText(
      typeof normalizeEmail === 'function'
        ? normalizeEmail(match[1])
        : String(match[1] ?? '').toLowerCase(),
      320,
    ).toLowerCase()

    if (!normalizedEmailAddress) {
      continue
    }

    parsed.push(normalizedEmailAddress)
  }

  return [...new Set(parsed)].slice(0, 40)
}

function decodeGoogleBase64Url(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return ''
  }

  const base64 = normalizedValue
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(normalizedValue.length / 4) * 4, '=')

  try {
    return Buffer.from(base64, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

function stripHtmlMarkup(value) {
  return String(value ?? '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeHtmlForStorage(value, maxLength = 50000) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return null
  }

  // Defensive strip for executable tags; client still sanitizes before rendering.
  return normalizedValue
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
    .slice(0, maxLength)
}

function extractGooglePayloadContent(payload) {
  const attachmentNames = []
  const bodyTextChunks = []
  const bodyHtmlChunks = []

  function visitPart(part) {
    if (!part || typeof part !== 'object') {
      return
    }

    const fileName = normalizeText(part?.filename, 240)

    if (fileName) {
      attachmentNames.push(fileName)
    }

    const mimeType = String(part?.mimeType ?? '').trim().toLowerCase()
    const bodyData = decodeGoogleBase64Url(part?.body?.data)

    if (bodyData) {
      const normalizedTextChunk = mimeType.includes('html')
        ? stripHtmlMarkup(bodyData)
        : bodyData.replace(/\s+/g, ' ').trim()

      if (normalizedTextChunk) {
        bodyTextChunks.push(normalizedTextChunk)
      }

      if (mimeType.includes('html')) {
        const normalizedHtmlChunk = normalizeHtmlForStorage(bodyData)

        if (normalizedHtmlChunk) {
          bodyHtmlChunks.push(normalizedHtmlChunk)
        }
      }
    }

    ;(Array.isArray(part?.parts) ? part.parts : []).forEach((nestedPart) => {
      visitPart(nestedPart)
    })
  }

  visitPart(payload)

  return {
    bodyText: normalizeText(bodyTextChunks.join('\n\n'), 12000) || null,
    bodyHtml: normalizeHtmlForStorage(bodyHtmlChunks.join('\n\n<hr />\n\n'), 50000),
    attachmentNames: [...new Set(
      attachmentNames
        .map((name) => normalizeText(name, 240))
        .filter(Boolean),
    )].slice(0, 20),
  }
}

function normalizeGraphRecipientList(recipients, normalizeEmail) {
  return [...new Set(
    (Array.isArray(recipients) ? recipients : [])
      .map((entry) => normalizeText(
        typeof normalizeEmail === 'function'
          ? normalizeEmail(entry?.emailAddress?.address)
          : String(entry?.emailAddress?.address ?? '').toLowerCase(),
        320,
      ).toLowerCase())
      .filter(Boolean),
  )].slice(0, 40)
}

async function exchangeGoogleRefreshToken({
  clientId,
  clientSecret,
  refreshToken,
}) {
  const formData = new URLSearchParams()

  formData.set('client_id', clientId)
  formData.set('client_secret', clientSecret)
  formData.set('grant_type', 'refresh_token')
  formData.set('refresh_token', normalizeText(refreshToken, 8000))

  const response = await fetch(googleTokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: formData.toString(),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw {
      status: response.status,
      message: `Google token refresh failed: ${resolveGoogleErrorMessage(payload, `status ${response.status}`)}`,
    }
  }

  return payload
}

async function exchangeMicrosoftRefreshToken({
  config,
  refreshToken,
}) {
  const formData = new URLSearchParams()

  formData.set('client_id', config.clientId)
  formData.set('client_secret', config.clientSecret)
  formData.set('grant_type', 'refresh_token')
  formData.set('refresh_token', normalizeText(refreshToken, 8000))
  formData.set('scope', config.scopes)

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: formData.toString(),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw {
      status: response.status,
      message: `Microsoft token refresh failed: ${resolveMicrosoftErrorMessage(payload, `status ${response.status}`)}`,
    }
  }

  return payload
}

function mapGoogleRefreshPayload(payload, previousRefreshToken) {
  const accessToken = normalizeText(payload?.access_token, 8000)
  const refreshToken = normalizeText(payload?.refresh_token, 8000) || previousRefreshToken
  const expiresInSeconds = Number(payload?.expires_in)

  if (!accessToken || !refreshToken) {
    throw {
      status: 502,
      message: 'Google token refresh did not return required token fields.',
    }
  }

  return {
    accessToken,
    refreshToken,
    tokenType: normalizeText(payload?.token_type, 50) || 'Bearer',
    scope: normalizeText(payload?.scope, 1500) || null,
    accessTokenExpiresAt: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : null,
  }
}

function mapMicrosoftRefreshPayload(payload, previousRefreshToken) {
  const accessToken = normalizeText(payload?.access_token, 8000)
  const refreshToken = normalizeText(payload?.refresh_token, 8000) || previousRefreshToken
  const expiresInSeconds = Number(payload?.expires_in)

  if (!accessToken || !refreshToken) {
    throw {
      status: 502,
      message: 'Microsoft token refresh did not return required token fields.',
    }
  }

  return {
    accessToken,
    refreshToken,
    tokenType: normalizeText(payload?.token_type, 50) || 'Bearer',
    scope: normalizeText(payload?.scope, 1500) || null,
    accessTokenExpiresAt: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : null,
  }
}

export function registerEmailIntakeRoutes(app, deps) {
  const {
    classifyEmailIntakeSuggestion,
    getCollections,
    normalizeEmail,
    randomUUID,
    requireFirebaseAuth,
    toPublicAuthUser,
  } = deps

  async function getEmailIntakeCollections() {
    const {
      aiRulesCollection,
      crmAccountsCollection,
      crmContactsCollection,
      crmOrdersCollection,
      crmQuotesCollection,
      databasesByDomain,
      emailConnectionsCollection,
      emailIntakeFeedbackCollection,
      emailIntakeMessagesCollection,
      emailIntakeSuggestionsCollection,
      emailIntakeSyncRunsCollection,
      emailSyncStatesCollection,
      ordersUnifiedCollection,
    } = await getCollections()

    return {
      aiRulesCollection,
      crmAccountsCollection,
      crmContactsCollection,
      crmOrdersCollection,
      crmQuotesCollection,
      crmDatabase: databasesByDomain?.crm,
      emailConnectionsCollection,
      emailIntakeFeedbackCollection,
      emailIntakeMessagesCollection,
      emailIntakeSuggestionsCollection,
      emailIntakeSyncRunsCollection,
      emailSyncStatesCollection,
      ordersDatabase: databasesByDomain?.orders,
      ordersUnifiedCollection,
    }
  }

  function normalizeEmailAddress(value) {
    const candidate = typeof normalizeEmail === 'function'
      ? normalizeEmail(value)
      : String(value ?? '').toLowerCase()

    return normalizeText(candidate, 320).toLowerCase()
  }

  function resolveEmailIntakeChatAuthorName(actor) {
    const explicitAuthorName = normalizeText(process.env.EMAIL_INTAKE_CHAT_AUTHOR_NAME, 80)

    if (explicitAuthorName) {
      return explicitAuthorName
    }

    const displayName = normalizeText(actor?.displayName, 200)

    if (displayName) {
      return normalizeText(displayName, 80) || 'Teammate'
    }

    return 'Teammate'
  }

  function normalizeEmailIntakePostedMessage(chatDraft, fallbackSummary) {
    const normalizedChatDraft = normalizeText(chatDraft, 4000)
    const normalizedFallbackSummary = normalizeText(fallbackSummary, 1200)

    if (!normalizedChatDraft) {
      return normalizedFallbackSummary || ''
    }

    const lines = normalizedChatDraft
      .split(/\r?\n/)
      .map((line) => String(line ?? '').trim())
      .filter(Boolean)
    const messageSummaryLine = lines.find((line) => /^message\s*summary\s*:/i.test(line))

    if (messageSummaryLine) {
      const extractedSummary = normalizeText(
        messageSummaryLine.replace(/^message\s*summary\s*:/i, ''),
        1200,
      )

      if (extractedSummary) {
        return extractedSummary
      }
    }

    const unlabeledLines = lines.filter((line) => !/^(regarding|quote\s*number|order\s*number|account|requested\s*action)\s*:/i.test(line))
    const plainSummary = normalizeText(unlabeledLines.join(' '), 1200)

    if (plainSummary) {
      return plainSummary
    }

    return normalizeText(normalizedChatDraft, 1200)
      || normalizedFallbackSummary
      || ''
  }

  function resolveReviewActor(req) {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved) {
      throw {
        status: 403,
        message: 'Approved access is required.',
      }
    }

    const uid = normalizeText(req.authUser?.uid, 200)

    if (!uid) {
      throw {
        status: 401,
        message: 'Missing authenticated user identifier.',
      }
    }

    return {
      uid,
      email: normalizeEmailAddress(req.authUser?.email) || null,
      displayName: normalizeText(publicUser?.displayName, 200) || null,
      isAdmin: Boolean(publicUser?.isAdmin),
    }
  }

  function buildSuggestionAccessFilter(baseFilter, actor) {
    if (actor?.isAdmin) {
      return baseFilter
    }

    return {
      ...baseFilter,
      uid: normalizeText(actor?.uid, 200),
    }
  }

  async function resolveGoogleAccessTokenForSync({
    emailConnectionsCollection,
    connection,
    forceRefresh = false,
  }) {
    const shouldRefresh = forceRefresh
      || isExpiredAt(connection?.accessTokenExpiresAt, googleAccessTokenRefreshSkewMs)
      || !connection?.accessTokenEncrypted

    if (!shouldRefresh) {
      const decrypted = decryptSecret(connection?.accessTokenEncrypted)

      if (decrypted) {
        return {
          connection,
          accessToken: decrypted,
        }
      }
    }

    const refreshToken = decryptSecret(connection?.refreshTokenEncrypted)

    if (!refreshToken) {
      throw {
        status: 409,
        message: 'Google connection is missing a refresh token. Reconnect Gmail.',
      }
    }

    const config = resolveGoogleServiceConfig()
    const refreshPayload = await exchangeGoogleRefreshToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken,
    })
    const mapped = mapGoogleRefreshPayload(refreshPayload, refreshToken)
    const now = nowIso()
    const accessTokenEncrypted = encryptSecret(mapped.accessToken)
    const refreshTokenEncrypted = encryptSecret(mapped.refreshToken)

    await emailConnectionsCollection.updateOne(
      {
        provider: googleProviderId,
        uid: normalizeText(connection?.uid, 200),
      },
      {
        $set: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          accessTokenExpiresAt: mapped.accessTokenExpiresAt,
          tokenType: mapped.tokenType,
          scope: mapped.scope || normalizeText(connection?.scope, 1500) || null,
          updatedAt: now,
          lastRefreshAt: now,
        },
      },
    )

    return {
      connection: {
        ...connection,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        accessTokenExpiresAt: mapped.accessTokenExpiresAt,
        tokenType: mapped.tokenType,
        scope: mapped.scope || normalizeText(connection?.scope, 1500) || null,
        updatedAt: now,
        lastRefreshAt: now,
      },
      accessToken: mapped.accessToken,
    }
  }

  async function resolveMicrosoftAccessTokenForSync({
    emailConnectionsCollection,
    connection,
    forceRefresh = false,
  }) {
    const shouldRefresh = forceRefresh
      || isExpiredAt(connection?.accessTokenExpiresAt, microsoftAccessTokenRefreshSkewMs)
      || !connection?.accessTokenEncrypted

    if (!shouldRefresh) {
      const decrypted = decryptSecret(connection?.accessTokenEncrypted)

      if (decrypted) {
        return {
          connection,
          accessToken: decrypted,
        }
      }
    }

    const refreshToken = decryptSecret(connection?.refreshTokenEncrypted)

    if (!refreshToken) {
      throw {
        status: 409,
        message: 'Microsoft connection is missing a refresh token. Reconnect Outlook.',
      }
    }

    const config = resolveMicrosoftServiceConfig()
    const refreshPayload = await exchangeMicrosoftRefreshToken({
      config,
      refreshToken,
    })
    const mapped = mapMicrosoftRefreshPayload(refreshPayload, refreshToken)
    const now = nowIso()
    const accessTokenEncrypted = encryptSecret(mapped.accessToken)
    const refreshTokenEncrypted = encryptSecret(mapped.refreshToken)

    await emailConnectionsCollection.updateOne(
      {
        provider: microsoftProviderId,
        uid: normalizeText(connection?.uid, 200),
      },
      {
        $set: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          accessTokenExpiresAt: mapped.accessTokenExpiresAt,
          tokenType: mapped.tokenType,
          scope: mapped.scope || normalizeText(connection?.scope, 1500) || null,
          updatedAt: now,
          lastRefreshAt: now,
        },
      },
    )

    return {
      connection: {
        ...connection,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        accessTokenExpiresAt: mapped.accessTokenExpiresAt,
        tokenType: mapped.tokenType,
        scope: mapped.scope || normalizeText(connection?.scope, 1500) || null,
        updatedAt: now,
        lastRefreshAt: now,
      },
      accessToken: mapped.accessToken,
    }
  }

  async function fetchGoogleMailboxProfile(accessToken) {
    const response = await fetch(googleGmailProfileUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw {
        status: response.status,
        message: `Could not fetch Gmail profile: ${resolveGoogleErrorMessage(payload, `status ${response.status}`)}`,
      }
    }

    return {
      emailAddress: normalizeEmailAddress(payload?.emailAddress) || null,
      historyId: normalizeText(payload?.historyId, 120) || null,
    }
  }

  async function fetchGoogleHistoryPage({
    accessToken,
    startHistoryId,
    pageToken,
    maxResults = 200,
  }) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history')

    url.searchParams.set('startHistoryId', String(startHistoryId ?? '').trim())
    url.searchParams.set('historyTypes', 'messageAdded')
    url.searchParams.set('maxResults', String(clampInteger(maxResults, 1, 500, 200)))

    if (pageToken) {
      url.searchParams.set('pageToken', String(pageToken).trim())
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw {
        status: response.status,
        message: `Could not fetch Gmail history: ${resolveGoogleErrorMessage(payload, `status ${response.status}`)}`,
      }
    }

    return payload
  }

  async function fetchGoogleMessageIdPage({
    accessToken,
    query,
    pageToken,
    maxResults = 100,
  }) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')

    if (query) {
      url.searchParams.set('q', String(query).trim())
    }

    url.searchParams.set('maxResults', String(clampInteger(maxResults, 1, 500, 100)))

    if (pageToken) {
      url.searchParams.set('pageToken', String(pageToken).trim())
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw {
        status: response.status,
        message: `Could not fetch Gmail message list: ${resolveGoogleErrorMessage(payload, `status ${response.status}`)}`,
      }
    }

    return payload
  }

  async function fetchGoogleMessageMetadata({
    accessToken,
    messageId,
  }) {
    const normalizedMessageId = normalizeText(messageId, 220)

    if (!normalizedMessageId) {
      return null
    }

    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(normalizedMessageId)}`)

    url.searchParams.set('format', 'full')
    ;['From', 'To', 'Cc', 'Bcc', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References'].forEach((headerName) => {
      url.searchParams.append('metadataHeaders', headerName)
    })

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw {
        status: response.status,
        message: `Could not fetch Gmail message metadata: ${resolveGoogleErrorMessage(payload, `status ${response.status}`)}`,
      }
    }

    return payload
  }

  function normalizeGoogleMessageForIntake({
    rawMessage,
    connectedEmail,
  }) {
    const externalMessageId = normalizeText(rawMessage?.id, 220)

    if (!externalMessageId) {
      return null
    }

    const headerMap = buildGoogleHeaderMap(rawMessage?.payload?.headers)
    const payloadContent = extractGooglePayloadContent(rawMessage?.payload)
    const fromEmail = parseEmailAddressList(headerMap.get('from'), normalizeEmail)[0] || null
    const toEmails = parseEmailAddressList(headerMap.get('to'), normalizeEmail)
    const ccEmails = parseEmailAddressList(headerMap.get('cc'), normalizeEmail)
    const bccEmails = parseEmailAddressList(headerMap.get('bcc'), normalizeEmail)
    const connected = normalizeEmailAddress(connectedEmail)
    const labelIds = Array.isArray(rawMessage?.labelIds)
      ? rawMessage.labelIds.map((value) => String(value ?? '').trim().toUpperCase())
      : []
    const isSent = labelIds.includes('SENT')
      || Boolean(fromEmail && connected && fromEmail === connected)
    const direction = normalizeDirection(isSent ? 'outbound' : 'inbound')
    const dateHeaderIso = toIsoDateSafe(headerMap.get('date'))
    const internalDateMs = Number(rawMessage?.internalDate)
    const internalDateIso = Number.isFinite(internalDateMs) && internalDateMs > 0
      ? new Date(internalDateMs).toISOString()
      : null

    return {
      externalMessageId,
      internetMessageId: normalizeText(headerMap.get('message-id'), 320).replace(/[<>]/g, '') || null,
      threadId: normalizeText(rawMessage?.threadId, 220) || null,
      conversationId: null,
      direction,
      fromEmail,
      toEmails,
      ccEmails,
      bccEmails,
      subject: normalizeText(headerMap.get('subject'), 500) || null,
      snippet: normalizeText(rawMessage?.snippet, 1600) || null,
      bodyText: normalizeText(payloadContent?.bodyText, 12000)
        || normalizeText(rawMessage?.snippet, 12000)
        || null,
      bodyHtml: normalizeHtmlForStorage(payloadContent?.bodyHtml, 50000),
      bodyPreview: normalizeText(payloadContent?.bodyText, 2600)
        || normalizeText(rawMessage?.snippet, 2600)
        || null,
      attachmentNames: Array.isArray(payloadContent?.attachmentNames)
        ? payloadContent.attachmentNames
        : [],
      messageDate: toIsoDateSafe(direction === 'outbound' ? dateHeaderIso || internalDateIso : internalDateIso || dateHeaderIso)
        || internalDateIso
        || dateHeaderIso
        || nowIso(),
      sentAt: direction === 'outbound' ? (dateHeaderIso || internalDateIso) : null,
      receivedAt: direction === 'inbound' ? (internalDateIso || dateHeaderIso) : null,
      providerUpdatedAt: internalDateIso || dateHeaderIso || null,
      webLink: null,
    }
  }

  async function fetchMicrosoftMessagesSince({
    accessToken,
    sinceIso,
    startIso,
    endIso,
    maxPages = 8,
    pageSize = 80,
  }) {
    const url = new URL(`${microsoftGraphApiBaseUrl}/me/messages`)
    const rangeStartIso = toIsoDateSafe(startIso)
    const rangeEndIso = toIsoDateSafe(endIso)
    const sinceCursorIso = toIsoDateSafe(sinceIso)

    url.searchParams.set('$select', 'id,internetMessageId,conversationId,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,lastModifiedDateTime,bodyPreview,body,hasAttachments,isDraft,webLink')
    url.searchParams.set('$orderby', 'lastModifiedDateTime desc')
    url.searchParams.set('$top', String(clampInteger(pageSize, 10, 200, 80)))

    if (rangeStartIso && rangeEndIso) {
      url.searchParams.set(
        '$filter',
        `((receivedDateTime ge ${rangeStartIso} and receivedDateTime lt ${rangeEndIso}) or (sentDateTime ge ${rangeStartIso} and sentDateTime lt ${rangeEndIso})) and isDraft eq false`,
      )
    } else {
      url.searchParams.set('$filter', `lastModifiedDateTime ge ${sinceCursorIso || new Date(Date.now() - 15 * 60 * 1000).toISOString()}`)
    }

    const messages = []
    let nextUrl = url.toString()
    let pageCount = 0

    while (nextUrl && pageCount < maxPages) {
      const response = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw {
          status: response.status,
          message: `Could not fetch Microsoft mailbox messages: ${resolveMicrosoftErrorMessage(payload, `status ${response.status}`)}`,
        }
      }

      messages.push(...(Array.isArray(payload?.value) ? payload.value : []))
      nextUrl = normalizeText(payload?.['@odata.nextLink'], 2000) || null
      pageCount += 1
    }

    return messages
  }

  function normalizeMicrosoftMessageForIntake({
    rawMessage,
    connectedEmail,
  }) {
    const externalMessageId = normalizeText(rawMessage?.id, 220)

    if (!externalMessageId || rawMessage?.isDraft) {
      return null
    }

    const fromEmail = normalizeEmailAddress(rawMessage?.from?.emailAddress?.address) || null
    const toEmails = normalizeGraphRecipientList(rawMessage?.toRecipients, normalizeEmail)
    const ccEmails = normalizeGraphRecipientList(rawMessage?.ccRecipients, normalizeEmail)
    const bccEmails = normalizeGraphRecipientList(rawMessage?.bccRecipients, normalizeEmail)
    const connected = normalizeEmailAddress(connectedEmail)
    const bodyContentType = String(rawMessage?.body?.contentType ?? '').trim().toLowerCase()
    const rawBodyContent = String(rawMessage?.body?.content ?? '').trim()
    const extractedBodyText = rawBodyContent
      ? (bodyContentType === 'html'
        ? stripHtmlMarkup(rawBodyContent)
        : rawBodyContent.replace(/\s+/g, ' ').trim())
      : ''
    const direction = normalizeDirection(
      fromEmail && connected && fromEmail === connected
        ? 'outbound'
        : 'inbound',
    )

    return {
      externalMessageId,
      internetMessageId: normalizeText(rawMessage?.internetMessageId, 320) || null,
      threadId: null,
      conversationId: normalizeText(rawMessage?.conversationId, 220) || null,
      direction,
      fromEmail,
      toEmails,
      ccEmails,
      bccEmails,
      subject: normalizeText(rawMessage?.subject, 500) || null,
      snippet: normalizeText(rawMessage?.bodyPreview, 1600) || null,
      bodyText: normalizeText(extractedBodyText, 12000)
        || normalizeText(rawMessage?.bodyPreview, 12000)
        || null,
      bodyHtml: bodyContentType === 'html'
        ? normalizeHtmlForStorage(rawBodyContent, 50000)
        : null,
      bodyPreview: normalizeText(rawMessage?.bodyPreview, 2600) || null,
      attachmentNames: [],
      messageDate: toIsoDateSafe(direction === 'outbound' ? rawMessage?.sentDateTime : rawMessage?.receivedDateTime)
        || toIsoDateSafe(rawMessage?.lastModifiedDateTime)
        || nowIso(),
      sentAt: toIsoDateSafe(rawMessage?.sentDateTime),
      receivedAt: toIsoDateSafe(rawMessage?.receivedDateTime),
      providerUpdatedAt: toIsoDateSafe(rawMessage?.lastModifiedDateTime),
      webLink: normalizeText(rawMessage?.webLink, 1800) || null,
    }
  }

  function extractReferenceTokens({
    subject,
    snippet,
    bodyPreview,
    bodyText,
    attachmentNames,
  }) {
    const sourceText = [
      String(subject ?? ''),
      String(snippet ?? ''),
      String(bodyPreview ?? ''),
      String(bodyText ?? ''),
      ...(Array.isArray(attachmentNames) ? attachmentNames.map((item) => String(item ?? '')) : []),
    ].join(' ')
    const quoteTokens = new Set()
    const orderTokens = new Set()
    const quotePattern = /\b(?:quote|q)\s*#?\s*([a-z0-9][a-z0-9_-]{2,})\b/ig
    const orderPattern = /\b(?:order|po|job|ack|acknowledg(?:e)?ment)\s*#?\s*([a-z0-9][a-z0-9_-]{2,})\b/ig
    let match = null

    function addToken(targetSet, rawToken) {
      const normalizedToken = String(rawToken ?? '').trim().toUpperCase().slice(0, 120)

      if (!normalizedToken) {
        return
      }

      targetSet.add(normalizedToken)

      const firstSegment = normalizedToken.split(/[-_]/).map((item) => item.trim()).find(Boolean)

      if (firstSegment && firstSegment !== normalizedToken) {
        targetSet.add(firstSegment.slice(0, 120))
      }

      const numericPrefixMatch = normalizedToken.match(/^(\d{4,})/)

      if (numericPrefixMatch?.[1]) {
        targetSet.add(numericPrefixMatch[1])
      }
    }

    while ((match = quotePattern.exec(sourceText)) !== null) {
      addToken(quoteTokens, match[1])
    }

    while ((match = orderPattern.exec(sourceText)) !== null) {
      addToken(orderTokens, match[1])
    }

    return {
      quoteTokens: [...quoteTokens].slice(0, 12),
      orderTokens: [...orderTokens].slice(0, 14),
    }
  }

  function resolveOrderChatId(orderDocument, fallbackId = '') {
    return String(
      orderDocument?.orderKey
      ?? orderDocument?.order_number
      ?? orderDocument?.monday_item_id
      ?? fallbackId,
    ).trim()
  }

  function buildOrderReferenceRegexPatterns(token) {
    const normalizedToken = String(token ?? '').trim()

    if (!normalizedToken) {
      return []
    }

    const flexibleTokenPattern = escapeRegexLiteral(normalizedToken)
      .replace(/[-_\s]+/g, '[-_\\s]*')
    const patterns = [`^${flexibleTokenPattern}$`]

    if (normalizedToken.length >= 4) {
      patterns.push(`(^|[^A-Z0-9])${flexibleTokenPattern}([^A-Z0-9]|$)`)
    }

    return patterns
  }

  function buildEmailIntakeSourceText(message) {
    return [
      String(message?.subject ?? ''),
      String(message?.snippet ?? ''),
      String(message?.bodyPreview ?? ''),
      String(message?.bodyText ?? ''),
      ...(Array.isArray(message?.attachmentNames)
        ? message.attachmentNames.map((item) => String(item ?? ''))
        : []),
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  }

  function analyzeEmailIntakeRoutingSignals(message) {
    const sourceText = buildEmailIntakeSourceText(message)
    const hasOrderConversation = /\border\b|\border\s+status\b|\back\b|\backnowledg(?:e)?ment\b|\binstallation\b|\breinstall(?:ation)?\b|\bcompletion\b|\bprogress\b|\bfollow[\s-]?up\b/.test(sourceText)
    const hasCustomerContext = /\bcustomer\b|\bclient\b|\border\s+status\b|\binstall(?:ation)?\b|\breinstall(?:ation)?\b|\bcompletion\b|\bstatus\s+update\b/.test(sourceText)
    const hasComplaintContext = /\bcomplain(?:t|ing)?\b|\bissue\b|\bproblem\b|\bdelay(?:ed|s)?\b|\blate\b|\bfrustrat(?:ed|ing)?\b|\burgent\b|\bescalat(?:e|ion)\b|\bnot\s+(?:complete|completed|installed|delivered|done)\b|\bbroken\b|\bdamag(?:e|ed)\b|\bdefect(?:ive)?\b/.test(sourceText)
    const hasLogisticsContext = /\bschedule(?:d)?\s+pickup\b|\bpickup\b|\bfreight\b|\bbox\s+truck\b|\bcarrier\b|\bdispatch\b|\blogistics\b|\btruck(?:ing)?\b|\brate\s+quote\b|\bbill\s+of\s+lading\b|\bbol\b/.test(sourceText)
    const hasQuoteWorkflowContext = /\bquote\s+request\b|\bplease\s+schedule\s+pickup\b/.test(sourceText)
    const hasPurchaseOrderSignal = /\bpurchase\s+order\b|\bpo\s*#|\bp\.?\s*o\.?\b/.test(sourceText)
    const hasVendorFinanceReleaseContext = /\bpending\s+order\b|\bpayment\s+(?:has\s+been\s+)?received\b|\border\s+has\s+been\s+released\b|\breleased\s+for\s+production\b|\bbalance\s+must\s+be\s+paid\b|\bbefore\s+shipping\b/.test(sourceText)
    const hasOrderStatusEscalationSignal = /\border\s+status\b|\bstatus\s+update\b|\breinstall(?:ation)?\b|\bcompletion\b|\bupdate\s+the\s+client\b/.test(sourceText)
    const skipAsOperationalNoise = (
      (hasLogisticsContext || hasQuoteWorkflowContext)
      && !hasCustomerContext
      && !hasComplaintContext
      && !hasOrderStatusEscalationSignal
    ) || (
      hasPurchaseOrderSignal
      && !hasCustomerContext
      && !hasComplaintContext
      && !/\back\b|\backnowledg(?:e)?ment\b|\border\s+status\b/.test(sourceText)
    ) || (
      hasVendorFinanceReleaseContext
      && !hasComplaintContext
      && !hasOrderStatusEscalationSignal
      && !/\back\b|\backnowledg(?:e)?ment\b/.test(sourceText)
    )

    return {
      hasOrderConversation,
      hasCustomerContext,
      hasComplaintContext,
      hasLogisticsContext,
      hasQuoteWorkflowContext,
      hasPurchaseOrderSignal,
      hasVendorFinanceReleaseContext,
      hasOrderStatusEscalationSignal,
      skipAsOperationalNoise,
      sourceText,
    }
  }

  function resolvePreferredEmailIntakeSummary({
    message,
    aiSuggestion,
  }) {
    const sourceText = buildEmailIntakeSourceText(message)
    const fallbackSummary = normalizeText(aiSuggestion?.summary, 1200)
      || normalizeText(message?.snippet, 1200)
      || normalizeText(message?.subject, 500)
      || 'Email summary unavailable.'

    if (/\back\b|\backnowledg(?:e)?ment\b/.test(sourceText)) {
      const { orderTokens } = extractReferenceTokens({
        subject: message?.subject,
        snippet: message?.snippet,
        bodyPreview: message?.bodyPreview,
        bodyText: message?.bodyText,
        attachmentNames: message?.attachmentNames,
      })
      const numericOrderToken = (Array.isArray(orderTokens) ? orderTokens : []).find((token) => /^\d{4,}$/.test(String(token ?? '')))
      const orderReference = normalizeText(numericOrderToken, 120)

      if (orderReference) {
        return `Acknowledgment sent for order ${orderReference}.`
      }

      return 'Acknowledgment sent.'
    }

    if (
      /\border\s+status\b/.test(sourceText)
      && /\btomorrow\b/.test(sourceText)
      && /\breinstall(?:ation)?\b/.test(sourceText)
    ) {
      return 'Order-status thread: update will be provided tomorrow and reinstall-date confirmation was requested for the client.'
    }

    return fallbackSummary
  }

  function normalizeRoutingTargetsInput(routeTargets, candidateDestinations = []) {
    const normalizedCandidates = (Array.isArray(candidateDestinations) ? candidateDestinations : [])
      .map((candidate) => {
        const type = normalizeEmailDestinationType(candidate?.type)
        const id = normalizeText(candidate?.id, 220)

        if (type === 'none' || !id) {
          return null
        }

        return {
          type,
          id,
          label: normalizeText(candidate?.label, 280) || id,
          reason: normalizeText(candidate?.reason, 360) || null,
          confidence: Number.isFinite(Number(candidate?.confidence))
            ? Number(Math.max(0, Math.min(1, Number(candidate.confidence))).toFixed(2))
            : null,
        }
      })
      .filter(Boolean)
    const candidateByKey = new Map(
      normalizedCandidates.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate]),
    )
    const normalizedTargets = []
    const seenKeys = new Set()

    ;(Array.isArray(routeTargets) ? routeTargets : []).forEach((target) => {
      const type = normalizeEmailDestinationType(target?.type ?? target?.destinationType)
      const id = normalizeText(target?.id ?? target?.destinationId, 220)

      if (type === 'none' || !id) {
        return
      }

      const key = `${type}:${id}`

      if (seenKeys.has(key)) {
        return
      }

      seenKeys.add(key)
      const matchedCandidate = candidateByKey.get(key)

      normalizedTargets.push({
        type,
        id,
        label: matchedCandidate?.label || normalizeText(target?.label, 280) || id,
        reason: matchedCandidate?.reason || normalizeText(target?.reason, 360) || null,
        confidence: matchedCandidate?.confidence ?? (
          Number.isFinite(Number(target?.confidence))
            ? Number(Math.max(0, Math.min(1, Number(target.confidence))).toFixed(2))
            : null
        ),
      })
    })

    return normalizedTargets.slice(0, 4)
  }

  function resolveSuggestionRoutingPlan({
    message,
    candidateDestinations,
    aiSuggestion,
  }) {
    const routingSignals = analyzeEmailIntakeRoutingSignals(message)
    const normalizedCandidates = normalizeRoutingTargetsInput(
      candidateDestinations,
      candidateDestinations,
    )

    if (routingSignals.skipAsOperationalNoise) {
      return {
        skipSuggestion: true,
        skipReason: 'Filtered logistics/quote/purchase-order workflow email.',
        routeTargets: [],
        primaryTarget: null,
        destinationReason: null,
        routingSignals,
      }
    }

    const orderCandidates = normalizedCandidates.filter((candidate) => candidate.type === 'order')
    const accountCandidates = normalizedCandidates.filter((candidate) => candidate.type === 'account')
    const quoteCandidates = normalizedCandidates.filter((candidate) => candidate.type === 'quote')
    const missingOrderMatchForOrderContext = routingSignals.hasOrderConversation
      && orderCandidates.length === 0
    const requestedType = normalizeEmailDestinationType(aiSuggestion?.destinationType)
    const requestedId = normalizeText(aiSuggestion?.destinationId, 220)
    const requestedCandidate = normalizedCandidates.find((candidate) => (
      candidate.type === requestedType
      && candidate.id === requestedId
    )) || null
    let primaryTarget = requestedCandidate

    if (routingSignals.hasOrderConversation && orderCandidates.length > 0) {
      primaryTarget = orderCandidates[0]
    }

    if (!primaryTarget) {
      primaryTarget = orderCandidates[0] || accountCandidates[0] || quoteCandidates[0] || null
    }

    const routeTargets = []

    if (primaryTarget) {
      routeTargets.push(primaryTarget)
    }

    if (
      primaryTarget?.type === 'order'
      && routingSignals.hasComplaintContext
      && accountCandidates.length > 0
    ) {
      routeTargets.push(accountCandidates[0])
    }

    const normalizedRouteTargets = normalizeRoutingTargetsInput(
      routeTargets,
      normalizedCandidates,
    )
    const finalPrimaryTarget = normalizedRouteTargets[0] || null
    let destinationReason = normalizeText(aiSuggestion?.destinationReason, 600)

    if (normalizedRouteTargets.length > 1) {
      destinationReason = 'Order-related complaint/update routed to both order and account.'
    } else if (missingOrderMatchForOrderContext && accountCandidates.length > 0) {
      destinationReason = 'Order-related thread detected, but no exact order match was found in data; routed to account for visibility.'
    }

    if (!destinationReason) {
      if (finalPrimaryTarget?.type === 'order' && routingSignals.hasOrderConversation) {
        destinationReason = 'Order-related thread routed to order.'
      } else {
        destinationReason = finalPrimaryTarget?.reason || 'Matched email context to destination.'
      }
    }

    return {
      skipSuggestion: false,
      skipReason: null,
      routeTargets: normalizedRouteTargets,
      primaryTarget: finalPrimaryTarget,
      destinationReason,
      routingSignals,
    }
  }

  function resolveEmailIntakeReviewLane({
    destinationType,
    destinationId = null,
    confidence,
    usedFallback = false,
    policySkipped = false,
  }) {
    if (policySkipped) {
      return emailReviewLaneRed
    }

    const normalizedDestinationType = normalizeEmailDestinationType(destinationType)
    const normalizedDestinationId = normalizeText(destinationId, 220)

    if (normalizedDestinationType === 'none' || !normalizedDestinationId) {
      return emailReviewLaneRed
    }

    const normalizedConfidence = Number(confidence)
    const hasConfidence = Number.isFinite(normalizedConfidence)

    if (
      hasConfidence
      && normalizedConfidence >= emailReviewSureMatchConfidenceThreshold
      && !usedFallback
    ) {
      return emailReviewLaneGreen
    }

    return emailReviewLaneYellow
  }

  async function resolveEmailDestinationCandidates({
    crmAccountsCollection,
    crmContactsCollection,
    crmOrdersCollection,
    crmQuotesCollection,
    ordersUnifiedCollection,
    message,
  }) {
    const direction = normalizeDirection(message?.direction)
    const connectedEmail = normalizeEmailAddress(message?.connectedEmail)
    const senderEmail = normalizeEmailAddress(message?.fromEmail)
    const recipientEmails = [...new Set([
      ...(Array.isArray(message?.toEmails) ? message.toEmails : []),
      ...(Array.isArray(message?.ccEmails) ? message.ccEmails : []),
    ].map((value) => normalizeEmailAddress(value)).filter(Boolean))]
    const participantEmails = [...new Set([
      senderEmail,
      ...recipientEmails,
    ].filter(Boolean))]
    const counterpartyEmails = participantEmails
      .filter((value) => !connectedEmail || value !== connectedEmail)
      .slice(0, 24)
    let accountLookupEmails = direction === 'inbound'
      ? [senderEmail]
      : recipientEmails

    accountLookupEmails = accountLookupEmails
      .filter(Boolean)
      .filter((value) => !connectedEmail || value !== connectedEmail)

    if (accountLookupEmails.length === 0) {
      accountLookupEmails = counterpartyEmails
    }

    const messageSignals = analyzeEmailIntakeRoutingSignals(message)

    const { quoteTokens, orderTokens } = extractReferenceTokens({
      subject: message?.subject,
      snippet: message?.snippet,
      bodyPreview: message?.bodyPreview,
      bodyText: message?.bodyText,
      attachmentNames: message?.attachmentNames,
    })
    const candidatesByKey = new Map()
    let matchedAccountSourceIds = []

    function pushCandidate(candidate) {
      const type = normalizeEmailDestinationType(candidate?.type)
      const id = normalizeText(candidate?.id, 220)

      if (!id || type === 'none') {
        return
      }

      const key = `${type}:${id}`
      const confidence = Number.isFinite(Number(candidate?.confidence))
        ? Number(Math.max(0, Math.min(1, Number(candidate.confidence))).toFixed(2))
        : 0.5
      const existing = candidatesByKey.get(key)

      if (existing && Number(existing.confidence ?? 0) >= confidence) {
        return
      }

      candidatesByKey.set(key, {
        type,
        id,
        label: normalizeText(candidate?.label, 280) || id,
        reason: normalizeText(candidate?.reason, 360) || null,
        confidence,
      })
    }

    if (accountLookupEmails.length > 0) {
      const contactRows = await crmContactsCollection
        .find(
          {
            primaryEmailLower: {
              $in: accountLookupEmails,
            },
            recordStatus: {
              $ne: 'deleted',
            },
          },
          {
            projection: {
              _id: 0,
              accountSourceId: 1,
            },
          },
        )
        .limit(40)
        .toArray()

      const accountIds = [...new Set(
        contactRows
          .map((contact) => normalizeText(contact?.accountSourceId, 160))
          .filter(Boolean),
      )]
      const directAccounts = await crmAccountsCollection
        .find(
          {
            emailLower: {
              $in: accountLookupEmails,
            },
            recordStatus: {
              $ne: 'deleted',
            },
          },
          {
            projection: {
              _id: 0,
              sourceId: 1,
              name: 1,
            },
          },
        )
        .limit(40)
        .toArray()

      const lookupAccountIds = [...new Set([
        ...accountIds,
        ...directAccounts
          .map((account) => normalizeText(account?.sourceId, 160))
          .filter(Boolean),
      ])].slice(0, 60)

      matchedAccountSourceIds = lookupAccountIds

      if (lookupAccountIds.length > 0) {
        const accountRows = await crmAccountsCollection
          .find(
            {
              sourceId: {
                $in: lookupAccountIds,
              },
              recordStatus: {
                $ne: 'deleted',
              },
            },
            {
              projection: {
                _id: 0,
                sourceId: 1,
                name: 1,
              },
            },
          )
          .limit(60)
          .toArray()

        accountRows.forEach((account) => {
          const sourceId = normalizeText(account?.sourceId, 160)

          if (!sourceId) {
            return
          }

          pushCandidate({
            type: 'account',
            id: sourceId,
            label: normalizeText(account?.name, 240) || sourceId,
            reason: direction === 'inbound'
              ? 'Matched sender email to contact/account.'
              : 'Matched recipient email to contact/account.',
            confidence: 0.86,
          })
        })
      }
    }

    if (quoteTokens.length > 0) {
      const quoteLookupClauses = buildQuoteLookupClauses(quoteTokens)

      if (quoteLookupClauses.length > 0) {
        const quoteRows = await crmQuotesCollection
          .find(
            {
              $or: quoteLookupClauses,
            },
            {
              projection: {
                _id: 0,
                id: 1,
                quoteNumber: 1,
                title: 1,
              },
            },
          )
          .limit(40)
          .toArray()

        quoteRows.forEach((quote) => {
          const quoteId = normalizeText(quote?.id, 160)

          if (!quoteId) {
            return
          }

          pushCandidate({
            type: 'quote',
            id: quoteId,
            label: normalizeText(quote?.quoteNumber, 120)
              || normalizeText(quote?.title, 240)
              || quoteId,
            reason: 'Matched quote reference in subject/body.',
            confidence: 0.95,
          })
        })
      }
    }

    if (orderTokens.length > 0) {
      const crmOrderClauses = orderTokens.flatMap((token) => {
        return buildOrderReferenceRegexPatterns(token)
          .map((pattern) => ({
            orderNumber: {
              $regex: pattern,
              $options: 'i',
            },
          }))
      })
      const crmOrderRows = await crmOrdersCollection
        .find(
          {
            $or: crmOrderClauses,
          },
          {
            projection: {
              _id: 0,
              id: 1,
              orderNumber: 1,
            },
          },
        )
        .limit(40)
        .toArray()

      crmOrderRows.forEach((order) => {
        const orderId = normalizeText(order?.id, 200)

        if (!orderId) {
          return
        }

        pushCandidate({
          type: 'order',
          id: orderId,
          label: normalizeText(order?.orderNumber, 160) || orderId,
          reason: 'Matched CRM order reference in subject/body.',
          confidence: 0.9,
        })
      })

      const unifiedOrderClauses = orderTokens.flatMap((token) => {
        return buildOrderReferenceRegexPatterns(token)
          .flatMap((pattern, patternIndex) => ([
            {
              order_number: {
                $regex: pattern,
                $options: 'i',
              },
            },
            {
              orderKey: {
                $regex: pattern,
                $options: 'i',
              },
            },
            {
              monday_item_id: {
                $regex: pattern,
                $options: 'i',
              },
            },
            ...(patternIndex > 0
              ? [
                {
                  order_name: {
                    $regex: pattern,
                    $options: 'i',
                  },
                },
                {
                  monday_name: {
                    $regex: pattern,
                    $options: 'i',
                  },
                },
              ]
              : []),
          ]))
      })
      const unifiedOrderRows = await ordersUnifiedCollection
        .find(
          {
            $or: unifiedOrderClauses,
          },
          {
            projection: {
              _id: 0,
              orderKey: 1,
              order_number: 1,
              order_name: 1,
              monday_name: 1,
              monday_item_id: 1,
            },
          },
        )
        .limit(40)
        .toArray()

      unifiedOrderRows.forEach((orderDocument) => {
        const orderId = resolveOrderChatId(orderDocument)

        if (!orderId) {
          return
        }

        pushCandidate({
          type: 'order',
          id: orderId,
          label: normalizeText(orderDocument?.order_number, 160)
            || normalizeText(orderDocument?.order_name, 240)
            || orderId,
          reason: 'Matched unified order reference in subject/body.',
          confidence: 0.96,
        })
      })
    }

    const hasResolvedOrderCandidate = [...candidatesByKey.values()].some((candidate) => (
      candidate.type === 'order'
    ))

    if (
      !hasResolvedOrderCandidate
      && messageSignals.hasOrderConversation
      && matchedAccountSourceIds.length > 0
    ) {
      const accountLinkedOrderRows = await crmOrdersCollection
        .find(
          {
            dealerSourceId: {
              $in: matchedAccountSourceIds.slice(0, 20),
            },
            status: {
              $nin: ['delivered', 'cancelled'],
            },
          },
          {
            projection: {
              _id: 0,
              id: 1,
              orderNumber: 1,
              title: 1,
              status: 1,
              updatedAt: 1,
              lastStatusChangedAt: 1,
            },
          },
        )
        .sort({
          updatedAt: -1,
          lastStatusChangedAt: -1,
          createdAt: -1,
        })
        .limit(12)
        .toArray()

      if (accountLinkedOrderRows.length > 0) {
        accountLinkedOrderRows.slice(0, 5).forEach((orderRow) => {
          const orderId = normalizeText(orderRow?.id, 200)

          if (!orderId) {
            return
          }

          pushCandidate({
            type: 'order',
            id: orderId,
            label: normalizeText(orderRow?.orderNumber, 160)
              || normalizeText(orderRow?.title, 220)
              || orderId,
            reason: 'Matched account to active CRM order for order-related thread.',
            confidence: 0.58,
          })
        })
      }
    }

    return [...candidatesByKey.values()]
      .sort((left, right) => Number(right.confidence ?? 0) - Number(left.confidence ?? 0))
      .slice(0, 20)
  }

  async function upsertEmailIntakeMessage({
    emailIntakeMessagesCollection,
    message,
  }) {
    const conversationIdentity = resolveEmailConversationIdentity(message)
    const provider = conversationIdentity.provider
    const uid = normalizeText(message?.uid, 200)
    const externalMessageId = normalizeText(message?.externalMessageId, 220)

    if (!provider || !uid || !externalMessageId) {
      return {
        isNew: false,
        message: null,
      }
    }

    const now = nowIso()
    const filter = {
      provider,
      uid,
      externalMessageId,
    }
    const baseDocument = {
      provider,
      uid,
      connectionId: normalizeText(message?.connectionId, 220) || null,
      connectedEmail: normalizeEmailAddress(message?.connectedEmail) || null,
      externalMessageId,
      internetMessageId: normalizeText(message?.internetMessageId, 320) || null,
      threadId: conversationIdentity.threadId,
      conversationId: conversationIdentity.conversationId,
      conversationKey: conversationIdentity.conversationKey,
      conversationReference: conversationIdentity.conversationReference,
      direction: normalizeDirection(message?.direction),
      fromEmail: normalizeEmailAddress(message?.fromEmail) || null,
      toEmails: [...new Set((Array.isArray(message?.toEmails) ? message.toEmails : []).map((value) => normalizeEmailAddress(value)).filter(Boolean))].slice(0, 50),
      ccEmails: [...new Set((Array.isArray(message?.ccEmails) ? message.ccEmails : []).map((value) => normalizeEmailAddress(value)).filter(Boolean))].slice(0, 50),
      bccEmails: [...new Set((Array.isArray(message?.bccEmails) ? message.bccEmails : []).map((value) => normalizeEmailAddress(value)).filter(Boolean))].slice(0, 50),
      subject: normalizeText(message?.subject, 500) || null,
      snippet: normalizeText(message?.snippet, 1600) || null,
      bodyText: normalizeText(message?.bodyText, 12000) || null,
      bodyHtml: normalizeHtmlForStorage(message?.bodyHtml, 50000),
      bodyPreview: normalizeText(message?.bodyPreview, 2600) || null,
      attachmentNames: [...new Set((Array.isArray(message?.attachmentNames) ? message.attachmentNames : [])
        .map((value) => normalizeText(value, 240))
        .filter(Boolean))].slice(0, 20),
      messageDate: toIsoDateSafe(message?.messageDate) || now,
      sentAt: toIsoDateSafe(message?.sentAt),
      receivedAt: toIsoDateSafe(message?.receivedAt),
      providerUpdatedAt: toIsoDateSafe(message?.providerUpdatedAt),
      webLink: normalizeText(message?.webLink, 1800) || null,
      updatedAt: now,
    }

    const existing = await emailIntakeMessagesCollection.findOne(
      filter,
      {
        projection: {
          _id: 0,
          id: 1,
          suggestionId: 1,
        },
      },
    )

    if (existing?.id) {
      await emailIntakeMessagesCollection.updateOne(
        { id: existing.id },
        {
          $set: baseDocument,
        },
      )

      return {
        isNew: false,
        message: {
          id: existing.id,
          suggestionId: normalizeText(existing?.suggestionId, 220) || null,
          ...baseDocument,
        },
      }
    }

    const createdMessage = {
      id: randomUUID(),
      ...baseDocument,
      suggestionId: null,
      createdAt: now,
    }

    try {
      await emailIntakeMessagesCollection.insertOne(createdMessage)

      return {
        isNew: true,
        message: createdMessage,
      }
    } catch (error) {
      if (Number(error?.code) !== 11000) {
        throw error
      }

      const duplicate = await emailIntakeMessagesCollection.findOne(
        filter,
        {
          projection: {
            _id: 0,
            id: 1,
            suggestionId: 1,
          },
        },
      )

      if (!duplicate?.id) {
        throw error
      }

      await emailIntakeMessagesCollection.updateOne(
        { id: duplicate.id },
        {
          $set: baseDocument,
        },
      )

      return {
        isNew: false,
        message: {
          id: duplicate.id,
          suggestionId: normalizeText(duplicate?.suggestionId, 220) || null,
          ...baseDocument,
        },
      }
    }
  }

  async function buildConversationBodySnapshot({
    emailIntakeMessagesCollection,
    message,
  }) {
    const provider = normalizeSyncProvider(message?.provider)
    const uid = normalizeText(message?.uid, 200)
    const conversationKey = normalizeText(message?.conversationKey, 320)
    const fallbackMessageDate = toIsoDateSafe(message?.messageDate) || nowIso()

    if (!provider || !uid || !conversationKey) {
      return {
        conversationMessageCount: 1,
        latestMessageDate: fallbackMessageDate,
        conversationBodyText: null,
      }
    }

    const conversationMessages = await emailIntakeMessagesCollection
      .find(
        {
          provider,
          uid,
          conversationKey,
        },
        {
          projection: {
            _id: 0,
            fromEmail: 1,
            toEmails: 1,
            ccEmails: 1,
            subject: 1,
            messageDate: 1,
            bodyText: 1,
            bodyPreview: 1,
            snippet: 1,
            createdAt: 1,
            id: 1,
          },
        },
      )
      .sort({ messageDate: 1, createdAt: 1, id: 1 })
      .limit(50)
      .toArray()

    if (!conversationMessages.length) {
      return {
        conversationMessageCount: 1,
        latestMessageDate: fallbackMessageDate,
        conversationBodyText: null,
      }
    }

    let latestMessageDate = fallbackMessageDate
    let latestMessageDateMs = Date.parse(fallbackMessageDate)

    const blocks = conversationMessages.map((entry, index) => {
      const entryMessageDate = toIsoDateSafe(entry?.messageDate)

      if (entryMessageDate) {
        const entryMessageDateMs = Date.parse(entryMessageDate)

        if (Number.isFinite(entryMessageDateMs) && entryMessageDateMs > latestMessageDateMs) {
          latestMessageDateMs = entryMessageDateMs
          latestMessageDate = entryMessageDate
        }
      }

      const fromLine = normalizeEmailAddress(entry?.fromEmail) || 'unknown sender'
      const toLine = (Array.isArray(entry?.toEmails) ? entry.toEmails : [])
        .map((value) => normalizeEmailAddress(value))
        .filter(Boolean)
        .slice(0, 20)
        .join(', ')
      const ccLine = (Array.isArray(entry?.ccEmails) ? entry.ccEmails : [])
        .map((value) => normalizeEmailAddress(value))
        .filter(Boolean)
        .slice(0, 20)
        .join(', ')
      const body = normalizeText(entry?.bodyText, 6000)
        || normalizeText(entry?.bodyPreview, 6000)
        || normalizeText(entry?.snippet, 6000)
        || '(no email body text)'

      return [
        `Message ${index + 1} of ${conversationMessages.length}`,
        `Date: ${entryMessageDate || 'unknown'}`,
        `From: ${fromLine}`,
        `To: ${toLine || '-'}`,
        ccLine ? `CC: ${ccLine}` : null,
        `Subject: ${normalizeText(entry?.subject, 500) || '(no subject)'}`,
        '',
        body,
      ].filter(Boolean).join('\n')
    })

    return {
      conversationMessageCount: conversationMessages.length,
      latestMessageDate,
      conversationBodyText: normalizeText(blocks.join('\n\n---\n\n'), 45000) || null,
    }
  }

  async function createEmailIntakeSuggestion({
    aiRulesCollection,
    crmAccountsCollection,
    crmContactsCollection,
    crmOrdersCollection,
    crmQuotesCollection,
    emailIntakeMessagesCollection,
    emailIntakeSuggestionsCollection,
    ordersUnifiedCollection,
    message,
    forceDefaultRed = false,
    onTrace = null,
  }) {
    const conversationIdentity = resolveEmailConversationIdentity(message)
    const suggestionProvider = conversationIdentity.provider
    const suggestionUid = normalizeText(message?.uid, 200)
    const suggestionMessageId = normalizeText(message?.id, 220) || null
    const suggestionConversationKey = conversationIdentity.conversationKey
    const suggestionSubject = normalizeText(message?.subject, 220) || '(no subject)'
    const existingSuggestionFilter = suggestionConversationKey && suggestionProvider && suggestionUid
      ? {
        provider: suggestionProvider,
        uid: suggestionUid,
        conversationKey: suggestionConversationKey,
      }
      : {
        messageId: suggestionMessageId,
      }

    let existingSuggestion = await emailIntakeSuggestionsCollection.findOne(
      existingSuggestionFilter,
      {
        projection: {
          _id: 0,
          id: 1,
        },
      },
    )

    if (!existingSuggestion?.id && suggestionProvider && suggestionUid) {
      const legacyConversationFilter = conversationIdentity.threadId && suggestionProvider === googleProviderId
        ? {
          provider: suggestionProvider,
          uid: suggestionUid,
          threadId: conversationIdentity.threadId,
        }
        : conversationIdentity.conversationId && suggestionProvider === microsoftProviderId
          ? {
            provider: suggestionProvider,
            uid: suggestionUid,
            conversationId: conversationIdentity.conversationId,
          }
          : null

      if (legacyConversationFilter) {
        const linkedConversationMessage = await emailIntakeMessagesCollection.findOne(
          {
            ...legacyConversationFilter,
            suggestionId: {
              $nin: [null, ''],
            },
          },
          {
            projection: {
              _id: 0,
              suggestionId: 1,
            },
            sort: {
              messageDate: -1,
              createdAt: -1,
            },
          },
        )
        const linkedSuggestionId = normalizeText(linkedConversationMessage?.suggestionId, 220)

        if (linkedSuggestionId) {
          existingSuggestion = await emailIntakeSuggestionsCollection.findOne(
            {
              id: linkedSuggestionId,
            },
            {
              projection: {
                _id: 0,
                id: 1,
              },
            },
          )
        }
      }
    }

    if (existingSuggestion?.id) {
      const now = nowIso()
      const conversationSnapshot = await buildConversationBodySnapshot({
        emailIntakeMessagesCollection,
        message,
      })

      await Promise.all([
        emailIntakeMessagesCollection.updateOne(
          {
            id: message.id,
          },
          {
            $set: {
              suggestionId: existingSuggestion.id,
              updatedAt: now,
            },
          },
        ),
        emailIntakeSuggestionsCollection.updateOne(
          {
            id: existingSuggestion.id,
          },
          {
            $set: {
              messageId: message.id,
              provider: suggestionProvider,
              uid: suggestionUid,
              connectionId: normalizeText(message?.connectionId, 220) || null,
              connectedEmail: normalizeEmailAddress(message?.connectedEmail) || null,
              direction: normalizeDirection(message?.direction),
              messageDate: conversationSnapshot.latestMessageDate || toIsoDateSafe(message?.messageDate) || now,
              fromEmail: normalizeEmailAddress(message?.fromEmail) || null,
              toEmails: Array.isArray(message?.toEmails) ? message.toEmails.slice(0, 40) : [],
              ccEmails: Array.isArray(message?.ccEmails) ? message.ccEmails.slice(0, 40) : [],
              subject: normalizeText(message?.subject, 500) || null,
              snippet: normalizeText(message?.snippet, 1600) || null,
              bodyText: normalizeText(message?.bodyText, 12000) || null,
              bodyHtml: normalizeHtmlForStorage(message?.bodyHtml, 50000),
              bodyPreview: normalizeText(message?.bodyPreview, 2600) || null,
              threadId: conversationIdentity.threadId,
              conversationId: conversationIdentity.conversationId,
              conversationKey: suggestionConversationKey,
              conversationReference: conversationIdentity.conversationReference,
              conversationMessageCount: Number(conversationSnapshot.conversationMessageCount ?? 1),
              conversationBodyText: conversationSnapshot.conversationBodyText || null,
              updatedAt: now,
            },
          },
        ),
      ])

      emitEmailSyncTrace(onTrace, 'info', 'Conversation already has a suggestion. Linked message to existing review item.', {
        messageId: suggestionMessageId,
        suggestionId: existingSuggestion.id,
        subject: suggestionSubject,
        conversationKey: suggestionConversationKey,
      })

      return {
        created: false,
        suggestionId: existingSuggestion.id,
        deduplicatedConversation: Boolean(suggestionConversationKey),
      }
    }

    const learningNotes = await aiRulesCollection.findOne(
      {
        category: 'email_intake',
      },
      {
        projection: {
          _id: 0,
          content: 1,
        },
      },
    )
    const candidateDestinations = await resolveEmailDestinationCandidates({
      crmAccountsCollection,
      crmContactsCollection,
      crmOrdersCollection,
      crmQuotesCollection,
      ordersUnifiedCollection,
      message,
    })

    emitEmailSyncTrace(onTrace, 'info', `Destination matching found ${candidateDestinations.length} candidate(s).`, {
      messageId: suggestionMessageId,
      subject: suggestionSubject,
      candidateCount: candidateDestinations.length,
    })

    if (candidateDestinations.length === 0) {
      emitEmailSyncTrace(onTrace, 'warn', 'No account/order/quote destination candidate matched this email.', {
        messageId: suggestionMessageId,
        subject: suggestionSubject,
      })
    }

    let aiSuggestion = null

    if (!forceDefaultRed && typeof classifyEmailIntakeSuggestion === 'function') {
      emitEmailSyncTrace(onTrace, 'info', 'AI classification started for email.', {
        messageId: suggestionMessageId,
        subject: suggestionSubject,
        candidateCount: candidateDestinations.length,
      })

      try {
        aiSuggestion = await withOperationTimeout(
          classifyEmailIntakeSuggestion({
            email: {
              direction: message?.direction,
              connectedEmail: message?.connectedEmail,
              fromEmail: message?.fromEmail,
              toEmails: message?.toEmails,
              ccEmails: message?.ccEmails,
              subject: message?.subject,
              snippet: message?.snippet,
              bodyText: message?.bodyText,
              bodyPreview: message?.bodyPreview,
              bodyHtml: message?.bodyHtml,
              attachmentNames: message?.attachmentNames,
              messageDate: message?.messageDate,
            },
            candidateDestinations,
            rulesText: normalizeText(learningNotes?.content, 12000) || '',
          }),
          emailIntakeAiClassificationTimeoutMs,
          'Email AI classification',
        )

        emitEmailSyncTrace(onTrace, 'info', 'AI classification completed.', {
          messageId: suggestionMessageId,
          subject: suggestionSubject,
          usedFallback: Boolean(aiSuggestion?.usedFallback),
        })
      } catch (error) {
        aiSuggestion = null

        const timedOut = normalizeText(error?.code, 80) === 'email_intake_sync_timeout'

        emitEmailSyncTrace(
          onTrace,
          timedOut
            ? 'warn'
            : 'error',
          timedOut
            ? 'AI classification timed out. Using deterministic fallback routing.'
            : 'AI classification failed. Using deterministic fallback routing.',
          {
            messageId: suggestionMessageId,
            subject: suggestionSubject,
            error: normalizeText(error?.message, 600) || null,
          },
        )
      }
    }

    const routingPlan = forceDefaultRed
      ? {
        skipSuggestion: false,
        skipReason: null,
        routeTargets: [],
        primaryTarget: null,
        destinationReason: null,
      }
      : resolveSuggestionRoutingPlan({
        message,
        candidateDestinations,
        aiSuggestion,
      })
    const policySkipped = Boolean(routingPlan.skipSuggestion)

    if (policySkipped) {
      emitEmailSyncTrace(onTrace, 'warn', routingPlan.skipReason || 'Routing policy marked this email as red triage.', {
        messageId: suggestionMessageId,
        subject: suggestionSubject,
        skipByPolicy: true,
      })
    }

    const routeTargets = policySkipped
      ? []
      : routingPlan.routeTargets
    const primaryTarget = policySkipped
      ? null
      : routingPlan.primaryTarget
    const preferredSummary = resolvePreferredEmailIntakeSummary({
      message,
      aiSuggestion,
    })
    const preferredChatDraft = normalizeText(preferredSummary, 1200)
      || normalizeText(aiSuggestion?.chatDraft, 4000)
      || null

    const destinationType = normalizeEmailDestinationType(primaryTarget?.type)
    const destinationId = normalizeText(primaryTarget?.id, 220) || null
    const confidence = Number.isFinite(Number(aiSuggestion?.confidence))
      ? Number(Math.max(0, Math.min(1, Number(aiSuggestion.confidence))).toFixed(2))
      : Number.isFinite(Number(primaryTarget?.confidence))
        ? Number(Math.max(0, Math.min(1, Number(primaryTarget.confidence))).toFixed(2))
        : destinationType === 'none'
          ? 0.25
          : 0.5
    const lane = resolveEmailIntakeReviewLane({
      destinationType,
      destinationId,
      confidence,
      usedFallback: Boolean(aiSuggestion?.usedFallback),
      policySkipped,
    })
    let destinationReason = normalizeText(routingPlan.destinationReason, 600)
      || normalizeText(aiSuggestion?.destinationReason, 600)
      || (policySkipped
        ? normalizeText(routingPlan.skipReason, 600)
        : null)

    if (destinationType === 'none') {
      destinationReason = null
    }

    const now = nowIso()
    const suggestion = {
      id: randomUUID(),
      messageId: message.id,
      provider: suggestionProvider,
      uid: suggestionUid,
      connectionId: normalizeText(message?.connectionId, 220) || null,
      connectedEmail: normalizeEmailAddress(message?.connectedEmail) || null,
      status: emailReviewStatusPending,
      isRead: false,
      direction: normalizeDirection(message?.direction),
      messageDate: toIsoDateSafe(message?.messageDate) || now,
      fromEmail: normalizeEmailAddress(message?.fromEmail) || null,
      toEmails: Array.isArray(message?.toEmails) ? message.toEmails.slice(0, 40) : [],
      ccEmails: Array.isArray(message?.ccEmails) ? message.ccEmails.slice(0, 40) : [],
      subject: normalizeText(message?.subject, 500) || null,
      snippet: normalizeText(message?.snippet, 1600) || null,
      bodyText: normalizeText(message?.bodyText, 12000) || null,
      bodyHtml: normalizeHtmlForStorage(message?.bodyHtml, 50000),
      bodyPreview: normalizeText(message?.bodyPreview, 2600) || null,
      threadId: conversationIdentity.threadId,
      conversationId: conversationIdentity.conversationId,
      conversationKey: suggestionConversationKey,
      conversationReference: conversationIdentity.conversationReference,
      conversationMessageCount: 1,
      conversationBodyText: null,
      candidateDestinations,
      routingTargets: routeTargets,
      destinationType,
      destinationId,
      destinationReason,
      confidence,
      lane,
      summary: normalizeText(preferredSummary, 1200) || null,
      chatDraft: preferredChatDraft,
      tags: (Array.isArray(aiSuggestion?.tags) ? aiSuggestion.tags : [])
        .map((tag) => normalizeText(tag, 100).toLowerCase())
        .filter(Boolean)
        .concat(routeTargets.length > 1 ? ['multi-route'] : [])
        .concat(policySkipped ? ['policy-skip'] : [])
        .slice(0, 10),
      usedFallback: Boolean(aiSuggestion?.usedFallback),
      reviewNotes: null,
      approvalResult: null,
      reviewedAt: null,
      reviewedByUid: null,
      reviewedByEmail: null,
      reviewedByName: null,
      rejectedReason: null,
      correctionCount: 0,
      history: [],
      createdAt: now,
      updatedAt: now,
    }

    await emailIntakeSuggestionsCollection.insertOne(suggestion)
    await emailIntakeMessagesCollection.updateOne(
      {
        id: message.id,
      },
      {
        $set: {
          suggestionId: suggestion.id,
          updatedAt: now,
        },
      },
    )

    const conversationSnapshot = await buildConversationBodySnapshot({
      emailIntakeMessagesCollection,
      message,
    })

    await emailIntakeSuggestionsCollection.updateOne(
      {
        id: suggestion.id,
      },
      {
        $set: {
          messageDate: conversationSnapshot.latestMessageDate || suggestion.messageDate,
          conversationMessageCount: Number(conversationSnapshot.conversationMessageCount ?? 1),
          conversationBodyText: conversationSnapshot.conversationBodyText || null,
          updatedAt: nowIso(),
        },
      },
    )

    emitEmailSyncTrace(onTrace, 'info', 'Suggestion created and queued for review.', {
      messageId: suggestionMessageId,
      suggestionId: suggestion.id,
      subject: suggestionSubject,
      destinationType: suggestion.destinationType,
      destinationId: suggestion.destinationId,
      routingTargetCount: routeTargets.length,
    })

    return {
      created: true,
      suggestionId: suggestion.id,
      destinationType: suggestion.destinationType,
      destinationId: suggestion.destinationId,
      lane: suggestion.lane,
      skippedByPolicy: policySkipped,
      routingTargetCount: routeTargets.length,
    }
  }

  async function runGoogleSyncForConnection({
    collections,
    connection,
    historicalLookbackDays = 0,
    syncDate = null,
    syncTimeZone = emailIntakeDefaultSyncTimeZone,
    bootstrapLookbackDays = null,
    maxMessagesPerConnection = 120,
    processingDeadlineMs = 0,
    onTrace = null,
  }) {
    const {
      aiRulesCollection,
      crmAccountsCollection,
      crmContactsCollection,
      crmOrdersCollection,
      crmQuotesCollection,
      emailConnectionsCollection,
      emailIntakeMessagesCollection,
      emailIntakeSuggestionsCollection,
      emailSyncStatesCollection,
      ordersUnifiedCollection,
    } = collections
    const resolvedSyncTimeZone = normalizeSyncTimeZone(syncTimeZone)
    const syncDateRange = resolveSyncDateRange(syncDate, resolvedSyncTimeZone)
    const resolvedHistoricalLookbackDays = syncDateRange
      ? 0
      : resolveSyncLookbackDays(historicalLookbackDays, 0)
    const resolvedBootstrapLookbackDays = resolveSyncLookbackDays(
      bootstrapLookbackDays,
      resolveBootstrapLookbackDays(),
    )
    const resolvedMaxMessagesPerConnection = clampInteger(
      maxMessagesPerConnection,
      20,
      emailIntakeManualSyncMaxMessagesPerConnectionMax,
      emailIntakeManualSyncMaxMessagesPerConnectionDefault,
    )
    const resolvedProcessingDeadlineMs = Number.isFinite(Number(processingDeadlineMs))
      ? Number(processingDeadlineMs)
      : 0
    const uid = normalizeText(connection?.uid, 200)
    const hasReachedProcessingDeadline = () => (
      resolvedProcessingDeadlineMs > 0
      && Date.now() >= resolvedProcessingDeadlineMs
    )

    if (!uid) {
      return {
        provider: googleProviderId,
        uid: null,
        skipped: true,
        reason: 'Missing connection uid.',
        syncDateApplied: syncDateRange?.syncDate || null,
        lookbackDaysApplied: 0,
        messagesCaught: 0,
        messagesIngested: 0,
        suggestionsCreated: 0,
      }
    }

    let activeConnection = connection
    let tokenResolution = await resolveGoogleAccessTokenForSync({
      emailConnectionsCollection,
      connection: activeConnection,
    })
    activeConnection = tokenResolution.connection

    const callWithRefresh = async (callback) => {
      try {
        return await callback(tokenResolution.accessToken)
      } catch (error) {
        if (Number(error?.status) !== 401) {
          throw error
        }

        tokenResolution = await resolveGoogleAccessTokenForSync({
          emailConnectionsCollection,
          connection: activeConnection,
          forceRefresh: true,
        })
        activeConnection = tokenResolution.connection

        return callback(tokenResolution.accessToken)
      }
    }

    const now = nowIso()
    const profile = await callWithRefresh((accessToken) => fetchGoogleMailboxProfile(accessToken))
    const connectedEmail = normalizeEmailAddress(activeConnection?.connectedEmail || profile?.emailAddress)

    emitEmailSyncTrace(onTrace, 'info', `Connected to mailbox account ${connectedEmail || uid}.`, {
      provider: googleProviderId,
      uid,
      connectedEmail,
    })

    const syncState = await emailSyncStatesCollection.findOne(
      {
        provider: googleProviderId,
        uid,
      },
      {
        projection: {
          _id: 0,
          googleHistoryId: 1,
          autoSyncEnabled: 1,
        },
      },
    )

    if (syncState?.autoSyncEnabled === false) {
      return {
        provider: googleProviderId,
        uid,
        skipped: true,
        reason: 'Auto sync is disabled.',
        syncDateApplied: syncDateRange?.syncDate || null,
        lookbackDaysApplied: 0,
        messagesCaught: 0,
        messagesIngested: 0,
        suggestionsCreated: 0,
      }
    }

    const currentHistoryId = normalizeText(syncState?.googleHistoryId, 120)
    const profileHistoryId = normalizeText(profile?.historyId, 120)

    let bootstrapped = false
    let rebaselined = false
    const messageIds = new Set()
    let latestHistoryId = currentHistoryId || profileHistoryId || null

    if (syncDateRange) {
      const exactDayQuery = buildGoogleExactDayQuery(syncDateRange.syncDate, resolvedSyncTimeZone)
      let syncDatePageToken = null
      let syncDatePageCount = 0

      emitEmailSyncTrace(onTrace, 'info', `Running exact-day Gmail sync for ${syncDateRange.syncDate}.`, {
        provider: googleProviderId,
        uid,
        syncDate: syncDateRange.syncDate,
        syncTimeZone: resolvedSyncTimeZone,
      })

      if (exactDayQuery) {
        while (syncDatePageCount < 10 && messageIds.size < 1200) {
          const dayPayload = await callWithRefresh((accessToken) => fetchGoogleMessageIdPage({
            accessToken,
            query: exactDayQuery,
            pageToken: syncDatePageToken,
            maxResults: 120,
          }))

          ;(Array.isArray(dayPayload?.messages) ? dayPayload.messages : []).forEach((messageEntry) => {
            const dayMessageId = normalizeText(messageEntry?.id, 220)

            if (dayMessageId) {
              messageIds.add(dayMessageId)
            }
          })

          syncDatePageToken = normalizeText(dayPayload?.nextPageToken, 220) || null
          syncDatePageCount += 1

          if (!syncDatePageToken) {
            break
          }
        }
      }
    } else if (!currentHistoryId || !profileHistoryId) {
      await emailSyncStatesCollection.updateOne(
        {
          provider: googleProviderId,
          uid,
        },
        {
          $set: {
            provider: googleProviderId,
            uid,
            connectionId: normalizeText(activeConnection?.id, 220) || null,
            connectedEmailLower: connectedEmail,
            autoSyncEnabled: true,
            googleHistoryId: profileHistoryId,
            lastSyncAttemptAt: now,
            lastSyncCompletedAt: now,
            lastSyncStatus: 'bootstrapped',
            lastSyncError: null,
            updatedAt: now,
          },
          $setOnInsert: {
            id: randomUUID(),
            createdAt: now,
          },
        },
        { upsert: true },
      )

      bootstrapped = true
      latestHistoryId = profileHistoryId || currentHistoryId || latestHistoryId

      if (resolvedHistoricalLookbackDays <= 0 && resolvedBootstrapLookbackDays <= 0) {
        return {
          provider: googleProviderId,
          uid,
          bootstrapped: true,
          syncDateApplied: syncDateRange?.syncDate || null,
          lookbackDaysApplied: 0,
          messagesCaught: 0,
          messagesIngested: 0,
          suggestionsCreated: 0,
        }
      }
    } else {
      let pageToken = null
      let pageCount = 0

      while (pageCount < 8) {
        let historyPayload = null

        try {
          historyPayload = await callWithRefresh((accessToken) => fetchGoogleHistoryPage({
            accessToken,
            startHistoryId: currentHistoryId,
            pageToken,
            maxResults: 250,
          }))
        } catch (error) {
          if (Number(error?.status) !== 404) {
            throw error
          }

          await emailSyncStatesCollection.updateOne(
            {
              provider: googleProviderId,
              uid,
            },
            {
              $set: {
                provider: googleProviderId,
                uid,
                connectionId: normalizeText(activeConnection?.id, 220) || null,
                connectedEmailLower: connectedEmail,
                autoSyncEnabled: true,
                googleHistoryId: profileHistoryId,
                lastSyncAttemptAt: now,
                lastSyncCompletedAt: now,
                lastSyncStatus: 'rebaselined',
                lastSyncError: null,
                updatedAt: now,
              },
              $setOnInsert: {
                id: randomUUID(),
                createdAt: now,
              },
            },
            { upsert: true },
          )

          rebaselined = true
          latestHistoryId = profileHistoryId || currentHistoryId || latestHistoryId

          if (resolvedHistoricalLookbackDays <= 0) {
            return {
              provider: googleProviderId,
              uid,
              rebaselined: true,
              syncDateApplied: syncDateRange?.syncDate || null,
              lookbackDaysApplied: 0,
              messagesCaught: 0,
              messagesIngested: 0,
              suggestionsCreated: 0,
            }
          }

          break
        }

        latestHistoryId = normalizeText(historyPayload?.historyId, 120) || latestHistoryId

        ;(Array.isArray(historyPayload?.history) ? historyPayload.history : []).forEach((historyEntry) => {
          ;(Array.isArray(historyEntry?.messagesAdded) ? historyEntry.messagesAdded : []).forEach((messageEntry) => {
            const historyMessageId = normalizeText(messageEntry?.message?.id, 220)

            if (historyMessageId) {
              messageIds.add(historyMessageId)
            }
          })
        })

        pageToken = normalizeText(historyPayload?.nextPageToken, 220) || null
        pageCount += 1

        if (!pageToken) {
          break
        }
      }
    }

    const lookbackDaysApplied = syncDateRange
      ? 0
      : resolvedHistoricalLookbackDays > 0
      ? resolvedHistoricalLookbackDays
      : bootstrapped
        ? resolvedBootstrapLookbackDays
        : 0
    let lookbackMessagesCollected = 0

    if (!syncDateRange && lookbackDaysApplied > 0) {
      const lookbackQuery = buildGoogleLookbackQuery(lookbackDaysApplied)
      let lookbackPageToken = null
      let lookbackPageCount = 0

      while (lookbackPageCount < 6 && messageIds.size < 360) {
        const lookbackPayload = await callWithRefresh((accessToken) => fetchGoogleMessageIdPage({
          accessToken,
          query: lookbackQuery,
          pageToken: lookbackPageToken,
          maxResults: 120,
        }))

        const beforeSize = messageIds.size

        ;(Array.isArray(lookbackPayload?.messages) ? lookbackPayload.messages : []).forEach((messageEntry) => {
          const lookbackMessageId = normalizeText(messageEntry?.id, 220)

          if (lookbackMessageId) {
            messageIds.add(lookbackMessageId)
          }
        })

        lookbackMessagesCollected += Math.max(0, messageIds.size - beforeSize)
        lookbackPageToken = normalizeText(lookbackPayload?.nextPageToken, 220) || null
        lookbackPageCount += 1

        if (!lookbackPageToken) {
          break
        }
      }
    }

    let messagesIngested = 0
    let suggestionsCreated = 0
    let messagesSkippedNoDestination = 0
    let messagesSkippedByPolicy = 0
    const selectedMessageIds = [...messageIds].slice(0, resolvedMaxMessagesPerConnection)
    let messagesVisitedForProcessing = 0
    let processingStoppedReason = null

    emitEmailSyncTrace(
      onTrace,
      'info',
      `Caught ${messageIds.size} email(s) in sync window. Processing ${selectedMessageIds.length}.`,
      {
        provider: googleProviderId,
        uid,
        syncDateApplied: syncDateRange?.syncDate || null,
        lookbackDaysApplied,
        messagesCaught: messageIds.size,
        processingCount: selectedMessageIds.length,
      },
    )

    for (const [messageIndex, messageId] of selectedMessageIds.entries()) {
      if (hasReachedProcessingDeadline()) {
        processingStoppedReason = 'Per-mailbox runtime budget reached before all selected emails were processed.'

        emitEmailSyncTrace(onTrace, 'warn', processingStoppedReason, {
          provider: googleProviderId,
          uid,
          messagesVisitedForProcessing,
          messagesPlannedForProcessing: selectedMessageIds.length,
        })
        break
      }

      messagesVisitedForProcessing += 1

      try {
        emitEmailSyncTrace(onTrace, 'info', `Email ${messageIndex + 1}/${selectedMessageIds.length}: loading metadata.`, {
          provider: googleProviderId,
          uid,
          messageId,
        })

        const rawMessage = await withOperationTimeout(
          callWithRefresh((accessToken) => fetchGoogleMessageMetadata({
            accessToken,
            messageId,
          })),
          10 * 1000,
          'Google message metadata fetch',
        )
        const normalizedMessage = normalizeGoogleMessageForIntake({
          rawMessage,
          connectedEmail,
        })

        if (!normalizedMessage) {
          emitEmailSyncTrace(onTrace, 'warn', 'Email metadata was not usable and was skipped.', {
            provider: googleProviderId,
            uid,
            messageId,
          })
          continue
        }

        if (
          syncDateRange
          && !isTimestampWithinIsoRange(
            normalizedMessage.messageDate,
            syncDateRange.startIso,
            syncDateRange.endIso,
          )
        ) {
          emitEmailSyncTrace(onTrace, 'info', 'Email fell outside selected-date timezone range and was skipped.', {
            provider: googleProviderId,
            uid,
            messageId,
            syncDate: syncDateRange.syncDate,
            syncTimeZone: resolvedSyncTimeZone,
          })
          continue
        }

        const ingestResult = await upsertEmailIntakeMessage({
          emailIntakeMessagesCollection,
          message: {
            provider: googleProviderId,
            uid,
            connectionId: normalizeText(activeConnection?.id, 220) || null,
            connectedEmail,
            ...normalizedMessage,
          },
        })

        if (!ingestResult?.message) {
          emitEmailSyncTrace(onTrace, 'warn', 'Email could not be persisted to intake messages and was skipped.', {
            provider: googleProviderId,
            uid,
            messageId,
          })
          continue
        }

        messagesIngested += 1

        if (!ingestResult.isNew) {
          emitEmailSyncTrace(onTrace, 'info', 'Email was already ingested earlier. Skipping AI reprocessing.', {
            provider: googleProviderId,
            uid,
            messageId,
            intakeMessageId: normalizeText(ingestResult?.message?.id, 220) || null,
          })
          continue
        }

        const suggestionResult = await withOperationTimeout(
          createEmailIntakeSuggestion({
            aiRulesCollection,
            crmAccountsCollection,
            crmContactsCollection,
            crmOrdersCollection,
            crmQuotesCollection,
            emailIntakeMessagesCollection,
            emailIntakeSuggestionsCollection,
            ordersUnifiedCollection,
            message: ingestResult.message,
            forceDefaultRed: Boolean(syncDateRange?.syncDate),
            onTrace,
          }),
          15 * 1000,
          'Email suggestion creation',
        )

        if (suggestionResult?.skippedByPolicy) {
          messagesSkippedByPolicy += 1
        }

        if (suggestionResult?.skippedNoDestination) {
          messagesSkippedNoDestination += 1
        }

        if (suggestionResult?.created) {
          suggestionsCreated += 1
        }
      } catch (error) {
        const timedOut = normalizeText(error?.code, 80) === 'email_intake_sync_timeout'

        emitEmailSyncTrace(
          onTrace,
          timedOut
            ? 'warn'
            : 'error',
          timedOut
            ? `Email ${messageIndex + 1}/${selectedMessageIds.length} timed out and was skipped.`
            : `Email ${messageIndex + 1}/${selectedMessageIds.length} failed and was skipped.`,
          {
            provider: googleProviderId,
            uid,
            messageId,
            error: normalizeText(error?.message, 600) || null,
          },
        )
      }
    }

    const processingTimedOut = Boolean(processingStoppedReason)

    await emailSyncStatesCollection.updateOne(
      {
        provider: googleProviderId,
        uid,
      },
      {
        $set: {
          provider: googleProviderId,
          uid,
          connectionId: normalizeText(activeConnection?.id, 220) || null,
          connectedEmailLower: connectedEmail,
          autoSyncEnabled: true,
          googleHistoryId: latestHistoryId || profileHistoryId || currentHistoryId,
          lastSyncAttemptAt: now,
          lastSyncCompletedAt: now,
          lastSyncStatus: rebaselined
            ? 'rebaselined'
            : bootstrapped
              ? 'bootstrapped'
              : 'ok',
          lastSyncError: null,
          updatedAt: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          createdAt: now,
        },
      },
      { upsert: true },
    )

    return {
      provider: googleProviderId,
      uid,
      timedOut: processingTimedOut,
      processingStoppedReason,
      bootstrapped,
      rebaselined,
      syncDateApplied: syncDateRange?.syncDate || null,
      lookbackDaysApplied,
      messagesCaught: messageIds.size,
      messagesPlannedForProcessing: selectedMessageIds.length,
      messagesVisitedForProcessing,
      lookbackMessagesCollected,
      messagesSkippedNoDestination,
      messagesSkippedByPolicy,
      messagesIngested,
      suggestionsCreated,
    }
  }

  async function runMicrosoftSyncForConnection({
    collections,
    connection,
    historicalLookbackDays = 0,
    syncDate = null,
    syncTimeZone = emailIntakeDefaultSyncTimeZone,
    bootstrapLookbackDays = null,
    maxMessagesPerConnection = 120,
    processingDeadlineMs = 0,
    onTrace = null,
  }) {
    const {
      aiRulesCollection,
      crmAccountsCollection,
      crmContactsCollection,
      crmOrdersCollection,
      crmQuotesCollection,
      emailConnectionsCollection,
      emailIntakeMessagesCollection,
      emailIntakeSuggestionsCollection,
      emailSyncStatesCollection,
      ordersUnifiedCollection,
    } = collections
    const resolvedSyncTimeZone = normalizeSyncTimeZone(syncTimeZone)
    const syncDateRange = resolveSyncDateRange(syncDate, resolvedSyncTimeZone)
    const resolvedHistoricalLookbackDays = syncDateRange
      ? 0
      : resolveSyncLookbackDays(historicalLookbackDays, 0)
    const resolvedBootstrapLookbackDays = resolveSyncLookbackDays(
      bootstrapLookbackDays,
      resolveBootstrapLookbackDays(),
    )
    const resolvedMaxMessagesPerConnection = clampInteger(
      maxMessagesPerConnection,
      20,
      emailIntakeManualSyncMaxMessagesPerConnectionMax,
      emailIntakeManualSyncMaxMessagesPerConnectionDefault,
    )
    const resolvedProcessingDeadlineMs = Number.isFinite(Number(processingDeadlineMs))
      ? Number(processingDeadlineMs)
      : 0
    const uid = normalizeText(connection?.uid, 200)
    const hasReachedProcessingDeadline = () => (
      resolvedProcessingDeadlineMs > 0
      && Date.now() >= resolvedProcessingDeadlineMs
    )

    if (!uid) {
      return {
        provider: microsoftProviderId,
        uid: null,
        skipped: true,
        reason: 'Missing connection uid.',
        syncDateApplied: syncDateRange?.syncDate || null,
        lookbackDaysApplied: 0,
        messagesCaught: 0,
        messagesIngested: 0,
        suggestionsCreated: 0,
      }
    }

    let activeConnection = connection
    let tokenResolution = await resolveMicrosoftAccessTokenForSync({
      emailConnectionsCollection,
      connection: activeConnection,
    })
    activeConnection = tokenResolution.connection

    const callWithRefresh = async (callback) => {
      try {
        return await callback(tokenResolution.accessToken)
      } catch (error) {
        if (Number(error?.status) !== 401) {
          throw error
        }

        tokenResolution = await resolveMicrosoftAccessTokenForSync({
          emailConnectionsCollection,
          connection: activeConnection,
          forceRefresh: true,
        })
        activeConnection = tokenResolution.connection

        return callback(tokenResolution.accessToken)
      }
    }

    const now = nowIso()
    const connectedEmail = normalizeEmailAddress(activeConnection?.connectedEmail)

    emitEmailSyncTrace(onTrace, 'info', `Connected to mailbox account ${connectedEmail || uid}.`, {
      provider: microsoftProviderId,
      uid,
      connectedEmail,
    })

    const syncState = await emailSyncStatesCollection.findOne(
      {
        provider: microsoftProviderId,
        uid,
      },
      {
        projection: {
          _id: 0,
          microsoftLastSyncedAt: 1,
          autoSyncEnabled: 1,
        },
      },
    )

    if (syncState?.autoSyncEnabled === false) {
      return {
        provider: microsoftProviderId,
        uid,
        skipped: true,
        reason: 'Auto sync is disabled.',
        syncDateApplied: syncDateRange?.syncDate || null,
        lookbackDaysApplied: 0,
        messagesCaught: 0,
        messagesIngested: 0,
        suggestionsCreated: 0,
      }
    }

    const isBootstrappedNow = !syncState?.microsoftLastSyncedAt

    if (isBootstrappedNow) {
      await emailSyncStatesCollection.updateOne(
        {
          provider: microsoftProviderId,
          uid,
        },
        {
          $set: {
            provider: microsoftProviderId,
            uid,
            connectionId: normalizeText(activeConnection?.id, 220) || null,
            connectedEmailLower: connectedEmail,
            autoSyncEnabled: true,
            microsoftLastSyncedAt: now,
            lastSyncAttemptAt: now,
            lastSyncCompletedAt: now,
            lastSyncStatus: 'bootstrapped',
            lastSyncError: null,
            updatedAt: now,
          },
          $setOnInsert: {
            id: randomUUID(),
            createdAt: now,
          },
        },
        { upsert: true },
      )

      if (!syncDateRange && resolvedHistoricalLookbackDays <= 0 && resolvedBootstrapLookbackDays <= 0) {
        return {
          provider: microsoftProviderId,
          uid,
          bootstrapped: true,
          syncDateApplied: syncDateRange?.syncDate || null,
          lookbackDaysApplied: 0,
          messagesCaught: 0,
          messagesIngested: 0,
          suggestionsCreated: 0,
        }
      }
    }

    const lookbackDaysApplied = syncDateRange
      ? 0
      : resolvedHistoricalLookbackDays > 0
      ? resolvedHistoricalLookbackDays
      : isBootstrappedNow
        ? resolvedBootstrapLookbackDays
        : 0
    const baselineMs = Date.parse(String(syncState?.microsoftLastSyncedAt))
    const incrementalSinceIso = Number.isFinite(baselineMs)
      ? new Date(Math.max(0, baselineMs - 2 * 60 * 1000)).toISOString()
      : new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const lookbackSinceIso = lookbackDaysApplied > 0
      ? new Date(Date.now() - lookbackDaysApplied * 24 * 60 * 60 * 1000).toISOString()
      : null
    const sinceIso = syncDateRange
      ? syncDateRange.startIso
      : lookbackSinceIso || incrementalSinceIso
    const rawMessages = await callWithRefresh((accessToken) => fetchMicrosoftMessagesSince({
      accessToken,
      sinceIso,
      startIso: syncDateRange?.startIso,
      endIso: syncDateRange?.endIso,
      maxPages: 8,
      pageSize: 80,
    }))

    let messagesIngested = 0
    let suggestionsCreated = 0
    let messagesSkippedNoDestination = 0
    let messagesSkippedByPolicy = 0
    const selectedRawMessages = (Array.isArray(rawMessages) ? rawMessages : []).slice(0, resolvedMaxMessagesPerConnection)
    let messagesVisitedForProcessing = 0
    let processingStoppedReason = null

    emitEmailSyncTrace(
      onTrace,
      'info',
      `Caught ${(Array.isArray(rawMessages) ? rawMessages.length : 0)} email(s) in sync window. Processing ${selectedRawMessages.length}.`,
      {
        provider: microsoftProviderId,
        uid,
        syncDateApplied: syncDateRange?.syncDate || null,
        lookbackDaysApplied,
        messagesCaught: Array.isArray(rawMessages) ? rawMessages.length : 0,
        processingCount: selectedRawMessages.length,
      },
    )

    let latestCursor = toIsoDateSafe(syncState?.microsoftLastSyncedAt) || now

    for (const [messageIndex, rawMessage] of selectedRawMessages.entries()) {
      if (hasReachedProcessingDeadline()) {
        processingStoppedReason = 'Per-mailbox runtime budget reached before all selected emails were processed.'

        emitEmailSyncTrace(onTrace, 'warn', processingStoppedReason, {
          provider: microsoftProviderId,
          uid,
          messagesVisitedForProcessing,
          messagesPlannedForProcessing: selectedRawMessages.length,
        })
        break
      }

      messagesVisitedForProcessing += 1

      try {
        emitEmailSyncTrace(onTrace, 'info', `Email ${messageIndex + 1}/${selectedRawMessages.length}: analyzing message.`, {
          provider: microsoftProviderId,
          uid,
        })

        const normalizedMessage = normalizeMicrosoftMessageForIntake({
          rawMessage,
          connectedEmail,
        })

        if (!normalizedMessage) {
          emitEmailSyncTrace(onTrace, 'warn', 'Email metadata was not usable and was skipped.', {
            provider: microsoftProviderId,
            uid,
          })
          continue
        }

        if (
          syncDateRange
          && !isTimestampWithinIsoRange(
            normalizedMessage.messageDate,
            syncDateRange.startIso,
            syncDateRange.endIso,
          )
        ) {
          emitEmailSyncTrace(onTrace, 'info', 'Email fell outside selected-date timezone range and was skipped.', {
            provider: microsoftProviderId,
            uid,
            syncDate: syncDateRange.syncDate,
            syncTimeZone: resolvedSyncTimeZone,
          })
          continue
        }

        const ingestResult = await upsertEmailIntakeMessage({
          emailIntakeMessagesCollection,
          message: {
            provider: microsoftProviderId,
            uid,
            connectionId: normalizeText(activeConnection?.id, 220) || null,
            connectedEmail,
            ...normalizedMessage,
          },
        })

        if (!ingestResult?.message) {
          emitEmailSyncTrace(onTrace, 'warn', 'Email could not be persisted to intake messages and was skipped.', {
            provider: microsoftProviderId,
            uid,
          })
          continue
        }

        messagesIngested += 1
        const providerCursor = toIsoDateSafe(normalizedMessage.providerUpdatedAt)

        if (providerCursor && Date.parse(providerCursor) > Date.parse(latestCursor)) {
          latestCursor = providerCursor
        }

        if (!ingestResult.isNew) {
          emitEmailSyncTrace(onTrace, 'info', 'Email was already ingested earlier. Skipping AI reprocessing.', {
            provider: microsoftProviderId,
            uid,
            intakeMessageId: normalizeText(ingestResult?.message?.id, 220) || null,
          })
          continue
        }

        const suggestionResult = await withOperationTimeout(
          createEmailIntakeSuggestion({
            aiRulesCollection,
            crmAccountsCollection,
            crmContactsCollection,
            crmOrdersCollection,
            crmQuotesCollection,
            emailIntakeMessagesCollection,
            emailIntakeSuggestionsCollection,
            ordersUnifiedCollection,
            message: ingestResult.message,
            forceDefaultRed: Boolean(syncDateRange?.syncDate),
            onTrace,
          }),
          15 * 1000,
          'Email suggestion creation',
        )

        if (suggestionResult?.skippedByPolicy) {
          messagesSkippedByPolicy += 1
        }

        if (suggestionResult?.skippedNoDestination) {
          messagesSkippedNoDestination += 1
        }

        if (suggestionResult?.created) {
          suggestionsCreated += 1
        }
      } catch (error) {
        const timedOut = normalizeText(error?.code, 80) === 'email_intake_sync_timeout'

        emitEmailSyncTrace(
          onTrace,
          timedOut
            ? 'warn'
            : 'error',
          timedOut
            ? `Email ${messageIndex + 1}/${selectedRawMessages.length} timed out and was skipped.`
            : `Email ${messageIndex + 1}/${selectedRawMessages.length} failed and was skipped.`,
          {
            provider: microsoftProviderId,
            uid,
            error: normalizeText(error?.message, 600) || null,
          },
        )
      }
    }

    const processingTimedOut = Boolean(processingStoppedReason)

    await emailSyncStatesCollection.updateOne(
      {
        provider: microsoftProviderId,
        uid,
      },
      {
        $set: {
          provider: microsoftProviderId,
          uid,
          connectionId: normalizeText(activeConnection?.id, 220) || null,
          connectedEmailLower: connectedEmail,
          autoSyncEnabled: true,
          microsoftLastSyncedAt: latestCursor,
          lastSyncAttemptAt: now,
          lastSyncCompletedAt: now,
          lastSyncStatus: isBootstrappedNow ? 'bootstrapped' : 'ok',
          lastSyncError: null,
          updatedAt: now,
        },
        $setOnInsert: {
          id: randomUUID(),
          createdAt: now,
        },
      },
      { upsert: true },
    )

    return {
      provider: microsoftProviderId,
      uid,
      timedOut: processingTimedOut,
      processingStoppedReason,
      bootstrapped: isBootstrappedNow,
      syncDateApplied: syncDateRange?.syncDate || null,
      lookbackDaysApplied,
      messagesCaught: Array.isArray(rawMessages) ? rawMessages.length : 0,
      messagesPlannedForProcessing: selectedRawMessages.length,
      messagesVisitedForProcessing,
      lookbackMessagesCollected: Array.isArray(rawMessages) ? rawMessages.length : 0,
      messagesSkippedNoDestination,
      messagesSkippedByPolicy,
      messagesIngested,
      suggestionsCreated,
    }
  }

  async function runEmailIntakeSyncCycle({
    requestedByUid = null,
    requestedProvider = null,
    syncDate = null,
    syncTimeZone = emailIntakeDefaultSyncTimeZone,
    maxConnections = 40,
    lookbackDays = 0,
    maxMessagesPerConnection = emailIntakeManualSyncMaxMessagesPerConnectionDefault,
    maxRuntimeMs = 0,
    perConnectionTimeoutMs = 0,
  } = {}) {
    const collections = await getEmailIntakeCollections()
    const {
      emailConnectionsCollection,
    } = collections
    const syncDateRange = resolveSyncDateRange(syncDate, syncTimeZone)
    const resolvedSyncDate = syncDateRange?.syncDate || null
    const resolvedSyncTimeZone = resolvedSyncDate
      ? normalizeSyncTimeZone(syncDateRange?.timeZone || syncTimeZone)
      : null
    const resolvedLookbackDays = resolvedSyncDate
      ? 0
      : resolveSyncLookbackDays(lookbackDays, 0)
    const resolvedBootstrapLookbackDays = resolveBootstrapLookbackDays()
    const resolvedMaxMessagesPerConnection = clampInteger(
      maxMessagesPerConnection,
      20,
      emailIntakeManualSyncMaxMessagesPerConnectionMax,
      emailIntakeManualSyncMaxMessagesPerConnectionDefault,
    )
    const resolvedMaxRuntimeMs = clampInteger(maxRuntimeMs, 0, 120000, 0)
    const resolvedPerConnectionTimeoutMs = clampInteger(perConnectionTimeoutMs, 0, 60000, 0)
    const syncStartedAtMs = Date.now()
    const providerFilter = normalizeSyncProvider(requestedProvider)
    const filter = {
      provider: providerFilter || {
        $in: [googleProviderId, microsoftProviderId],
      },
    }

    if (requestedByUid) {
      filter.uid = normalizeText(requestedByUid, 200)
    }

    const connections = await emailConnectionsCollection
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(clampInteger(maxConnections, 1, 200, 40))
      .toArray()
    const adaptivePerConnectionTimeoutMs = resolveAdaptivePerConnectionTimeoutMs({
      requestedTimeoutMs: resolvedPerConnectionTimeoutMs,
      maxRuntimeMs: resolvedMaxRuntimeMs,
      totalConnections: connections.length || 1,
    })
    const summary = {
      startedAt: nowIso(),
      completedAt: null,
      requestedByUid: normalizeText(requestedByUid, 200) || null,
      providerFilter,
      syncDateRequested: resolvedSyncDate,
      syncTimeZoneRequested: resolvedSyncTimeZone,
      lookbackDaysRequested: resolvedLookbackDays,
      maxMessagesPerConnection: resolvedMaxMessagesPerConnection,
      maxRuntimeMs: resolvedMaxRuntimeMs || null,
      perConnectionTimeoutMs: adaptivePerConnectionTimeoutMs || null,
      scannedConnections: connections.length,
      processedConnections: 0,
      succeededConnections: 0,
      failedConnections: 0,
      skippedConnections: 0,
      truncated: false,
      truncationReason: null,
      messagesCaught: 0,
      messagesIngested: 0,
      suggestionsCreated: 0,
      details: [],
    }

    for (const connection of connections) {
      if (resolvedMaxRuntimeMs > 0 && Date.now() - syncStartedAtMs >= resolvedMaxRuntimeMs) {
        summary.truncated = true
        summary.truncationReason = `Sync runtime budget reached (${Math.ceil(resolvedMaxRuntimeMs / 1000)}s). Returned partial results.`
        break
      }

      const provider = normalizeSyncProvider(connection?.provider)
      const missingScopes = provider === googleProviderId
        ? getMissingGoogleScopes(connection?.scope)
        : getMissingMicrosoftScopes(connection?.scope)
      const missingReadScope = provider === googleProviderId
        ? missingScopes.includes(googleRequiredReadScope)
        : missingScopes.includes(microsoftRequiredReadScope)

      if (missingReadScope) {
        summary.processedConnections += 1
        summary.skippedConnections += 1
        summary.details.push({
          provider,
          uid: normalizeText(connection?.uid, 200) || null,
          skipped: true,
          reason: `Missing required scope: ${provider === googleProviderId ? googleRequiredReadScope : microsoftRequiredReadScope}`,
          syncDateApplied: resolvedSyncDate,
          lookbackDaysApplied: 0,
          messagesCaught: 0,
          messagesIngested: 0,
          suggestionsCreated: 0,
        })
        continue
      }

      try {
        const elapsedMs = Date.now() - syncStartedAtMs
        const remainingRuntimeMs = resolvedMaxRuntimeMs > 0
          ? Math.max(0, resolvedMaxRuntimeMs - elapsedMs)
          : 0
        const timeoutForConnectionMs = resolvedMaxRuntimeMs > 0
          ? Math.max(0, Math.min(adaptivePerConnectionTimeoutMs, remainingRuntimeMs - 600))
          : adaptivePerConnectionTimeoutMs
        const useAdaptiveMessageBudget = !resolvedSyncDate
        const estimatedMessagesByTimeout = useAdaptiveMessageBudget && timeoutForConnectionMs > 0
          ? Math.max(
            1,
            Math.floor(
              Math.max(1000, timeoutForConnectionMs - emailIntakeRuntimeReserveMs)
              / Math.max(100, emailIntakePerEmailRuntimeEstimateMs),
            ),
          )
          : resolvedMaxMessagesPerConnection
        const effectiveMaxMessagesPerConnection = useAdaptiveMessageBudget
          ? clampInteger(
            estimatedMessagesByTimeout,
            1,
            resolvedMaxMessagesPerConnection,
            resolvedMaxMessagesPerConnection,
          )
          : resolvedMaxMessagesPerConnection

        if (resolvedMaxRuntimeMs > 0 && timeoutForConnectionMs <= 0) {
          summary.truncated = true
          summary.truncationReason = `Sync runtime budget reached (${Math.ceil(resolvedMaxRuntimeMs / 1000)}s). Returned partial results.`
          break
        }

        const connectionProcessingDeadlineMs = timeoutForConnectionMs > 0
          ? Date.now() + Math.max(2000, timeoutForConnectionMs - emailIntakeRuntimeReserveMs)
          : 0
        const connectionSyncPromise = provider === googleProviderId
          ? runGoogleSyncForConnection({
            collections,
            connection,
            syncDate: resolvedSyncDate,
            syncTimeZone: resolvedSyncTimeZone,
            historicalLookbackDays: resolvedLookbackDays,
            bootstrapLookbackDays: resolvedBootstrapLookbackDays,
            maxMessagesPerConnection: effectiveMaxMessagesPerConnection,
            processingDeadlineMs: connectionProcessingDeadlineMs,
          })
          : runMicrosoftSyncForConnection({
            collections,
            connection,
            syncDate: resolvedSyncDate,
            syncTimeZone: resolvedSyncTimeZone,
            historicalLookbackDays: resolvedLookbackDays,
            bootstrapLookbackDays: resolvedBootstrapLookbackDays,
            maxMessagesPerConnection: effectiveMaxMessagesPerConnection,
            processingDeadlineMs: connectionProcessingDeadlineMs,
          })

        const result = await withOperationTimeout(
          connectionSyncPromise,
          timeoutForConnectionMs > 0
            ? timeoutForConnectionMs + 1500
            : timeoutForConnectionMs,
          `${provider || 'mailbox'} sync`,
        )

        summary.processedConnections += 1
        summary.succeededConnections += 1
        summary.messagesCaught += Number(result?.messagesCaught ?? result?.lookbackMessagesCollected ?? 0)
        summary.messagesIngested += Number(result?.messagesIngested ?? 0)
        summary.suggestionsCreated += Number(result?.suggestionsCreated ?? 0)
        summary.details.push(result)
      } catch (error) {
        const timedOut = normalizeText(error?.code, 80) === 'email_intake_sync_timeout'

        summary.processedConnections += 1
        summary.failedConnections += 1
        summary.details.push({
          provider,
          uid: normalizeText(connection?.uid, 200) || null,
          failed: true,
          timedOut,
          error: normalizeText(error?.message, 1200) || 'Mailbox sync failed.',
          syncDateApplied: resolvedSyncDate,
          lookbackDaysApplied: 0,
          messagesCaught: 0,
          messagesIngested: 0,
          suggestionsCreated: 0,
        })
      }
    }

    if (!summary.truncated && summary.processedConnections < summary.scannedConnections) {
      summary.truncated = true
      summary.truncationReason = 'Sync returned partial results.'
    }

    summary.completedAt = nowIso()

    return summary
  }

  async function createEmailIntakeSyncRun({
    actor,
    requestedProvider = null,
    syncDate = null,
    syncTimeZone = emailIntakeDefaultSyncTimeZone,
    includeAllConnections = false,
    maxConnections = 40,
    lookbackDays = 0,
    maxMessagesPerConnection = emailIntakeManualSyncMaxMessagesPerConnectionDefault,
    maxRuntimeMs = emailIntakeManualSyncMaxRuntimeMs,
    perConnectionTimeoutMs = emailIntakeManualSyncPerConnectionTimeoutMs,
  }) {
    const collections = await getEmailIntakeCollections()
    const {
      emailConnectionsCollection,
      emailIntakeSyncRunsCollection,
    } = collections
    const providerFilter = normalizeSyncProvider(requestedProvider)
    const requestedByUid = actor?.isAdmin && includeAllConnections
      ? null
      : normalizeText(actor?.uid, 200) || null
    const syncDateRange = resolveSyncDateRange(syncDate, syncTimeZone)
    const resolvedSyncDate = syncDateRange?.syncDate || null
    const resolvedSyncTimeZone = resolvedSyncDate
      ? normalizeSyncTimeZone(syncDateRange?.timeZone || syncTimeZone)
      : null
    const resolvedLookbackDays = resolvedSyncDate
      ? 0
      : resolveSyncLookbackDays(lookbackDays, 0)
    const resolvedMaxMessagesPerConnection = clampInteger(
      maxMessagesPerConnection,
      20,
      emailIntakeManualSyncMaxMessagesPerConnectionMax,
      emailIntakeManualSyncMaxMessagesPerConnectionDefault,
    )
    const resolvedMaxRuntimeMs = clampInteger(maxRuntimeMs, 0, 120000, 0)
    const resolvedPerConnectionTimeoutMs = clampInteger(perConnectionTimeoutMs, 0, 60000, 0)
    const filter = {
      provider: providerFilter || {
        $in: [googleProviderId, microsoftProviderId],
      },
    }

    if (requestedByUid) {
      filter.uid = requestedByUid
    }

    const connections = await emailConnectionsCollection
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(clampInteger(maxConnections, 1, 200, 40))
      .toArray()

    const connectionQueue = connections.map((connection) => {
      const provider = normalizeSyncProvider(connection?.provider)
      const missingScopes = provider === googleProviderId
        ? getMissingGoogleScopes(connection?.scope)
        : getMissingMicrosoftScopes(connection?.scope)
      const missingScopeName = provider === googleProviderId
        ? googleRequiredReadScope
        : microsoftRequiredReadScope
      const missingReadScope = missingScopes.includes(missingScopeName)

      return {
        connectionId: normalizeText(connection?.id, 220) || null,
        provider,
        uid: normalizeText(connection?.uid, 200) || null,
        connectedEmail: normalizeEmailAddress(connection?.connectedEmail) || null,
        missingReadScope,
        missingScopeName: missingReadScope
          ? missingScopeName
          : null,
      }
    })
    const adaptivePerConnectionTimeoutMs = resolveAdaptivePerConnectionTimeoutMs({
      requestedTimeoutMs: resolvedPerConnectionTimeoutMs,
      maxRuntimeMs: resolvedMaxRuntimeMs,
      totalConnections: connectionQueue.length || 1,
    })
    const runId = randomUUID()
    const now = nowIso()
    let nextLogSequence = 0
    const initialLogs = []

    function pushInitialLog(level, message, data = null) {
      nextLogSequence += 1
      initialLogs.push(buildSyncRunLogEntry({
        sequence: nextLogSequence,
        level,
        message,
        data,
      }))
    }

    pushInitialLog(
      'info',
      `Sync run queued for ${connectionQueue.length} mailbox(es).`,
      {
        providerFilter: providerFilter || 'all',
        syncDateRequested: resolvedSyncDate,
        syncTimeZoneRequested: resolvedSyncTimeZone,
        lookbackDaysRequested: resolvedLookbackDays,
      },
    )

    const isCompletedImmediately = connectionQueue.length === 0

    if (isCompletedImmediately) {
      pushInitialLog('info', 'No connected mailboxes matched this sync filter.')
    }

    const runDocument = {
      id: runId,
      status: isCompletedImmediately
        ? emailIntakeSyncRunStatusCompleted
        : emailIntakeSyncRunStatusQueued,
      startedAt: isCompletedImmediately
        ? now
        : null,
      completedAt: isCompletedImmediately
        ? now
        : null,
      createdAt: now,
      updatedAt: now,
      requestedByUid,
      providerFilter,
      syncDateRequested: resolvedSyncDate,
      syncTimeZoneRequested: resolvedSyncTimeZone,
      lookbackDaysRequested: resolvedLookbackDays,
      maxMessagesPerConnection: resolvedMaxMessagesPerConnection,
      maxRuntimeMs: resolvedMaxRuntimeMs,
      perConnectionTimeoutMs: adaptivePerConnectionTimeoutMs,
      scannedConnections: connectionQueue.length,
      processedConnections: 0,
      succeededConnections: 0,
      failedConnections: 0,
      skippedConnections: 0,
      truncated: false,
      truncationReason: null,
      messagesCaught: 0,
      messagesIngested: 0,
      suggestionsCreated: 0,
      logSequence: nextLogSequence,
      logs: initialLogs,
      details: [],
      connectionQueue,
    }

    await emailIntakeSyncRunsCollection.insertOne(runDocument)

    return {
      run: runDocument,
      logs: initialLogs,
    }
  }

  async function getEmailIntakeSyncRunForActor({
    actor,
    runId,
  }) {
    const normalizedRunId = normalizeText(runId, 160)

    if (!normalizedRunId) {
      throw {
        status: 400,
        message: 'runId is required.',
      }
    }

    const collections = await getEmailIntakeCollections()
    const {
      emailIntakeSyncRunsCollection,
    } = collections
    const run = await emailIntakeSyncRunsCollection.findOne(
      {
        id: normalizedRunId,
      },
      {
        projection: {
          _id: 0,
        },
      },
    )

    if (!run) {
      throw {
        status: 404,
        message: 'Sync run was not found.',
      }
    }

    if (!canActorAccessSyncRun(actor, run)) {
      throw {
        status: 403,
        message: 'You do not have access to this sync run.',
      }
    }

    return {
      collections,
      run,
      runId: normalizedRunId,
    }
  }

  async function stepEmailIntakeSyncRun({
    actor,
    runId,
  }) {
    const {
      collections,
      runId: normalizedRunId,
      run: initialRun,
    } = await getEmailIntakeSyncRunForActor({ actor, runId })
    const {
      emailConnectionsCollection,
      emailIntakeSyncRunsCollection,
    } = collections
    let run = initialRun
    const status = normalizeSyncRunStatus(run?.status)

    if (emailIntakeSyncRunStatusesTerminal.has(status)) {
      return {
        run,
        logs: [],
      }
    }

    const now = nowIso()
    const processedConnections = clampInteger(run?.processedConnections, 0, 500, 0)
    const claimedRun = await emailIntakeSyncRunsCollection.findOneAndUpdate(
      {
        id: normalizedRunId,
        processedConnections,
        status: {
          $in: [emailIntakeSyncRunStatusQueued, emailIntakeSyncRunStatusRunning],
        },
      },
      {
        $set: {
          status: emailIntakeSyncRunStatusRunning,
          startedAt: toIsoDateSafe(run?.startedAt) || now,
          updatedAt: now,
        },
      },
      {
        projection: {
          _id: 0,
        },
        returnDocument: 'after',
      },
    )

    if (!claimedRun) {
      const latestRun = await emailIntakeSyncRunsCollection.findOne(
        {
          id: normalizedRunId,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!latestRun) {
        throw {
          status: 404,
          message: 'Sync run was not found.',
        }
      }

      return {
        run: latestRun,
        logs: [],
      }
    }

    run = claimedRun

    const queue = Array.isArray(run?.connectionQueue)
      ? run.connectionQueue
      : []
    const scannedConnections = clampInteger(run?.scannedConnections, 0, 500, queue.length)
    const stepIndex = clampInteger(run?.processedConnections, 0, 500, 0)
    const maxRuntimeMs = clampInteger(run?.maxRuntimeMs, 0, 120000, 0)
    const perConnectionTimeoutMs = clampInteger(run?.perConnectionTimeoutMs, 0, 60000, 0)
    const runStartedAtIso = toIsoDateSafe(run?.startedAt) || toIsoDateSafe(run?.createdAt) || now
    const runStartedAtMs = Date.parse(runStartedAtIso)
    const elapsedMs = Number.isFinite(runStartedAtMs)
      ? Math.max(0, Date.now() - runStartedAtMs)
      : 0
    const remainingRuntimeMs = maxRuntimeMs > 0
      ? Math.max(0, maxRuntimeMs - elapsedMs)
      : 0
    let nextLogSequence = clampInteger(run?.logSequence, 0, Number.MAX_SAFE_INTEGER, 0)
    const logs = []

    function pushLog(level, message, data = null, persistImmediately = false) {
      nextLogSequence += 1
      const entry = buildSyncRunLogEntry({
        sequence: nextLogSequence,
        level,
        message,
        data,
      })

      logs.push(entry)

      if (persistImmediately) {
        void emailIntakeSyncRunsCollection.updateOne(
          {
            id: normalizedRunId,
          },
          {
            $max: {
              logSequence: entry.sequence,
            },
            $set: {
              updatedAt: entry.at,
            },
            $push: {
              logs: {
                $each: [entry],
                $slice: -emailIntakeSyncRunLogsMax,
              },
            },
          },
        ).catch(() => {
          // Ignore trace persistence failures; logs will still be returned in step response.
        })
      }
    }

    const onConnectionTrace = (level, message, data = null) => {
      pushLog(level, message, data, true)
    }

    const stepTimestamp = nowIso()

    if (stepIndex >= scannedConnections || !queue[stepIndex]) {
      pushLog('info', 'Sync run completed.')
      const completedRun = await emailIntakeSyncRunsCollection.findOneAndUpdate(
        {
          id: normalizedRunId,
        },
        {
          $set: {
            status: emailIntakeSyncRunStatusCompleted,
            completedAt: stepTimestamp,
            updatedAt: stepTimestamp,
            logSequence: nextLogSequence,
          },
          ...(logs.length > 0
            ? {
              $push: {
                logs: {
                  $each: logs,
                  $slice: -emailIntakeSyncRunLogsMax,
                },
              },
            }
            : {}),
        },
        {
          projection: {
            _id: 0,
          },
          returnDocument: 'after',
        },
      )

      return {
        run: completedRun || run,
        logs,
      }
    }

    if (maxRuntimeMs > 0 && remainingRuntimeMs <= 0) {
      const truncationReason = `Sync runtime budget reached (${Math.ceil(maxRuntimeMs / 1000)}s). Returned partial results.`
      pushLog('warn', truncationReason)
      const truncatedRun = await emailIntakeSyncRunsCollection.findOneAndUpdate(
        {
          id: normalizedRunId,
        },
        {
          $set: {
            status: emailIntakeSyncRunStatusCompleted,
            truncated: true,
            truncationReason,
            completedAt: stepTimestamp,
            updatedAt: stepTimestamp,
            logSequence: nextLogSequence,
          },
          ...(logs.length > 0
            ? {
              $push: {
                logs: {
                  $each: logs,
                  $slice: -emailIntakeSyncRunLogsMax,
                },
              },
            }
            : {}),
        },
        {
          projection: {
            _id: 0,
          },
          returnDocument: 'after',
        },
      )

      return {
        run: truncatedRun || run,
        logs,
      }
    }

    const queueEntry = queue[stepIndex]
    const connectionProvider = normalizeSyncProvider(queueEntry?.provider)
    const connectionUid = normalizeText(queueEntry?.uid, 200) || null
    const connectionEmail = normalizeEmailAddress(queueEntry?.connectedEmail) || null
    const stepNumber = stepIndex + 1

    pushLog(
      'info',
      `Processing mailbox ${stepNumber} of ${scannedConnections}.`,
      {
        provider: connectionProvider,
        uid: connectionUid,
        connectedEmail: connectionEmail,
      },
      true,
    )

    if (queueEntry?.missingReadScope) {
      const missingScopeName = normalizeText(queueEntry?.missingScopeName, 240)
      const resolvedSyncDate = normalizeSyncDateValue(run?.syncDateRequested)
      const detail = {
        provider: connectionProvider,
        uid: connectionUid,
        skipped: true,
        reason: `Missing required scope: ${missingScopeName || 'Mail.Read'}`,
        syncDateApplied: resolvedSyncDate,
        lookbackDaysApplied: 0,
        messagesCaught: 0,
        messagesIngested: 0,
        suggestionsCreated: 0,
      }
      const nextProcessedConnections = stepNumber
      const hasRemainingConnections = nextProcessedConnections < scannedConnections

      pushLog('warn', detail.reason, {
        mailbox: stepNumber,
      })

      const skippedRun = await emailIntakeSyncRunsCollection.findOneAndUpdate(
        {
          id: normalizedRunId,
        },
        {
          $set: {
            status: hasRemainingConnections
              ? emailIntakeSyncRunStatusRunning
              : emailIntakeSyncRunStatusCompleted,
            completedAt: hasRemainingConnections
              ? null
              : stepTimestamp,
            updatedAt: stepTimestamp,
            logSequence: nextLogSequence,
          },
          $inc: {
            processedConnections: 1,
            skippedConnections: 1,
          },
          $push: {
            details: detail,
            ...(logs.length > 0
              ? {
                logs: {
                  $each: logs,
                  $slice: -emailIntakeSyncRunLogsMax,
                },
              }
              : {}),
          },
        },
        {
          projection: {
            _id: 0,
          },
          returnDocument: 'after',
        },
      )

      return {
        run: skippedRun || run,
        logs,
      }
    }

    const resolvedLookbackDays = resolveSyncLookbackDays(run?.lookbackDaysRequested, 0)
    const resolvedSyncDate = normalizeSyncDateValue(run?.syncDateRequested)
    const resolvedSyncTimeZone = normalizeSyncTimeZone(run?.syncTimeZoneRequested)
    const effectiveLookbackDays = resolvedSyncDate
      ? 0
      : resolvedLookbackDays
    const resolvedBootstrapLookbackDays = resolveBootstrapLookbackDays()
    const resolvedMaxMessagesPerConnection = clampInteger(
      run?.maxMessagesPerConnection,
      20,
      emailIntakeManualSyncMaxMessagesPerConnectionMax,
      emailIntakeManualSyncMaxMessagesPerConnectionDefault,
    )
    const timeoutForConnectionMs = maxRuntimeMs > 0
      ? Math.max(0, Math.min(perConnectionTimeoutMs, remainingRuntimeMs - 600))
      : perConnectionTimeoutMs
    const useAdaptiveMessageBudget = !resolvedSyncDate
    const estimatedMessagesByTimeout = useAdaptiveMessageBudget && timeoutForConnectionMs > 0
      ? Math.max(
        1,
        Math.floor(
          Math.max(1000, timeoutForConnectionMs - emailIntakeRuntimeReserveMs)
          / Math.max(100, emailIntakePerEmailRuntimeEstimateMs),
        ),
      )
      : resolvedMaxMessagesPerConnection
    const effectiveMaxMessagesPerConnection = useAdaptiveMessageBudget
      ? clampInteger(
        estimatedMessagesByTimeout,
        1,
        resolvedMaxMessagesPerConnection,
        resolvedMaxMessagesPerConnection,
      )
      : resolvedMaxMessagesPerConnection

    if (maxRuntimeMs > 0 && timeoutForConnectionMs <= 0) {
      const truncationReason = `Sync runtime budget reached (${Math.ceil(maxRuntimeMs / 1000)}s). Returned partial results.`
      pushLog('warn', truncationReason)
      const truncatedRun = await emailIntakeSyncRunsCollection.findOneAndUpdate(
        {
          id: normalizedRunId,
        },
        {
          $set: {
            status: emailIntakeSyncRunStatusCompleted,
            truncated: true,
            truncationReason,
            completedAt: stepTimestamp,
            updatedAt: stepTimestamp,
            logSequence: nextLogSequence,
          },
          ...(logs.length > 0
            ? {
              $push: {
                logs: {
                  $each: logs,
                  $slice: -emailIntakeSyncRunLogsMax,
                },
              },
            }
            : {}),
        },
        {
          projection: {
            _id: 0,
          },
          returnDocument: 'after',
        },
      )

      return {
        run: truncatedRun || run,
        logs,
      }
    }

    let activeConnection = null
    const connectionId = normalizeText(queueEntry?.connectionId, 220)

    if (connectionId) {
      activeConnection = await emailConnectionsCollection.findOne(
        {
          id: connectionId,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )
    }

    if (!activeConnection && connectionUid && connectionProvider) {
      activeConnection = await emailConnectionsCollection.findOne(
        {
          uid: connectionUid,
          provider: connectionProvider,
        },
        {
          projection: {
            _id: 0,
          },
          sort: {
            updatedAt: -1,
          },
        },
      )
    }

    let detail = null
    let wasSuccessful = false
    let wasSkipped = false

    if (!activeConnection) {
      detail = {
        provider: connectionProvider,
        uid: connectionUid,
        failed: true,
        error: 'Mailbox connection was not found.',
        syncDateApplied: resolvedSyncDate,
        lookbackDaysApplied: 0,
        messagesCaught: 0,
        messagesIngested: 0,
        suggestionsCreated: 0,
      }
      pushLog('error', detail.error, {
        mailbox: stepNumber,
      })
    } else {
      const activeProvider = normalizeSyncProvider(activeConnection?.provider)

      if (!activeProvider) {
        detail = {
          provider: connectionProvider,
          uid: connectionUid,
          failed: true,
          error: 'Mailbox provider is invalid.',
          syncDateApplied: resolvedSyncDate,
          lookbackDaysApplied: 0,
          messagesCaught: 0,
          messagesIngested: 0,
          suggestionsCreated: 0,
        }
        pushLog('error', detail.error, {
          mailbox: stepNumber,
        })
      } else {
        try {
          const connectionProcessingDeadlineMs = timeoutForConnectionMs > 0
            ? Date.now() + Math.max(2000, timeoutForConnectionMs - emailIntakeRuntimeReserveMs)
            : 0
          const connectionSyncPromise = activeProvider === googleProviderId
            ? runGoogleSyncForConnection({
              collections,
              connection: activeConnection,
              syncDate: resolvedSyncDate,
                syncTimeZone: resolvedSyncTimeZone,
              historicalLookbackDays: effectiveLookbackDays,
              bootstrapLookbackDays: resolvedBootstrapLookbackDays,
              maxMessagesPerConnection: effectiveMaxMessagesPerConnection,
              processingDeadlineMs: connectionProcessingDeadlineMs,
              onTrace: onConnectionTrace,
            })
            : runMicrosoftSyncForConnection({
              collections,
              connection: activeConnection,
              syncDate: resolvedSyncDate,
                syncTimeZone: resolvedSyncTimeZone,
              historicalLookbackDays: effectiveLookbackDays,
              bootstrapLookbackDays: resolvedBootstrapLookbackDays,
              maxMessagesPerConnection: effectiveMaxMessagesPerConnection,
              processingDeadlineMs: connectionProcessingDeadlineMs,
              onTrace: onConnectionTrace,
            })

          const connectionResult = await withOperationTimeout(
            connectionSyncPromise,
            timeoutForConnectionMs > 0
              ? timeoutForConnectionMs + 1500
              : timeoutForConnectionMs,
            `${activeProvider || 'mailbox'} sync`,
          )

          detail = connectionResult
          wasSuccessful = true
          wasSkipped = Boolean(connectionResult?.skipped)

          if (connectionResult?.timedOut && connectionResult?.processingStoppedReason) {
            pushLog('warn', connectionResult.processingStoppedReason, {
              mailbox: stepNumber,
              provider: activeProvider,
              messagesVisitedForProcessing: Number(connectionResult?.messagesVisitedForProcessing ?? 0),
              messagesPlannedForProcessing: Number(connectionResult?.messagesPlannedForProcessing ?? 0),
            }, true)
          }

          pushLog('info', `Mailbox ${stepNumber} synced.`, {
            mailbox: stepNumber,
            provider: activeProvider,
            uid: normalizeText(connectionResult?.uid, 200) || connectionUid,
            timedOut: Boolean(connectionResult?.timedOut),
            processingStoppedReason: normalizeText(connectionResult?.processingStoppedReason, 400) || null,
            messagesCaught: Number(connectionResult?.messagesCaught ?? connectionResult?.lookbackMessagesCollected ?? 0),
            messagesVisitedForProcessing: Number(connectionResult?.messagesVisitedForProcessing ?? 0),
            messagesPlannedForProcessing: Number(connectionResult?.messagesPlannedForProcessing ?? 0),
            messagesIngested: Number(connectionResult?.messagesIngested ?? 0),
            suggestionsCreated: Number(connectionResult?.suggestionsCreated ?? 0),
            skippedNoDestination: Number(connectionResult?.messagesSkippedNoDestination ?? 0),
            skippedByPolicy: Number(connectionResult?.messagesSkippedByPolicy ?? 0),
          })
        } catch (error) {
          const timedOut = normalizeText(error?.code, 80) === 'email_intake_sync_timeout'

          detail = {
            provider: activeProvider,
            uid: connectionUid,
            failed: true,
            timedOut,
            error: normalizeText(error?.message, 1200) || 'Mailbox sync failed.',
            syncDateApplied: resolvedSyncDate,
            lookbackDaysApplied: 0,
            messagesCaught: 0,
            messagesIngested: 0,
            suggestionsCreated: 0,
          }
          pushLog(
            timedOut
              ? 'warn'
              : 'error',
            detail.error,
            {
              mailbox: stepNumber,
              provider: activeProvider,
              timedOut,
            },
          )
        }
      }
    }

    const nextProcessedConnections = stepNumber
    const hasRemainingConnections = nextProcessedConnections < scannedConnections
    const increments = {
      processedConnections: 1,
      succeededConnections: wasSuccessful && !wasSkipped
        ? 1
        : 0,
      failedConnections: detail?.failed
        ? 1
        : 0,
      skippedConnections: detail?.skipped || wasSkipped
        ? 1
        : 0,
      messagesCaught: clampInteger(detail?.messagesCaught ?? detail?.lookbackMessagesCollected, 0, 20000, 0),
      messagesIngested: clampInteger(detail?.messagesIngested, 0, 10000, 0),
      suggestionsCreated: clampInteger(detail?.suggestionsCreated, 0, 10000, 0),
    }
    const updatedRun = await emailIntakeSyncRunsCollection.findOneAndUpdate(
      {
        id: normalizedRunId,
      },
      {
        $set: {
          status: hasRemainingConnections
            ? emailIntakeSyncRunStatusRunning
            : emailIntakeSyncRunStatusCompleted,
          completedAt: hasRemainingConnections
            ? null
            : stepTimestamp,
          updatedAt: stepTimestamp,
          logSequence: nextLogSequence,
        },
        $inc: increments,
        $push: {
          details: detail,
          ...(logs.length > 0
            ? {
              logs: {
                $each: logs,
                $slice: -emailIntakeSyncRunLogsMax,
              },
            }
            : {}),
        },
      },
      {
        projection: {
          _id: 0,
        },
        returnDocument: 'after',
      },
    )

    return {
      run: updatedRun || run,
      logs,
    }
  }

  async function postSuggestionToChat({
    collections,
    suggestion,
    actor,
    destinationType,
    destinationId,
    chatDraft,
    chatMessageIdSuffix = null,
  }) {
    const normalizedDestinationType = normalizeEmailDestinationType(destinationType)
    const normalizedDestinationId = normalizeText(destinationId, 220)
    const normalizedChatDraft = normalizeText(chatDraft, 4000)

    if (!normalizedChatDraft) {
      throw {
        status: 400,
        message: 'chatDraft is required for approval.',
      }
    }

    if (normalizedDestinationType === 'none' || !normalizedDestinationId) {
      return {
        posted: false,
        destinationType: 'none',
        destinationId: null,
        chatCollection: null,
        chatMessageId: null,
      }
    }

    const {
      crmAccountsCollection,
      crmQuotesCollection,
      crmDatabase,
      ordersDatabase,
      ordersUnifiedCollection,
    } = collections
    const createdAt = nowIso()
    const chatMessageIdBase = normalizeText(suggestion?.id, 160) || randomUUID()
    const chatMessageId = normalizeText(chatMessageIdSuffix, 40)
      ? `email-intake-${chatMessageIdBase}-${normalizeText(chatMessageIdSuffix, 40)}`
      : `email-intake-${chatMessageIdBase}`
    const actorUid = normalizeText(actor?.uid, 200) || null
    const actorEmail = normalizeEmailAddress(actor?.email) || null
    const actorName = resolveEmailIntakeChatAuthorName(actor)

    if (normalizedDestinationType === 'account') {
      if (!crmDatabase) {
        throw new Error('CRM database is unavailable.')
      }

      const account = await crmAccountsCollection.findOne(
        {
          sourceId: normalizedDestinationId,
          recordStatus: {
            $ne: 'deleted',
          },
        },
        {
          projection: {
            _id: 0,
            sourceId: 1,
          },
        },
      )

      if (!account?.sourceId) {
        throw {
          status: 404,
          message: 'Account destination was not found.',
        }
      }

      const chatsCollection = crmDatabase.collection('crm_account_chats')

      await chatsCollection.updateOne(
        {
          id: chatMessageId,
        },
        {
          $setOnInsert: {
            id: chatMessageId,
            dealerSourceId: account.sourceId,
            message: normalizedChatDraft,
            mentionUserUids: [],
            mentionUserEmails: [],
            reminder: null,
            createdAt,
            createdByUid: actorUid,
            createdByEmail: actorEmail,
            createdByName: actorName,
          },
        },
        { upsert: true },
      )

      return {
        posted: true,
        destinationType: 'account',
        destinationId: account.sourceId,
        chatCollection: 'crm_account_chats',
        chatMessageId,
      }
    }

    if (normalizedDestinationType === 'quote') {
      if (!crmDatabase) {
        throw new Error('CRM database is unavailable.')
      }

      let quote = await crmQuotesCollection.findOne(
        {
          id: normalizedDestinationId,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            quoteNumber: 1,
            dealerSourceId: 1,
          },
        },
      )

      if (!quote?.id) {
        const quoteLookupClauses = buildQuoteLookupClauses([normalizedDestinationId])

        if (quoteLookupClauses.length > 0) {
          quote = await crmQuotesCollection.findOne(
            {
              $or: quoteLookupClauses,
            },
            {
              projection: {
                _id: 0,
                id: 1,
                quoteNumber: 1,
                dealerSourceId: 1,
              },
              sort: {
                updatedAt: -1,
              },
            },
          )
        }
      }

      if (!quote?.id) {
        throw {
          status: 404,
          message: 'Quote destination was not found. Add/import this quote number first, then approve.',
        }
      }

      const chatsCollection = crmDatabase.collection('crm_quote_chats')

      await chatsCollection.updateOne(
        {
          id: chatMessageId,
        },
        {
          $setOnInsert: {
            id: chatMessageId,
            quoteId: quote.id,
            dealerSourceId: normalizeText(quote?.dealerSourceId, 160) || null,
            quoteNumber: normalizeText(quote?.quoteNumber, 120) || null,
            message: normalizedChatDraft,
            mentionUserUids: [],
            mentionUserEmails: [],
            reminder: null,
            createdAt,
            createdByUid: actorUid,
            createdByEmail: actorEmail,
            createdByName: actorName,
          },
        },
        { upsert: true },
      )

      return {
        posted: true,
        destinationType: 'quote',
        destinationId: quote.id,
        chatCollection: 'crm_quote_chats',
        chatMessageId,
      }
    }

    if (!ordersDatabase) {
      throw new Error('Orders database is unavailable.')
    }

    const unifiedOrder = await ordersUnifiedCollection.findOne(
      {
        $or: [
          { orderKey: normalizedDestinationId },
          { order_number: normalizedDestinationId },
          { monday_item_id: normalizedDestinationId },
        ],
      },
      {
        projection: {
          _id: 0,
          orderKey: 1,
          order_number: 1,
          order_name: 1,
          monday_item_id: 1,
        },
      },
    )
    const orderId = resolveOrderChatId(unifiedOrder, normalizedDestinationId)

    if (!orderId) {
      throw {
        status: 404,
        message: 'Order destination was not found.',
      }
    }

    const chatsCollection = ordersDatabase.collection('orders_chats')

    await chatsCollection.updateOne(
      {
        id: chatMessageId,
      },
      {
        $setOnInsert: {
          id: chatMessageId,
          orderId,
          orderNumber: normalizeText(unifiedOrder?.order_number, 160) || null,
          mondayItemId: normalizeText(unifiedOrder?.monday_item_id, 120) || null,
          orderName: normalizeText(unifiedOrder?.order_name, 250) || null,
          message: normalizedChatDraft,
          mentionUserUids: [],
          mentionUserEmails: [],
          reminder: null,
          createdAt,
          createdByUid: actorUid,
          createdByEmail: actorEmail,
          createdByName: actorName,
        },
      },
      { upsert: true },
    )

    return {
      posted: true,
      destinationType: 'order',
      destinationId: orderId,
      chatCollection: 'orders_chats',
      chatMessageId,
    }
  }

  async function postSuggestionToChats({
    collections,
    suggestion,
    actor,
    routeTargets,
    chatDraft,
  }) {
    const normalizedTargets = normalizeRoutingTargetsInput(
      routeTargets,
      suggestion?.candidateDestinations,
    )

    if (normalizedTargets.length === 0) {
      return {
        posted: false,
        destinationType: 'none',
        destinationId: null,
        chatCollection: null,
        chatMessageId: null,
        postedTargets: [],
      }
    }

    const postedTargets = []
    let primaryResult = null

    for (let index = 0; index < normalizedTargets.length; index += 1) {
      const target = normalizedTargets[index]
      const postResult = await postSuggestionToChat({
        collections,
        suggestion,
        actor,
        destinationType: target.type,
        destinationId: target.id,
        chatDraft,
        chatMessageIdSuffix: index === 0 ? null : String(index + 1),
      })

      if (!primaryResult) {
        primaryResult = postResult
      }

      postedTargets.push({
        ...target,
        posted: Boolean(postResult?.posted),
        chatCollection: normalizeText(postResult?.chatCollection, 160) || null,
        chatMessageId: normalizeText(postResult?.chatMessageId, 220) || null,
      })
    }

    return {
      posted: postedTargets.some((target) => target.posted),
      destinationType: primaryResult?.destinationType || 'none',
      destinationId: primaryResult?.destinationId || null,
      chatCollection: primaryResult?.chatCollection || null,
      chatMessageId: primaryResult?.chatMessageId || null,
      postedTargets,
    }
  }

  async function appendLearningNote({
    aiRulesCollection,
    suggestion,
    actor,
    correctionReason,
    correctedDestinationType,
    correctedDestinationId,
  }) {
    const now = nowIso()
    const ruleDocument = await aiRulesCollection.findOne(
      {
        category: 'email_intake',
      },
      {
        projection: {
          _id: 0,
          content: 1,
        },
      },
    )
    const existingContent = String(ruleDocument?.content ?? '').trim()
    const line = `- ${now} | subject="${normalizeText(suggestion?.subject, 200) || '(no subject)'}" | from=${normalizeEmailAddress(suggestion?.fromEmail) || '(unknown)'} | corrected=${correctedDestinationType}:${correctedDestinationId || 'none'} | reason=${correctionReason} | by=${normalizeText(actor?.displayName, 200) || normalizeEmailAddress(actor?.email) || normalizeText(actor?.uid, 200) || 'unknown'}`
    const nextContent = [existingContent, line]
      .filter(Boolean)
      .join('\n')
      .slice(-45000)

    await aiRulesCollection.updateOne(
      {
        category: 'email_intake',
      },
      {
        $set: {
          content: nextContent,
          updatedAt: now,
        },
        $setOnInsert: {
          category: 'email_intake',
          createdAt: now,
        },
      },
      { upsert: true },
    )
  }

  async function approveSuggestion({
    collections,
    suggestion,
    actor,
    approveInput,
  }) {
    const {
      emailIntakeSuggestionsCollection,
    } = collections

    if (normalizeEmailReviewStatus(suggestion?.status) === emailReviewStatusApproved) {
      return {
        alreadyApproved: true,
        suggestion,
      }
    }

    const destinationType = normalizeEmailDestinationType(
      normalizeText(approveInput?.destinationType, 40)
      || normalizeText(suggestion?.destinationType, 40)
      || 'none',
    )
    const destinationId = normalizeText(approveInput?.destinationId, 220)
      || normalizeText(suggestion?.destinationId, 220)
      || null
    const summary = normalizeText(approveInput?.summary, 1200)
      || normalizeText(suggestion?.summary, 1200)
      || normalizeText(suggestion?.snippet, 1200)
      || 'Email summary approved.'
    const inputChatDraft = normalizeText(approveInput?.chatDraft, 4000)
      || normalizeText(suggestion?.chatDraft, 4000)
      || summary
    const chatDraft = normalizeEmailIntakePostedMessage(inputChatDraft, summary)
    const reviewNotes = normalizeText(approveInput?.reviewNotes, 1200) || null
    const suggestionPrimaryType = normalizeEmailDestinationType(suggestion?.destinationType)
    const suggestionPrimaryId = normalizeText(suggestion?.destinationId, 220) || null
    const useSuggestionRoutingTargets = (
      destinationType === suggestionPrimaryType
      && (destinationId || null) === suggestionPrimaryId
    )
    const fallbackPrimaryTargets = destinationType !== 'none' && destinationId
      ? [{ type: destinationType, id: destinationId }]
      : []
    const selectedRouteTargets = useSuggestionRoutingTargets
      ? normalizeRoutingTargetsInput(suggestion?.routingTargets, suggestion?.candidateDestinations)
      : []
    const routeTargets = selectedRouteTargets.length > 0
      ? selectedRouteTargets
      : normalizeRoutingTargetsInput(fallbackPrimaryTargets, suggestion?.candidateDestinations)
    const now = nowIso()
    const postResult = await postSuggestionToChats({
      collections,
      suggestion,
      actor,
      routeTargets,
      chatDraft,
    })

    const persistedRouteTargets = normalizeRoutingTargetsInput(
      postResult?.postedTargets,
      suggestion?.candidateDestinations,
    )
    const approvedLane = resolveEmailIntakeReviewLane({
      destinationType: postResult?.destinationType || 'none',
      destinationId: postResult?.destinationId || null,
      confidence: suggestion?.confidence,
      usedFallback: Boolean(suggestion?.usedFallback),
    })

    await emailIntakeSuggestionsCollection.updateOne(
      {
        id: normalizeText(suggestion?.id, 160),
      },
      {
        $set: {
          status: emailReviewStatusApproved,
          isRead: true,
          routingTargets: persistedRouteTargets,
          destinationType: postResult?.destinationType || 'none',
          destinationId: postResult?.destinationId || null,
          lane: approvedLane,
          summary,
          chatDraft,
          reviewNotes,
          approvalResult: postResult,
          reviewedAt: now,
          reviewedByUid: normalizeText(actor?.uid, 200) || null,
          reviewedByEmail: normalizeEmailAddress(actor?.email) || null,
          reviewedByName: normalizeText(actor?.displayName, 200) || null,
          rejectedReason: null,
          lastReviewError: null,
          lastReviewErrorAt: null,
          updatedAt: now,
        },
        $push: {
          history: {
            id: randomUUID(),
            action: 'approved',
            byUid: normalizeText(actor?.uid, 200) || null,
            byEmail: normalizeEmailAddress(actor?.email) || null,
            byName: normalizeText(actor?.displayName, 200) || null,
            destinationType: postResult?.destinationType || 'none',
            destinationId: postResult?.destinationId || null,
            chatMessageId: normalizeText(postResult?.chatMessageId, 220) || null,
            routingTargetCount: persistedRouteTargets.length,
            createdAt: now,
          },
        },
      },
    )

    const updatedSuggestion = await emailIntakeSuggestionsCollection.findOne(
      {
        id: normalizeText(suggestion?.id, 160),
      },
      {
        projection: {
          _id: 0,
        },
      },
    )

    return {
      alreadyApproved: false,
      suggestion: updatedSuggestion,
    }
  }

  app.post('/api/admin/email/review/sync-runs/start', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const requestedProvider = normalizeSyncProvider(req.body?.provider)
      const includeAllConnections = Boolean(req.body?.includeAllConnections)
      const maxConnections = clampInteger(req.body?.maxConnections, 1, 200, 40)
      const requestedSyncTimeZone = normalizeSyncTimeZone(
        req.body?.timeZone
          || req.authUser?.accessTimeZone
          || emailIntakeDefaultSyncTimeZone,
      )
      const requestedSyncDate = normalizeSyncDateValue(req.body?.syncDate)
        || resolveCurrentIsoDateInTimeZone(requestedSyncTimeZone)
      const lookbackDays = requestedSyncDate
        ? 0
        : Math.min(
          resolveSyncLookbackDays(
            req.body?.lookbackDays,
            emailIntakeManualSyncLookbackDaysDefault,
          ),
          emailIntakeManualSyncLookbackDaysMax,
        )
      const maxMessagesPerConnection = clampInteger(
        req.body?.maxMessagesPerConnection,
        20,
        emailIntakeManualSyncMaxMessagesPerConnectionMax,
        emailIntakeManualSyncMaxMessagesPerConnectionDefault,
      )
      const createdRun = await createEmailIntakeSyncRun({
        actor,
        requestedProvider,
        syncDate: requestedSyncDate,
        syncTimeZone: requestedSyncTimeZone,
        includeAllConnections,
        maxConnections,
        lookbackDays,
        maxMessagesPerConnection,
        maxRuntimeMs: emailIntakeManualSyncMaxRuntimeMs,
        perConnectionTimeoutMs: emailIntakeManualSyncPerConnectionTimeoutMs,
      })

      return res.json({
        run: toPublicEmailIntakeSyncRun(createdRun?.run),
        logs: toPublicEmailIntakeSyncRunLogs(createdRun?.logs),
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/email/review/sync-runs/:runId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const {
        run,
      } = await getEmailIntakeSyncRunForActor({
        actor,
        runId: req.params?.runId,
      })

      return res.json({
        run: toPublicEmailIntakeSyncRun(run),
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/email/review/sync-runs/:runId/logs', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const {
        run,
      } = await getEmailIntakeSyncRunForActor({
        actor,
        runId: req.params?.runId,
      })
      const afterSequence = clampInteger(req.query?.afterSequence, 0, Number.MAX_SAFE_INTEGER, 0)
      const limit = clampInteger(req.query?.limit, 1, 300, 120)
      const logs = toPublicEmailIntakeSyncRunLogs(run?.logs)
        .filter((log) => clampInteger(log?.sequence, 1, Number.MAX_SAFE_INTEGER, 1) > afterSequence)
        .slice(0, limit)

      return res.json({
        runId: normalizeText(run?.id, 160) || null,
        logSequence: clampInteger(run?.logSequence, 0, Number.MAX_SAFE_INTEGER, 0),
        logs,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/email/review/sync-runs/:runId/step', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const stepResult = await stepEmailIntakeSyncRun({
        actor,
        runId: req.params?.runId,
      })

      return res.json({
        run: toPublicEmailIntakeSyncRun(stepResult?.run),
        logs: toPublicEmailIntakeSyncRunLogs(stepResult?.logs),
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/email/review/sync', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const requestedProvider = normalizeSyncProvider(req.body?.provider)
      const includeAllConnections = Boolean(req.body?.includeAllConnections)
      const maxConnections = clampInteger(req.body?.maxConnections, 1, 200, 40)
      const requestedSyncTimeZone = normalizeSyncTimeZone(
        req.body?.timeZone
          || req.authUser?.accessTimeZone
          || emailIntakeDefaultSyncTimeZone,
      )
      const requestedSyncDate = normalizeSyncDateValue(req.body?.syncDate)
        || resolveCurrentIsoDateInTimeZone(requestedSyncTimeZone)
      const lookbackDays = requestedSyncDate
        ? 0
        : Math.min(
          resolveSyncLookbackDays(
            req.body?.lookbackDays,
            emailIntakeManualSyncLookbackDaysDefault,
          ),
          emailIntakeManualSyncLookbackDaysMax,
        )
      const maxMessagesPerConnection = clampInteger(
        req.body?.maxMessagesPerConnection,
        20,
        emailIntakeManualSyncMaxMessagesPerConnectionMax,
        emailIntakeManualSyncMaxMessagesPerConnectionDefault,
      )
      const summary = await runEmailIntakeSyncCycle({
        requestedByUid: actor.isAdmin && includeAllConnections
          ? null
          : actor.uid,
        requestedProvider,
        syncDate: requestedSyncDate,
        syncTimeZone: requestedSyncTimeZone,
        maxConnections,
        lookbackDays,
        maxMessagesPerConnection,
        maxRuntimeMs: emailIntakeManualSyncMaxRuntimeMs,
        perConnectionTimeoutMs: emailIntakeManualSyncPerConnectionTimeoutMs,
      })

      return res.json(summary)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/email/review/reset', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)

      if (!actor.isAdmin) {
        return res.status(403).json({
          error: 'Admin access is required.',
        })
      }

      const {
        emailIntakeFeedbackCollection,
        emailIntakeMessagesCollection,
        emailIntakeSuggestionsCollection,
        emailSyncStatesCollection,
      } = await getEmailIntakeCollections()
      const resetScope = String(req.body?.scope ?? '').trim().toLowerCase() === 'all-connections'
        ? 'all-connections'
        : 'actor'
      const uidFilter = resetScope === 'all-connections'
        ? {}
        : {
          uid: actor.uid,
        }
      const now = nowIso()
      const [feedbackResult, suggestionsResult, messagesResult, syncStatesResult] = await Promise.all([
        emailIntakeFeedbackCollection.deleteMany(uidFilter),
        emailIntakeSuggestionsCollection.deleteMany(uidFilter),
        emailIntakeMessagesCollection.deleteMany(uidFilter),
        emailSyncStatesCollection.deleteMany(uidFilter),
      ])

      return res.json({
        ok: true,
        scope: resetScope,
        resetAt: now,
        deleted: {
          feedback: Number(feedbackResult?.deletedCount ?? 0),
          suggestions: Number(suggestionsResult?.deletedCount ?? 0),
          messages: Number(messagesResult?.deletedCount ?? 0),
          syncStates: Number(syncStatesResult?.deletedCount ?? 0),
        },
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/email/review/summary', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const requestedSyncTimeZone = normalizeSyncTimeZone(
        req.query?.timeZone
          || req.authUser?.accessTimeZone
          || emailIntakeDefaultSyncTimeZone,
      )
      const {
        emailIntakeSuggestionsCollection,
      } = await getEmailIntakeCollections()
      const providerFilter = normalizeSyncProvider(req.query?.provider)
      const statusFilterRaw = normalizeText(req.query?.status, 40).toLowerCase()
      const statusFilter = statusFilterRaw === 'all'
        ? null
        : normalizeEmailReviewStatus(statusFilterRaw)
      const messageDateRange = resolveSyncDateRange(req.query?.messageDate, requestedSyncTimeZone)
      const laneStatus = statusFilter || emailReviewStatusPending
      const baseFilter = actor.isAdmin
        ? {}
        : {
          uid: actor.uid,
        }

      if (providerFilter) {
        baseFilter.provider = providerFilter
      }

      if (messageDateRange) {
        baseFilter.messageDate = {
          $gte: messageDateRange.startIso,
          $lt: messageDateRange.endIso,
        }
      }

      const [pendingCount, unreadPendingCount, approvedCount, rejectedCount, greenCount, yellowCount, redCount] = await Promise.all([
        emailIntakeSuggestionsCollection.countDocuments({
          ...baseFilter,
          status: emailReviewStatusPending,
        }),
        emailIntakeSuggestionsCollection.countDocuments({
          ...baseFilter,
          status: emailReviewStatusPending,
          isRead: false,
        }),
        emailIntakeSuggestionsCollection.countDocuments({
          ...baseFilter,
          status: emailReviewStatusApproved,
        }),
        emailIntakeSuggestionsCollection.countDocuments({
          ...baseFilter,
          status: emailReviewStatusRejected,
        }),
        emailIntakeSuggestionsCollection.countDocuments({
          ...baseFilter,
          status: laneStatus,
          lane: emailReviewLaneGreen,
        }),
        emailIntakeSuggestionsCollection.countDocuments({
          ...baseFilter,
          status: laneStatus,
          lane: emailReviewLaneYellow,
        }),
        emailIntakeSuggestionsCollection.countDocuments({
          ...baseFilter,
          status: laneStatus,
          lane: emailReviewLaneRed,
        }),
      ])

      return res.json({
        pending: pendingCount,
        unreadPending: unreadPendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        laneStatus,
        green: greenCount,
        yellow: yellowCount,
        red: redCount,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/email/review', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const requestedSyncTimeZone = normalizeSyncTimeZone(
        req.query?.timeZone
          || req.authUser?.accessTimeZone
          || emailIntakeDefaultSyncTimeZone,
      )
      const {
        emailIntakeSuggestionsCollection,
      } = await getEmailIntakeCollections()
      const statusFilterRaw = normalizeText(req.query?.status, 40).toLowerCase()
      const statusFilter = statusFilterRaw === 'all'
        ? null
        : normalizeEmailReviewStatus(statusFilterRaw)
      const providerFilter = normalizeSyncProvider(req.query?.provider)
      const laneFilterRaw = normalizeText(req.query?.lane, 40).toLowerCase()
      const laneFilter = laneFilterRaw === 'all'
        ? null
        : (emailReviewLanes.has(laneFilterRaw)
          ? laneFilterRaw
          : null)
      const messageDateRange = resolveSyncDateRange(req.query?.messageDate, requestedSyncTimeZone)
      const limit = clampInteger(req.query?.limit, 1, 200, 40)
      const offset = clampInteger(req.query?.offset, 0, 5000, 0)
      const baseFilter = {}

      if (providerFilter) {
        baseFilter.provider = providerFilter
      }

      if (statusFilter) {
        baseFilter.status = statusFilter
      }

      if (laneFilter) {
        baseFilter.lane = laneFilter
      }

      if (messageDateRange) {
        baseFilter.messageDate = {
          $gte: messageDateRange.startIso,
          $lt: messageDateRange.endIso,
        }
      }

      const filter = buildSuggestionAccessFilter(baseFilter, actor)
      const [total, suggestions] = await Promise.all([
        emailIntakeSuggestionsCollection.countDocuments(filter),
        emailIntakeSuggestionsCollection
          .find(
            filter,
            {
              projection: {
                _id: 0,
              },
            },
          )
          .sort({ messageDate: -1, createdAt: -1, id: -1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
      ])

      return res.json({
        suggestions,
        total,
        offset,
        limit,
        hasMore: offset + suggestions.length < total,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/email/review/:suggestionId/mark-read', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const suggestionId = normalizeText(req.params.suggestionId, 160)

      if (!suggestionId) {
        return res.status(400).json({
          error: 'suggestionId is required.',
        })
      }

      const {
        emailIntakeSuggestionsCollection,
      } = await getEmailIntakeCollections()
      const filter = buildSuggestionAccessFilter({ id: suggestionId }, actor)

      await emailIntakeSuggestionsCollection.updateOne(
        filter,
        {
          $set: {
            isRead: true,
            updatedAt: nowIso(),
          },
        },
      )

      return res.json({
        ok: true,
        suggestionId,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/admin/email/review/:suggestionId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const suggestionId = normalizeText(req.params.suggestionId, 160)

      if (!suggestionId) {
        return res.status(400).json({
          error: 'suggestionId is required.',
        })
      }

      const {
        emailIntakeSuggestionsCollection,
      } = await getEmailIntakeCollections()
      const filter = buildSuggestionAccessFilter({ id: suggestionId }, actor)
      const suggestion = await emailIntakeSuggestionsCollection.findOne(
        filter,
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!suggestion?.id) {
        return res.status(404).json({
          error: 'Suggestion not found.',
        })
      }

      const destinationType = normalizeEmailDestinationType(
        normalizeText(req.body?.destinationType, 40)
        || normalizeText(suggestion?.destinationType, 40)
        || 'none',
      )
      const destinationId = normalizeText(req.body?.destinationId, 220)
        || normalizeText(suggestion?.destinationId, 220)
        || null
      const summary = normalizeText(req.body?.summary, 1200)
        || normalizeText(suggestion?.summary, 1200)
        || normalizeText(suggestion?.snippet, 1200)
        || 'Email summary unavailable.'
      const chatDraft = normalizeText(req.body?.chatDraft, 4000)
        || normalizeText(suggestion?.chatDraft, 4000)
        || summary
      const reviewNotes = normalizeText(req.body?.reviewNotes, 1200)
        || normalizeText(suggestion?.reviewNotes, 1200)
        || null
      const routingTargets = destinationType !== 'none' && destinationId
        ? normalizeRoutingTargetsInput(
          [{ type: destinationType, id: destinationId }],
          suggestion?.candidateDestinations,
        )
        : []
      const lane = resolveEmailIntakeReviewLane({
        destinationType,
        destinationId,
        confidence: suggestion?.confidence,
        usedFallback: Boolean(suggestion?.usedFallback),
      })

      if (destinationType !== 'none' && !destinationId) {
        return res.status(400).json({
          error: 'destinationId is required when destinationType is account, order, or quote.',
        })
      }

      const now = nowIso()

      await emailIntakeSuggestionsCollection.updateOne(
        {
          id: suggestion.id,
        },
        {
          $set: {
            routingTargets,
            destinationType,
            destinationId,
            lane,
            summary,
            chatDraft,
            reviewNotes,
            updatedAt: now,
          },
          $push: {
            history: {
              id: randomUUID(),
              action: 'edited',
              byUid: normalizeText(actor?.uid, 200) || null,
              byEmail: normalizeEmailAddress(actor?.email) || null,
              byName: normalizeText(actor?.displayName, 200) || null,
              destinationType,
              destinationId,
              createdAt: now,
            },
          },
        },
      )

      const updatedSuggestion = await emailIntakeSuggestionsCollection.findOne(
        {
          id: suggestion.id,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      return res.json({
        ok: true,
        suggestion: updatedSuggestion,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/email/review/:suggestionId/approve', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const suggestionId = normalizeText(req.params.suggestionId, 160)

      if (!suggestionId) {
        return res.status(400).json({
          error: 'suggestionId is required.',
        })
      }

      const collections = await getEmailIntakeCollections()
      const {
        emailIntakeSuggestionsCollection,
      } = collections
      const filter = buildSuggestionAccessFilter({ id: suggestionId }, actor)
      const suggestion = await emailIntakeSuggestionsCollection.findOne(
        filter,
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!suggestion) {
        return res.status(404).json({
          error: 'Suggestion not found.',
        })
      }

      const result = await approveSuggestion({
        collections,
        suggestion,
        actor,
        approveInput: req.body && typeof req.body === 'object'
          ? req.body
          : {},
      })

      return res.json(result)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/email/review/approve-all', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const providerFilter = normalizeSyncProvider(req.body?.provider)
      const limit = clampInteger(req.body?.limit, 1, 200, 50)
      const collections = await getEmailIntakeCollections()
      const {
        emailIntakeSuggestionsCollection,
      } = collections
      const filter = buildSuggestionAccessFilter(
        {
          status: emailReviewStatusPending,
          ...(providerFilter ? { provider: providerFilter } : {}),
        },
        actor,
      )
      const suggestions = await emailIntakeSuggestionsCollection
        .find(
          filter,
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ createdAt: 1, id: 1 })
        .limit(limit)
        .toArray()

      let approved = 0
      let failed = 0
      const errors = []

      for (const suggestion of suggestions) {
        try {
          const result = await approveSuggestion({
            collections,
            suggestion,
            actor,
            approveInput: req.body && typeof req.body === 'object'
              ? req.body
              : {},
          })

          if (result?.alreadyApproved || result?.suggestion) {
            approved += 1
          }
        } catch (error) {
          failed += 1
          errors.push({
            suggestionId: normalizeText(suggestion?.id, 160) || null,
            message: normalizeText(error?.message, 1200) || 'Approval failed.',
          })
        }
      }

      return res.json({
        ok: true,
        processed: suggestions.length,
        approved,
        failed,
        errors,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/email/review/:suggestionId/reject', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const suggestionId = normalizeText(req.params.suggestionId, 160)
      const reason = normalizeText(req.body?.reason, 1200)

      if (!suggestionId) {
        return res.status(400).json({
          error: 'suggestionId is required.',
        })
      }

      if (!reason) {
        return res.status(400).json({
          error: 'reason is required.',
        })
      }

      const {
        aiRulesCollection,
        emailIntakeSuggestionsCollection,
      } = await getEmailIntakeCollections()
      const filter = buildSuggestionAccessFilter({ id: suggestionId }, actor)
      const suggestion = await emailIntakeSuggestionsCollection.findOne(
        filter,
        {
          projection: {
            _id: 0,
            id: 1,
            subject: 1,
            fromEmail: 1,
            destinationType: 1,
            destinationId: 1,
          },
        },
      )

      if (!suggestion?.id) {
        return res.status(404).json({
          error: 'Suggestion not found.',
        })
      }

      const now = nowIso()

      await emailIntakeSuggestionsCollection.updateOne(
        {
          id: suggestion.id,
        },
        {
          $set: {
            status: emailReviewStatusRejected,
            isRead: true,
            lane: emailReviewLaneRed,
            rejectedReason: reason,
            reviewedAt: now,
            reviewedByUid: normalizeText(actor?.uid, 200) || null,
            reviewedByEmail: normalizeEmailAddress(actor?.email) || null,
            reviewedByName: normalizeText(actor?.displayName, 200) || null,
            updatedAt: now,
          },
          $push: {
            history: {
              id: randomUUID(),
              action: 'rejected',
              reason,
              byUid: normalizeText(actor?.uid, 200) || null,
              byEmail: normalizeEmailAddress(actor?.email) || null,
              byName: normalizeText(actor?.displayName, 200) || null,
              createdAt: now,
            },
          },
        },
      )

      try {
        await appendLearningNote({
          aiRulesCollection,
          suggestion,
          actor,
          correctionReason: `Rejected suggestion: ${reason}`,
          correctedDestinationType: normalizeEmailDestinationType(suggestion?.destinationType || 'none'),
          correctedDestinationId: normalizeText(suggestion?.destinationId, 220) || null,
        })
      } catch {
        // Rejection should still succeed even if learning note persistence fails.
      }

      return res.json({
        ok: true,
        suggestionId: suggestion.id,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/email/review/:suggestionId/correct', requireFirebaseAuth, async (req, res, next) => {
    try {
      const actor = resolveReviewActor(req)
      const suggestionId = normalizeText(req.params.suggestionId, 160)
      const reason = normalizeText(req.body?.reason, 1200)
      const correctedDestinationType = normalizeEmailDestinationType(req.body?.correctedDestinationType)
      const correctedDestinationId = normalizeText(req.body?.correctedDestinationId, 220) || null

      if (!suggestionId) {
        return res.status(400).json({
          error: 'suggestionId is required.',
        })
      }

      if (!reason) {
        return res.status(400).json({
          error: 'reason is required.',
        })
      }

      const collections = await getEmailIntakeCollections()
      const {
        aiRulesCollection,
        emailIntakeFeedbackCollection,
        emailIntakeSuggestionsCollection,
      } = collections
      const filter = buildSuggestionAccessFilter({ id: suggestionId }, actor)
      const suggestion = await emailIntakeSuggestionsCollection.findOne(
        filter,
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!suggestion?.id) {
        return res.status(404).json({
          error: 'Suggestion not found.',
        })
      }

      const now = nowIso()
      const feedbackDocument = {
        id: randomUUID(),
        suggestionId: suggestion.id,
        messageId: normalizeText(suggestion?.messageId, 220) || null,
        provider: normalizeSyncProvider(suggestion?.provider),
        uid: normalizeText(suggestion?.uid, 200) || null,
        type: 'correction',
        reason,
        correctedDestinationType,
        correctedDestinationId,
        correctedSummary: normalizeText(req.body?.correctedSummary, 1200) || null,
        correctedChatDraft: normalizeText(req.body?.correctedChatDraft, 4000) || null,
        createdByUid: normalizeText(actor?.uid, 200) || null,
        createdByEmail: normalizeEmailAddress(actor?.email) || null,
        createdByName: normalizeText(actor?.displayName, 200) || null,
        createdAt: now,
      }

      await emailIntakeFeedbackCollection.insertOne(feedbackDocument)
      await appendLearningNote({
        aiRulesCollection,
        suggestion,
        actor,
        correctionReason: reason,
        correctedDestinationType,
        correctedDestinationId,
      })
      const finalDestinationType = correctedDestinationType !== 'none'
        ? correctedDestinationType
        : normalizeEmailDestinationType(suggestion?.destinationType)
      const finalDestinationId = correctedDestinationType !== 'none'
        ? correctedDestinationId
        : normalizeText(suggestion?.destinationId, 220)
      const correctedLane = resolveEmailIntakeReviewLane({
        destinationType: finalDestinationType,
        destinationId: finalDestinationId,
        confidence: suggestion?.confidence,
        usedFallback: Boolean(suggestion?.usedFallback),
      })

      await emailIntakeSuggestionsCollection.updateOne(
        {
          id: suggestion.id,
        },
        {
          $set: {
            routingTargets: correctedDestinationType !== 'none' && correctedDestinationId
              ? normalizeRoutingTargetsInput(
                [{ type: correctedDestinationType, id: correctedDestinationId }],
                suggestion?.candidateDestinations,
              )
              : normalizeRoutingTargetsInput(
                suggestion?.routingTargets,
                suggestion?.candidateDestinations,
              ),
            destinationType: finalDestinationType,
            destinationId: finalDestinationId,
            lane: correctedLane,
            summary: normalizeText(req.body?.correctedSummary, 1200)
              || normalizeText(suggestion?.summary, 1200)
              || null,
            chatDraft: normalizeText(req.body?.correctedChatDraft, 4000)
              || normalizeText(suggestion?.chatDraft, 4000)
              || null,
            correctionCount: Number(suggestion?.correctionCount ?? 0) + 1,
            updatedAt: now,
          },
          $push: {
            history: {
              id: randomUUID(),
              action: 'corrected',
              reason,
              correctedDestinationType,
              correctedDestinationId,
              byUid: normalizeText(actor?.uid, 200) || null,
              byEmail: normalizeEmailAddress(actor?.email) || null,
              byName: normalizeText(actor?.displayName, 200) || null,
              createdAt: now,
            },
          },
        },
      )

      return res.json({
        ok: true,
        feedback: feedbackDocument,
      })
    } catch (error) {
      next(error)
    }
  })

  return {
    runEmailIntakeSyncCycle,
  }
}

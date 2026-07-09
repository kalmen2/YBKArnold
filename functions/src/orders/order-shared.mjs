// Shared pure helpers for the orders modules: date-only parsing, order
// identity filters, and warranty field mapping. No I/O, no side effects.

import { randomUUID } from 'node:crypto'
import { normalizeOptionalShortText } from '../utils/value-utils.mjs'
import {
  ORDER_PROGRESS_STAGES,
  ORDER_PROGRESS_STAGE_KEYS,
  normalizeProgressStageKey,
  normalizeProgressStageStatus as normalizeWebsiteProgressStatus,
} from './stage-registry.mjs'

// Retry backoff for queued Monday pushes (seconds per attempt).
export const ORDERS_PROGRESS_QUEUE_RETRY_DELAYS_SECONDS = [10, 30, 90, 180, 300, 600]

const fixedOrderProgressStages = ORDER_PROGRESS_STAGES
const fixedOrderProgressStageKeySet = new Set(ORDER_PROGRESS_STAGE_KEYS)
const ordersProgressStatusQueueRetryDelaysSeconds = ORDERS_PROGRESS_QUEUE_RETRY_DELAYS_SECONDS

export function normalizeIsoDateInput(value) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return ''
  }

  const matched = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (!matched) {
    return ''
  }

  const [, year, month, day] = matched

  return `${year}-${month}-${day}`
}

export function hasOwnField(source, fieldName) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, fieldName))
}

export function toIsoDateOnlyOrNull(value) {
  return normalizeIsoDateInput(value) || null
}

export function toUtcDateFromIsoDateOnly(value) {
  const normalized = toIsoDateOnlyOrNull(value)

  if (!normalized) {
    return null
  }

  const parsed = Date.parse(`${normalized}T00:00:00.000Z`)

  return Number.isFinite(parsed) ? parsed : null
}

export function calculateDateDifferenceDays(startDate, endDate) {
  const startMs = toUtcDateFromIsoDateOnly(startDate)
  const endMs = toUtcDateFromIsoDateOnly(endDate)

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null
  }

  return Math.round((endMs - startMs) / (24 * 60 * 60 * 1000))
}

// Builds the Mongo filter that identifies one order by any of its identities
// (orderKey, Monday item id, or order number).
export function buildOrderIdentityFilter({
  orderKey,
  mondayItemId,
  orderNumber,
}) {
  const normalizedOrderKey = String(orderKey ?? '').trim()
  const normalizedMondayItemId = String(mondayItemId ?? '').trim()
  const normalizedOrderNumber = String(orderNumber ?? '').trim()
  const filters = []

  if (normalizedOrderKey) {
    filters.push({ orderKey: normalizedOrderKey })
  }

  if (normalizedMondayItemId) {
    filters.push({ monday_item_id: normalizedMondayItemId })
  }

  if (normalizedOrderNumber) {
    filters.push({ order_number: normalizedOrderNumber })
  }

  if (filters.length === 0) {
    return null
  }

  if (filters.length === 1) {
    return filters[0]
  }

  return { $or: filters }
}

export function normalizeOrderNumberInput(value) {
  return normalizeOptionalShortText(value, 120)
}

export function mapWarrantyStateFromOrderDocument(orderDocument) {
  const durationDays = Number(orderDocument?.warranty_last_completed_duration_days)
  const leadTimeVarianceDays = Number(orderDocument?.warranty_last_completed_lead_time_variance_days)

  return {
    warrantyIssueActive: Boolean(orderDocument?.warranty_issue_active),
    warrantyIssueDescription:
      normalizeOptionalShortText(orderDocument?.warranty_issue_description, 2000) || null,
    warrantyIssueReportedAt:
      normalizeOptionalShortText(orderDocument?.warranty_issue_reported_at, 80) || null,
    warrantyIssueLeadTimeDate:
      normalizeIsoDateInput(orderDocument?.warranty_issue_lead_time_date) || null,
    warrantyIssueDoneAt:
      normalizeOptionalShortText(orderDocument?.warranty_issue_done_at, 80) || null,
    warrantyLastCompletedDescription:
      normalizeOptionalShortText(orderDocument?.warranty_last_completed_description, 2000) || null,
    warrantyLastCompletedReportedAt:
      normalizeOptionalShortText(orderDocument?.warranty_last_completed_reported_at, 80) || null,
    warrantyLastCompletedLeadTimeDate:
      normalizeIsoDateInput(orderDocument?.warranty_last_completed_lead_time_date) || null,
    warrantyLastCompletedDoneAt:
      normalizeOptionalShortText(orderDocument?.warranty_last_completed_done_at, 80) || null,
    warrantyLastCompletedDurationDays:
      Number.isFinite(durationDays) ? durationDays : null,
    warrantyLastCompletedLeadTimeVarianceDays:
      Number.isFinite(leadTimeVarianceDays) ? leadTimeVarianceDays : null,
  }
}

export function buildWarrantyRouteOrderPayload({ orderDocument, mondayItemId }) {
  return {
    mondayItemId: String(mondayItemId ?? '').trim(),
    orderNumber: normalizeOptionalShortText(orderDocument?.order_number, 120) || null,
    isShipped: Boolean(orderDocument?.is_shipped),
    ...mapWarrantyStateFromOrderDocument(orderDocument),
  }
}

export function normalizeProgressDetailOptions(options) {
  return [...new Set(
    (Array.isArray(options) ? options : [])
      .map((option) => {
        if (typeof option === 'string') {
          return String(option).trim()
        }

        if (option && typeof option === 'object') {
          return String(option?.label ?? '').trim()
        }

        return ''
      })
      .filter(Boolean),
  )]
}

export function normalizeProgressDetailOptionStyles(optionStyles) {
  const stylesByLabel = new Map()

  ;(Array.isArray(optionStyles) ? optionStyles : []).forEach((entry) => {
    const label = String(
      (entry && typeof entry === 'object')
        ? entry?.label
        : entry,
    ).trim()

    if (!label || stylesByLabel.has(label)) {
      return
    }

    const normalizedEntry = entry && typeof entry === 'object'
      ? entry
      : {}
    const color = String(normalizedEntry?.color ?? '').trim() || null
    const border = String(normalizedEntry?.border ?? '').trim() || null
    const varName = String(
      normalizedEntry?.varName
      ?? normalizedEntry?.var_name
      ?? '',
    ).trim() || null

    stylesByLabel.set(label, {
      label,
      color,
      border,
      varName,
    })
  })

  return [...stylesByLabel.values()]
}

export function normalizeProgressStatusDetails(details, optionsByColumnId = {}) {
  return (Array.isArray(details) ? details : []).map((entry) => {
    const columnId = String(entry?.columnId ?? '').trim() || null
    const metadataOptions = columnId
      ? optionsByColumnId?.[columnId]
      : []
    const optionStyles = normalizeProgressDetailOptionStyles([
      ...normalizeProgressDetailOptionStyles(metadataOptions),
      ...normalizeProgressDetailOptionStyles(entry?.optionStyles),
    ])
    const options = normalizeProgressDetailOptions([
      ...normalizeProgressDetailOptions(metadataOptions),
      ...normalizeProgressDetailOptions(entry?.options),
      ...optionStyles.map((style) => style.label),
    ])

    return {
      key: String(entry?.key ?? '').trim() || null,
      label: String(entry?.label ?? '').trim() || null,
      weight: Number.isFinite(Number(entry?.weight)) ? Number(entry.weight) : 0,
      columnId,
      status: String(entry?.status ?? '').trim() || null,
      options,
      optionStyles,
    }
  })
}

export function resolveMondayProgressStatusLabel({
  status,
  columnId,
  optionsByColumnId,
}) {
  const requestedStatus = String(status ?? '').trim()

  if (!requestedStatus) {
    return {
      ok: true,
      statusLabel: '',
    }
  }

  const allowedOptions = normalizeProgressDetailOptions(optionsByColumnId?.[columnId])

  if (allowedOptions.length === 0) {
    return {
      ok: false,
      error: 'This stage does not expose status options in Monday.',
    }
  }

  const normalizeStatusMatchKey = (value) => String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

  const normalizedRequestedStatus = normalizeStatusMatchKey(requestedStatus)
  const directMatchedOption = allowedOptions.find((option) => (
    normalizeStatusMatchKey(option) === normalizedRequestedStatus
  ))

  if (directMatchedOption) {
    return {
      ok: true,
      statusLabel: directMatchedOption,
    }
  }

  const normalizedWebsiteStatus = normalizeWebsiteProgressStatus(requestedStatus)
  const websiteMatchedOption = normalizedWebsiteStatus
    ? allowedOptions.find((option) => (
      normalizeWebsiteProgressStatus(option) === normalizedWebsiteStatus
    ))
    : ''

  if (websiteMatchedOption) {
    return {
      ok: true,
      statusLabel: websiteMatchedOption,
    }
  }

  const allowedOptionsPreview = allowedOptions
    .slice(0, 8)
    .join(', ')
  const hasMoreOptions = allowedOptions.length > 8
    ? ', ...'
    : ''

  return {
    ok: false,
    error: `Selected status is not valid for this stage. Use one of: ${allowedOptionsPreview}${hasMoreOptions}`,
  }
}

export function buildProgressStatusQueueRequestKey(mondayItemId, columnId) {
  return `${String(mondayItemId ?? '').trim()}:${String(columnId ?? '').trim()}`
}

export function normalizeQueuedProgressStatusValue(value) {
  return String(value ?? '').trim()
}

// Single write path into the Monday push queue: latest update per
// item+column wins, used by the bulk save and by the single-update
// fallback when Monday is unreachable.
export async function enqueueMondayProgressStatusUpdates({
  queueCollection,
  updates,
  queuedByUid = null,
  queuedByEmail = null,
}) {
  const now = new Date().toISOString()
  const latestUpdateByRequestKey = new Map()

  ;(Array.isArray(updates) ? updates : []).forEach((entry) => {
    const mondayItemId = String(entry?.mondayItemId ?? '').trim()
    const columnId = String(entry?.columnId ?? '').trim()

    if (!mondayItemId || !columnId) {
      return
    }

    const requestKey = buildProgressStatusQueueRequestKey(mondayItemId, columnId)

    latestUpdateByRequestKey.set(requestKey, {
      requestKey,
      mondayItemId,
      columnId,
      status: normalizeQueuedProgressStatusValue(entry?.status),
    })
  })

  const queuedUpdates = [...latestUpdateByRequestKey.values()]

  if (queuedUpdates.length === 0) {
    return []
  }

  await queueCollection.bulkWrite(
    queuedUpdates.map((entry) => ({
      updateOne: {
        filter: {
          requestKey: entry.requestKey,
        },
        update: {
          $set: {
            requestKey: entry.requestKey,
            mondayItemId: entry.mondayItemId,
            columnId: entry.columnId,
            status: entry.status,
            statusState: 'queued',
            attempts: 0,
            queuedAt: now,
            nextAttemptAt: now,
            queuedByUid,
            queuedByEmail,
            lastError: null,
            resolvedStatusLabel: null,
            syncedAt: null,
            failedAt: null,
            updatedAt: now,
          },
          $setOnInsert: {
            id: randomUUID(),
            createdAt: now,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  )

  return queuedUpdates
}

// Applies a queued status to stored progress details so the website shows
// the edit immediately while the Monday push retries in the background.
export function applyStatusToStoredProgressDetails(rawDetails, columnId, status) {
  const normalizedColumnId = String(columnId ?? '').trim()

  return (Array.isArray(rawDetails) ? rawDetails : []).map((entry) => {
    if (String(entry?.columnId ?? '').trim() !== normalizedColumnId) {
      return entry
    }

    return {
      ...entry,
      status: String(status ?? '').trim() || null,
    }
  })
}

export function computeQueuedProgressStatusRetryAt(attemptNumber) {
  const attemptIndex = Math.max(0, Math.min(
    ordersProgressStatusQueueRetryDelaysSeconds.length - 1,
    Number(attemptNumber) - 1,
  ))
  const delaySeconds = ordersProgressStatusQueueRetryDelaysSeconds[attemptIndex]

  return new Date(Date.now() + delaySeconds * 1000).toISOString()
}

export function buildTrackedProgressStageStates(progressStatusDetails) {
  const statusByStageKey = new Map()

  ;(Array.isArray(progressStatusDetails) ? progressStatusDetails : []).forEach((entry) => {
    const normalizedStatus = normalizeWebsiteProgressStatus(entry?.status)

    if (!normalizedStatus) {
      return
    }

    const candidateKeys = [
      normalizeProgressStageKey(entry?.key),
      normalizeProgressStageKey(entry?.label),
    ]

    candidateKeys.forEach((candidateKey) => {
      if (!candidateKey || !fixedOrderProgressStageKeySet.has(candidateKey) || statusByStageKey.has(candidateKey)) {
        return
      }

      statusByStageKey.set(candidateKey, normalizedStatus)
    })
  })

  return fixedOrderProgressStages
    .map((stage, index) => {
      const status = statusByStageKey.get(stage.key)

      if (!status) {
        return null
      }

      return {
        key: stage.key,
        label: stage.label,
        index,
        status,
      }
    })
    .filter(Boolean)
}

export function resolveNewestTrackedProgressStage(progressStatusDetails) {
  const trackedStages = buildTrackedProgressStageStates(progressStatusDetails)

  if (trackedStages.length === 0) {
    return null
  }

  return trackedStages[trackedStages.length - 1]
}

export function buildTrackedProgressRowStatusLabel(progressStatusDetails) {
  const latestTrackedStage = resolveNewestTrackedProgressStage(progressStatusDetails)

  if (!latestTrackedStage) {
    return null
  }

  if (latestTrackedStage.key === 'ready' && latestTrackedStage.status === 'done') {
    return 'Ready'
  }

  if (latestTrackedStage.status === 'done') {
    return `${latestTrackedStage.label} ready`
  }

  if (latestTrackedStage.status === 'working') {
    return `${latestTrackedStage.label} working on it`
  }

  if (latestTrackedStage.status === 'stuck') {
    return `${latestTrackedStage.label} stuck`
  }

  return null
}

export function sanitizeStorageSegment(value, fallback = 'unknown') {
  const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_')

  if (!normalized) {
    return fallback
  }

  return normalized.slice(0, 120)
}

export function sanitizeDownloadFileName(value, fallbackFileName = 'invoice.pdf') {
  const normalized = String(value ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-')

  if (!normalized) {
    return fallbackFileName
  }

  return normalized
}

export function ensurePdfFileName(value, fallbackFileName = 'invoice.pdf') {
  const safeFileName = sanitizeDownloadFileName(value, fallbackFileName)

  if (/\.pdf$/i.test(safeFileName)) {
    return safeFileName
  }

  return `${safeFileName}.pdf`
}

export function resolveRowStatusLabel({
  hasMondayRecord,
  inDesign,
  isShipped,
  mondayStatus,
  progressStatusDetails,
}) {
  if (!hasMondayRecord && !inDesign) {
    return 'Not in Monday'
  }

  if (isShipped) {
    return 'Shipped'
  }

  if (inDesign) {
    return 'In Design'
  }

  const trackedProgressStatusLabel = buildTrackedProgressRowStatusLabel(progressStatusDetails)

  if (trackedProgressStatusLabel) {
    return trackedProgressStatusLabel
  }

  return String(mondayStatus ?? '').trim() || 'Open'
}

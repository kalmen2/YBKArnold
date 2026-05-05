// Pure helpers used by the orders unified refresh — text/lookup/key building,
// status history matching, order-number extraction. No I/O, no side effects.

export function normalizeText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength)
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

export function toBooleanOrNull(value) {
  return typeof value === 'boolean' ? value : null
}

export function toTimestampMs(value) {
  const ts = Date.parse(normalizeText(value, 80))
  return Number.isFinite(ts) ? ts : null
}

export function extractOrderNumberToken(value) {
  const matches = normalizeText(value, 1000).match(/\d{4,}/g)
  if (!Array.isArray(matches) || matches.length === 0) {
    return null
  }
  let best = ''
  for (const match of matches) {
    const token = String(match ?? '').trim()
    if (token && token.length > best.length) {
      best = token
    }
  }
  return best || null
}

export function normalizeOrderNumberKey(value) {
  return normalizeText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

export function buildOrderLookupValues(values) {
  const normalizedValues = new Set()
  const digitValues = new Set()

  ;(Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = normalizeLookupToken(value)
    if (normalized) {
      normalizedValues.add(normalized)
    }
    const digits = extractOrderNumberToken(value)
    if (digits) {
      digitValues.add(digits)
    }
  })

  return { normalizedValues, digitValues }
}

export function shouldUseQuickBooksOrderNumberForKey(value) {
  const normalized = normalizeText(value, 120)
  return normalized ? /\d/.test(normalized) : false
}

export function buildOrderKey({ orderNumber, mondayItemId, quickBooksProjectId }) {
  const normalized = normalizeOrderNumberKey(orderNumber)
  if (normalized) {
    return `order:${normalized}`
  }
  const mondayId = normalizeText(mondayItemId, 120)
  if (mondayId) {
    return `monday:${mondayId}`
  }
  const projectId = normalizeText(quickBooksProjectId, 120)
  if (projectId) {
    return `quickbooks:${projectId}`
  }
  return null
}

export function resolveOrderNumberFromMondayOrder(orderDocument) {
  const explicit = normalizeText(orderDocument?.jobNumber, 120)
  if (explicit) {
    return explicit
  }
  return extractOrderNumberToken(normalizeText(orderDocument?.orderName, 260))
}

export function isShippedOrderDocument(orderDocument, shippedBoardId) {
  const normalizedShippedBoardId = normalizeText(shippedBoardId, 120)
  const boardId = normalizeText(orderDocument?.mondayBoardId, 120)
  const movedToShippedAt = normalizeText(orderDocument?.movedToShippedAt, 80)
  const statusLabel = normalizeText(orderDocument?.statusLabel, 260).toLowerCase()

  if (normalizedShippedBoardId && boardId === normalizedShippedBoardId) {
    return true
  }
  if (movedToShippedAt) {
    return true
  }
  if (/\bnot\s+shipped\b/.test(statusLabel)) {
    return false
  }
  return /\bshipped\b/.test(statusLabel)
}

// ---- Status history (manager progress) ---------------------------------

function toStatusHistoryEntry(progressDocument) {
  return {
    id: normalizeText(progressDocument?.id ?? progressDocument?._id, 200) || null,
    date: normalizeText(progressDocument?.date, 80) || null,
    jobName: normalizeText(progressDocument?.jobName, 260) || null,
    readyPercent: Number.isFinite(Number(progressDocument?.readyPercent))
      ? Number(progressDocument.readyPercent)
      : null,
    updatedAt: normalizeText(progressDocument?.updatedAt, 80) || null,
  }
}

export function buildStatusHistoryLookups(orderProgressDocuments) {
  const byNormalized = new Map()
  const byDigits = new Map()

  const push = (map, key, row) => {
    if (!key) return
    const existing = map.get(key)
    if (existing) {
      existing.push(row)
    } else {
      map.set(key, [row])
    }
  }

  ;(Array.isArray(orderProgressDocuments) ? orderProgressDocuments : []).forEach((doc) => {
    const row = toStatusHistoryEntry(doc)
    push(byNormalized, normalizeLookupToken(doc?.jobName), row)
    push(byDigits, extractOrderNumberToken(doc?.jobName), row)
  })

  return { byNormalized, byDigits }
}

export function resolveStatusHistoryForOrder(orderRow, lookups) {
  const lookup = buildOrderLookupValues([
    orderRow?.order_number,
    orderRow?.order_name,
    orderRow?.monday_item_id,
    orderRow?.qb_project_name,
  ])
  const matches = []

  for (const value of lookup.normalizedValues) {
    const rows = lookups.byNormalized.get(value)
    if (Array.isArray(rows)) {
      matches.push(...rows)
    }
  }
  for (const value of lookup.digitValues) {
    const rows = lookups.byDigits.get(value)
    if (Array.isArray(rows)) {
      matches.push(...rows)
    }
  }

  if (matches.length === 0) {
    return []
  }

  const deduped = new Map()
  matches.forEach((row) => {
    const key = `${row.id || 'na'}::${row.date || 'na'}::${row.jobName || 'na'}::${row.updatedAt || 'na'}`
    if (!deduped.has(key)) {
      deduped.set(key, row)
    }
  })

  return [...deduped.values()]
    .sort((left, right) => {
      const ldMs = toTimestampMs(left.date)
      const rdMs = toTimestampMs(right.date)
      if (Number.isFinite(ldMs) && Number.isFinite(rdMs) && ldMs !== rdMs) {
        return rdMs - ldMs
      }
      const luMs = toTimestampMs(left.updatedAt)
      const ruMs = toTimestampMs(right.updatedAt)
      if (Number.isFinite(luMs) && Number.isFinite(ruMs) && luMs !== ruMs) {
        return ruMs - luMs
      }
      return String(right.jobName ?? '').localeCompare(String(left.jobName ?? ''))
    })
    .slice(0, 60)
}

// ---- Targeted name-only lookups (for shipped + design boards) -----------

export function buildNameLookupFromMondayItems(items) {
  const byNormalized = new Map()
  const byDigits = new Map()

  ;(Array.isArray(items) ? items : []).forEach((item) => {
    const normalized = normalizeLookupToken(item?.name)
    const digits = extractOrderNumberToken(item?.name)
    if (normalized && !byNormalized.has(normalized)) {
      byNormalized.set(normalized, item)
    }
    if (digits && !byDigits.has(digits)) {
      byDigits.set(digits, item)
    }
  })

  return { byNormalized, byDigits }
}

export function findNameLookupMatch(row, lookup) {
  const candidates = buildOrderLookupValues([
    row?.order_number,
    row?.order_name,
    row?.qb_project_name,
    row?.monday_item_id,
  ])

  for (const value of candidates.normalizedValues) {
    const match = lookup.byNormalized.get(value)
    if (match) return match
  }
  for (const value of candidates.digitValues) {
    const match = lookup.byDigits.get(value)
    if (match) return match
  }

  return null
}

// ---- Unified row shape --------------------------------------------------

export function createEmptyUnifiedOrder(orderKey) {
  return {
    orderKey,
    order_number: null,
    monday_item_id: null,
    Monday_url: null,
    Monday_status: null,
    order_name: null,
    is_shipped: false,
    status: [],
    Due_date: null,
    Lead_time_days: null,
    progress_percent: null,
    order_date: null,
    Shop_drawing_cached: null,
    Shop_drawing_source: null,
    Shop_drawing: null,
    amountOwed: null,
    billAmount: null,
    billedAmount: null,
    billBalanceAmount: null,
    invoiceAmount: null,
    paymentAmount: null,
    invoiceNumber: null,
    paidInFull: null,
    poAmount: null,
    shipped_at: null,
    has_monday_record: false,
    has_quickbooks_record: false,
    in_design: false,
    hazard_reason: null,
    source: null,
    qb_project_id: null,
    qb_project_name: null,
    qb_project_ids: [],
    qb_project_names: [],
    monday_board_id: null,
    monday_board_name: null,
    monday_updated_at: null,
    manager_ready_percent: null,
    manager_ready_date: null,
    manager_ready_updated_at: null,
    quickbooks_synced_at: null,
  }
}

export function hydrateUnifiedRowFromStoredDocument(stored) {
  const orderKey = normalizeText(stored?.orderKey, 200)
  if (!orderKey) {
    return null
  }

  const fields = { ...(stored ?? {}) }
  delete fields._id
  delete fields.createdAt
  delete fields.updatedAt
  delete fields.lastSyncedAt

  const singleProjectId = normalizeText(fields?.qb_project_id, 120)
  const singleProjectName = normalizeText(fields?.qb_project_name, 260)
  const projectIdsFromArray = Array.isArray(fields?.qb_project_ids)
    ? fields.qb_project_ids
      .map((value) => normalizeText(value, 120))
      .filter(Boolean)
    : []
  const projectNamesFromArray = Array.isArray(fields?.qb_project_names)
    ? fields.qb_project_names
      .map((value) => normalizeText(value, 260))
      .filter(Boolean)
    : []
  const qbProjectIds = [...new Set(singleProjectId ? [singleProjectId, ...projectIdsFromArray] : projectIdsFromArray)]
  const qbProjectNames = [...new Set(singleProjectName ? [singleProjectName, ...projectNamesFromArray] : projectNamesFromArray)]

  return {
    ...createEmptyUnifiedOrder(orderKey),
    ...fields,
    orderKey,
    status: Array.isArray(fields?.status) ? fields.status : [],
    is_shipped: Boolean(fields?.is_shipped),
    has_monday_record: Boolean(fields?.has_monday_record),
    has_quickbooks_record: Boolean(fields?.has_quickbooks_record),
    in_design: Boolean(fields?.in_design),
    amountOwed: Number.isFinite(Number(fields?.amountOwed)) ? Number(fields.amountOwed) : null,
    billAmount: Number.isFinite(Number(fields?.billAmount)) ? Number(fields.billAmount) : null,
    billedAmount: Number.isFinite(Number(fields?.billedAmount)) ? Number(fields.billedAmount) : null,
    billBalanceAmount: Number.isFinite(Number(fields?.billBalanceAmount))
      ? Number(fields.billBalanceAmount)
      : null,
    invoiceAmount: Number.isFinite(Number(fields?.invoiceAmount)) ? Number(fields.invoiceAmount) : null,
    paymentAmount: Number.isFinite(Number(fields?.paymentAmount)) ? Number(fields.paymentAmount) : null,
    poAmount: Number.isFinite(Number(fields?.poAmount)) ? Number(fields.poAmount) : null,
    paidInFull: toBooleanOrNull(fields?.paidInFull),
    qb_project_ids: qbProjectIds,
    qb_project_names: qbProjectNames,
  }
}

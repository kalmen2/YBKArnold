// Pure helpers used by the orders unified refresh — text/lookup/key building,
// status history matching, order-number extraction. No I/O, no side effects.

import {
  normalizeLookupToken,
  normalizeText,
  toIsoOrNull,
  toTimestampMs,
} from '../utils/value-utils.mjs'

export { normalizeLookupToken, normalizeText, toIsoOrNull, toTimestampMs }

export function toBooleanOrNull(value) {
  return typeof value === 'boolean' ? value : null
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

// Preserve meaningful suffixes used for rework/claim orders. A digits-only
// lookup makes 250610, 250610R, and 250610R_2 indistinguishable.
export function extractOrderNumberReference(value) {
  const matches = normalizeText(value, 1000).match(/\d{4,}(?:(?:[a-z][a-z0-9]*)|(?:[_-][a-z0-9]+))*/gi)

  if (!Array.isArray(matches) || matches.length === 0) {
    return null
  }

  let best = ''

  for (const match of matches) {
    const candidate = String(match ?? '').trim()

    if (normalizeOrderNumberKey(candidate).length > normalizeOrderNumberKey(best).length) {
      best = candidate
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
  return extractOrderNumberReference(normalizeText(orderDocument?.orderName, 260))
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
  const byOrderNumberKey = new Map()

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
    push(
      byOrderNumberKey,
      normalizeOrderNumberKey(extractOrderNumberReference(doc?.jobName)),
      row,
    )
  })

  return { byNormalized, byDigits, byOrderNumberKey }
}

export function resolveStatusHistoryForOrder(orderRow, lookups) {
  const explicitOrderNumberKey = normalizeOrderNumberKey(
    extractOrderNumberReference(orderRow?.order_number),
  )

  // An order suffix identifies a separate production job. Always resolve
  // manager progress by the complete order number first, so 250203,
  // 250203R, and 250203R_2 never inherit one another's operational history.
  if (explicitOrderNumberKey) {
    const exactRows = lookups.byOrderNumberKey?.get(explicitOrderNumberKey)
    return sortAndDedupeStatusHistory(exactRows)
  }

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

  return sortAndDedupeStatusHistory(matches)
}

function sortAndDedupeStatusHistory(rows) {
  const deduped = new Map()

  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
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

// ---- Strict Monday order-number lookups ---------------------------------
//
// ACK is the authoritative order number.  A Monday item's mutable name is
// only a fallback when its ACK is blank.  Never use a digits-only key here:
// 260306-A, 260306-B, and 260306-C are different orders.

// ACK and name are kept in SEPARATE tiers.  Merging them would let an item
// whose ACK is blank collide with an item whose ACK genuinely holds that
// number, and report a duplicate where the ACK match should simply win.
export function buildMondayOrderNumberLookup(items, getAck) {
  const byAck = new Map()
  const byName = new Map()

  const push = (map, key, item) => {
    if (!key) return
    const matches = map.get(key)
    if (matches) {
      matches.push(item)
    } else {
      map.set(key, [item])
    }
  }

  ;(Array.isArray(items) ? items : []).forEach((item) => {
    const ack = typeof getAck === 'function' ? getAck(item) : item?.jobNumber
    const ackKey = normalizeOrderNumberKey(normalizeText(ack, 120))

    if (ackKey) {
      push(byAck, ackKey, item)
      return
    }

    push(byName, normalizeOrderNumberKey(extractOrderNumberReference(item?.name)), item)
  })

  return { byAck, byName }
}

// Returns WHY a match failed, not just that it did.  'not_found' and
// 'duplicate' need different handling: the first may be a Monday item nobody
// created yet, the second is a data conflict a person has to resolve.
export function resolveMondayOrderMatch(row, lookup) {
  const orderNumberKey = normalizeOrderNumberKey(row?.order_number)

  if (!orderNumberKey) {
    return { status: 'not_found', item: null, linkSource: null, candidates: [] }
  }

  const tiers = [
    { source: 'ack', matches: lookup?.byAck?.get(orderNumberKey) ?? [] },
    { source: 'name_inferred', matches: lookup?.byName?.get(orderNumberKey) ?? [] },
  ]

  for (const tier of tiers) {
    if (tier.matches.length === 1) {
      return {
        status: 'ok',
        item: tier.matches[0],
        linkSource: tier.source,
        candidates: [],
      }
    }

    if (tier.matches.length > 1) {
      return {
        status: 'duplicate',
        item: null,
        linkSource: tier.source,
        candidates: tier.matches.map(toMondayCandidate),
      }
    }
  }

  return { status: 'not_found', item: null, linkSource: null, candidates: [] }
}

function toMondayCandidate(item) {
  return {
    itemId: normalizeText(item?.id, 120) || null,
    name: normalizeText(item?.name, 260) || null,
  }
}

export function findUniqueMondayOrderMatch(row, lookup) {
  const result = resolveMondayOrderMatch(row, lookup)
  return result.status === 'ok' ? result.item : null
}

// ---- Unified row shape --------------------------------------------------

export function createEmptyUnifiedOrder(orderKey) {
  return {
    orderKey,
    order_number: null,
    monday_item_id: null,
    Monday_url: null,
    Monday_status: null,
    job_status: null,
    order_name: null,
    ship_to: null,
    ship_notes: null,
    bol: null,
    BOL_cached: null,
    BOL_source: null,
    BOL: null,
    signed_bol: null,
    Signed_BOL_source: null,
    Signed_BOL: null,
    inspection_sheet: null,
    Inspection_sheet_source: null,
    Inspection_sheet: null,
    po_number: null,
    monday_notes: null,
    monday_description: null,
    is_shipped: false,
    status: [],
    Due_date: null,
    Lead_time_days: null,
    progress_percent: null,
    progress_status_details: [],
    order_date: null,
    Shop_drawing_cached: null,
    Shop_drawing_source: null,
    Shop_drawing: null,
    Cut_list_cached: null,
    Cut_list_source: null,
    Cut_list: null,
    amountOwed: null,
    billAmount: null,
    billedAmount: null,
    billBalanceAmount: null,
    invoiceAmount: null,
    paymentAmount: null,
    invoiceNumber: null,
    paidInFull: null,
    poAmount: null,
    orderValue: null,
    freightValue: null,
    sales_rep: null,
    deposit_received_date: null,
    new_orders_board_id: null,
    new_orders_item_id: null,
    new_orders_financial_synced_at: null,
    shipped_at: null,
    shipped_at_inferred: null,
    has_monday_record: false,
    has_quickbooks_record: false,
    in_design: false,
    is_production_started: false,
    hazard_reason: null,
    source: null,
    qb_project_id: null,
    qb_project_name: null,
    qb_project_ids: [],
    qb_project_names: [],
    monday_board_id: null,
    monday_board_name: null,
    monday_updated_at: null,
    // Per-role Monday links.  An order legitimately has one production item
    // (Design -> Order Track -> Shipped) AND one financial item on New Orders.
    monday_production_item_id: null,
    monday_financial_item_id: null,
    monday_financial_board_id: null,
    monday_link_status: null,
    monday_link_source: null,
    monday_link_candidates: [],
    monday_link_history: [],
    monday_links_verified_at: null,
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
    progress_status_details: Array.isArray(fields?.progress_status_details)
      ? fields.progress_status_details
      : [],
    is_shipped: Boolean(fields?.is_shipped),
    has_monday_record: Boolean(fields?.has_monday_record),
    has_quickbooks_record: Boolean(fields?.has_quickbooks_record),
    in_design: Boolean(fields?.in_design),
    is_production_started: Boolean(fields?.is_production_started),
    amountOwed: Number.isFinite(Number(fields?.amountOwed)) ? Number(fields.amountOwed) : null,
    billAmount: Number.isFinite(Number(fields?.billAmount)) ? Number(fields.billAmount) : null,
    billedAmount: Number.isFinite(Number(fields?.billedAmount)) ? Number(fields.billedAmount) : null,
    billBalanceAmount: Number.isFinite(Number(fields?.billBalanceAmount))
      ? Number(fields.billBalanceAmount)
      : null,
    invoiceAmount: Number.isFinite(Number(fields?.invoiceAmount)) ? Number(fields.invoiceAmount) : null,
    paymentAmount: Number.isFinite(Number(fields?.paymentAmount)) ? Number(fields.paymentAmount) : null,
    poAmount: Number.isFinite(Number(fields?.poAmount)) ? Number(fields.poAmount) : null,
    orderValue: Number.isFinite(Number(fields?.orderValue ?? fields?.canonical_order_value))
      ? Number(fields.orderValue ?? fields.canonical_order_value)
      : null,
    freightValue: Number.isFinite(Number(fields?.freightValue ?? fields?.canonical_freight_value))
      ? Number(fields.freightValue ?? fields.canonical_freight_value)
      : null,
    paidInFull: toBooleanOrNull(fields?.paidInFull),
    shipped_at_inferred: toBooleanOrNull(fields?.shipped_at_inferred),
    qb_project_ids: qbProjectIds,
    qb_project_names: qbProjectNames,
  }
}

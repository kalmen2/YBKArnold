import { createHash, randomUUID as createRandomUuid, timingSafeEqual } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'
import { createTtlCache } from '../utils/ttl-cache.mjs'
import { normalizeText, nowIso } from '../utils/value-utils.mjs'

const _cache = createTtlCache()
const cacheGet = (key) => _cache.get(key)
const cacheSet = (key, value, ttlMs) => _cache.set(key, value, ttlMs)
const cacheDelete = (key) => _cache.delete(key)
const cacheDeleteByPrefix = (prefix) => _cache.deleteByPrefix(prefix)

const DEALERS_CACHE_PREFIX = 'crm:dealers:'
const OVERVIEW_CACHE_KEY = 'crm:overview'
const DEALERS_CACHE_TTL_MS = 10 * 60 * 1000  // 10 minutes
const OVERVIEW_CACHE_TTL_MS = 3 * 60 * 1000  // 3 minutes

const importConfirmText = 'I_UNDERSTAND_IMPORT_OVERWRITES'
const maxConflictGroupsInResponse = 200
const maxIdsPerConflictGroup = 25
const quoteStatuses = ['draft', 'sent', 'accepted', 'rejected', 'cancelled']
const opportunityStages = [
  'proposal_submission',
  'order_placement',
]
const orderStatuses = [
  'draft',
  'pending',
  'in_progress',
  'on_hold',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
]
const mondayNewOrders2026BoardId = '18393945685'
const mondayDesignAkfBoardId = '1064270065'
const mondayNewOrders2026ColumnIds = Object.freeze({
  ack: 'text9',
  salesRep: 'text_mm3x9wep',
  orderValue: 'numbers',
  freightValue: 'numbers5',
  poDate: 'date',
  poNumber: 'text2',
  description: 'text81',
  leadTimeDate: 'due_date',
  shipTo: 'location',
  notes: 'text95',
})
const mondayDesignAkfColumnIds = Object.freeze({
  designStatus: 'status',
  orderNumber: 'text9',
  poDate: 'date',
  poNumber: 'text2',
  description: 'text81',
  shipTo: 'location',
  notes: 'text95',
})
const usStateCodes = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]
const usStateCodeSet = new Set(usStateCodes)
const usStateNameByCode = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
}
const quoteProjectTypes = ['Reception Desk', 'Courtroom', 'Conference Table', 'Libraries', 'Other']
const crmRecordStatusActive = 'active'
const crmRecordStatusDeleted = 'deleted'

const toTrimmedText = (value, maxLength = 4000) => normalizeText(value, maxLength)

const toLowerText = (value, maxLength = 4000) => toTrimmedText(value, maxLength).toLowerCase()

function normalizeColumnTitle(value) {
  return toLowerText(value, 240).replace(/[^a-z0-9]+/g, ' ').trim()
}

function resolveBoardColumnId(columns, options = {}) {
  const {
    idCandidates = [],
    titleCandidates = [],
    preferredTypes = [],
  } = options

  const normalizedColumns = (Array.isArray(columns) ? columns : [])
    .map((column) => {
      const id = toTrimmedText(column?.id, 160)

      if (!id) {
        return null
      }

      return {
        id,
        normalizedId: id.toLowerCase(),
        normalizedTitle: normalizeColumnTitle(column?.title),
        type: toLowerText(column?.type, 120),
      }
    })
    .filter(Boolean)

  const normalizedIdCandidates = [...new Set(
    (Array.isArray(idCandidates) ? idCandidates : [])
      .map((value) => toLowerText(value, 160))
      .filter(Boolean),
  )]
  const normalizedTitleCandidates = [...new Set(
    (Array.isArray(titleCandidates) ? titleCandidates : [])
      .map((value) => normalizeColumnTitle(value))
      .filter(Boolean),
  )]
  const normalizedPreferredTypes = new Set(
    (Array.isArray(preferredTypes) ? preferredTypes : [])
      .map((value) => toLowerText(value, 120))
      .filter(Boolean),
  )

  const typeMatches = (entry) => {
    if (normalizedPreferredTypes.size === 0) {
      return true
    }

    return normalizedPreferredTypes.has(toLowerText(entry?.type, 120))
  }

  for (const candidateId of normalizedIdCandidates) {
    const match = normalizedColumns.find((entry) => entry.normalizedId === candidateId && typeMatches(entry))

    if (match?.id) {
      return match.id
    }
  }

  for (const candidateTitle of normalizedTitleCandidates) {
    const exactMatch = normalizedColumns.find(
      (entry) => entry.normalizedTitle === candidateTitle && typeMatches(entry),
    )

    if (exactMatch?.id) {
      return exactMatch.id
    }
  }

  for (const candidateTitle of normalizedTitleCandidates) {
    const looseMatch = normalizedColumns.find(
      (entry) => entry.normalizedTitle.includes(candidateTitle) && typeMatches(entry),
    )

    if (looseMatch?.id) {
      return looseMatch.id
    }
  }

  return null
}

function resolveAckColumnIdFromBoardColumns(columns, fallbackColumnId) {
  const resolved = resolveBoardColumnId(columns, {
    idCandidates: [fallbackColumnId, 'text9'],
    titleCandidates: [
      'ack',
      'ack #',
      'ack number',
      'acknowledgement number',
      'acknowledgment number',
      'order number',
    ],
  })

  return resolved || toTrimmedText(fallbackColumnId, 160) || null
}

function toIsoDateOrNull(value) {
  const normalized = toTrimmedText(value, 80)

  if (!normalized) {
    return null
  }

  const parsed = new Date(normalized)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString()
}

function toIsoDateOnlyOrNull(value) {
  const normalized = toTrimmedText(value, 80)

  if (!normalized) {
    return null
  }

  const parsed = new Date(normalized)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString().slice(0, 10)
}

function toBoolean(value) {
  if (value === true) {
    return true
  }

  if (value === false) {
    return false
  }

  const normalized = toLowerText(value, 20)

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false
  }

  return false
}

function toNullableBoolean(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (value === true) {
    return true
  }

  if (value === false) {
    return false
  }

  const normalized = toLowerText(value, 20)

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false
  }

  return null
}

function toOptionalArray(value) {
  return Array.isArray(value) ? value : []
}

function toOptionalObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value
}

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10)

  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback
  }

  return parsed
}

function toNumberOrNull(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function toNonNegativeNumberOrNull(value) {
  const parsed = toNumberOrNull(value)

  if (parsed === null || parsed < 0) {
    return null
  }

  return parsed
}

function toPercentInRangeOrNull(value) {
  const parsed = toNumberOrNull(value)

  if (parsed === null || parsed < 0 || parsed > 100) {
    return null
  }

  return Number(parsed.toFixed(2))
}

function normalizeStatus(value, allowedStatuses, fallbackStatus) {
  const normalized = toLowerText(value, 60)

  if (!normalized) {
    return fallbackStatus
  }

  return allowedStatuses.includes(normalized)
    ? normalized
    : null
}

function normalizeOpportunityStage(value, fallbackStage = 'proposal_submission') {
  const normalized = toLowerText(value, 80)

  if (normalized === 'revision') {
    return 'proposal_submission'
  }

  return normalizeStatus(normalized, opportunityStages, fallbackStage)
}

const quoteRevisionSnapshotFields = [
  'dealerSourceId',
  'dealerName',
  'dealerState',
  'companyName',
  'salesRep',
  'projectType',
  'opportunityDate',
  'contactSourceId',
  'contactName',
  'contactEmail',
  'contactPhone',
  'quoteNumber',
  'paymentTerms',
  'leadTime',
  'subtotal',
  'discountPercent',
  'discountAmount',
  'discountScope',
  'discountFreightAmount',
  'freight',
  'freightDescription',
  'lineItems',
  'additionalServices',
  'shippingServices',
  'title',
  'description',
  'origin',
  'sourceWorkbookUrl',
  'sourceWorkbookName',
  'convertedPdfUrl',
  'convertedPdfName',
  'trimble3d',
  'status',
  'totalAmount',
  'currency',
  'sentAt',
  'acceptedAt',
  'rejectedAt',
  'notes',
]

function parseQuoteRevisionIdentity(value) {
  const normalized = toTrimmedText(value, 120)
  const match = normalized.match(/^(.+?)(?:[-_\s]*)r(\d+)$/i)
  const baseQuoteNumber = toTrimmedText(match?.[1] || normalized, 110)
    .replace(/[-_\s]+$/g, '')

  return {
    baseQuoteNumber,
    revisionNumber: match ? toNonNegativeInteger(match[2], 0) : 0,
    hasRevisionSuffix: Boolean(match),
  }
}

function formatQuoteRevisionNumber(baseQuoteNumber, revisionNumber) {
  const normalizedBase = toTrimmedText(baseQuoteNumber, 110).replace(/[-_\s]+$/g, '')

  if (!normalizedBase) {
    return null
  }

  return `${normalizedBase}_R${toNonNegativeInteger(revisionNumber, 0)}`
}

function cloneQuoteRevisionValue(value) {
  if (value === undefined) {
    return undefined
  }

  return JSON.parse(JSON.stringify(value))
}

function buildQuoteRevisionSnapshot(source, options = {}) {
  const sourceObject = toOptionalObject(source)
  const parsedIdentity = parseQuoteRevisionIdentity(
    options.baseQuoteNumber || sourceObject.baseQuoteNumber || sourceObject.quoteNumber,
  )
  const revisionNumber = toNonNegativeInteger(
    options.revisionNumber ?? sourceObject.revisionNumber ?? parsedIdentity.revisionNumber,
    0,
  )
  const baseQuoteNumber = toTrimmedText(
    options.baseQuoteNumber || sourceObject.baseQuoteNumber || parsedIdentity.baseQuoteNumber,
    110,
  )
  const snapshot = {
    id: toTrimmedText(options.id || sourceObject.id, 160) || randomUUID(),
    revisionNumber,
    quoteNumber: formatQuoteRevisionNumber(baseQuoteNumber, revisionNumber),
  }

  for (const fieldName of quoteRevisionSnapshotFields) {
    if (fieldName === 'quoteNumber') {
      continue
    }

    if (Object.prototype.hasOwnProperty.call(sourceObject, fieldName)) {
      snapshot[fieldName] = cloneQuoteRevisionValue(sourceObject[fieldName])
    }
  }

  snapshot.createdAt = toTrimmedText(
    options.createdAt || sourceObject.createdAt || sourceObject.updatedAt,
    80,
  ) || nowIso()
  snapshot.createdByUid = toTrimmedText(
    options.createdByUid ?? sourceObject.createdByUid,
    160,
  ) || null
  snapshot.createdByEmail = toTrimmedText(
    options.createdByEmail ?? sourceObject.createdByEmail,
    200,
  ) || null
  snapshot.updatedAt = toTrimmedText(
    options.updatedAt || sourceObject.updatedAt,
    80,
  ) || snapshot.createdAt
  snapshot.updatedByUid = toTrimmedText(
    options.updatedByUid ?? sourceObject.updatedByUid,
    160,
  ) || null
  snapshot.updatedByEmail = toTrimmedText(
    options.updatedByEmail ?? sourceObject.updatedByEmail,
    200,
  ) || null

  return snapshot
}

function resolveQuoteRevisionState(quote) {
  const sourceQuote = toOptionalObject(quote)
  const parsedIdentity = parseQuoteRevisionIdentity(
    sourceQuote.baseQuoteNumber || sourceQuote.quoteNumber,
  )
  const baseQuoteNumber = toTrimmedText(
    sourceQuote.baseQuoteNumber || parsedIdentity.baseQuoteNumber,
    110,
  )
  const storedRevisions = Array.isArray(sourceQuote.revisions)
    ? sourceQuote.revisions
      .map((revision) => buildQuoteRevisionSnapshot(revision, { baseQuoteNumber }))
      .sort((left, right) => left.revisionNumber - right.revisionNumber)
    : []
  const fallbackActiveRevisionNumber = storedRevisions.length > 0
    ? storedRevisions[storedRevisions.length - 1].revisionNumber
    : parsedIdentity.revisionNumber
  const activeRevisionNumber = toNonNegativeInteger(
    sourceQuote.activeRevisionNumber,
    fallbackActiveRevisionNumber,
  )
  let revisions = storedRevisions

  if (revisions.length === 0) {
    revisions = [
      buildQuoteRevisionSnapshot(sourceQuote, {
        baseQuoteNumber,
        revisionNumber: activeRevisionNumber,
      }),
    ]
  } else {
    // The root quote intentionally mirrors the active revision for compatibility
    // with existing cards, exports, and integrations. Merge it back into the
    // active snapshot so changes made by older routes (such as 3D uploads) are
    // never lost.
    revisions = revisions.map((revision) => (
      revision.revisionNumber === activeRevisionNumber
        ? {
          ...revision,
          ...buildQuoteRevisionSnapshot(
            { ...revision, ...sourceQuote },
            {
              id: revision.id,
              baseQuoteNumber,
              revisionNumber: activeRevisionNumber,
              createdAt: revision.createdAt,
              createdByUid: revision.createdByUid,
              createdByEmail: revision.createdByEmail,
            },
          ),
        }
        : revision
    ))
  }

  return {
    baseQuoteNumber,
    activeRevisionNumber,
    revisionCount: Math.max(0, ...revisions.map((revision) => revision.revisionNumber)),
    revisions,
  }
}

function normalizeQuoteOpportunityStageForResponse(quote) {
  if (!quote || typeof quote !== 'object') {
    return quote
  }

  const revisionState = resolveQuoteRevisionState(quote)

  return {
    ...quote,
    ...revisionState,
    quoteNumber: formatQuoteRevisionNumber(
      revisionState.baseQuoteNumber,
      revisionState.activeRevisionNumber,
    ) || quote.quoteNumber,
    opportunityStage: normalizeOpportunityStage(
      quote.opportunityStage,
      'proposal_submission',
    ) || 'proposal_submission',
  }
}

function inferProgressFromOrderStatus(status, fallbackProgress = 0) {
  if (status === 'draft') {
    return 0
  }

  if (status === 'pending') {
    return 5
  }

  if (status === 'in_progress') {
    return 45
  }

  if (status === 'on_hold') {
    return Math.max(0, Math.min(100, Number(fallbackProgress) || 0))
  }

  if (status === 'ready_to_ship') {
    return 90
  }

  if (status === 'shipped') {
    return 98
  }

  if (status === 'delivered' || status === 'cancelled') {
    return 100
  }

  return Math.max(0, Math.min(100, Number(fallbackProgress) || 0))
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildContainsRegex(value, maxLength = 180) {
  const normalized = toTrimmedText(value, maxLength)

  if (!normalized) {
    return null
  }

  return new RegExp(escapeRegex(normalized), 'i')
}

function combineFilterClauses(clauses) {
  const normalizedClauses = clauses.filter(Boolean)

  if (normalizedClauses.length === 0) {
    return {}
  }

  if (normalizedClauses.length === 1) {
    return normalizedClauses[0]
  }

  return {
    $and: normalizedClauses,
  }
}

function resolveContactDisplayName(contact) {
  const name = toTrimmedText(contact?.name, 240)

  if (name) {
    return name
  }

  const firstName = toTrimmedText(contact?.firstName, 120)
  const lastName = toTrimmedText(contact?.lastName, 120)
  const fullName = `${firstName} ${lastName}`.trim()

  return fullName || null
}

function normalizeMetadata(metadataInput) {
  const metadata = toOptionalObject(metadataInput)

  return {
    exportedAt: toIsoDateOrNull(metadata.exported_at),
    source: toTrimmedText(metadata.source, 160),
    totalAccounts: toNonNegativeInteger(metadata.total_accounts),
    totalContacts: toNonNegativeInteger(metadata.total_contacts),
    linkedContacts: toNonNegativeInteger(metadata.contacts_linked_to_accounts),
    unlinkedContacts: toNonNegativeInteger(metadata.contacts_without_account),
  }
}

function normalizeSocialMediaLinks(input) {
  let sourceValue = input

  if (typeof sourceValue === 'string') {
    const normalizedText = toTrimmedText(sourceValue, 4000)

    if (!normalizedText) {
      return {}
    }

    try {
      sourceValue = JSON.parse(normalizedText)
    } catch {
      return {}
    }
  }

  const sourceObject = toOptionalObject(sourceValue)
  const normalizedLinks = {}

  for (const [rawKey, rawValue] of Object.entries(sourceObject)) {
    const key = toLowerText(rawKey, 80)
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80)
    const value = toTrimmedText(rawValue, 600)

    if (!key || !value) {
      continue
    }

    normalizedLinks[key] = value
  }

  return normalizedLinks
}

function toCompactSocialMediaText(links) {
  const sourceObject = toOptionalObject(links)
  const normalizedEntries = Object.entries(sourceObject)
    .filter(([key, value]) => Boolean(toTrimmedText(key, 80) && toTrimmedText(value, 600)))
    .map(([key, value]) => `${key}: ${value}`)

  if (normalizedEntries.length === 0) {
    return ''
  }

  return normalizedEntries.join(' | ').slice(0, 2000)
}

function normalizeEmailList(input, maxItems = 12) {
  const sourceItems = Array.isArray(input)
    ? input
    : [input]

  const seen = new Set()
  const normalizedEmails = []

  for (const rawValue of sourceItems) {
    const nextEmail = toTrimmedText(rawValue, 200)

    if (!nextEmail) {
      continue
    }

    const dedupeKey = toLowerText(nextEmail, 200)

    if (!dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    normalizedEmails.push(nextEmail)

    if (normalizedEmails.length >= maxItems) {
      break
    }
  }

  return normalizedEmails
}

function normalizeUsStateCode(value) {
  const normalized = toTrimmedText(value, 4).toUpperCase()

  return usStateCodeSet.has(normalized)
    ? normalized
    : ''
}

function normalizeUsStateList(input) {
  const sourceItems = Array.isArray(input)
    ? input
    : [input]
  const seen = new Set()
  const normalizedStates = []

  for (const rawValue of sourceItems) {
    const nextState = normalizeUsStateCode(rawValue)

    if (!nextState || seen.has(nextState)) {
      continue
    }

    seen.add(nextState)
    normalizedStates.push(nextState)
  }

  return normalizedStates.sort((left, right) => left.localeCompare(right))
}

function normalizeDelimitedTextList(input, maxItemLength = 200, maxItems = 250) {
  const sourceItems = Array.isArray(input)
    ? input
    : [input]
  const seen = new Set()
  const normalizedValues = []

  for (const sourceItem of sourceItems) {
    const segments = String(sourceItem ?? '')
      .split(',')

    for (const segment of segments) {
      const nextValue = toTrimmedText(segment, maxItemLength)

      if (!nextValue) {
        continue
      }

      const dedupeKey = toLowerText(nextValue, maxItemLength)

      if (!dedupeKey || seen.has(dedupeKey)) {
        continue
      }

      seen.add(dedupeKey)
      normalizedValues.push(nextValue)

      if (normalizedValues.length >= maxItems) {
        return normalizedValues
      }
    }
  }

  return normalizedValues
}

function normalizeProjectType(value) {
  const normalized = toLowerText(value, 120)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return null
  }

  if (
    normalized === 'conference'
    || normalized === 'table'
    || normalized === 'conference table'
    || normalized.startsWith('conference ')
    || normalized.startsWith('table ')
  ) {
    return 'Conference Table'
  }

  if (
    normalized === 'reception desk'
    || normalized === 'reception'
    || normalized.startsWith('reception desk ')
  ) {
    return 'Reception Desk'
  }

  if (normalized === 'courtroom' || normalized === 'court room' || normalized.startsWith('courtroom ')) {
    return 'Courtroom'
  }

  if (/\blibrar(?:y|ies)\b/.test(normalized)) {
    return 'Libraries'
  }

  if (normalized === 'other' || normalized.startsWith('other ')) {
    return 'Other'
  }

  return null
}

function normalizeQuoteLifecycle(value) {
  const normalized = toLowerText(value, 60)
    .replace(/[\s-]+/g, '_')

  if (!normalized || normalized === 'all') {
    return 'all'
  }

  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'cancelled'
  }

  if (normalized === 'converted' || normalized === 'accepted' || normalized === 'order_placement') {
    return 'converted'
  }

  if (normalized === 'rejected') {
    return 'rejected'
  }

  if (normalized === 'open' || normalized === 'active') {
    return 'open'
  }

  return 'all'
}

function buildExactStateRegexes(states) {
  return states.map((stateCode) => new RegExp(`^${escapeRegex(stateCode)}$`, 'i'))
}

function normalizeCrmRecordStatus(value) {
  const normalized = toLowerText(value, 32)

  return normalized === crmRecordStatusDeleted
    ? crmRecordStatusDeleted
    : crmRecordStatusActive
}

function normalizeUidList(input, maxItems = 25) {
  const sourceItems = Array.isArray(input)
    ? input
    : [input]
  const seen = new Set()
  const normalized = []

  for (const rawValue of sourceItems) {
    const value = toTrimmedText(rawValue, 200)

    if (!value) {
      continue
    }

    if (seen.has(value)) {
      continue
    }

    seen.add(value)
    normalized.push(value)

    if (normalized.length >= maxItems) {
      break
    }
  }

  return normalized
}

function normalizeReminderDate(value) {
  const normalized = toTrimmedText(value, 16)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return ''
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`)

  if (Number.isNaN(parsed.getTime())) {
    return ''
  }

  return normalized
}

function normalizeChatReminderInput(input) {
  const source = toOptionalObject(input)
  const dueDate = normalizeReminderDate(source.dueDate)

  if (!dueDate) {
    return null
  }

  return {
    dueDate,
    note: toTrimmedText(source.note, 500) || null,
    targetUserUids: normalizeUidList(source.targetUserUids, 25),
  }
}

function normalizeQuoteDocuments(input) {
  if (!Array.isArray(input)) {
    return []
  }

  const maxDocuments = 500
  const normalizedDocuments = []
  const seenUrls = new Set()

  for (const rawDocument of input) {
    const documentEntry = toOptionalObject(rawDocument)
    const url = toTrimmedText(documentEntry.url ?? documentEntry.documentUrl, 2000)

    if (!url) {
      continue
    }

    const dedupeKey = toLowerText(url, 2000)

    if (!dedupeKey || seenUrls.has(dedupeKey)) {
      continue
    }

    seenUrls.add(dedupeKey)

    normalizedDocuments.push({
      url,
      name: toTrimmedText(documentEntry.name ?? documentEntry.documentName, 1200) || null,
    })

    if (normalizedDocuments.length >= maxDocuments) {
      break
    }
  }

  return normalizedDocuments
}

function extractFirebaseStorageObjectFromUrl(rawUrl) {
  const normalizedUrl = toTrimmedText(rawUrl, 4000)

  if (!normalizedUrl) {
    return null
  }

  let parsed

  try {
    parsed = new URL(normalizedUrl)
  } catch {
    return null
  }

  if (String(parsed.hostname ?? '').toLowerCase() !== 'firebasestorage.googleapis.com') {
    return null
  }

  const pathMatch = String(parsed.pathname ?? '').match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/)

  if (!pathMatch) {
    return null
  }

  const bucketName = decodeURIComponent(String(pathMatch[1] ?? '')).trim()
  const objectPath = decodeURIComponent(String(pathMatch[2] ?? '')).trim()

  if (!bucketName || !objectPath) {
    return null
  }

  return {
    bucketName,
    objectPath,
  }
}

function inferImageContentTypeFromObjectPath(objectPath) {
  const normalizedPath = toLowerText(objectPath, 2000)

  if (normalizedPath.endsWith('.png')) {
    return 'image/png'
  }

  if (normalizedPath.endsWith('.jpg') || normalizedPath.endsWith('.jpeg')) {
    return 'image/jpeg'
  }

  if (normalizedPath.endsWith('.webp')) {
    return 'image/webp'
  }

  if (normalizedPath.endsWith('.gif')) {
    return 'image/gif'
  }

  if (normalizedPath.endsWith('.bmp')) {
    return 'image/bmp'
  }

  if (normalizedPath.endsWith('.svg')) {
    return 'image/svg+xml'
  }

  return null
}

function resolveQuoteDocumentUrls(quote) {
  const source = toOptionalObject(quote)
  const urls = []
  const seen = new Set()
  const normalizedDocuments = normalizeQuoteDocuments(source.documents)

  for (const document of normalizedDocuments) {
    const url = toTrimmedText(document?.url, 2000)
    const dedupeKey = toLowerText(url, 2000)

    if (!url || !dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    urls.push(url)
  }

  const legacyUrls = [
    toTrimmedText(source.documentUrl ?? source.document_url, 2000),
    toTrimmedText(source.sourceWorkbookUrl, 2000),
    toTrimmedText(source.convertedPdfUrl, 2000),
    toTrimmedText(source.archivedPdfUrl, 2000),
  ]

  for (const revision of Array.isArray(source.revisions) ? source.revisions : []) {
    legacyUrls.push(...resolveQuoteDocumentUrls(revision))
  }

  for (const itemCollection of [source.lineItems, source.additionalServices, source.shippingServices]) {
    for (const item of Array.isArray(itemCollection) ? itemCollection : []) {
      for (const image of Array.isArray(item?.images) ? item.images : []) {
        legacyUrls.push(toTrimmedText(image?.url, 2000))
      }
    }
  }

  for (const url of legacyUrls) {
    const dedupeKey = toLowerText(url, 2000)

    if (!url || !dedupeKey || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    urls.push(url)
  }

  return urls
}

function resolveQuoteStorageTargets(quote) {
  const dedupe = new Set()
  const targets = []

  for (const url of resolveQuoteDocumentUrls(quote)) {
    const target = extractFirebaseStorageObjectFromUrl(url)

    if (!target) {
      continue
    }

    const dedupeKey = `${target.bucketName.toLowerCase()}::${target.objectPath.toLowerCase()}`

    if (dedupe.has(dedupeKey)) {
      continue
    }

    dedupe.add(dedupeKey)
    targets.push(target)
  }

  return targets
}

async function deleteQuoteStorageTargets(quote) {
  const targets = resolveQuoteStorageTargets(quote)

  return deleteResolvedQuoteStorageTargets(targets)
}

async function deleteGeneratedOrderStorageTargets(order) {
  const targets = [order?.deposit_request_url, order?.order_confirmation_url, order?.work_order_url, order?.proforma_invoice_url]
    .map((url) => extractFirebaseStorageObjectFromUrl(url))
    .filter((target) => target && target.objectPath.startsWith('crm/orders/'))
  return deleteResolvedQuoteStorageTargets(targets)
}

async function deleteResolvedQuoteStorageTargets(targets) {

  if (targets.length === 0) {
    return {
      attemptedCount: 0,
      deletedCount: 0,
      failedCount: 0,
    }
  }

  const storage = getStorage()
  const deletionResults = await Promise.all(
    targets.map(async (target) => {
      try {
        await storage
          .bucket(target.bucketName)
          .file(target.objectPath)
          .delete({ ignoreNotFound: true })

        return {
          ok: true,
        }
      } catch (error) {
        return {
          ok: false,
          bucketName: target.bucketName,
          objectPath: target.objectPath,
          message: error instanceof Error ? error.message : 'Unknown storage delete error.',
        }
      }
    }),
  )

  const deletedCount = deletionResults.filter((entry) => entry.ok).length
  const failures = deletionResults.filter((entry) => !entry.ok)

  if (failures.length > 0) {
    console.error('Quote document storage cleanup failed for one or more files.', {
      failedCount: failures.length,
      failures: failures.slice(0, 25),
    })
  }

  return {
    attemptedCount: targets.length,
    deletedCount,
    failedCount: failures.length,
  }
}

function normalizeQuoteLineItems(input) {
  if (!Array.isArray(input)) {
    return []
  }

  const maxLineItems = 500
  const normalizedLineItems = []

  for (const rawLineItem of input) {
    const lineItem = toOptionalObject(rawLineItem)
    const parentLineId = toTrimmedText(lineItem.parentLineId, 160) || null
    const detailLabel = toTrimmedText(lineItem.detailLabel, 240)
    const description = toTrimmedText(lineItem.description, 1000)
    const itemNumber = toNonNegativeInteger(lineItem.itemNumber, 0)
    const qty = toNumberOrNull(lineItem.qty)
    const unitPrice = toNumberOrNull(lineItem.unitPrice)
    const extPrice = toNumberOrNull(lineItem.extPrice)
    const images = []
    const seenImageUrls = new Set()

    for (const rawImage of !parentLineId && Array.isArray(lineItem.images) ? lineItem.images : []) {
      const image = toOptionalObject(rawImage)
      const url = toTrimmedText(image.url, 2000)
      const dedupeKey = toLowerText(url, 2000)

      if (!url || !dedupeKey || seenImageUrls.has(dedupeKey)) {
        continue
      }

      seenImageUrls.add(dedupeKey)
      images.push({
        id: toTrimmedText(image.id, 160) || createRandomUuid(),
        url,
        name: toTrimmedText(image.name, 500) || null,
        width: toNonNegativeInteger(image.width, 0) || null,
        height: toNonNegativeInteger(image.height, 0) || null,
        shape: ['square', 'landscape', 'wide', 'portrait'].includes(toLowerText(image.shape, 20))
          ? toLowerText(image.shape, 20)
          : null,
        displaySize: ['small', 'medium', 'large'].includes(toLowerText(image.displaySize, 20))
          ? toLowerText(image.displaySize, 20)
          : null,
        pdfLayout: (() => {
          const layout = toOptionalObject(image.pdfLayout)
          const x = toNumberOrNull(layout.x)
          const y = toNumberOrNull(layout.y)
          const width = toNumberOrNull(layout.width)

          if (x === null || y === null || width === null) {
            return null
          }

          return {
            x: Math.min(327, Math.max(0, Number(x.toFixed(2)))),
            y: Math.min(180, Math.max(0, Number(y.toFixed(2)))),
            width: Math.min(300, Math.max(48, Number(width.toFixed(2)))),
          }
        })(),
      })

      if (images.length >= 2) {
        break
      }
    }

    if (!detailLabel && !description && qty === null && unitPrice === null && extPrice === null && images.length === 0) {
      continue
    }

    normalizedLineItems.push({
      id: toTrimmedText(lineItem.id, 160) || createRandomUuid(),
      parentLineId,
      itemNumber,
      detailLabel: detailLabel || null,
      description: description || null,
      qty: parentLineId ? null : qty,
      unitPrice: parentLineId ? null : unitPrice,
      extPrice: parentLineId ? null : extPrice,
      images,
    })

    if (normalizedLineItems.length >= maxLineItems) {
      break
    }
  }

  return normalizedLineItems
}

function normalizeQuoteServiceItems(input) {
  if (!Array.isArray(input)) {
    return []
  }

  return input.slice(0, 50).map((rawItem) => {
    const item = toOptionalObject(rawItem)
    const qty = toNonNegativeNumberOrNull(item.qty)
    const unitPrice = toNonNegativeNumberOrNull(item.unitPrice)
    const extFromFields = qty !== null && unitPrice !== null
      ? Number((qty * unitPrice).toFixed(2))
      : null
    const extPrice = toNonNegativeNumberOrNull(item.extPrice) ?? extFromFields ?? toNonNegativeNumberOrNull(item.price)
    const images = normalizeQuoteLineItems([{
      id: item.id,
      description: item.description,
      images: item.images,
    }])[0]?.images || []

    return {
      id: toTrimmedText(item.id, 160) || createRandomUuid(),
      title: toTrimmedText(item.title, 240),
      description: toTrimmedText(item.description, 4000) || null,
      qty,
      unitPrice,
      extPrice,
      // Keep legacy field for compatibility with older consumers.
      price: extPrice,
      images,
    }
  }).filter((item) => (
    item.title
    || item.description
    || item.qty !== null
    || item.unitPrice !== null
    || item.extPrice !== null
    || item.images.length > 0
  ))
}

function normalizeExcelQuoteLineItems(input, existingLineItems) {
  const existing = normalizeQuoteLineItems(existingLineItems)
  const incoming = normalizeQuoteLineItems(input)

  // A workbook that was recognized but whose price grid was not understood
  // must never erase previously imported quote lines.
  if (incoming.length === 0 && existing.length > 0) {
    return existing
  }

  return incoming.map((lineItem, index) => {
    const matchingLine = existing.find((entry) => entry.id === lineItem.id)
      || existing.find((entry) => entry.itemNumber > 0 && entry.itemNumber === lineItem.itemNumber)
      || existing[index]

    return {
      ...lineItem,
      id: matchingLine?.id || lineItem.id,
      images: Array.isArray(matchingLine?.images) ? matchingLine.images : lineItem.images,
    }
  })
}

const defaultQuotePrintSettings = Object.freeze({
  id: 'default',
  logoUrl: 'https://ybkarnold.com/arnold-quote-mark.png',
  logoName: 'Arnold Contract mark',
  companyName: 'Arnold Contract',
  addressLines: ['120 Coit Street, Irvington, New Jersey 07111'],
  phone: '866-425-6529',
  email: null,
  website: 'ArnoldContract.us',
  headerText: null,
  footerText: 'Thank you for the opportunity to quote this project.',
  accentColor: '#0f4c81',
  showPaymentTerms: true,
  showLeadTime: true,
  showFreight: true,
  customerInformation: `Purchase Orders can be sent to sales@arnoldcontract.us.\nArnold Contract requires full payment as a deposit for all change orders, replacements, and add-ons prior to processing.\nAll items are shipped F.O.B. Factory, Irvington NJ.\nCustom-made and custom-finished furniture is non-cancelable and non-returnable. Please ensure specifications are correct before placing your order.\nArnold Contract reserves the right to correct clerical or pricing errors at any time.\nIt is the customer's responsibility to confirm that all furniture will fit into the designated elevator and building.\nCrated and knocked-down units will be shipped and must be installed on-site by the customer's installer.\nLead times are based on the volume of orders in-house when the quotation and deposit are received and may change.\nArnold Contract will acknowledge receipt of your PO and confirm order details once processed.`,
  projectManagers: 'Misha Patel, Jose Gonzalez',
  depositRequestBody: 'To begin processing this order, please send the 50% Product Net deposit shown above at your earliest convenience.',
  depositRequestTerms: 'Color samples and shop drawings must be received and approved when required. Delays in receiving required approvals may affect the stated lead time.\n\nCustom orders are final and cannot be returned, exchanged, or refunded.',
  orderConfirmationRequestedInfo: 'Please send the control sample to the address below:\n\nArnold Kolax Furniture Inc.\nAttn: Misha Patel (Ack # {ack})\n120 Coit Street, Irvington, NJ 07111',
  orderConfirmationNotes: 'Thank you for your order. We appreciate your business and look forward to working with you.',
  orderConfirmationTerms: 'Lead times begin after final approved shop drawings and finish samples are received.',
})

function normalizeQuoteOrigin(value, fallback = 'website') {
  return toLowerText(value, 20) === 'excel' ? 'excel' : fallback
}

function normalizeQuotePrintSettings(input, metadata = {}) {
  const source = toOptionalObject(input)
  const normalizeBoolean = (value, fallback) => {
    const parsed = toNullableBoolean(value)
    return parsed === null ? fallback : parsed
  }
  const accentColor = toTrimmedText(source.accentColor, 7)

  return {
    id: 'default',
    logoUrl: defaultQuotePrintSettings.logoUrl,
    logoName: defaultQuotePrintSettings.logoName,
    companyName: toTrimmedText(source.companyName, 240) || defaultQuotePrintSettings.companyName,
    addressLines: [...defaultQuotePrintSettings.addressLines],
    phone: defaultQuotePrintSettings.phone,
    email: toTrimmedText(source.email, 200) || null,
    website: defaultQuotePrintSettings.website,
    headerText: toTrimmedText(source.headerText, 1000) || null,
    footerText: toTrimmedText(source.footerText, 4000) || null,
    accentColor: /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor.toLowerCase() : defaultQuotePrintSettings.accentColor,
    showPaymentTerms: normalizeBoolean(source.showPaymentTerms, true),
    showLeadTime: normalizeBoolean(source.showLeadTime, true),
    showFreight: normalizeBoolean(source.showFreight, true),
    customerInformation: toTrimmedText(source.customerInformation, 8000) || defaultQuotePrintSettings.customerInformation,
    projectManagers: toTrimmedText(source.projectManagers, 1000) || defaultQuotePrintSettings.projectManagers,
    depositRequestBody: toTrimmedText(source.depositRequestBody, 8000) || defaultQuotePrintSettings.depositRequestBody,
    depositRequestTerms: toTrimmedText(source.depositRequestTerms, 8000) || defaultQuotePrintSettings.depositRequestTerms,
    orderConfirmationRequestedInfo: toTrimmedText(source.orderConfirmationRequestedInfo, 8000) || defaultQuotePrintSettings.orderConfirmationRequestedInfo,
    orderConfirmationNotes: toTrimmedText(source.orderConfirmationNotes, 8000) || defaultQuotePrintSettings.orderConfirmationNotes,
    orderConfirmationTerms: toTrimmedText(source.orderConfirmationTerms, 8000) || defaultQuotePrintSettings.orderConfirmationTerms,
    updatedAt: toIsoDateOrNull(metadata.updatedAt ?? source.updatedAt),
    updatedByEmail: toTrimmedText(metadata.updatedByEmail ?? source.updatedByEmail, 200) || null,
  }
}

const documentTermTypes = Object.freeze([
  'quote',
  'order_confirmation',
  'proforma_invoice',
  'work_order',
  'bill_of_lading',
  'change_order',
])
const documentTermTypeSet = new Set(documentTermTypes)

function buildDefaultDocumentTerms(settingsInput) {
  const settings = normalizeQuotePrintSettings(settingsInput || defaultQuotePrintSettings)
  const now = null
  const term = (id, documentType, title, body, sortOrder) => ({
    id,
    kind: 'document_term',
    documentType,
    title,
    body,
    sortOrder,
    isDefault: true,
    includedDealerSourceIds: [],
    excludedDealerSourceIds: [],
    isBuiltIn: true,
    isArchived: false,
    createdAt: now,
    createdByEmail: null,
    updatedAt: now,
    updatedByEmail: null,
  })

  return [
    term('quote-validity', 'quote', 'Quote Validity', 'Quoted prices are subject to change without notice. All pricing is valid for 30 days from the initial quote. (R0) Date', 10),
    term('quote-stain-to-match', 'quote', 'Stain to Match', 'Stain to Match — Net $375.00. S.T.M. is available only on Arnold standard veneers: Cherry, Walnut, Mahogany, Oak, and Maple.\nDoes not include reconstituted veneer, multi-step finishes, racking, glazing, matching laminate wood, or proprietary veneer.\nAn additional up-charge may apply upon receipt and review of the sample by our Procurement Manager.', 20),
    term('quote-customer-information', 'quote', 'Customer Information', settings.customerInformation, 30),
    term('order-confirmation-lead-time', 'order_confirmation', 'Lead Time', settings.orderConfirmationTerms, 10),
    term('order-confirmation-processing', 'order_confirmation', 'Deposit and Processing', settings.depositRequestTerms, 20),
    term('bol-received', 'bill_of_lading', 'Received', 'Subject to the classifications and tariffs in effect on the date of issue of this bill of lading, the property described below is received in apparent good order, except as noted (contents and condition of contents of packages unknown), marked, consigned, and destined as indicated. The carrier, meaning any person or corporation in possession of the property under this contract, agrees to carry it to its usual place of delivery at the destination, if on its route, or otherwise to deliver it to another carrier on the route to the destination.', 10),
    term('bol-transportation', 'bill_of_lading', 'Terms of Transportation', 'As to each carrier of all or any of the property over all or any portion of the route, and as to each party interested in the property, every service performed under this bill is subject to all terms and conditions of the applicable domestic bill of lading, freight classification, carrier tariff, rules, and governing law in effect on the date of shipment.', 20),
    term('bol-shipper-certification', 'bill_of_lading', 'Shipper Certification', 'The shipper certifies that it is familiar with the applicable bill-of-lading terms and conditions, including those incorporated by the governing classification or tariff, and agrees to them for itself and its assigns.', 30),
    term('bol-non-recourse', 'bill_of_lading', 'Non-Recourse', 'Subject to Section 7 of the applicable bill of lading, if this shipment is to be delivered without recourse on the consignor, the consignor shall sign here: ________________________________. The carrier shall not make delivery without payment of freight and other lawful charges.', 40),
    term('bol-prepaid-charges', 'bill_of_lading', 'Prepaid Charges', 'To be prepaid: ____________________. Received $____________________ to apply in prepayment of charges. Per ____________________. Charges advanced: $____________________.', 50),
    term('bol-water-shipments', 'bill_of_lading', 'Water Shipments', "If the shipment moves between two ports by water, state whether the weight is the carrier's or shipper's weight: ____________________.", 60),
    term('bol-declared-value', 'bill_of_lading', 'Declared Value', 'Where the rate depends on value, the agreed or declared value is stated by the shipper as not exceeding $____________________ per ____________________.', 70),
    term('bol-fob-damage', 'bill_of_lading', 'F.O.B. and Damage', "All goods are sold F.O.B. Irvington, New Jersey, producing point. The transportation company is the customer's agent, and damage claims must be reported to it immediately upon receipt. Merchandise is shipped blanket wrapped except where unavailable; a crating charge may then be added.", 80),
    term('bol-custom-orders', 'bill_of_lading', 'Custom Orders', 'Custom-made and custom-finished furniture cannot be canceled or returned. Returns without an authorization number will not be accepted.', 90),
    term('change-order-approval', 'change_order', 'Change Order Approval', 'This document replaces the prior order details only after it is signed by the customer and accepted by Arnold Contract. Production paperwork will remain on hold until the customer-signed change order is uploaded.', 10),
  ]
}

function normalizeDealerSourceIdList(value) {
  return [...new Set(
    toOptionalArray(value)
      .map((entry) => toTrimmedText(entry, 160))
      .filter(Boolean),
  )].slice(0, 5000)
}

function normalizeDocumentTerm(input, fallback = {}) {
  const source = { ...toOptionalObject(fallback), ...toOptionalObject(input) }
  const documentType = toLowerText(source.documentType, 80)

  if (!documentTermTypeSet.has(documentType)) {
    return null
  }

  const title = toTrimmedText(source.title, 240)
  const body = toTrimmedText(source.body, 12000)

  if (!title || !body) {
    return null
  }

  return {
    id: toTrimmedText(source.id, 180),
    kind: 'document_term',
    documentType,
    title,
    body,
    sortOrder: Math.max(0, Math.min(100000, toNonNegativeInteger(source.sortOrder, 0))),
    isDefault: toNullableBoolean(source.isDefault) ?? false,
    includedDealerSourceIds: normalizeDealerSourceIdList(source.includedDealerSourceIds),
    excludedDealerSourceIds: normalizeDealerSourceIdList(source.excludedDealerSourceIds),
    isBuiltIn: Boolean(source.isBuiltIn),
    isArchived: Boolean(source.isArchived),
    createdAt: toIsoDateOrNull(source.createdAt),
    createdByEmail: toTrimmedText(source.createdByEmail, 200) || null,
    updatedAt: toIsoDateOrNull(source.updatedAt),
    updatedByEmail: toTrimmedText(source.updatedByEmail, 200) || null,
  }
}

function documentTermAppliesToDealer(term, dealerSourceId) {
  const dealerId = toTrimmedText(dealerSourceId, 160)

  if (!dealerId) {
    return Boolean(term.isDefault)
  }

  return term.isDefault
    ? !term.excludedDealerSourceIds.includes(dealerId)
    : term.includedDealerSourceIds.includes(dealerId)
}

function toSalesRepResponse(rawSalesRep, options = {}) {
  const includeContractFields = options.includeContractFields !== false
  const salesRep = toOptionalObject(rawSalesRep)
  const companyName = toTrimmedText(salesRep.companyName, 200)
  const logoUrl = toTrimmedText(salesRep.logoUrl, 800)
  const contractUrl = toTrimmedText(salesRep.contractUrl, 1200)
  const contractSignedDate = toIsoDateOrNull(salesRep.contractSignedDate)
  const contractNet = toTrimmedText(salesRep.contractNet, 200)
  const email = toTrimmedText(salesRep.email, 200)
  const email2 = toTrimmedText(salesRep.email2, 200)
  const phone = toTrimmedText(salesRep.phone, 80)
  const phone2 = toTrimmedText(salesRep.phone2, 80)

  return {
    id: toTrimmedText(salesRep.id, 160),
    name: toTrimmedText(salesRep.name, 200),
    companyName: companyName || null,
    logoUrl: logoUrl || null,
    contractUrl: includeContractFields ? (contractUrl || null) : null,
    contractSignedDate: includeContractFields ? contractSignedDate : null,
    contractNet: includeContractFields ? (contractNet || null) : null,
    email: email || null,
    email2: email2 || null,
    phone: phone || null,
    phone2: phone2 || null,
    states: normalizeUsStateList(salesRep.states),
    createdAt: toIsoDateOrNull(salesRep.createdAt),
    updatedAt: toIsoDateOrNull(salesRep.updatedAt),
  }
}

async function assertNoSalesRepStateConflicts({
  crmSalesRepsCollection,
  excludedSalesRepId = null,
  states,
}) {
  if (!Array.isArray(states) || states.length === 0) {
    return
  }

  const filter = {
    states: {
      $in: states,
    },
  }

  if (excludedSalesRepId) {
    filter.id = {
      $ne: excludedSalesRepId,
    }
  }

  const conflictingSalesReps = await crmSalesRepsCollection
    .find(
      filter,
      {
        projection: {
          _id: 0,
          id: 1,
          name: 1,
          states: 1,
        },
      },
    )
    .toArray()

  if (conflictingSalesReps.length === 0) {
    return
  }

  const conflictingStates = uniqueSorted(
    conflictingSalesReps
      .flatMap((salesRep) => normalizeUsStateList(salesRep.states))
      .filter((stateCode) => states.includes(stateCode)),
  )

  const conflictingRepNames = uniqueSorted(
    conflictingSalesReps.map((salesRep) => toTrimmedText(salesRep.name, 200)),
  )

  throw {
    status: 409,
    message: `State assignments already in use (${conflictingStates.join(', ')}) by ${conflictingRepNames.join(', ')}.`,
  }
}

function normalizeAccount(rawAccount) {
  const account = toOptionalObject(rawAccount)
  const socialMediaLinks = normalizeSocialMediaLinks(account.social_media)
  const socialMediaText = typeof account.social_media === 'string'
    ? toTrimmedText(account.social_media, 2000)
    : toCompactSocialMediaText(socialMediaLinks)
  const normalizedEmails = normalizeEmailList([
    account.email,
    account.email2,
    account.email_2,
    account.email3,
    account.email_3,
    account.email4,
    account.email_4,
    ...toOptionalArray(account.emails),
  ])
  const primaryEmail = normalizedEmails[0] || ''
  const secondaryEmail = normalizedEmails[1] || ''

  return {
    sourceId: toTrimmedText(account.id, 160),
    name: toTrimmedText(account.name, 240),
    quoteCompanyName: toTrimmedText(account.quoteCompanyName ?? account.quote_company_name, 240),
    pictureUrlSource: toTrimmedText(account.picture_url, 500),
    phone: toTrimmedText(account.phone, 80),
    phone2: toTrimmedText(account.phone2, 80),
    email: primaryEmail,
    email2: secondaryEmail,
    emails: normalizedEmails,
    address: toTrimmedText(account.address, 400),
    city: toTrimmedText(account.city, 160),
    state: toTrimmedText(account.state, 80),
    zip: toTrimmedText(account.zip, 40),
    country: toTrimmedText(account.country, 120),
    industry: toTrimmedText(account.industry, 160),
    accountClass: toTrimmedText(account.account_class, 160),
    accountType: toTrimmedText(account.account_type, 160),
    salesRep: toTrimmedText(account.sales_rep ?? account.salesRep, 200),
    paymentTerms: toTrimmedText(account.paymentTerms ?? account.payment_terms, 240),
    website: toTrimmedText(account.website, 240),
    accountText: toTrimmedText(account.account_text, 4000),
    createdDate: toIsoDateOrNull(account.created),
    modifiedDate: toIsoDateOrNull(account.modified),
    owner: toTrimmedText(account.owner, 200),
    ownerEmail: toTrimmedText(account.owner_email, 200),
    socialMedia: socialMediaText,
    socialMediaLinks,
    recordStatus: normalizeCrmRecordStatus(account.recordStatus ?? account.record_status),
    isArchived: toBoolean(account.is_archived),
    isFavorite: toBoolean(account.is_favorite),
    contacts: toOptionalArray(account.contacts),
  }
}

function normalizeContact(rawContact, accountContext = null, contactOrigin = 'linked') {
  const contact = toOptionalObject(rawContact)

  const accountSourceIdFromContact = toTrimmedText(contact.account_id, 160)
  const accountNameFromContact = toTrimmedText(contact.account_name, 240)

  const linkedAccountSourceId = toTrimmedText(accountContext?.sourceId, 160)
  const linkedAccountName = toTrimmedText(accountContext?.name, 240)

  return {
    sourceId: toTrimmedText(contact.id, 160),
    name: toTrimmedText(contact.name, 240),
    createdDate: toIsoDateOrNull(contact.created_date),
    city: toTrimmedText(contact.city, 160),
    primaryEmail: toTrimmedText(contact.primary_email, 200),
    secondaryEmail: toTrimmedText(contact.secondary_email, 200),
    email3: toTrimmedText(contact.email_3, 200),
    email4: toTrimmedText(contact.email_4, 200),
    salesUnit: toTrimmedText(contact.sales_unit, 160),
    accountName: linkedAccountName || accountNameFromContact,
    accountSourceId: linkedAccountSourceId || accountSourceIdFromContact || null,
    phoneAlt: toTrimmedText(contact.phone_alt, 80),
    state: toTrimmedText(contact.state, 80),
    country: toTrimmedText(contact.country, 120),
    address: toTrimmedText(contact.address, 400),
    zip: toTrimmedText(contact.zip, 40),
    phone: toTrimmedText(contact.phone, 80),
    phone2: toTrimmedText(contact.phone_2, 80),
    firstName: toTrimmedText(contact.first_name, 160),
    lastName: toTrimmedText(contact.last_name, 160),
    gender: toTrimmedText(contact.gender, 50),
    contactTypeId: toTrimmedText(contact.contact_type_id, 160),
    photoUrl: toTrimmedText(contact.photo_url, 500),
    recordStatus: normalizeCrmRecordStatus(contact.recordStatus ?? contact.record_status),
    isArchived: toBoolean(contact.is_archived),
    contactOrigin,
  }
}

function groupDuplicatesByKey(records, getKey, getSourceId) {
  const keyMap = new Map()

  for (const record of records) {
    const key = toTrimmedText(getKey(record), 260)

    if (!key) {
      continue
    }

    if (!keyMap.has(key)) {
      keyMap.set(key, [])
    }

    keyMap.get(key).push(toTrimmedText(getSourceId(record), 160))
  }

  return [...keyMap.entries()]
    .map(([key, sourceIds]) => ({
      key,
      sourceIds: uniqueSorted(sourceIds),
    }))
    .filter((entry) => entry.sourceIds.length > 1)
    .sort((left, right) => {
      if (right.sourceIds.length !== left.sourceIds.length) {
        return right.sourceIds.length - left.sourceIds.length
      }

      return left.key.localeCompare(right.key)
    })
}

function truncateConflictGroups(groups) {
  return groups.slice(0, maxConflictGroupsInResponse).map((group) => ({
    key: group.key,
    count: group.sourceIds.length,
    sourceIds: group.sourceIds.slice(0, maxIdsPerConflictGroup),
    hasMoreSourceIds: group.sourceIds.length > maxIdsPerConflictGroup,
  }))
}

function computeImportFingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function buildImportAnalysis(payload) {
  const root = toOptionalObject(payload)
  const metadata = normalizeMetadata(root.metadata)
  const rawAccounts = toOptionalArray(root.accounts)
  const rawUnlinkedContacts = toOptionalArray(root.unlinked_contacts)

  const validation = {
    skippedAccountsMissingSourceId: 0,
    skippedAccountsMissingName: 0,
    skippedContactsMissingSourceId: 0,
    skippedLinkedContactsInvalidParent: 0,
  }

  const accounts = []
  const linkedContacts = []
  const unlinkedContacts = []

  for (const rawAccount of rawAccounts) {
    const account = normalizeAccount(rawAccount)

    if (!account.sourceId) {
      validation.skippedAccountsMissingSourceId += 1
      continue
    }

    if (!account.name) {
      validation.skippedAccountsMissingName += 1
      continue
    }

    accounts.push(account)

    for (const rawContact of account.contacts) {
      if (!account.sourceId) {
        validation.skippedLinkedContactsInvalidParent += 1
        continue
      }

      const contact = normalizeContact(rawContact, account, 'linked')

      if (!contact.sourceId) {
        validation.skippedContactsMissingSourceId += 1
        continue
      }

      linkedContacts.push(contact)
    }
  }

  for (const rawContact of rawUnlinkedContacts) {
    const contact = normalizeContact(rawContact, null, 'unlinked')

    if (!contact.sourceId) {
      validation.skippedContactsMissingSourceId += 1
      continue
    }

    unlinkedContacts.push(contact)
  }

  const contacts = [...linkedContacts, ...unlinkedContacts]

  const accountSourceIdDuplicates = groupDuplicatesByKey(
    accounts,
    (account) => account.sourceId,
    (account) => account.sourceId,
  )

  const accountNameDuplicates = groupDuplicatesByKey(
    accounts,
    (account) => toLowerText(account.name, 260),
    (account) => account.sourceId,
  )

  const accountEmailDuplicates = groupDuplicatesByKey(
    accounts,
    (account) => toLowerText(account.email, 260),
    (account) => account.sourceId,
  )

  const contactSourceIdDuplicates = groupDuplicatesByKey(
    contacts,
    (contact) => contact.sourceId,
    (contact) => contact.sourceId,
  )

  const contactEmailDuplicates = groupDuplicatesByKey(
    contacts,
    (contact) => toLowerText(contact.primaryEmail, 260),
    (contact) => contact.sourceId,
  )

  const linkedContactByEmail = new Map()

  for (const contact of linkedContacts) {
    const emailLower = toLowerText(contact.primaryEmail, 260)

    if (!emailLower) {
      continue
    }

    if (!linkedContactByEmail.has(emailLower)) {
      linkedContactByEmail.set(emailLower, [])
    }

    linkedContactByEmail.get(emailLower).push(contact)
  }

  const unlinkedEmailOverlaps = []

  for (const contact of unlinkedContacts) {
    const emailLower = toLowerText(contact.primaryEmail, 260)

    if (!emailLower) {
      continue
    }

    const linkedMatches = linkedContactByEmail.get(emailLower) ?? []

    if (linkedMatches.length === 0) {
      continue
    }

    unlinkedEmailOverlaps.push({
      key: emailLower,
      sourceIds: uniqueSorted([
        contact.sourceId,
        ...linkedMatches.map((entry) => entry.sourceId),
      ]),
    })
  }

  const accountOwnerEmails = uniqueSorted(accounts.map((account) => toLowerText(account.ownerEmail, 200)))

  const summary = {
    metadata,
    counts: {
      accounts: accounts.length,
      linkedContacts: linkedContacts.length,
      unlinkedContacts: unlinkedContacts.length,
      contacts: contacts.length,
      archivedAccounts: accounts.filter((account) => account.isArchived).length,
      archivedContacts: contacts.filter((contact) => contact.isArchived).length,
      accountsWithEmail: accounts.filter((account) => Boolean(account.email)).length,
      contactsWithPrimaryEmail: contacts.filter((contact) => Boolean(contact.primaryEmail)).length,
      uniqueOwnerEmails: accountOwnerEmails.length,
      ownerEmails: accountOwnerEmails,
    },
    validation,
  }

  const conflicts = {
    accountSourceIdDuplicates,
    accountNameDuplicates,
    accountEmailDuplicates,
    contactSourceIdDuplicates,
    contactEmailDuplicates,
    unlinkedEmailOverlaps,
  }

  return {
    metadata,
    accounts,
    linkedContacts,
    unlinkedContacts,
    contacts,
    summary,
    conflicts,
  }
}

function buildConflictQueueEntries({
  conflicts,
  importRunId,
  createdAt,
  randomUUID,
}) {
  const entries = []

  const append = (records, conflictType, entityType) => {
    for (const record of records) {
      entries.push({
        id: randomUUID(),
        importRunId,
        entityType,
        conflictType,
        conflictKey: record.key,
        sourceIds: record.sourceIds,
        sourceCount: record.sourceIds.length,
        status: 'open',
        createdAt,
        updatedAt: createdAt,
      })
    }
  }

  append(conflicts.accountSourceIdDuplicates, 'source_id_duplicate', 'account')
  append(conflicts.accountNameDuplicates, 'name_duplicate', 'account')
  append(conflicts.accountEmailDuplicates, 'email_duplicate', 'account')
  append(conflicts.contactSourceIdDuplicates, 'source_id_duplicate', 'contact')
  append(conflicts.contactEmailDuplicates, 'email_duplicate', 'contact')
  append(conflicts.unlinkedEmailOverlaps, 'unlinked_linked_email_overlap', 'contact')

  return entries
}

function toImportResponse(analysis) {
  return {
    importFingerprint: computeImportFingerprint({
      metadata: analysis.metadata,
      accounts: analysis.accounts,
      contacts: analysis.contacts,
    }),
    confirmTextRequired: importConfirmText,
    summary: analysis.summary,
    conflicts: {
      accountSourceIdDuplicates: truncateConflictGroups(analysis.conflicts.accountSourceIdDuplicates),
      accountNameDuplicates: truncateConflictGroups(analysis.conflicts.accountNameDuplicates),
      accountEmailDuplicates: truncateConflictGroups(analysis.conflicts.accountEmailDuplicates),
      contactSourceIdDuplicates: truncateConflictGroups(analysis.conflicts.contactSourceIdDuplicates),
      contactEmailDuplicates: truncateConflictGroups(analysis.conflicts.contactEmailDuplicates),
      unlinkedEmailOverlaps: truncateConflictGroups(analysis.conflicts.unlinkedEmailOverlaps),
    },
    conflictGroupCounts: {
      accountSourceIdDuplicates: analysis.conflicts.accountSourceIdDuplicates.length,
      accountNameDuplicates: analysis.conflicts.accountNameDuplicates.length,
      accountEmailDuplicates: analysis.conflicts.accountEmailDuplicates.length,
      contactSourceIdDuplicates: analysis.conflicts.contactSourceIdDuplicates.length,
      contactEmailDuplicates: analysis.conflicts.contactEmailDuplicates.length,
      unlinkedEmailOverlaps: analysis.conflicts.unlinkedEmailOverlaps.length,
      totalConflictGroups:
        analysis.conflicts.accountSourceIdDuplicates.length
        + analysis.conflicts.accountNameDuplicates.length
        + analysis.conflicts.accountEmailDuplicates.length
        + analysis.conflicts.contactSourceIdDuplicates.length
        + analysis.conflicts.contactEmailDuplicates.length
        + analysis.conflicts.unlinkedEmailOverlaps.length,
    },
  }
}

async function computeCrmOverview({
  crmAccountsCollection,
  crmContactsCollection,
  crmDuplicateQueueCollection,
  crmImportRunsCollection,
  crmQuotesCollection,
  crmOrdersCollection,
}) {
  const [
    totalAccounts,
    totalContacts,
    openConflictCount,
    latestImport,
    totalOrders,
  ] = await Promise.all([
    crmAccountsCollection.countDocuments({}),
    crmContactsCollection.countDocuments({}),
    crmDuplicateQueueCollection.countDocuments({ status: 'open' }),
    crmImportRunsCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            id: 1,
            importedAt: 1,
            importedByEmail: 1,
            summary: 1,
            conflictGroupCounts: 1,
            status: 1,
          },
        },
      )
      .sort({ importedAt: -1 })
      .limit(1)
      .next(),
    crmOrdersCollection.countDocuments({
      is_canonical_order: true,
      is_cancelled: { $ne: true },
    }),
  ])

  const quoteCursor = crmQuotesCollection.find(
    {},
    {
      projection: {
        _id: 0,
        dealerSourceId: 1,
        status: 1,
        totalAmount: 1,
      },
    },
  )

  let totalQuotes = 0
  let acceptedQuotes = 0
  let rejectedQuotes = 0
  let quotedValue = 0
  let acceptedValue = 0

  const dealerAcceptedValueMap = new Map()

  for await (const quote of quoteCursor) {
    totalQuotes += 1

    const status = toLowerText(quote?.status, 80)
    const amount = Number(quote?.totalAmount)
    const safeAmount = Number.isFinite(amount) ? amount : 0

    quotedValue += safeAmount

    if (status === 'accepted') {
      acceptedQuotes += 1
      acceptedValue += safeAmount

      const dealerSourceId = toTrimmedText(quote?.dealerSourceId, 160)

      if (dealerSourceId) {
        const current = dealerAcceptedValueMap.get(dealerSourceId) ?? 0
        dealerAcceptedValueMap.set(dealerSourceId, current + safeAmount)
      }
    }

    if (status === 'rejected') {
      rejectedQuotes += 1
    }
  }

  const acceptanceRate = totalQuotes > 0
    ? Number(((acceptedQuotes / totalQuotes) * 100).toFixed(2))
    : 0

  const topDealerEntries = [...dealerAcceptedValueMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)

  const topDealerIds = topDealerEntries.map(([sourceId]) => sourceId)

  const topDealerNameDocuments = topDealerIds.length > 0
    ? await crmAccountsCollection
        .find(
          {
            sourceId: {
              $in: topDealerIds,
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
        .toArray()
    : []

  const topDealerNameMap = new Map(
    topDealerNameDocuments.map((dealer) => [
      toTrimmedText(dealer.sourceId, 160),
      toTrimmedText(dealer.name, 240),
    ]),
  )

  const topDealersByAcceptedValue = topDealerEntries.map(([sourceId, totalAcceptedValue]) => ({
    dealerSourceId: sourceId,
    dealerName: topDealerNameMap.get(sourceId) || sourceId,
    acceptedValue: Number(totalAcceptedValue.toFixed(2)),
  }))

  return {
    generatedAt: nowIso(),
    dealers: {
      totalAccounts,
      totalContacts,
      openConflictCount,
      latestImport: latestImport ?? null,
    },
    quotes: {
      totalQuotes,
      acceptedQuotes,
      rejectedQuotes,
      acceptanceRate,
      quotedValue: Number(quotedValue.toFixed(2)),
      acceptedValue: Number(acceptedValue.toFixed(2)),
      topDealersByAcceptedValue,
    },
    orders: {
      totalOrders,
    },
  }
}

function toCrmOrderResponse(order) {
  if (!order || typeof order !== 'object') {
    return null
  }

  return {
    id: toTrimmedText(order?.canonical_order_id, 160) || toTrimmedText(order?.id, 160),
    dealerSourceId: toTrimmedText(order?.dealer_source_id, 160)
      || toTrimmedText(order?.dealerSourceId, 160),
    dealerName: toTrimmedText(order?.dealer_name, 240)
      || toTrimmedText(order?.dealerName, 240),
    orderNumber: toTrimmedText(order?.order_number, 120)
      || toTrimmedText(order?.orderNumber, 120)
      || null,
    sourceQuoteId: toTrimmedText(order?.source_quote_id, 160)
      || toTrimmedText(order?.sourceQuoteId, 160)
      || null,
    sourceQuoteNumber: toTrimmedText(order?.source_quote_number, 120)
      || toTrimmedText(order?.sourceQuoteNumber, 120)
      || null,
    sourceQuoteTitle: toTrimmedText(order?.source_quote_title, 240)
      || toTrimmedText(order?.sourceQuoteTitle, 240)
      || null,
    mondayPrimaryBoardId: toTrimmedText(order?.monday_primary_board_id, 120)
      || toTrimmedText(order?.mondayPrimaryBoardId, 120)
      || null,
    mondayPrimaryItemId: toTrimmedText(order?.monday_primary_item_id, 120)
      || toTrimmedText(order?.mondayPrimaryItemId, 120)
      || null,
    mondaySecondaryBoardId: toTrimmedText(order?.monday_secondary_board_id, 120)
      || toTrimmedText(order?.mondaySecondaryBoardId, 120)
      || null,
    mondaySecondaryItemId: toTrimmedText(order?.monday_secondary_item_id, 120)
      || toTrimmedText(order?.mondaySecondaryItemId, 120)
      || null,
    poDate: toIsoDateOrNull(order?.poDate ?? order?.order_date),
    poNumber: toTrimmedText(order?.poNumber ?? order?.po_number, 120) || null,
    leadTimeDate: toIsoDateOrNull(order?.leadTimeDate ?? order?.Due_date),
    shipTo: toTrimmedText(order?.shipTo ?? order?.ship_to, 2000) || null,
    title: toTrimmedText(order?.title ?? order?.order_name, 240) || 'Order',
    status: normalizeStatus(order?.crmStatus ?? order?.canonical_status, orderStatuses, 'pending') || 'pending',
    progressPercent: toPercentInRangeOrNull(order?.progressPercent ?? order?.canonical_progress_percent) ?? 0,
    orderValue: toNonNegativeNumberOrNull(order?.orderValue ?? order?.canonical_order_value) ?? 0,
    currency: toTrimmedText(order?.currency ?? order?.canonical_currency, 16) || 'USD',
    dueDate: toIsoDateOrNull(order?.dueDate ?? order?.Due_date),
    shippedAt: toIsoDateOrNull(order?.shippedAt ?? order?.shipped_at),
    deliveredAt: toIsoDateOrNull(order?.deliveredAt),
    notes: toTrimmedText(order?.notes ?? order?.canonical_notes, 4000) || null,
    createdByUid: toTrimmedText(order?.createdByUid ?? order?.converted_by_uid, 160) || null,
    createdByEmail: toTrimmedText(order?.createdByEmail ?? order?.converted_by_email, 200) || null,
    lastStatusChangedAt: toIsoDateOrNull(order?.lastStatusChangedAt)
      || toIsoDateOrNull(order?.canonical_created_at)
      || null,
    createdAt: toIsoDateOrNull(order?.canonical_created_at ?? order?.createdAt),
    updatedAt: toIsoDateOrNull(order?.canonical_updated_at ?? order?.updatedAt),
  }
}

export function registerCrmRoutes(app, deps) {
  const {
    getCollections,
    fetchMondayBoardsCatalog,
    fetchMondayBoardColumns,
    fetchMondayStatusColumnOptions,
    createMondayItem,
    updateMondayItemStatusColumn,
    updateMondayItemTextColumn,
    updateMondayItemJsonColumn,
    deleteMondayItem,
    randomUUID,
    requireAdminRole,
    requireSalesManagerOrAdminRole,
    requireFirebaseAuth,
    toPublicAuthUser,
  } = deps

  async function getSuggestedAcknowledgmentNumber() {
    const easternParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date())
    const partValue = (type) => easternParts.find((part) => part.type === type)?.value || ''
    const year = partValue('year').slice(-2)
    const month = partValue('month')
    const prefix = `${year}${month}`
    const { ordersUnifiedCollection } = await getCollections()
    const existingOrders = await ordersUnifiedCollection.find(
      { order_number: new RegExp(`^${prefix}\\d{2}$`, 'i') },
      { projection: { _id: 0, order_number: 1 } },
    ).toArray()
    const highestSequence = existingOrders.reduce((highest, order) => {
      const match = String(order?.order_number ?? '').trim().match(new RegExp(`^${prefix}(\\d{2})$`, 'i'))
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0)

    if (highestSequence >= 99) {
      throw new Error(`All acknowledgement numbers for ${prefix} have been used.`)
    }

    return `${prefix}${String(highestSequence + 1).padStart(2, '0')}`
  }

  function resolveCrmAccessScope(req) {
    const publicUser = toPublicAuthUser(req.authUser)
    const isSalesRep = Boolean(publicUser?.isApproved && publicUser?.isSalesRep)
    const territoryStates = isSalesRep
      ? normalizeUsStateList(publicUser?.salesTerritoryStates)
      : []

    return {
      publicUser,
      isSalesRep,
      territoryStates,
    }
  }

  function requireApprovedCrmAccess(req, _res, next) {
    const publicUser = toPublicAuthUser(req.authUser)

    if (!publicUser?.isApproved) {
      return next({
        status: 403,
        message: 'Approved access is required.',
      })
    }

    next()
  }

  function requireOfficeManagerOrAdminRole(req, _res, next) {
    const publicUser = toPublicAuthUser(req.authUser)
    const hasAccess = Boolean(
      publicUser?.isApproved
      && (
        publicUser?.isOwner
        || publicUser?.isAdmin
        || publicUser?.isManager
        || publicUser?.isOfficeWorker
      ),
    )

    if (!hasAccess) {
      return next({
        status: 403,
        message: 'Office, manager, or admin access is required.',
      })
    }

    next()
  }

  function resolveSalesRepQuoteAccessScope(accessScope) {
    const publicUser = accessScope?.publicUser
    const restrictToLinkedSalesRep = Boolean(
      accessScope?.isSalesRep
      && !publicUser?.isAdmin
      && !publicUser?.isOwner,
    )
    const linkedSalesRepName = restrictToLinkedSalesRep
      ? toTrimmedText(publicUser?.linkedSalesRepName, 200) || null
      : null

    return {
      restrictToLinkedSalesRep,
      linkedSalesRepName,
      linkedSalesRepRegex: linkedSalesRepName
        ? new RegExp(`^${escapeRegex(linkedSalesRepName)}$`, 'i')
        : null,
    }
  }

  function canAccessQuoteBySalesRep(quote, quoteAccessScope) {
    if (!quoteAccessScope?.restrictToLinkedSalesRep) {
      return true
    }

    if (!quoteAccessScope.linkedSalesRepRegex) {
      return false
    }

    const quoteSalesRep = toTrimmedText(quote?.salesRep, 200)

    if (!quoteSalesRep) {
      return false
    }

    return quoteAccessScope.linkedSalesRepRegex.test(quoteSalesRep)
  }

  function assertCanAccessQuoteBySalesRep(quote, quoteAccessScope) {
    if (canAccessQuoteBySalesRep(quote, quoteAccessScope)) {
      return
    }

    throw {
      status: 403,
      message: 'You can only access opportunities assigned to your linked sales rep.',
    }
  }

  function isDealerInTerritory(dealerState, territoryStates) {
    if (!Array.isArray(territoryStates) || territoryStates.length === 0) {
      return false
    }

    const normalizedDealerState = toTrimmedText(dealerState, 80).toUpperCase()

    return Boolean(normalizedDealerState && territoryStates.includes(normalizedDealerState))
  }

  async function resolveTerritoryDealerSourceIds(crmAccountsCollection, territoryStates) {
    if (!Array.isArray(territoryStates) || territoryStates.length === 0) {
      return []
    }

    const stateRegexes = buildExactStateRegexes(territoryStates)
    const dealers = await crmAccountsCollection
      .find(
        {
          state: {
            $in: stateRegexes,
          },
          recordStatus: {
            $ne: crmRecordStatusDeleted,
          },
        },
        {
          projection: {
            _id: 0,
            sourceId: 1,
          },
        },
      )
      .toArray()

    return [...new Set(
      dealers
        .map((dealer) => toTrimmedText(dealer.sourceId, 160))
        .filter(Boolean),
    )]
  }

  async function resolveDealerOrThrow(crmAccountsCollection, dealerSourceId) {
    const dealerId = toTrimmedText(dealerSourceId, 160)

    if (!dealerId) {
      throw {
        status: 400,
        message: 'dealerSourceId is required.',
      }
    }

    const dealer = await crmAccountsCollection.findOne(
      {
        sourceId: dealerId,
        recordStatus: {
          $ne: crmRecordStatusDeleted,
        },
      },
      {
        projection: {
          _id: 0,
          sourceId: 1,
          name: 1,
          state: 1,
          isArchived: 1,
          recordStatus: 1,
        },
      },
    )

    if (!dealer) {
      throw {
        status: 400,
        message: 'dealerSourceId was not found in CRM accounts.',
      }
    }

    return {
      sourceId: toTrimmedText(dealer.sourceId, 160),
      name: toTrimmedText(dealer.name, 240),
      state: toTrimmedText(dealer.state, 80),
      isArchived: toBoolean(dealer.isArchived),
      recordStatus: normalizeCrmRecordStatus(dealer.recordStatus),
    }
  }

  async function resolveQuoteOrThrow(crmQuotesCollection, quoteId) {
    const normalizedQuoteId = toTrimmedText(quoteId, 160)

    if (!normalizedQuoteId) {
      throw {
        status: 400,
        message: 'quoteId is required.',
      }
    }

    const quote = await crmQuotesCollection.findOne(
      {
        id: normalizedQuoteId,
      },
      {
        projection: {
          _id: 0,
          id: 1,
          quoteNumber: 1,
          title: 1,
          dealerSourceId: 1,
          dealerName: 1,
          salesRep: 1,
          status: 1,
          opportunityStage: 1,
        },
      },
    )

    if (!quote) {
      throw {
        status: 404,
        message: 'Quote not found.',
      }
    }

    return {
      id: toTrimmedText(quote.id, 160),
      quoteNumber: toTrimmedText(quote.quoteNumber, 120) || null,
      title: toTrimmedText(quote.title, 240) || null,
      dealerSourceId: toTrimmedText(quote.dealerSourceId, 160) || null,
      dealerName: toTrimmedText(quote.dealerName, 240) || null,
      salesRep: toTrimmedText(quote.salesRep, 200) || null,
      status: toTrimmedText(quote.status, 60) || null,
      opportunityStage: toTrimmedText(quote.opportunityStage, 80) || null,
    }
  }

  let crmAccountChatsIndexesPromise

  async function getCrmAccountChatsCollection(collectionsFromCaller = null) {
    const collections = collectionsFromCaller ?? await getCollections()
    const crmDatabase = collections?.databasesByDomain?.crm

    if (!crmDatabase) {
      throw new Error('CRM database is unavailable.')
    }

    const crmAccountChatsCollection = crmDatabase.collection('crm_account_chats')

    if (!crmAccountChatsIndexesPromise) {
      crmAccountChatsIndexesPromise = Promise.all([
        crmAccountChatsCollection.createIndex({ id: 1 }, { unique: true }),
        crmAccountChatsCollection.createIndex({ dealerSourceId: 1, createdAt: 1 }),
        crmAccountChatsCollection.createIndex({ createdAt: -1 }),
      ])
    }

    try {
      await crmAccountChatsIndexesPromise
    } catch (error) {
      crmAccountChatsIndexesPromise = undefined
      throw error
    }

    return crmAccountChatsCollection
  }

  let crmQuoteChatsIndexesPromise

  async function getCrmQuoteChatsCollection(collectionsFromCaller = null) {
    const collections = collectionsFromCaller ?? await getCollections()
    const crmDatabase = collections?.databasesByDomain?.crm

    if (!crmDatabase) {
      throw new Error('CRM database is unavailable.')
    }

    const crmQuoteChatsCollection = crmDatabase.collection('crm_quote_chats')

    if (!crmQuoteChatsIndexesPromise) {
      crmQuoteChatsIndexesPromise = Promise.all([
        crmQuoteChatsCollection.createIndex({ id: 1 }, { unique: true }),
        crmQuoteChatsCollection.createIndex({ quoteId: 1, createdAt: 1 }),
        crmQuoteChatsCollection.createIndex({ dealerSourceId: 1, createdAt: 1 }),
        crmQuoteChatsCollection.createIndex({ createdAt: -1 }),
      ])
    }

    try {
      await crmQuoteChatsIndexesPromise
    } catch (error) {
      crmQuoteChatsIndexesPromise = undefined
      throw error
    }

    return crmQuoteChatsCollection
  }

  function canManageCrmAccountChatMessage({ publicUser, authUser, chatMessage }) {
    const isAdmin = Boolean(publicUser?.isApproved && publicUser?.isAdmin)

    if (isAdmin) {
      return true
    }

    const requesterUid = toTrimmedText(authUser?.uid, 200)
    const requesterEmail = toLowerText(authUser?.email, 200)
    const createdByUid = toTrimmedText(chatMessage?.createdByUid, 200)
    const createdByEmail = toLowerText(chatMessage?.createdByEmail, 200)

    return Boolean(
      (requesterUid && createdByUid && requesterUid === createdByUid)
      || (requesterEmail && createdByEmail && requesterEmail === createdByEmail),
    )
  }

  async function createCrmChatInAppAlert({
    mobileAlertsCollection,
    randomUUID,
    title,
    message,
    createdByUid,
    createdByEmail,
    recipientUids,
    metadata,
  }) {
    if (!Array.isArray(recipientUids) || recipientUids.length === 0) {
      return
    }

    const now = nowIso()
    const alertDocument = {
      id: randomUUID(),
      title,
      message,
      isUpdate: false,
      targetMode: 'selected',
      targetUserUids: recipientUids,
      createdByUid: createdByUid || null,
      createdByEmail: createdByEmail || null,
      delivery: {
        targetUserCount: recipientUids.length,
        pushTokenCount: 0,
        pushAcceptedCount: 0,
        pushErrorCount: 0,
        errorSamples: [],
      },
      metadata: toOptionalObject(metadata),
      createdAt: now,
      updatedAt: now,
    }

    await mobileAlertsCollection.insertOne(alertDocument)
  }

  app.post('/api/crm/imports/preview', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const analysis = buildImportAnalysis(req.body?.payload)

      return res.json(toImportResponse(analysis))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/sales-reps', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { crmSalesRepsCollection } = await getCollections()
      const accessScope = resolveCrmAccessScope(req)
      const canAccessContractFields = Boolean(accessScope.publicUser?.isOwner || accessScope.publicUser?.isAdmin)

      const salesReps = await crmSalesRepsCollection
        .find(
          { isDeleted: { $ne: true } },
          {
            projection: {
              _id: 0,
              id: 1,
              name: 1,
              companyName: 1,
              logoUrl: 1,
              contractUrl: 1,
              contractSignedDate: 1,
              contractNet: 1,
              email: 1,
              email2: 1,
              phone: 1,
              phone2: 1,
              states: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        )
        .sort({ companyNameLower: 1, nameLower: 1, name: 1, id: 1 })
        .toArray()

      return res.json({
        salesReps: salesReps.map((salesRep) => toSalesRepResponse(salesRep, {
          includeContractFields: canAccessContractFields,
        })),
        availableStates: usStateCodes,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/sales-reps', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const body = toOptionalObject(req.body)
      const name = toTrimmedText(body.name, 200)
      const companyName = toTrimmedText(body.companyName, 200)
      const logoUrl = toTrimmedText(body.logoUrl, 800)
      const contractUrl = toTrimmedText(body.contractUrl, 1200)
      const contractSignedDateInput = toTrimmedText(body.contractSignedDate, 80)
      const contractSignedDate = contractSignedDateInput ? toIsoDateOrNull(contractSignedDateInput) : null
      const contractNet = toTrimmedText(body.contractNet, 200)
      const email = toTrimmedText(body.email, 200)
      const email2 = toTrimmedText(body.email2, 200)
      const phone = toTrimmedText(body.phone, 80)
      const phone2 = toTrimmedText(body.phone2, 80)
      const states = normalizeUsStateList(body.states)

      if (!name) {
        return res.status(400).json({
          error: 'name is required.',
        })
      }

      if (contractSignedDateInput && !contractSignedDate) {
        return res.status(400).json({
          error: 'contractSignedDate must be a valid ISO date string.',
        })
      }

      const { crmSalesRepsCollection } = await getCollections()

      await assertNoSalesRepStateConflicts({
        crmSalesRepsCollection,
        states,
      })

      const now = nowIso()
      const salesRep = {
        id: randomUUID(),
        name,
        nameLower: toLowerText(name, 200),
        companyName: companyName || null,
        companyNameLower: toLowerText(companyName, 200),
        logoUrl: logoUrl || null,
        contractUrl: contractUrl || null,
        contractSignedDate,
        contractNet: contractNet || null,
        email: email || null,
        email2: email2 || null,
        phone: phone || null,
        phone2: phone2 || null,
        states,
        createdAt: now,
        updatedAt: now,
      }

      try {
        await crmSalesRepsCollection.insertOne(salesRep)
      } catch (error) {
        if (Number(error?.code) === 11000) {
          return res.status(409).json({
            error: 'Sales rep name already exists.',
          })
        }

        throw error
      }

      return res.status(201).json({
        salesRep: toSalesRepResponse(salesRep),
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/crm/sales-reps/:salesRepId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const salesRepId = toTrimmedText(req.params.salesRepId, 160)

      if (!salesRepId) {
        return res.status(400).json({
          error: 'salesRepId is required.',
        })
      }

      const body = toOptionalObject(req.body)
      const { crmSalesRepsCollection } = await getCollections()
      const existingSalesRep = await crmSalesRepsCollection.findOne(
        {
          id: salesRepId,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            name: 1,
            companyName: 1,
            logoUrl: 1,
            contractUrl: 1,
            contractSignedDate: 1,
            contractNet: 1,
            email: 1,
            email2: 1,
            phone: 1,
            phone2: 1,
            states: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      )

      if (!existingSalesRep) {
        return res.status(404).json({
          error: 'Sales rep not found.',
        })
      }

      const updates = {}
      let nextStates = normalizeUsStateList(existingSalesRep.states)

      if (Object.prototype.hasOwnProperty.call(body, 'name')) {
        const name = toTrimmedText(body.name, 200)

        if (!name) {
          return res.status(400).json({
            error: 'name cannot be empty.',
          })
        }

        updates.name = name
        updates.nameLower = toLowerText(name, 200)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'companyName')) {
        const companyName = toTrimmedText(body.companyName, 200)
        updates.companyName = companyName || null
        updates.companyNameLower = toLowerText(companyName, 200)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'logoUrl')) {
        const logoUrl = toTrimmedText(body.logoUrl, 800)
        updates.logoUrl = logoUrl || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'contractUrl')) {
        const contractUrl = toTrimmedText(body.contractUrl, 1200)
        updates.contractUrl = contractUrl || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'contractSignedDate')) {
        const contractSignedDateInput = toTrimmedText(body.contractSignedDate, 80)
        const contractSignedDate = contractSignedDateInput ? toIsoDateOrNull(contractSignedDateInput) : null

        if (contractSignedDateInput && !contractSignedDate) {
          return res.status(400).json({
            error: 'contractSignedDate must be a valid ISO date string.',
          })
        }

        updates.contractSignedDate = contractSignedDate
      }

      if (Object.prototype.hasOwnProperty.call(body, 'contractNet')) {
        const contractNet = toTrimmedText(body.contractNet, 200)
        updates.contractNet = contractNet || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'email')) {
        const email = toTrimmedText(body.email, 200)
        updates.email = email || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'email2')) {
        const email2 = toTrimmedText(body.email2, 200)
        updates.email2 = email2 || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
        const phone = toTrimmedText(body.phone, 80)
        updates.phone = phone || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'phone2')) {
        const phone2 = toTrimmedText(body.phone2, 80)
        updates.phone2 = phone2 || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'states')) {
        nextStates = normalizeUsStateList(body.states)
        updates.states = nextStates
      }

      if (Object.keys(updates).length === 0) {
        return res.json({
          salesRep: toSalesRepResponse(existingSalesRep),
        })
      }

      await assertNoSalesRepStateConflicts({
        crmSalesRepsCollection,
        excludedSalesRepId: salesRepId,
        states: nextStates,
      })

      updates.updatedAt = nowIso()

      let updatedSalesRep

      try {
        updatedSalesRep = await crmSalesRepsCollection.findOneAndUpdate(
          {
            id: salesRepId,
          },
          {
            $set: updates,
          },
          {
            returnDocument: 'after',
            projection: {
              _id: 0,
              id: 1,
              name: 1,
              companyName: 1,
              logoUrl: 1,
              contractUrl: 1,
              contractSignedDate: 1,
              contractNet: 1,
              email: 1,
              email2: 1,
              phone: 1,
              phone2: 1,
              states: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        )
      } catch (error) {
        if (Number(error?.code) === 11000) {
          return res.status(409).json({
            error: 'Sales rep name already exists.',
          })
        }

        throw error
      }

      return res.json({
        salesRep: toSalesRepResponse(updatedSalesRep),
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/crm/sales-reps/:salesRepId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const salesRepId = toTrimmedText(req.params.salesRepId, 160)

      if (!salesRepId) {
        return res.status(400).json({
          error: 'salesRepId is required.',
        })
      }

      const { crmSalesRepsCollection } = await getCollections()

      const existing = await crmSalesRepsCollection.findOne(
        { id: salesRepId },
        { projection: { _id: 0, id: 1, isDeleted: 1 } },
      )

      if (!existing) {
        return res.status(404).json({
          error: 'Sales rep not found.',
        })
      }

      if (existing.isDeleted) {
        return res.json({ ok: true, salesRepId })
      }

      const deletedAt = nowIso()
      const deletedByEmail = toTrimmedText(req.authUser?.email, 200) || null

      await crmSalesRepsCollection.updateOne(
        { id: salesRepId },
        {
          $set: {
            isDeleted: true,
            deletedAt,
            deletedByEmail,
            updatedAt: deletedAt,
          },
        },
      )

      return res.json({
        ok: true,
        salesRepId,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/dealers', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates } = resolveCrmAccessScope(req)
      const searchRegex = buildContainsRegex(req.query?.search, 200)
      const includeArchived = toBoolean(req.query?.includeArchived)
      const ownerEmail = toLowerText(req.query?.ownerEmail, 200)
      const accountType = toLowerText(req.query?.accountType, 60)
      const dealerStates = normalizeUsStateList(normalizeDelimitedTextList(req.query?.dealerStates, 24, 120))
      const salesReps = normalizeDelimitedTextList(req.query?.salesReps, 200, 250)
      const hasEmail = toNullableBoolean(req.query?.hasEmail)
      const offset = toNonNegativeInteger(req.query?.offset, 0)
      const limit = Math.min(2500, Math.max(1, toNonNegativeInteger(req.query?.limit, 1200)))

      if (isSalesRep && territoryStates.length === 0) {
        return res.json({
          dealers: [],
          total: 0,
          offset,
          limit,
          hasMore: false,
        })
      }

      // Build a stable cache key from the normalized query params. Requests
      // without filters (the bulk "load all dealers for dropdown" calls) will
      // almost always hit the same key, so they only touch MongoDB once per TTL.
      const cacheKey = `${DEALERS_CACHE_PREFIX}${JSON.stringify({
        search: req.query?.search ?? '',
        includeArchived,
        ownerEmail,
        accountType,
        dealerStates,
        salesReps,
        hasEmail,
        territoryStates,
        offset,
        limit,
      })}`

      const cached = cacheGet(cacheKey)

      if (cached) {
        return res.json(cached)
      }

      const collections = await getCollections()
      const { crmAccountsCollection, crmContactsCollection } = collections
      const crmAccountChatsCollection = await getCrmAccountChatsCollection(collections)
      const filterClauses = []
      let accountSourceIdsFromContactSearch = []

      filterClauses.push({
        recordStatus: {
          $ne: crmRecordStatusDeleted,
        },
      })

      if (isSalesRep) {
        filterClauses.push({
          state: {
            $in: buildExactStateRegexes(territoryStates),
          },
        })
      }

      if (dealerStates.length > 0) {
        filterClauses.push({
          state: {
            $in: buildExactStateRegexes(dealerStates),
          },
        })
      }

      if (salesReps.length > 0) {
        filterClauses.push({
          salesRep: {
            $in: salesReps.map((salesRepName) => new RegExp(`^${escapeRegex(salesRepName)}$`, 'i')),
          },
        })
      }

      if (!includeArchived) {
        filterClauses.push({
          isArchived: {
            $ne: true,
          },
        })
      }

      if (ownerEmail) {
        filterClauses.push({
          ownerEmailLower: ownerEmail,
        })
      }

      if (accountType && accountType !== 'all') {
        if (accountType === 'none') {
          filterClauses.push({
            $nor: [
              {
                accountType: /^(dealer|designer)$/i,
              },
              {
                accountClass: /^(dealer|designer)$/i,
              },
            ],
          })
        } else {
          filterClauses.push({
            $or: [
              {
                accountType: new RegExp(`^${escapeRegex(accountType)}$`, 'i'),
              },
              {
                accountClass: new RegExp(`^${escapeRegex(accountType)}$`, 'i'),
              },
            ],
          })
        }
      }

      if (hasEmail === true) {
        filterClauses.push({
          $or: [
            {
              emailLower: {
                $nin: [null, ''],
              },
            },
            {
              email2: {
                $nin: [null, ''],
              },
            },
          ],
        })
      }

      if (hasEmail === false) {
        filterClauses.push({
          $and: [
            {
              $or: [
                {
                  emailLower: null,
                },
                {
                  emailLower: '',
                },
              ],
            },
            {
              $or: [
                {
                  email2: null,
                },
                {
                  email2: '',
                },
              ],
            },
          ],
        })
      }

      if (searchRegex) {
        const matchedAccountSourceIds = await crmContactsCollection.distinct(
          'accountSourceId',
          {
            accountSourceId: {
              $nin: [null, ''],
            },
            recordStatus: {
              $ne: crmRecordStatusDeleted,
            },
            $or: [
              {
                primaryEmail: searchRegex,
              },
              {
                secondaryEmail: searchRegex,
              },
              {
                email3: searchRegex,
              },
              {
                email4: searchRegex,
              },
              {
                name: searchRegex,
              },
              {
                firstName: searchRegex,
              },
              {
                lastName: searchRegex,
              },
              {
                accountName: searchRegex,
              },
            ],
          },
        )
        accountSourceIdsFromContactSearch = [...new Set(
          matchedAccountSourceIds
            .map((value) => String(value ?? '').trim())
            .filter(Boolean),
        )]

        filterClauses.push({
          $or: [
            {
              sourceId: searchRegex,
            },
            {
              name: searchRegex,
            },
            {
              email: searchRegex,
            },
            {
              email2: searchRegex,
            },
            {
              ownerEmail: searchRegex,
            },
            {
              salesRep: searchRegex,
            },
            {
              city: searchRegex,
            },
            {
              state: searchRegex,
            },
            {
              country: searchRegex,
            },
            {
              emails: searchRegex,
            },
            ...(accountSourceIdsFromContactSearch.length > 0
              ? [
                {
                  sourceId: {
                    $in: accountSourceIdsFromContactSearch,
                  },
                },
              ]
              : []),
          ],
        })
      }

      const filter = combineFilterClauses(filterClauses)

      const [total, dealers] = await Promise.all([
        crmAccountsCollection.countDocuments(filter),
        crmAccountsCollection
          .find(
            filter,
            {
              projection: {
                _id: 0,
                sourceId: 1,
                name: 1,
                quoteCompanyName: 1,
                phone: 1,
                email: 1,
                ownerEmail: 1,
                city: 1,
                state: 1,
                country: 1,
                industry: 1,
                accountType: 1,
                accountClass: 1,
                salesRep: 1,
                paymentTerms: 1,
                website: 1,
                emails: 1,
                pictureUrl: 1,
                pictureUrlSource: 1,
                contactCountSource: 1,
                isArchived: 1,
                lastImportedAt: 1,
              },
            },
          )
          .sort({ nameLower: 1, sourceId: 1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
      ])

      const dealerSourceIds = [...new Set(
        dealers
          .map((dealer) => toTrimmedText(dealer.sourceId, 160))
          .filter(Boolean),
      )]

      const chatCountRows = dealerSourceIds.length > 0
        ? await crmAccountChatsCollection
          .aggregate([
            {
              $match: {
                dealerSourceId: {
                  $in: dealerSourceIds,
                },
              },
            },
            {
              $group: {
                _id: '$dealerSourceId',
                count: {
                  $sum: 1,
                },
              },
            },
          ])
          .toArray()
        : []

      const chatCountByDealerSourceId = new Map(
        chatCountRows
          .map((entry) => [toTrimmedText(entry._id, 160), toNonNegativeInteger(entry.count, 0)])
          .filter(([sourceId]) => Boolean(sourceId)),
      )

      const dealersWithChatCounts = dealers.map((dealer) => ({
        ...dealer,
        pictureUrl:
          toTrimmedText(dealer?.pictureUrl, 1200)
          || toTrimmedText(dealer?.pictureUrlSource, 1200)
          || null,
        chatMessageCount: chatCountByDealerSourceId.get(toTrimmedText(dealer.sourceId, 160)) ?? 0,
      }))

      const payload = {
        dealers: dealersWithChatCounts,
        total,
        offset,
        limit,
        hasMore: offset + dealersWithChatCounts.length < total,
      }

      cacheSet(cacheKey, payload, DEALERS_CACHE_TTL_MS)

      return res.json(payload)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/dealers', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates } = resolveCrmAccessScope(req)
      const body = toOptionalObject(req.body)
      const name = toTrimmedText(body.name, 240)

      if (!name) {
        return res.status(400).json({
          error: 'name is required.',
        })
      }

      if (isSalesRep && territoryStates.length === 0) {
        return res.status(403).json({
          error: 'No sales territories are assigned to this user.',
        })
      }

      const accountTypeInput = toLowerText(body.accountType, 40)
      const accountType = accountTypeInput || 'dealer'

      if (accountType !== 'dealer' && accountType !== 'designer') {
        return res.status(400).json({
          error: "accountType must be 'dealer' or 'designer'.",
        })
      }

      const state = normalizeUsStateCode(body.state) || null

      if (isSalesRep && state && !isDealerInTerritory(state, territoryStates)) {
        return res.status(403).json({
          error: 'State must be within your assigned sales territories.',
        })
      }

      const requestedSourceId = toTrimmedText(body.sourceId, 160)
      const sourceId = requestedSourceId || `manual-${randomUUID()}`
      const normalizedEmails = normalizeEmailList([
        body.email,
        body.email2,
        ...toOptionalArray(body.emails),
      ])
      const primaryEmail = normalizedEmails[0] || ''
      const secondaryEmail = normalizedEmails[1] || ''
      const ownerEmail = toTrimmedText(body.ownerEmail, 200)
      const ownerEmailLower = toLowerText(ownerEmail, 200)
      const socialMediaLinks = normalizeSocialMediaLinks(body.socialMediaLinks)
      const hasSocialMediaLinks = Object.keys(socialMediaLinks).length > 0
      const socialMedia = Object.prototype.hasOwnProperty.call(body, 'socialMedia')
        ? (toTrimmedText(body.socialMedia, 2000) || null)
        : (hasSocialMediaLinks ? toCompactSocialMediaText(socialMediaLinks) : null)
      const now = nowIso()
      const { crmAccountsCollection } = await getCollections()

      const dealer = {
        id: sourceId,
        sourceId,
        name,
        nameLower: toLowerText(name, 240),
        quoteCompanyName: toTrimmedText(body.quoteCompanyName, 240) || name,
        phone: toTrimmedText(body.phone, 80) || null,
        phone2: toTrimmedText(body.phone2, 80) || null,
        email: primaryEmail || null,
        emailLower: toLowerText(primaryEmail, 200) || null,
        email2: secondaryEmail || null,
        emails: normalizedEmails,
        address: toTrimmedText(body.address, 400) || null,
        city: toTrimmedText(body.city, 160) || null,
        state,
        zip: toTrimmedText(body.zip, 40) || null,
        country: toTrimmedText(body.country, 120) || null,
        industry: toTrimmedText(body.industry, 160) || null,
        accountClass: toTrimmedText(body.accountClass, 160) || accountType,
        accountType,
        salesRep: toTrimmedText(body.salesRep, 200) || null,
        paymentTerms: toTrimmedText(body.paymentTerms, 240) || '50% Deposit / 50% CBD',
        website: toTrimmedText(body.website, 240) || null,
        accountText: toTrimmedText(body.accountText, 4000) || null,
        createdDateSource: toIsoDateOrNull(body.createdDateSource) || now,
        modifiedDateSource: toIsoDateOrNull(body.modifiedDateSource) || now,
        owner: toTrimmedText(body.owner, 200) || null,
        ownerEmail: ownerEmail || null,
        ownerEmailLower: ownerEmailLower || null,
        pictureUrl: toTrimmedText(body.pictureUrl, 500) || null,
        pictureUrlSource: toTrimmedText(body.pictureUrlSource, 500) || null,
        socialMedia,
        socialMediaLinks: hasSocialMediaLinks ? socialMediaLinks : null,
        recordStatus: crmRecordStatusActive,
        isArchived: false,
        isFavorite: false,
        contactCountSource: 0,
        lastImportRunId: null,
        lastImportedAt: now,
        createdAt: now,
        updatedAt: now,
      }

      try {
        await crmAccountsCollection.insertOne(dealer)
      } catch (error) {
        if (Number(error?.code) === 11000) {
          return res.status(409).json({
            error: 'sourceId already exists. Use a unique sourceId or omit it for auto-generation.',
          })
        }

        throw error
      }

      cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
      cacheDelete(OVERVIEW_CACHE_KEY)

      return res.status(201).json({
        dealer,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/dealers/:dealerSourceId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates } = resolveCrmAccessScope(req)
      const dealerSourceId = toTrimmedText(req.params.dealerSourceId, 160)

      if (!dealerSourceId) {
        return res.status(400).json({
          error: 'dealerSourceId is required.',
        })
      }

      const includeArchivedContacts = toBoolean(req.query?.includeArchivedContacts)
      const contactSearchRegex = buildContainsRegex(req.query?.contactSearch, 200)
      const contactOffset = toNonNegativeInteger(req.query?.contactOffset, 0)
      const contactLimit = Math.min(1000, Math.max(1, toNonNegativeInteger(req.query?.contactLimit, 250)))

      const {
        crmAccountsCollection,
        crmContactsCollection,
      } = await getCollections()

      if (isSalesRep && territoryStates.length === 0) {
        return res.status(403).json({
          error: 'No sales territories are assigned to this user.',
        })
      }

      const dealer = await crmAccountsCollection.findOne(
        combineFilterClauses([
          {
            sourceId: dealerSourceId,
          },
          {
            recordStatus: {
              $ne: crmRecordStatusDeleted,
            },
          },
          isSalesRep
            ? {
              state: {
                $in: buildExactStateRegexes(territoryStates),
              },
            }
            : null,
        ]),
        {
          projection: {
            _id: 0,
            sourceId: 1,
            name: 1,
            quoteCompanyName: 1,
            phone: 1,
            phone2: 1,
            email: 1,
            email2: 1,
            address: 1,
            city: 1,
            state: 1,
            zip: 1,
            country: 1,
            industry: 1,
            accountClass: 1,
            accountType: 1,
            salesRep: 1,
            paymentTerms: 1,
            website: 1,
            emails: 1,
            accountText: 1,
            owner: 1,
            ownerEmail: 1,
            pictureUrl: 1,
            pictureUrlSource: 1,
            socialMedia: 1,
            socialMediaLinks: 1,
            recordStatus: 1,
            isArchived: 1,
            isFavorite: 1,
            contactCountSource: 1,
            createdDateSource: 1,
            modifiedDateSource: 1,
            lastImportedAt: 1,
          },
        },
      )

      if (!dealer) {
        return res.status(404).json({
          error: 'Dealer not found.',
        })
      }

      const contactFilterClauses = [
        {
          accountSourceId: dealerSourceId,
        },
        {
          recordStatus: {
            $ne: crmRecordStatusDeleted,
          },
        },
      ]

      if (!includeArchivedContacts) {
        contactFilterClauses.push({
          isArchived: {
            $ne: true,
          },
        })
      }

      if (contactSearchRegex) {
        contactFilterClauses.push({
          $or: [
            {
              sourceId: contactSearchRegex,
            },
            {
              name: contactSearchRegex,
            },
            {
              firstName: contactSearchRegex,
            },
            {
              lastName: contactSearchRegex,
            },
            {
              primaryEmail: contactSearchRegex,
            },
            {
              secondaryEmail: contactSearchRegex,
            },
            {
              email3: contactSearchRegex,
            },
            {
              email4: contactSearchRegex,
            },
            {
              salesUnit: contactSearchRegex,
            },
            {
              phone: contactSearchRegex,
            },
            {
              phone2: contactSearchRegex,
            },
            {
              phoneAlt: contactSearchRegex,
            },
            {
              city: contactSearchRegex,
            },
            {
              state: contactSearchRegex,
            },
          ],
        })
      }

      const contactFilter = combineFilterClauses(contactFilterClauses)

      const [contactsTotal, contacts] = await Promise.all([
        crmContactsCollection.countDocuments(contactFilter),
        crmContactsCollection
          .find(
            contactFilter,
            {
              projection: {
                _id: 0,
                sourceId: 1,
                name: 1,
                firstName: 1,
                lastName: 1,
                primaryEmail: 1,
                secondaryEmail: 1,
                email3: 1,
                email4: 1,
                salesUnit: 1,
                accountSourceId: 1,
                accountName: 1,
                phone: 1,
                phone2: 1,
                phoneAlt: 1,
                photoUrl: 1,
                address: 1,
                city: 1,
                state: 1,
                zip: 1,
                country: 1,
                gender: 1,
                contactTypeId: 1,
                isArchived: 1,
                recordStatus: 1,
                contactOrigin: 1,
                createdDateSource: 1,
                lastImportedAt: 1,
              },
            },
          )
          .sort({ nameLower: 1, sourceId: 1 })
          .skip(contactOffset)
          .limit(contactLimit)
          .toArray(),
      ])

      return res.json({
        dealer,
        contacts,
        contactsTotal,
        contactOffset,
        contactLimit,
        hasMoreContacts: contactOffset + contacts.length < contactsTotal,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/chat-users', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { publicUser } = resolveCrmAccessScope(req)

      if (!publicUser?.isApproved) {
        return res.status(403).json({
          error: 'Approved access is required.',
        })
      }

      const { authUsersCollection } = await getCollections()
      const users = await authUsersCollection
        .find(
          {
            approvalStatus: 'approved',
          },
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ displayName: 1, email: 1 })
        .limit(300)
        .toArray()

      const publicUsers = users
        .map((document) => toPublicAuthUser(document))
        .filter((user) => Boolean(user?.uid && user.isApproved))
        .map((user) => ({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName ?? null,
          isAdmin: user.isAdmin,
          isSalesRep: user.isSalesRep,
          hasWebAccess: user.hasWebAccess,
          hasAppAccess: user.hasAppAccess,
          lastActivityAt: user.lastActivityAt ?? null,
        }))

      return res.json({
        users: publicUsers,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/dealers/:dealerSourceId/chats', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates, publicUser } = resolveCrmAccessScope(req)
      const isAdmin = Boolean(publicUser?.isApproved && publicUser?.isAdmin)
      const dealerSourceId = toTrimmedText(req.params.dealerSourceId, 160)

      if (!dealerSourceId) {
        return res.status(400).json({
          error: 'dealerSourceId is required.',
        })
      }

      const offset = toNonNegativeInteger(req.query?.offset, 0)
      const limit = Math.min(500, Math.max(1, toNonNegativeInteger(req.query?.limit, 150)))
      const collections = await getCollections()
      const { crmAccountsCollection } = collections
      const crmAccountChatsCollection = await getCrmAccountChatsCollection(collections)

      if (isSalesRep && !isAdmin && territoryStates.length === 0) {
        return res.status(403).json({
          error: 'No sales territories are assigned to this user.',
        })
      }

      const dealer = await resolveDealerOrThrow(crmAccountsCollection, dealerSourceId)

      if (isSalesRep && !isAdmin && !isDealerInTerritory(dealer.state, territoryStates)) {
        return res.status(403).json({
          error: 'You do not have territory access to this dealer.',
        })
      }

      const filter = {
        dealerSourceId: dealer.sourceId,
      }

      const [total, messages] = await Promise.all([
        crmAccountChatsCollection.countDocuments(filter),
        crmAccountChatsCollection
          .find(
            filter,
            {
              projection: {
                _id: 0,
                id: 1,
                dealerSourceId: 1,
                message: 1,
                mentionUserUids: 1,
                mentionUserEmails: 1,
                reminder: 1,
                createdAt: 1,
                createdByUid: 1,
                createdByEmail: 1,
                createdByName: 1,
                updatedAt: 1,
                updatedByUid: 1,
                updatedByEmail: 1,
                updatedByName: 1,
              },
            },
          )
          .sort({ createdAt: 1, id: 1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
      ])

      return res.json({
        messages,
        total,
        offset,
        limit,
        hasMore: offset + messages.length < total,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/dealers/:dealerSourceId/chats', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates, publicUser } = resolveCrmAccessScope(req)
      const isAdmin = Boolean(publicUser?.isApproved && publicUser?.isAdmin)
      const dealerSourceId = toTrimmedText(req.params.dealerSourceId, 160)
      const body = toOptionalObject(req.body)
      const messageText = toTrimmedText(body.message, 4000)
      const requestedMentionUserUids = normalizeUidList(body.mentionUserUids, 300)
      const requestedReminder = normalizeChatReminderInput(body.reminder)

      if (!dealerSourceId) {
        return res.status(400).json({
          error: 'dealerSourceId is required.',
        })
      }

      if (!messageText) {
        return res.status(400).json({
          error: 'message is required.',
        })
      }

      if (body.reminder && !requestedReminder) {
        return res.status(400).json({
          error: 'reminder.dueDate must be a valid ISO date in YYYY-MM-DD format.',
        })
      }

      const collections = await getCollections()
      const { crmAccountsCollection, authUsersCollection, mobileAlertsCollection } = collections
      const crmAccountChatsCollection = await getCrmAccountChatsCollection(collections)

      if (isSalesRep && !isAdmin && territoryStates.length === 0) {
        return res.status(403).json({
          error: 'No sales territories are assigned to this user.',
        })
      }

      const dealer = await resolveDealerOrThrow(crmAccountsCollection, dealerSourceId)

      if (isSalesRep && !isAdmin && !isDealerInTerritory(dealer.state, territoryStates)) {
        return res.status(403).json({
          error: 'You do not have territory access to this dealer.',
        })
      }

      const now = nowIso()
      const requesterUid = toTrimmedText(req.authUser?.uid, 200)
      const requesterEmail = toTrimmedText(req.authUser?.email, 200) || null
      const requestedRecipientUids = normalizeUidList([
        ...requestedMentionUserUids,
        ...(requestedReminder?.targetUserUids ?? []),
      ], 350)
      const recipientUsers = requestedRecipientUids.length > 0
        ? await authUsersCollection
          .find(
            {
              uid: {
                $in: requestedRecipientUids,
              },
              approvalStatus: 'approved',
            },
            {
              projection: {
                _id: 0,
              },
            },
          )
          .toArray()
        : []
      const recipientByUid = new Map(
        recipientUsers
          .map((document) => toPublicAuthUser(document))
          .filter((user) => Boolean(user?.uid))
          .map((user) => [user.uid, user]),
      )
      const mentionRecipientUids = requestedMentionUserUids
        .filter((uid) => uid !== requesterUid)
        .filter((uid) => recipientByUid.has(uid))
      const mentionRecipientEmails = mentionRecipientUids
        .map((uid) => toTrimmedText(recipientByUid.get(uid)?.email, 200))
        .filter(Boolean)
      const reminderRecipientUids = (requestedReminder?.targetUserUids ?? [])
        .filter((uid) => recipientByUid.has(uid))
      const reminderRecipientEmails = reminderRecipientUids
        .map((uid) => toTrimmedText(recipientByUid.get(uid)?.email, 200))
        .filter(Boolean)
      const reminder = requestedReminder
        ? {
          id: randomUUID(),
          dueDate: requestedReminder.dueDate,
          note: requestedReminder.note || null,
          targetUserUids: reminderRecipientUids,
          targetUserEmails: reminderRecipientEmails,
          notifiedAt: null,
          createdAt: now,
        }
        : null

      const message = {
        id: randomUUID(),
        dealerSourceId: dealer.sourceId,
        message: messageText,
        mentionUserUids: mentionRecipientUids,
        mentionUserEmails: mentionRecipientEmails,
        reminder,
        createdAt: now,
        createdByUid: requesterUid || null,
        createdByEmail: requesterEmail,
        createdByName: toTrimmedText(publicUser?.displayName, 200) || null,
      }

      await crmAccountChatsCollection.insertOne(message)

      if (mentionRecipientUids.length > 0) {
        await createCrmChatInAppAlert({
          mobileAlertsCollection,
          randomUUID,
          title: `Mentioned in engagement chat: ${dealer.name || dealer.sourceId}`,
          message: `${toTrimmedText(publicUser?.displayName || requesterEmail || 'A teammate', 120)} mentioned you: ${messageText.slice(0, 300)}`,
          createdByUid: requesterUid,
          createdByEmail: requesterEmail,
          recipientUids: mentionRecipientUids,
          metadata: {
            source: 'crm_chat_mention',
            dealerSourceId: dealer.sourceId,
            dealerName: dealer.name || null,
            chatMessageId: message.id,
          },
        })
      }

      cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)

      return res.status(201).json({
        message,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/crm/dealers/:dealerSourceId/chats/:messageId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates, publicUser } = resolveCrmAccessScope(req)
      const isAdmin = Boolean(publicUser?.isApproved && publicUser?.isAdmin)
      const dealerSourceId = toTrimmedText(req.params.dealerSourceId, 160)
      const messageId = toTrimmedText(req.params.messageId, 160)
      const body = toOptionalObject(req.body)
      const messageText = toTrimmedText(body.message, 4000)

      if (!dealerSourceId) {
        return res.status(400).json({
          error: 'dealerSourceId is required.',
        })
      }

      if (!messageId) {
        return res.status(400).json({
          error: 'messageId is required.',
        })
      }

      if (!messageText) {
        return res.status(400).json({
          error: 'message is required.',
        })
      }

      const collections = await getCollections()
      const { crmAccountsCollection } = collections
      const crmAccountChatsCollection = await getCrmAccountChatsCollection(collections)

      if (isSalesRep && !isAdmin && territoryStates.length === 0) {
        return res.status(403).json({
          error: 'No sales territories are assigned to this user.',
        })
      }

      const dealer = await resolveDealerOrThrow(crmAccountsCollection, dealerSourceId)

      if (isSalesRep && !isAdmin && !isDealerInTerritory(dealer.state, territoryStates)) {
        return res.status(403).json({
          error: 'You do not have territory access to this dealer.',
        })
      }

      const existingMessage = await crmAccountChatsCollection.findOne(
        {
          id: messageId,
          dealerSourceId: dealer.sourceId,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            dealerSourceId: 1,
            createdByUid: 1,
            createdByEmail: 1,
          },
        },
      )

      if (!existingMessage) {
        return res.status(404).json({
          error: 'Chat message not found.',
        })
      }

      if (!canManageCrmAccountChatMessage({
        publicUser,
        authUser: req.authUser,
        chatMessage: existingMessage,
      })) {
        return res.status(403).json({
          error: 'You can only edit your own chat messages unless you are an admin.',
        })
      }

      const now = nowIso()
      const message = await crmAccountChatsCollection.findOneAndUpdate(
        {
          id: messageId,
          dealerSourceId: dealer.sourceId,
        },
        {
          $set: {
            message: messageText,
            updatedAt: now,
            updatedByUid: toTrimmedText(req.authUser?.uid, 200) || null,
            updatedByEmail: toTrimmedText(req.authUser?.email, 200) || null,
            updatedByName: toTrimmedText(publicUser?.displayName, 200) || null,
          },
        },
        {
          returnDocument: 'after',
          projection: {
            _id: 0,
            id: 1,
            dealerSourceId: 1,
            message: 1,
            createdAt: 1,
            createdByUid: 1,
            createdByEmail: 1,
            createdByName: 1,
            updatedAt: 1,
            updatedByUid: 1,
            updatedByEmail: 1,
            updatedByName: 1,
          },
        },
      )

      return res.json({
        message,
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/crm/dealers/:dealerSourceId/chats/:messageId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates, publicUser } = resolveCrmAccessScope(req)
      const isAdmin = Boolean(publicUser?.isApproved && publicUser?.isAdmin)
      const dealerSourceId = toTrimmedText(req.params.dealerSourceId, 160)
      const messageId = toTrimmedText(req.params.messageId, 160)

      if (!dealerSourceId) {
        return res.status(400).json({
          error: 'dealerSourceId is required.',
        })
      }

      if (!messageId) {
        return res.status(400).json({
          error: 'messageId is required.',
        })
      }

      const collections = await getCollections()
      const { crmAccountsCollection } = collections
      const crmAccountChatsCollection = await getCrmAccountChatsCollection(collections)

      if (isSalesRep && !isAdmin && territoryStates.length === 0) {
        return res.status(403).json({
          error: 'No sales territories are assigned to this user.',
        })
      }

      const dealer = await resolveDealerOrThrow(crmAccountsCollection, dealerSourceId)

      if (isSalesRep && !isAdmin && !isDealerInTerritory(dealer.state, territoryStates)) {
        return res.status(403).json({
          error: 'You do not have territory access to this dealer.',
        })
      }

      const existingMessage = await crmAccountChatsCollection.findOne(
        {
          id: messageId,
          dealerSourceId: dealer.sourceId,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            dealerSourceId: 1,
            createdByUid: 1,
            createdByEmail: 1,
          },
        },
      )

      if (!existingMessage) {
        return res.status(404).json({
          error: 'Chat message not found.',
        })
      }

      if (!canManageCrmAccountChatMessage({
        publicUser,
        authUser: req.authUser,
        chatMessage: existingMessage,
      })) {
        return res.status(403).json({
          error: 'You can only delete your own chat messages unless you are an admin.',
        })
      }

      await crmAccountChatsCollection.deleteOne({
        id: messageId,
        dealerSourceId: dealer.sourceId,
      })

      cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)

      return res.json({
        ok: true,
        messageId,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/quotes/:quoteId/chats', requireFirebaseAuth, async (req, res, next) => {
    try {
      const accessScope = resolveCrmAccessScope(req)
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)
      const quoteId = toTrimmedText(req.params.quoteId, 160)

      if (!quoteId) {
        return res.status(400).json({
          error: 'quoteId is required.',
        })
      }

      const offset = toNonNegativeInteger(req.query?.offset, 0)
      const limit = Math.min(500, Math.max(1, toNonNegativeInteger(req.query?.limit, 150)))
      const collections = await getCollections()
      const { crmAccountsCollection, crmQuotesCollection } = collections
      const crmQuoteChatsCollection = await getCrmQuoteChatsCollection(collections)
      const quote = await resolveQuoteOrThrow(crmQuotesCollection, quoteId)
      assertCanAccessQuoteBySalesRep(quote, quoteAccessScope)
      const filter = {
        quoteId: quote.id,
      }

      const [total, messages] = await Promise.all([
        crmQuoteChatsCollection.countDocuments(filter),
        crmQuoteChatsCollection
          .find(
            filter,
            {
              projection: {
                _id: 0,
                id: 1,
                quoteId: 1,
                dealerSourceId: 1,
                quoteNumber: 1,
                message: 1,
                mentionUserUids: 1,
                mentionUserEmails: 1,
                reminder: 1,
                createdAt: 1,
                createdByUid: 1,
                createdByEmail: 1,
                createdByName: 1,
                updatedAt: 1,
                updatedByUid: 1,
                updatedByEmail: 1,
                updatedByName: 1,
              },
            },
          )
          .sort({ createdAt: 1, id: 1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
      ])

      return res.json({
        messages,
        total,
        offset,
        limit,
        hasMore: offset + messages.length < total,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/quotes/:quoteId/chats', requireFirebaseAuth, async (req, res, next) => {
    try {
      const accessScope = resolveCrmAccessScope(req)
      const { publicUser } = accessScope
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)
      const quoteId = toTrimmedText(req.params.quoteId, 160)
      const body = toOptionalObject(req.body)
      const messageText = toTrimmedText(body.message, 4000)
      const requestedMentionUserUids = normalizeUidList(body.mentionUserUids, 300)
      const requestedReminder = normalizeChatReminderInput(body.reminder)

      if (!quoteId) {
        return res.status(400).json({
          error: 'quoteId is required.',
        })
      }

      if (!messageText) {
        return res.status(400).json({
          error: 'message is required.',
        })
      }

      if (body.reminder && !requestedReminder) {
        return res.status(400).json({
          error: 'reminder.dueDate must be a valid ISO date in YYYY-MM-DD format.',
        })
      }

      const collections = await getCollections()
      const {
        crmQuotesCollection,
        authUsersCollection,
        mobileAlertsCollection,
      } = collections
      const crmQuoteChatsCollection = await getCrmQuoteChatsCollection(collections)
      const quote = await resolveQuoteOrThrow(crmQuotesCollection, quoteId)
      assertCanAccessQuoteBySalesRep(quote, quoteAccessScope)
      const now = nowIso()
      const requesterUid = toTrimmedText(req.authUser?.uid, 200)
      const requesterEmail = toTrimmedText(req.authUser?.email, 200) || null
      const requestedRecipientUids = normalizeUidList([
        ...requestedMentionUserUids,
        ...(requestedReminder?.targetUserUids ?? []),
      ], 350)
      const recipientUsers = requestedRecipientUids.length > 0
        ? await authUsersCollection
          .find(
            {
              uid: {
                $in: requestedRecipientUids,
              },
              approvalStatus: 'approved',
            },
            {
              projection: {
                _id: 0,
              },
            },
          )
          .toArray()
        : []
      const recipientByUid = new Map(
        recipientUsers
          .map((document) => toPublicAuthUser(document))
          .filter((user) => Boolean(user?.uid))
          .map((user) => [user.uid, user]),
      )
      const mentionRecipientUids = requestedMentionUserUids
        .filter((uid) => uid !== requesterUid)
        .filter((uid) => recipientByUid.has(uid))
      const mentionRecipientEmails = mentionRecipientUids
        .map((uid) => toTrimmedText(recipientByUid.get(uid)?.email, 200))
        .filter(Boolean)
      const reminderRecipientUids = (requestedReminder?.targetUserUids ?? [])
        .filter((uid) => recipientByUid.has(uid))
      const reminderRecipientEmails = reminderRecipientUids
        .map((uid) => toTrimmedText(recipientByUid.get(uid)?.email, 200))
        .filter(Boolean)
      const reminder = requestedReminder
        ? {
          id: randomUUID(),
          dueDate: requestedReminder.dueDate,
          note: requestedReminder.note || null,
          targetUserUids: reminderRecipientUids,
          targetUserEmails: reminderRecipientEmails,
          notifiedAt: null,
          createdAt: now,
        }
        : null

      const message = {
        id: randomUUID(),
        quoteId: quote.id,
        dealerSourceId: quote.dealerSourceId,
        quoteNumber: quote.quoteNumber,
        message: messageText,
        mentionUserUids: mentionRecipientUids,
        mentionUserEmails: mentionRecipientEmails,
        reminder,
        createdAt: now,
        createdByUid: requesterUid || null,
        createdByEmail: requesterEmail,
        createdByName: toTrimmedText(publicUser?.displayName, 200) || null,
      }

      await crmQuoteChatsCollection.insertOne(message)

      if (mentionRecipientUids.length > 0) {
        const quoteLabel = quote.quoteNumber || quote.title || quote.id

        await createCrmChatInAppAlert({
          mobileAlertsCollection,
          randomUUID,
          title: `Mentioned in quote chat: ${quoteLabel}`,
          message: `${toTrimmedText(publicUser?.displayName || requesterEmail || 'A teammate', 120)} mentioned you: ${messageText.slice(0, 300)}`,
          createdByUid: requesterUid,
          createdByEmail: requesterEmail,
          recipientUids: mentionRecipientUids,
          metadata: {
            source: 'crm_quote_chat_mention',
            quoteId: quote.id,
            quoteNumber: quote.quoteNumber,
            dealerSourceId: quote.dealerSourceId,
            dealerName: quote.dealerName,
            chatMessageId: message.id,
          },
        })
      }

      return res.status(201).json({
        message,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/crm/quotes/:quoteId/chats/:messageId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const accessScope = resolveCrmAccessScope(req)
      const { publicUser } = accessScope
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)
      const quoteId = toTrimmedText(req.params.quoteId, 160)
      const messageId = toTrimmedText(req.params.messageId, 160)
      const body = toOptionalObject(req.body)
      const messageText = toTrimmedText(body.message, 4000)

      if (!quoteId) {
        return res.status(400).json({
          error: 'quoteId is required.',
        })
      }

      if (!messageId) {
        return res.status(400).json({
          error: 'messageId is required.',
        })
      }

      if (!messageText) {
        return res.status(400).json({
          error: 'message is required.',
        })
      }

      const collections = await getCollections()
      const { crmQuotesCollection } = collections
      const crmQuoteChatsCollection = await getCrmQuoteChatsCollection(collections)
      const quote = await resolveQuoteOrThrow(crmQuotesCollection, quoteId)
      assertCanAccessQuoteBySalesRep(quote, quoteAccessScope)
      const existingMessage = await crmQuoteChatsCollection.findOne(
        {
          id: messageId,
          quoteId: quote.id,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            quoteId: 1,
            createdByUid: 1,
            createdByEmail: 1,
          },
        },
      )

      if (!existingMessage) {
        return res.status(404).json({
          error: 'Chat message not found.',
        })
      }

      if (!canManageCrmAccountChatMessage({
        publicUser,
        authUser: req.authUser,
        chatMessage: existingMessage,
      })) {
        return res.status(403).json({
          error: 'You can only edit your own chat messages unless you are an admin.',
        })
      }

      const now = nowIso()
      const message = await crmQuoteChatsCollection.findOneAndUpdate(
        {
          id: messageId,
          quoteId: quote.id,
        },
        {
          $set: {
            message: messageText,
            updatedAt: now,
            updatedByUid: toTrimmedText(req.authUser?.uid, 200) || null,
            updatedByEmail: toTrimmedText(req.authUser?.email, 200) || null,
            updatedByName: toTrimmedText(publicUser?.displayName, 200) || null,
          },
        },
        {
          returnDocument: 'after',
          projection: {
            _id: 0,
            id: 1,
            quoteId: 1,
            dealerSourceId: 1,
            quoteNumber: 1,
            message: 1,
            mentionUserUids: 1,
            mentionUserEmails: 1,
            reminder: 1,
            createdAt: 1,
            createdByUid: 1,
            createdByEmail: 1,
            createdByName: 1,
            updatedAt: 1,
            updatedByUid: 1,
            updatedByEmail: 1,
            updatedByName: 1,
          },
        },
      )

      return res.json({
        message,
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/crm/quotes/:quoteId/chats/:messageId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const accessScope = resolveCrmAccessScope(req)
      const { publicUser } = accessScope
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)
      const quoteId = toTrimmedText(req.params.quoteId, 160)
      const messageId = toTrimmedText(req.params.messageId, 160)

      if (!quoteId) {
        return res.status(400).json({
          error: 'quoteId is required.',
        })
      }

      if (!messageId) {
        return res.status(400).json({
          error: 'messageId is required.',
        })
      }

      const collections = await getCollections()
      const { crmQuotesCollection } = collections
      const crmQuoteChatsCollection = await getCrmQuoteChatsCollection(collections)
      const quote = await resolveQuoteOrThrow(crmQuotesCollection, quoteId)
      assertCanAccessQuoteBySalesRep(quote, quoteAccessScope)
      const existingMessage = await crmQuoteChatsCollection.findOne(
        {
          id: messageId,
          quoteId: quote.id,
        },
        {
          projection: {
            _id: 0,
            id: 1,
            quoteId: 1,
            createdByUid: 1,
            createdByEmail: 1,
          },
        },
      )

      if (!existingMessage) {
        return res.status(404).json({
          error: 'Chat message not found.',
        })
      }

      if (!canManageCrmAccountChatMessage({
        publicUser,
        authUser: req.authUser,
        chatMessage: existingMessage,
      })) {
        return res.status(403).json({
          error: 'You can only delete your own chat messages unless you are an admin.',
        })
      }

      await crmQuoteChatsCollection.deleteOne({
        id: messageId,
        quoteId: quote.id,
      })

      return res.json({
        ok: true,
        messageId,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/crm/dealers/:dealerSourceId', requireFirebaseAuth, requireSalesManagerOrAdminRole, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates } = resolveCrmAccessScope(req)
      const dealerSourceId = toTrimmedText(req.params.dealerSourceId, 160)

      if (!dealerSourceId) {
        return res.status(400).json({
          error: 'dealerSourceId is required.',
        })
      }

      const body = toOptionalObject(req.body)
      const { crmAccountsCollection } = await getCollections()

      if (isSalesRep && territoryStates.length === 0) {
        return res.status(403).json({
          error: 'No sales territories are assigned to this user.',
        })
      }

      const existingDealer = await crmAccountsCollection.findOne(
        {
          sourceId: dealerSourceId,
        },
        {
          projection: {
            _id: 0,
            sourceId: 1,
            state: 1,
            recordStatus: 1,
          },
        },
      )

      if (!existingDealer) {
        return res.status(404).json({
          error: 'Dealer not found.',
        })
      }

      if (normalizeCrmRecordStatus(existingDealer.recordStatus) === crmRecordStatusDeleted) {
        return res.status(404).json({
          error: 'Dealer not found.',
        })
      }

      if (isSalesRep && !isDealerInTerritory(existingDealer.state, territoryStates)) {
        return res.status(403).json({
          error: 'You do not have territory access to this dealer.',
        })
      }

      const updates = {}

      if (Object.prototype.hasOwnProperty.call(body, 'name')) {
        const nextName = toTrimmedText(body.name, 240)

        if (!nextName) {
          return res.status(400).json({
            error: 'name cannot be empty.',
          })
        }

        updates.name = nextName
        updates.nameLower = toLowerText(nextName, 240)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'quoteCompanyName')) {
        updates.quoteCompanyName = toTrimmedText(body.quoteCompanyName, 240) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
        updates.phone = toTrimmedText(body.phone, 80) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'phone2')) {
        updates.phone2 = toTrimmedText(body.phone2, 80) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'email')) {
        const nextEmail = toTrimmedText(body.email, 200)
        updates.email = nextEmail || null
        updates.emailLower = toLowerText(nextEmail, 200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'email2')) {
        updates.email2 = toTrimmedText(body.email2, 200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'address')) {
        updates.address = toTrimmedText(body.address, 400) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'city')) {
        updates.city = toTrimmedText(body.city, 160) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'state')) {
        updates.state = toTrimmedText(body.state, 80) || null

        if (isSalesRep && !isDealerInTerritory(updates.state, territoryStates)) {
          return res.status(403).json({
            error: 'State must remain within your assigned sales territories.',
          })
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'zip')) {
        updates.zip = toTrimmedText(body.zip, 40) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'country')) {
        updates.country = toTrimmedText(body.country, 120) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'industry')) {
        updates.industry = toTrimmedText(body.industry, 160) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'accountClass')) {
        updates.accountClass = toTrimmedText(body.accountClass, 160) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'accountType')) {
        const accountType = toLowerText(body.accountType, 40)

        if (accountType !== 'dealer' && accountType !== 'designer') {
          return res.status(400).json({
            error: "accountType must be 'dealer' or 'designer'.",
          })
        }

        updates.accountType = accountType
        updates.accountClass = accountType
      }

      if (Object.prototype.hasOwnProperty.call(body, 'salesRep')) {
        updates.salesRep = toTrimmedText(body.salesRep, 200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'paymentTerms')) {
        updates.paymentTerms = toTrimmedText(body.paymentTerms, 240) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'website')) {
        updates.website = toTrimmedText(body.website, 240) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'emails')) {
        const normalizedEmails = normalizeEmailList(body.emails)

        updates.emails = normalizedEmails
        updates.email = normalizedEmails[0] || null
        updates.emailLower = toLowerText(normalizedEmails[0], 200) || null
        updates.email2 = normalizedEmails[1] || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'accountText')) {
        updates.accountText = toTrimmedText(body.accountText, 4000) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'owner')) {
        updates.owner = toTrimmedText(body.owner, 200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'ownerEmail')) {
        const nextOwnerEmail = toTrimmedText(body.ownerEmail, 200)
        updates.ownerEmail = nextOwnerEmail || null
        updates.ownerEmailLower = toLowerText(nextOwnerEmail, 200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'pictureUrl')) {
        updates.pictureUrl = toTrimmedText(body.pictureUrl, 500) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'pictureUrlSource')) {
        updates.pictureUrlSource = toTrimmedText(body.pictureUrlSource, 500) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'socialMedia')) {
        updates.socialMedia = toTrimmedText(body.socialMedia, 2000) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'socialMediaLinks')) {
        const normalizedLinks = normalizeSocialMediaLinks(body.socialMediaLinks)
        const hasLinks = Object.keys(normalizedLinks).length > 0

        updates.socialMediaLinks = hasLinks
          ? normalizedLinks
          : null

        if (!Object.prototype.hasOwnProperty.call(body, 'socialMedia')) {
          updates.socialMedia = hasLinks
            ? toCompactSocialMediaText(normalizedLinks)
            : null
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'isArchived')) {
        updates.isArchived = toBoolean(body.isArchived)

        if (updates.isArchived) {
          updates.deletedAt = nowIso()
          updates.deletedByEmail = toTrimmedText(req.authUser?.email, 200) || null
        } else {
          // Un-archiving clears the audit trail
          updates.recordStatus = crmRecordStatusActive
          updates.deletedAt = null
          updates.deletedByEmail = null
          updates.deleteRequestedAt = null
          updates.deleteRequestedByUid = null
          updates.deleteRequestedByEmail = null
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'isFavorite')) {
        updates.isFavorite = toBoolean(body.isFavorite)
      }

      if (Object.keys(updates).length === 0) {
        const dealer = await crmAccountsCollection.findOne(
          {
            sourceId: dealerSourceId,
          },
          {
            projection: {
              _id: 0,
              sourceId: 1,
              name: 1,
              phone: 1,
              phone2: 1,
              email: 1,
              email2: 1,
              address: 1,
              city: 1,
              state: 1,
              zip: 1,
              country: 1,
              industry: 1,
              accountClass: 1,
              accountType: 1,
              salesRep: 1,
              website: 1,
              emails: 1,
              accountText: 1,
              owner: 1,
              ownerEmail: 1,
              pictureUrl: 1,
              pictureUrlSource: 1,
              socialMedia: 1,
              socialMediaLinks: 1,
              recordStatus: 1,
              isArchived: 1,
              isFavorite: 1,
              contactCountSource: 1,
              createdDateSource: 1,
              modifiedDateSource: 1,
              lastImportedAt: 1,
            },
          },
        )

        return res.json({
          dealer,
        })
      }

      const now = nowIso()

      updates.modifiedDateSource = now
      updates.updatedAt = now

      const dealer = await crmAccountsCollection.findOneAndUpdate(
        {
          sourceId: dealerSourceId,
        },
        {
          $set: updates,
        },
        {
          returnDocument: 'after',
          projection: {
            _id: 0,
            sourceId: 1,
            name: 1,
            phone: 1,
            phone2: 1,
            email: 1,
            email2: 1,
            address: 1,
            city: 1,
            state: 1,
            zip: 1,
            country: 1,
            industry: 1,
            accountClass: 1,
            accountType: 1,
            salesRep: 1,
            website: 1,
            emails: 1,
            accountText: 1,
            owner: 1,
            ownerEmail: 1,
            pictureUrl: 1,
            pictureUrlSource: 1,
            socialMedia: 1,
            socialMediaLinks: 1,
            recordStatus: 1,
            isArchived: 1,
            isFavorite: 1,
            contactCountSource: 1,
            createdDateSource: 1,
            modifiedDateSource: 1,
            lastImportedAt: 1,
          },
        },
      )

      cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
      cacheDelete(OVERVIEW_CACHE_KEY)

      return res.json({
        dealer,
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/crm/dealers/:dealerSourceId', requireFirebaseAuth, requireSalesManagerOrAdminRole, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates, publicUser } = resolveCrmAccessScope(req)
      const isAdmin = Boolean(publicUser?.isApproved && publicUser?.isAdmin)
      const dealerSourceId = toTrimmedText(req.params.dealerSourceId, 160)

      if (!dealerSourceId) {
        return res.status(400).json({
          error: 'dealerSourceId is required.',
        })
      }

      const archiveContacts = isAdmin && toBoolean(req.query?.archiveContacts)
      const { crmAccountsCollection, crmContactsCollection } = await getCollections()

      if (isSalesRep && territoryStates.length === 0) {
        return res.status(403).json({
          error: 'No sales territories are assigned to this user.',
        })
      }

      const existingDealer = await crmAccountsCollection.findOne(
        {
          sourceId: dealerSourceId,
        },
        {
          projection: {
            _id: 0,
            sourceId: 1,
            state: 1,
            isArchived: 1,
            recordStatus: 1,
          },
        },
      )

      if (!existingDealer) {
        return res.status(404).json({
          error: 'Dealer not found.',
        })
      }

      if (isSalesRep && !isDealerInTerritory(existingDealer.state, territoryStates)) {
        return res.status(403).json({
          error: 'You do not have territory access to this dealer.',
        })
      }

      const archivedAt = nowIso()
      const archivedByEmail = toTrimmedText(req.authUser?.email, 200) || null
      const archivedByUid = toTrimmedText(req.authUser?.uid, 200) || null
      let dealer = null

      if (!isAdmin) {
        dealer = await crmAccountsCollection.findOneAndUpdate(
          {
            sourceId: dealerSourceId,
          },
          {
            $set: {
              recordStatus: crmRecordStatusDeleted,
              isArchived: true,
              deletedAt: archivedAt,
              deletedByEmail: archivedByEmail,
              deleteRequestedAt: archivedAt,
              deleteRequestedByUid: archivedByUid,
              deleteRequestedByEmail: archivedByEmail,
              modifiedDateSource: archivedAt,
              updatedAt: archivedAt,
            },
          },
          {
            returnDocument: 'after',
            projection: {
              _id: 0,
              sourceId: 1,
              name: 1,
              phone: 1,
              phone2: 1,
              email: 1,
              email2: 1,
              address: 1,
              city: 1,
              state: 1,
              zip: 1,
              country: 1,
              industry: 1,
              accountClass: 1,
              accountType: 1,
              salesRep: 1,
              website: 1,
              emails: 1,
              accountText: 1,
              owner: 1,
              ownerEmail: 1,
              pictureUrl: 1,
              pictureUrlSource: 1,
              socialMedia: 1,
              socialMediaLinks: 1,
              recordStatus: 1,
              isArchived: 1,
              isFavorite: 1,
              contactCountSource: 1,
              createdDateSource: 1,
              modifiedDateSource: 1,
              lastImportedAt: 1,
            },
          },
        )

        cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
        cacheDelete(OVERVIEW_CACHE_KEY)

        return res.json({
          dealer,
          archivedContactsCount: 0,
          archiveContactsApplied: false,
          queuedForDeletion: true,
        })
      }

      if (
        normalizeCrmRecordStatus(existingDealer.recordStatus) === crmRecordStatusDeleted
        || toBoolean(existingDealer.isArchived)
      ) {
        dealer = await crmAccountsCollection.findOne(
          {
            sourceId: dealerSourceId,
          },
          {
            projection: {
              _id: 0,
              sourceId: 1,
              name: 1,
              phone: 1,
              phone2: 1,
              email: 1,
              email2: 1,
              address: 1,
              city: 1,
              state: 1,
              zip: 1,
              country: 1,
              industry: 1,
              accountClass: 1,
              accountType: 1,
              salesRep: 1,
              website: 1,
              emails: 1,
              accountText: 1,
              owner: 1,
              ownerEmail: 1,
              pictureUrl: 1,
              pictureUrlSource: 1,
              socialMedia: 1,
              socialMediaLinks: 1,
              recordStatus: 1,
              isArchived: 1,
              isFavorite: 1,
              contactCountSource: 1,
              createdDateSource: 1,
              modifiedDateSource: 1,
              lastImportedAt: 1,
            },
          },
        )
      } else {
        dealer = await crmAccountsCollection.findOneAndUpdate(
          {
            sourceId: dealerSourceId,
          },
          {
            $set: {
              isArchived: true,
              deletedAt: archivedAt,
              deletedByEmail: archivedByEmail,
              modifiedDateSource: archivedAt,
              updatedAt: archivedAt,
            },
          },
          {
            returnDocument: 'after',
            projection: {
              _id: 0,
              sourceId: 1,
              name: 1,
              phone: 1,
              phone2: 1,
              email: 1,
              email2: 1,
              address: 1,
              city: 1,
              state: 1,
              zip: 1,
              country: 1,
              industry: 1,
              accountClass: 1,
              accountType: 1,
              salesRep: 1,
              website: 1,
              emails: 1,
              accountText: 1,
              owner: 1,
              ownerEmail: 1,
              pictureUrl: 1,
              pictureUrlSource: 1,
              socialMedia: 1,
              socialMediaLinks: 1,
              recordStatus: 1,
              isArchived: 1,
              isFavorite: 1,
              contactCountSource: 1,
              createdDateSource: 1,
              modifiedDateSource: 1,
              lastImportedAt: 1,
            },
          },
        )
      }

      let archivedContactsCount = 0

      if (archiveContacts) {
        const contactsResult = await crmContactsCollection.updateMany(
          {
            accountSourceId: dealerSourceId,
            isArchived: {
              $ne: true,
            },
          },
          {
            $set: {
              isArchived: true,
              deletedAt: archivedAt,
              deletedByEmail: archivedByEmail,
              updatedAt: archivedAt,
            },
          },
        )

        archivedContactsCount = Number(contactsResult.modifiedCount ?? 0)
      }

      cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
      cacheDelete(OVERVIEW_CACHE_KEY)

      return res.json({
        dealer,
        archivedContactsCount,
        archiveContactsApplied: archiveContacts,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/dealers/:dealerSourceId/contacts', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates } = resolveCrmAccessScope(req)
      const dealerSourceId = toTrimmedText(req.params.dealerSourceId, 160)

      if (!dealerSourceId) {
        return res.status(400).json({
          error: 'dealerSourceId is required.',
        })
      }

      const body = toOptionalObject(req.body)
      const {
        crmAccountsCollection,
        crmContactsCollection,
      } = await getCollections()

      if (isSalesRep && territoryStates.length === 0) {
        return res.status(403).json({
          error: 'No sales territories are assigned to this user.',
        })
      }

      const dealer = await resolveDealerOrThrow(crmAccountsCollection, dealerSourceId)

      if (isSalesRep && !isDealerInTerritory(dealer.state, territoryStates)) {
        return res.status(403).json({
          error: 'You do not have territory access to this dealer.',
        })
      }
      const requestedSourceId = toTrimmedText(body.sourceId, 160)
      const contactSourceId = requestedSourceId || `manual-${randomUUID()}`

      const existingContact = await crmContactsCollection.findOne(
        {
          sourceId: contactSourceId,
        },
        {
          projection: {
            _id: 0,
            sourceId: 1,
          },
        },
      )

      if (existingContact) {
        return res.status(409).json({
          error: 'sourceId already exists. Use a unique sourceId or omit it for auto-generation.',
        })
      }

      const firstName = toTrimmedText(body.firstName, 160)
      const lastName = toTrimmedText(body.lastName, 160)
      const explicitName = toTrimmedText(body.name, 240)
      const combinedName = [firstName, lastName].filter(Boolean).join(' ')
      const name = explicitName || combinedName

      if (!name) {
        return res.status(400).json({
          error: 'name is required (or provide firstName/lastName).',
        })
      }

      const primaryEmail = toTrimmedText(body.primaryEmail, 200)
      const secondaryEmail = toTrimmedText(body.secondaryEmail, 200)
      const now = nowIso()

      const contact = {
        id: contactSourceId,
        sourceId: contactSourceId,
        name,
        nameLower: toLowerText(name, 240),
        firstName: firstName || null,
        lastName: lastName || null,
        primaryEmail: primaryEmail || null,
        primaryEmailLower: toLowerText(primaryEmail, 200) || null,
        secondaryEmail: secondaryEmail || null,
        secondaryEmailLower: toLowerText(secondaryEmail, 200) || null,
        email3: toTrimmedText(body.email3, 200) || null,
        email4: toTrimmedText(body.email4, 200) || null,
        salesUnit: toTrimmedText(body.salesUnit, 160) || null,
        accountSourceId: dealer.sourceId,
        accountName: dealer.name || dealer.sourceId,
        phone: toTrimmedText(body.phone, 80) || null,
        phone2: toTrimmedText(body.phone2, 80) || null,
        phoneAlt: toTrimmedText(body.phoneAlt, 80) || null,
        address: toTrimmedText(body.address, 400) || null,
        city: toTrimmedText(body.city, 160) || null,
        state: toTrimmedText(body.state, 80) || null,
        zip: toTrimmedText(body.zip, 40) || null,
        country: toTrimmedText(body.country, 120) || null,
        gender: toTrimmedText(body.gender, 50) || null,
        contactTypeId: toTrimmedText(body.contactTypeId, 160) || null,
        photoUrl: toTrimmedText(body.photoUrl, 500) || null,
        recordStatus: crmRecordStatusActive,
        isArchived: toBoolean(body.isArchived),
        contactOrigin: 'manual',
        createdDateSource: toIsoDateOrNull(body.createdDateSource) || now,
        lastImportedAt: now,
        createdAt: now,
        updatedAt: now,
      }

      await crmContactsCollection.insertOne(contact)

      cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
      cacheDelete(OVERVIEW_CACHE_KEY)

      return res.status(201).json({
        contact,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/crm/contacts/:contactSourceId', requireFirebaseAuth, requireApprovedCrmAccess, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates } = resolveCrmAccessScope(req)
      const contactSourceId = toTrimmedText(req.params.contactSourceId, 160)

      if (!contactSourceId) {
        return res.status(400).json({
          error: 'contactSourceId is required.',
        })
      }

      const body = toOptionalObject(req.body)
      const {
        crmAccountsCollection,
        crmContactsCollection,
      } = await getCollections()

      const salesRepDealerSourceIds = isSalesRep
        ? await resolveTerritoryDealerSourceIds(crmAccountsCollection, territoryStates)
        : []
      const salesRepDealerSourceIdSet = new Set(salesRepDealerSourceIds)

      if (isSalesRep && territoryStates.length === 0) {
        return res.status(403).json({
          error: 'No sales territories are assigned to this user.',
        })
      }

      const existingContact = await crmContactsCollection.findOne(
        {
          sourceId: contactSourceId,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!existingContact) {
        return res.status(404).json({
          error: 'Contact not found.',
        })
      }

      if (normalizeCrmRecordStatus(existingContact.recordStatus) === crmRecordStatusDeleted) {
        return res.status(404).json({
          error: 'Contact not found.',
        })
      }

      if (isSalesRep) {
        const existingDealerSourceId = toTrimmedText(existingContact.accountSourceId, 160)
        const existingContactState = toTrimmedText(existingContact.state, 80)
        const hasDealerAccess = existingDealerSourceId
          ? salesRepDealerSourceIdSet.has(existingDealerSourceId)
          : false
        const hasStateAccess = !existingDealerSourceId
          ? isDealerInTerritory(existingContactState, territoryStates)
          : false

        if (!hasDealerAccess && !hasStateAccess) {
          return res.status(403).json({
            error: 'You do not have territory access to this contact.',
          })
        }
      }

      const updates = {}

      const hasFirstName = Object.prototype.hasOwnProperty.call(body, 'firstName')
      const hasLastName = Object.prototype.hasOwnProperty.call(body, 'lastName')
      const hasName = Object.prototype.hasOwnProperty.call(body, 'name')

      if (hasFirstName) {
        updates.firstName = toTrimmedText(body.firstName, 160) || null
      }

      if (hasLastName) {
        updates.lastName = toTrimmedText(body.lastName, 160) || null
      }

      if (hasName) {
        const nextName = toTrimmedText(body.name, 240)

        if (!nextName) {
          return res.status(400).json({
            error: 'name cannot be empty.',
          })
        }

        updates.name = nextName
        updates.nameLower = toLowerText(nextName, 240)
      } else if (hasFirstName || hasLastName) {
        const firstName = hasFirstName
          ? updates.firstName
          : (toTrimmedText(existingContact.firstName, 160) || null)
        const lastName = hasLastName
          ? updates.lastName
          : (toTrimmedText(existingContact.lastName, 160) || null)
        const combinedName = [firstName, lastName].filter(Boolean).join(' ')

        if (combinedName) {
          updates.name = combinedName
          updates.nameLower = toLowerText(combinedName, 240)
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'primaryEmail')) {
        const nextPrimaryEmail = toTrimmedText(body.primaryEmail, 200)
        updates.primaryEmail = nextPrimaryEmail || null
        updates.primaryEmailLower = toLowerText(nextPrimaryEmail, 200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'secondaryEmail')) {
        const nextSecondaryEmail = toTrimmedText(body.secondaryEmail, 200)
        updates.secondaryEmail = nextSecondaryEmail || null
        updates.secondaryEmailLower = toLowerText(nextSecondaryEmail, 200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'email3')) {
        updates.email3 = toTrimmedText(body.email3, 200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'email4')) {
        updates.email4 = toTrimmedText(body.email4, 200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'salesUnit')) {
        updates.salesUnit = toTrimmedText(body.salesUnit, 160) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
        updates.phone = toTrimmedText(body.phone, 80) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'phone2')) {
        updates.phone2 = toTrimmedText(body.phone2, 80) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'phoneAlt')) {
        updates.phoneAlt = toTrimmedText(body.phoneAlt, 80) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'address')) {
        updates.address = toTrimmedText(body.address, 400) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'city')) {
        updates.city = toTrimmedText(body.city, 160) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'state')) {
        updates.state = toTrimmedText(body.state, 80) || null

        if (
          isSalesRep
          && !toTrimmedText(existingContact.accountSourceId, 160)
          && !isDealerInTerritory(updates.state, territoryStates)
        ) {
          return res.status(403).json({
            error: 'State must remain within your assigned sales territories.',
          })
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'zip')) {
        updates.zip = toTrimmedText(body.zip, 40) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'country')) {
        updates.country = toTrimmedText(body.country, 120) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'gender')) {
        updates.gender = toTrimmedText(body.gender, 50) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'contactTypeId')) {
        updates.contactTypeId = toTrimmedText(body.contactTypeId, 160) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'photoUrl')) {
        updates.photoUrl = toTrimmedText(body.photoUrl, 500) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'isArchived')) {
        updates.isArchived = toBoolean(body.isArchived)

        if (!updates.isArchived) {
          updates.recordStatus = crmRecordStatusActive
          updates.deletedAt = null
          updates.deletedByEmail = null
          updates.deleteRequestedAt = null
          updates.deleteRequestedByUid = null
          updates.deleteRequestedByEmail = null
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'dealerSourceId')) {
        const nextDealerSourceId = toTrimmedText(body.dealerSourceId, 160)

        if (!nextDealerSourceId) {
          updates.accountSourceId = null
          updates.accountName = null

          if (!Object.prototype.hasOwnProperty.call(body, 'contactOrigin')) {
            updates.contactOrigin = 'unlinked'
          }
        } else {
          const dealer = await resolveDealerOrThrow(crmAccountsCollection, nextDealerSourceId)

          if (isSalesRep && !isDealerInTerritory(dealer.state, territoryStates)) {
            return res.status(403).json({
              error: 'You do not have territory access to the selected dealer.',
            })
          }

          updates.accountSourceId = dealer.sourceId
          updates.accountName = dealer.name || dealer.sourceId

          if (!Object.prototype.hasOwnProperty.call(body, 'contactOrigin')) {
            updates.contactOrigin = 'linked'
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'contactOrigin')) {
        const nextContactOrigin = toLowerText(body.contactOrigin, 40)

        if (!nextContactOrigin) {
          return res.status(400).json({
            error: 'contactOrigin cannot be empty.',
          })
        }

        const allowedContactOrigins = ['linked', 'unlinked', 'manual']

        if (!allowedContactOrigins.includes(nextContactOrigin)) {
          return res.status(400).json({
            error: `contactOrigin must be one of: ${allowedContactOrigins.join(', ')}`,
          })
        }

        updates.contactOrigin = nextContactOrigin
      }

      if (Object.keys(updates).length === 0) {
        return res.json({
          contact: existingContact,
        })
      }

      if (isSalesRep) {
        const effectiveDealerSourceId = toTrimmedText(
          Object.prototype.hasOwnProperty.call(updates, 'accountSourceId')
            ? updates.accountSourceId
            : existingContact.accountSourceId,
          160,
        )

        if (effectiveDealerSourceId) {
          if (!salesRepDealerSourceIdSet.has(effectiveDealerSourceId)) {
            return res.status(403).json({
              error: 'You do not have territory access to this contact dealer.',
            })
          }
        } else {
          const effectiveState = toTrimmedText(
            Object.prototype.hasOwnProperty.call(updates, 'state')
              ? updates.state
              : existingContact.state,
            80,
          )

          if (!isDealerInTerritory(effectiveState, territoryStates)) {
            return res.status(403).json({
              error: 'Unlinked contacts must stay within your territory states.',
            })
          }
        }
      }

      const now = nowIso()

      updates.updatedAt = now

      const contact = await crmContactsCollection.findOneAndUpdate(
        {
          sourceId: contactSourceId,
        },
        {
          $set: updates,
        },
        {
          returnDocument: 'after',
          projection: {
            _id: 0,
          },
        },
      )

      cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
      cacheDelete(OVERVIEW_CACHE_KEY)

      return res.json({
        contact,
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/crm/contacts/:contactSourceId', requireFirebaseAuth, requireSalesManagerOrAdminRole, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates } = resolveCrmAccessScope(req)
      const contactSourceId = toTrimmedText(req.params.contactSourceId, 160)

      if (!contactSourceId) {
        return res.status(400).json({
          error: 'contactSourceId is required.',
        })
      }

      const {
        crmAccountsCollection,
        crmContactsCollection,
      } = await getCollections()

      if (isSalesRep && territoryStates.length === 0) {
        return res.status(403).json({
          error: 'No sales territories are assigned to this user.',
        })
      }

      const salesRepDealerSourceIds = isSalesRep
        ? await resolveTerritoryDealerSourceIds(crmAccountsCollection, territoryStates)
        : []
      const salesRepDealerSourceIdSet = new Set(salesRepDealerSourceIds)

      const existingContact = await crmContactsCollection.findOne(
        {
          sourceId: contactSourceId,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!existingContact) {
        return res.status(404).json({
          error: 'Contact not found.',
        })
      }

      if (isSalesRep) {
        const linkedDealerSourceId = toTrimmedText(existingContact.accountSourceId, 160)
        const contactState = toTrimmedText(existingContact.state, 80)
        const hasDealerAccess = linkedDealerSourceId
          ? salesRepDealerSourceIdSet.has(linkedDealerSourceId)
          : false
        const hasStateAccess = !linkedDealerSourceId
          ? isDealerInTerritory(contactState, territoryStates)
          : false

        if (!hasDealerAccess && !hasStateAccess) {
          return res.status(403).json({
            error: 'You do not have territory access to this contact.',
          })
        }
      }

      if (normalizeCrmRecordStatus(existingContact.recordStatus) === crmRecordStatusDeleted) {
        return res.json({
          contact: existingContact,
          queuedForDeletion: true,
        })
      }

      if (isSalesRep) {
        const deletedAt = nowIso()
        const deletedByEmail = toTrimmedText(req.authUser?.email, 200) || null
        const deletedByUid = toTrimmedText(req.authUser?.uid, 160) || null

        const contact = await crmContactsCollection.findOneAndUpdate(
          {
            sourceId: contactSourceId,
          },
          {
            $set: {
              recordStatus: crmRecordStatusDeleted,
              isArchived: true,
              deletedAt,
              deletedByEmail,
              deleteRequestedAt: deletedAt,
              deleteRequestedByUid: deletedByUid,
              deleteRequestedByEmail: deletedByEmail,
              updatedAt: deletedAt,
            },
          },
          {
            returnDocument: 'after',
            projection: {
              _id: 0,
            },
          },
        )

        cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
        cacheDelete(OVERVIEW_CACHE_KEY)

        return res.json({
          contact,
          queuedForDeletion: true,
        })
      }

      if (toBoolean(existingContact.isArchived)) {
        return res.json({
          contact: existingContact,
        })
      }

      const archivedAt = nowIso()
      const archivedByEmail = toTrimmedText(req.authUser?.email, 200) || null

      const contact = await crmContactsCollection.findOneAndUpdate(
        {
          sourceId: contactSourceId,
        },
        {
          $set: {
            isArchived: true,
            deletedAt: archivedAt,
            deletedByEmail: archivedByEmail,
            updatedAt: archivedAt,
          },
        },
        {
          returnDocument: 'after',
          projection: {
            _id: 0,
          },
        },
      )

      cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
      cacheDelete(OVERVIEW_CACHE_KEY)

      return res.json({
        contact,
        queuedForDeletion: false,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/contacts', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { isSalesRep, territoryStates } = resolveCrmAccessScope(req)
      const includeArchived = toBoolean(req.query?.includeArchived)
      const searchRegex = buildContainsRegex(req.query?.search, 200)
      const dealerSourceId = toTrimmedText(req.query?.dealerSourceId, 160)
      const salesUnit = toTrimmedText(req.query?.salesUnit, 160)
      const state = toTrimmedText(req.query?.state, 80)
      const country = toTrimmedText(req.query?.country, 120)
      const contactOrigin = toTrimmedText(req.query?.contactOrigin, 40)
      const hasEmail = toNullableBoolean(req.query?.hasEmail)
      const offset = toNonNegativeInteger(req.query?.offset, 0)
      const limit = Math.min(500, Math.max(1, toNonNegativeInteger(req.query?.limit, 150)))

      if (isSalesRep && territoryStates.length === 0) {
        return res.json({
          contacts: [],
          total: 0,
          offset,
          limit,
          hasMore: false,
        })
      }

      const { crmAccountsCollection, crmContactsCollection } = await getCollections()
      const filterClauses = []

      filterClauses.push({
        recordStatus: {
          $ne: crmRecordStatusDeleted,
        },
      })

      if (isSalesRep) {
        const territoryDealerSourceIds = await resolveTerritoryDealerSourceIds(crmAccountsCollection, territoryStates)
        const territoryStateRegexes = buildExactStateRegexes(territoryStates)

        if (dealerSourceId && !territoryDealerSourceIds.includes(dealerSourceId)) {
          return res.json({
            contacts: [],
            total: 0,
            offset,
            limit,
            hasMore: false,
          })
        }

        filterClauses.push({
          $or: [
            {
              accountSourceId: {
                $in: territoryDealerSourceIds,
              },
            },
            {
              accountSourceId: {
                $in: [null, ''],
              },
              state: {
                $in: territoryStateRegexes,
              },
            },
          ],
        })
      }

      if (!includeArchived) {
        filterClauses.push({
          isArchived: {
            $ne: true,
          },
        })
      }

      if (dealerSourceId) {
        filterClauses.push({
          accountSourceId: dealerSourceId,
        })
      }

      if (salesUnit) {
        filterClauses.push({
          salesUnit: new RegExp(`^${escapeRegex(salesUnit)}$`, 'i'),
        })
      }

      if (state) {
        filterClauses.push({
          state: new RegExp(`^${escapeRegex(state)}$`, 'i'),
        })
      }

      if (country) {
        filterClauses.push({
          country: new RegExp(`^${escapeRegex(country)}$`, 'i'),
        })
      }

      if (contactOrigin && contactOrigin !== 'all') {
        filterClauses.push({
          contactOrigin,
        })
      }

      if (hasEmail === true) {
        filterClauses.push({
          $or: [
            {
              primaryEmail: {
                $nin: [null, ''],
              },
            },
            {
              secondaryEmail: {
                $nin: [null, ''],
              },
            },
            {
              email3: {
                $nin: [null, ''],
              },
            },
            {
              email4: {
                $nin: [null, ''],
              },
            },
          ],
        })
      }

      if (hasEmail === false) {
        filterClauses.push({
          $and: [
            {
              $or: [
                {
                  primaryEmail: null,
                },
                {
                  primaryEmail: '',
                },
              ],
            },
            {
              $or: [
                {
                  secondaryEmail: null,
                },
                {
                  secondaryEmail: '',
                },
              ],
            },
            {
              $or: [
                {
                  email3: null,
                },
                {
                  email3: '',
                },
              ],
            },
            {
              $or: [
                {
                  email4: null,
                },
                {
                  email4: '',
                },
              ],
            },
          ],
        })
      }

      if (searchRegex) {
        filterClauses.push({
          $or: [
            {
              sourceId: searchRegex,
            },
            {
              name: searchRegex,
            },
            {
              firstName: searchRegex,
            },
            {
              lastName: searchRegex,
            },
            {
              accountName: searchRegex,
            },
            {
              accountSourceId: searchRegex,
            },
            {
              primaryEmail: searchRegex,
            },
            {
              secondaryEmail: searchRegex,
            },
            {
              email3: searchRegex,
            },
            {
              email4: searchRegex,
            },
            {
              salesUnit: searchRegex,
            },
            {
              phone: searchRegex,
            },
            {
              phone2: searchRegex,
            },
            {
              phoneAlt: searchRegex,
            },
            {
              city: searchRegex,
            },
            {
              state: searchRegex,
            },
            {
              country: searchRegex,
            },
          ],
        })
      }

      const filter = combineFilterClauses(filterClauses)

      const [total, contacts] = await Promise.all([
        crmContactsCollection.countDocuments(filter),
        crmContactsCollection
          .find(
            filter,
            {
              projection: {
                _id: 0,
                sourceId: 1,
                name: 1,
                firstName: 1,
                lastName: 1,
                primaryEmail: 1,
                secondaryEmail: 1,
                email3: 1,
                email4: 1,
                salesUnit: 1,
                accountSourceId: 1,
                accountName: 1,
                phone: 1,
                phone2: 1,
                phoneAlt: 1,
                photoUrl: 1,
                city: 1,
                state: 1,
                country: 1,
                recordStatus: 1,
                isArchived: 1,
                contactOrigin: 1,
                createdDateSource: 1,
                lastImportedAt: 1,
              },
            },
          )
          .sort({ nameLower: 1, sourceId: 1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
      ])

      return res.json({
        contacts,
        total,
        offset,
        limit,
        hasMore: offset + contacts.length < total,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/deletion-queue', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const limit = Math.min(2000, Math.max(1, toNonNegativeInteger(req.query?.limit, 500)))
      const { crmAccountsCollection, crmContactsCollection } = await getCollections()

      const [dealers, contacts] = await Promise.all([
        crmAccountsCollection
          .find(
            {
              recordStatus: crmRecordStatusDeleted,
            },
            {
              projection: {
                _id: 0,
                sourceId: 1,
                name: 1,
                state: 1,
                accountType: 1,
                accountClass: 1,
                salesRep: 1,
                deleteRequestedAt: 1,
                deleteRequestedByUid: 1,
                deleteRequestedByEmail: 1,
                deletedAt: 1,
                deletedByEmail: 1,
                updatedAt: 1,
              },
            },
          )
          .sort({ deleteRequestedAt: -1, deletedAt: -1, updatedAt: -1 })
          .limit(limit)
          .toArray(),
        crmContactsCollection
          .find(
            {
              recordStatus: crmRecordStatusDeleted,
            },
            {
              projection: {
                _id: 0,
                sourceId: 1,
                name: 1,
                accountSourceId: 1,
                accountName: 1,
                state: 1,
                deleteRequestedAt: 1,
                deleteRequestedByUid: 1,
                deleteRequestedByEmail: 1,
                deletedAt: 1,
                deletedByEmail: 1,
                updatedAt: 1,
              },
            },
          )
          .sort({ deleteRequestedAt: -1, deletedAt: -1, updatedAt: -1 })
          .limit(limit)
          .toArray(),
      ])

      return res.json({
        dealers,
        contacts,
        total: dealers.length + contacts.length,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/deletion-queue/:entityType/:sourceId/confirm', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const entityType = toLowerText(req.params.entityType, 40)
      const sourceId = toTrimmedText(req.params.sourceId, 160)

      if (!sourceId) {
        return res.status(400).json({ error: 'sourceId is required.' })
      }

      const { crmAccountsCollection, crmContactsCollection } = await getCollections()

      if (entityType === 'dealer') {
        const includeContacts = req.body?.includeContacts !== false

        const dealerResult = await crmAccountsCollection.deleteOne({
          sourceId,
          recordStatus: crmRecordStatusDeleted,
        })

        if (Number(dealerResult.deletedCount ?? 0) <= 0) {
          return res.status(404).json({ error: 'Dealer not found in deletion queue.' })
        }

        const contactsResult = includeContacts
          ? await crmContactsCollection.deleteMany({
              accountSourceId: sourceId,
            })
          : { deletedCount: 0 }

        cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
        cacheDelete(OVERVIEW_CACHE_KEY)

        return res.json({
          ok: true,
          entityType,
          sourceId,
          deletedDealerCount: Number(dealerResult.deletedCount ?? 0),
          deletedContactCount: Number(contactsResult.deletedCount ?? 0),
        })
      }

      if (entityType === 'contact') {
        const contactResult = await crmContactsCollection.deleteOne({
          sourceId,
          recordStatus: crmRecordStatusDeleted,
        })

        if (Number(contactResult.deletedCount ?? 0) <= 0) {
          return res.status(404).json({ error: 'Contact not found in deletion queue.' })
        }

        cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
        cacheDelete(OVERVIEW_CACHE_KEY)

        return res.json({
          ok: true,
          entityType,
          sourceId,
          deletedContactCount: Number(contactResult.deletedCount ?? 0),
        })
      }

      return res.status(400).json({
        error: "entityType must be 'dealer' or 'contact'.",
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/deletion-queue/:entityType/:sourceId/restore', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const entityType = toLowerText(req.params.entityType, 40)
      const sourceId = toTrimmedText(req.params.sourceId, 160)

      if (!sourceId) {
        return res.status(400).json({ error: 'sourceId is required.' })
      }

      const restoredAt = nowIso()
      const { crmAccountsCollection, crmContactsCollection } = await getCollections()

      if (entityType === 'dealer') {
        const dealer = await crmAccountsCollection.findOneAndUpdate(
          {
            sourceId,
            recordStatus: crmRecordStatusDeleted,
          },
          {
            $set: {
              recordStatus: crmRecordStatusActive,
              isArchived: false,
              updatedAt: restoredAt,
            },
            $unset: {
              deleteRequestedAt: '',
              deleteRequestedByUid: '',
              deleteRequestedByEmail: '',
              deletedAt: '',
              deletedByEmail: '',
            },
          },
          {
            returnDocument: 'after',
            projection: {
              _id: 0,
            },
          },
        )

        if (!dealer) {
          return res.status(404).json({ error: 'Dealer not found in deletion queue.' })
        }

        cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
        cacheDelete(OVERVIEW_CACHE_KEY)

        return res.json({
          ok: true,
          entityType,
          sourceId,
          dealer,
        })
      }

      if (entityType === 'contact') {
        const contact = await crmContactsCollection.findOneAndUpdate(
          {
            sourceId,
            recordStatus: crmRecordStatusDeleted,
          },
          {
            $set: {
              recordStatus: crmRecordStatusActive,
              isArchived: false,
              updatedAt: restoredAt,
            },
            $unset: {
              deleteRequestedAt: '',
              deleteRequestedByUid: '',
              deleteRequestedByEmail: '',
              deletedAt: '',
              deletedByEmail: '',
            },
          },
          {
            returnDocument: 'after',
            projection: {
              _id: 0,
            },
          },
        )

        if (!contact) {
          return res.status(404).json({ error: 'Contact not found in deletion queue.' })
        }

        cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
        cacheDelete(OVERVIEW_CACHE_KEY)

        return res.json({
          ok: true,
          entityType,
          sourceId,
          contact,
        })
      }

      return res.status(400).json({
        error: "entityType must be 'dealer' or 'contact'.",
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/quote-print-settings', requireFirebaseAuth, async (_req, res, next) => {
    try {
      const { crmQuotePrintSettingsCollection } = await getCollections()
      const storedSettings = await crmQuotePrintSettingsCollection.findOne(
        { id: 'default' },
        { projection: { _id: 0 } },
      )

      return res.json({
        settings: normalizeQuotePrintSettings(storedSettings || defaultQuotePrintSettings),
      })
    } catch (error) {
      next(error)
    }
  })

  async function loadDocumentTerms(collection) {
    const [storedSettings, storedTerms] = await Promise.all([
      collection.findOne({ id: 'default' }, { projection: { _id: 0 } }),
      collection.find({ kind: 'document_term' }, { projection: { _id: 0 } }).toArray(),
    ])
    const defaults = buildDefaultDocumentTerms(storedSettings || defaultQuotePrintSettings)
    const defaultsById = new Map(defaults.map((term) => [term.id, term]))
    const storedById = new Map(storedTerms.map((term) => [toTrimmedText(term?.id, 180), term]))
    const merged = defaults.map((defaultTerm) => (
      normalizeDocumentTerm(storedById.get(defaultTerm.id), defaultTerm)
    ))

    storedTerms.forEach((storedTerm) => {
      const id = toTrimmedText(storedTerm?.id, 180)
      if (!id || defaultsById.has(id)) return
      merged.push(normalizeDocumentTerm(storedTerm))
    })

    return merged
      .filter((term) => term && !term.isArchived)
      .sort((left, right) => (
        documentTermTypes.indexOf(left.documentType) - documentTermTypes.indexOf(right.documentType)
        || left.sortOrder - right.sortOrder
        || left.title.localeCompare(right.title)
      ))
  }

  app.get('/api/crm/document-terms', requireFirebaseAuth, async (req, res, next) => {
    try {
      const dealerSourceId = toTrimmedText(req.query?.dealerSourceId, 160)
      const { crmQuotePrintSettingsCollection } = await getCollections()
      const terms = await loadDocumentTerms(crmQuotePrintSettingsCollection)

      return res.json({
        documentTypes: documentTermTypes,
        terms: terms.map((term) => ({
          ...term,
          appliesToDealer: dealerSourceId
            ? documentTermAppliesToDealer(term, dealerSourceId)
            : undefined,
        })),
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/document-terms', requireFirebaseAuth, async (req, res, next) => {
    try {
      const body = toOptionalObject(req.body)
      const updatedAt = nowIso()
      const updatedByEmail = toLowerText(req.authUser?.email, 200) || null
      const term = normalizeDocumentTerm({
        ...body,
        id: `document-term-${randomUUID()}`,
        isBuiltIn: false,
        isArchived: false,
        createdAt: updatedAt,
        createdByEmail: updatedByEmail,
        updatedAt,
        updatedByEmail,
      })

      if (!term) {
        return res.status(400).json({ error: 'A valid document, title, and term text are required.' })
      }

      const { crmQuotePrintSettingsCollection } = await getCollections()
      await crmQuotePrintSettingsCollection.insertOne(term)
      return res.status(201).json({ term })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/crm/document-terms/:termId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const termId = toTrimmedText(req.params.termId, 180)
      const body = toOptionalObject(req.body)
      const { crmQuotePrintSettingsCollection } = await getCollections()
      const allTerms = await loadDocumentTerms(crmQuotePrintSettingsCollection)
      const existing = allTerms.find((term) => term.id === termId)

      if (!existing) {
        return res.status(404).json({ error: 'Document term not found.' })
      }

      const updatedAt = nowIso()
      const updatedByEmail = toLowerText(req.authUser?.email, 200) || null
      const term = normalizeDocumentTerm({
        ...existing,
        ...body,
        id: existing.id,
        isBuiltIn: existing.isBuiltIn,
        isArchived: false,
        createdAt: existing.createdAt,
        createdByEmail: existing.createdByEmail,
        updatedAt,
        updatedByEmail,
      })

      if (!term) {
        return res.status(400).json({ error: 'A valid document, title, and term text are required.' })
      }

      await crmQuotePrintSettingsCollection.updateOne(
        { id: term.id },
        { $set: term },
        { upsert: true },
      )
      return res.json({ term })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/crm/document-terms/:termId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const termId = toTrimmedText(req.params.termId, 180)
      const { crmQuotePrintSettingsCollection } = await getCollections()
      const allTerms = await loadDocumentTerms(crmQuotePrintSettingsCollection)
      const existing = allTerms.find((term) => term.id === termId)

      if (!existing) {
        return res.status(404).json({ error: 'Document term not found.' })
      }

      const updatedAt = nowIso()
      await crmQuotePrintSettingsCollection.updateOne(
        { id: existing.id },
        {
          $set: {
            ...existing,
            kind: 'document_term',
            isArchived: true,
            updatedAt,
            updatedByEmail: toLowerText(req.authUser?.email, 200) || null,
          },
        },
        { upsert: true },
      )
      return res.json({ ok: true, termId })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/quote-image-proxy', async (req, res, next) => {
    try {
      const imageUrl = toTrimmedText(req.query?.url, 4000)

      if (!imageUrl) {
        return res.status(400).json({ error: 'url query parameter is required.' })
      }

      const storageTarget = extractFirebaseStorageObjectFromUrl(imageUrl)
      const storage = getStorage()
      const bucket = storage.bucket()

      if (
        !storageTarget
        || storageTarget.bucketName !== bucket.name
        || !storageTarget.objectPath.startsWith('crm/opportunities/')
      ) {
        return res.status(400).json({ error: 'Only Opportunity storage images can be proxied.' })
      }

      const fallbackContentType = inferImageContentTypeFromObjectPath(storageTarget.objectPath)

      if (!fallbackContentType) {
        return res.status(400).json({ error: 'Only image files can be proxied.' })
      }

      const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) })

      if (!imageResponse.ok) {
        const responseStatus = imageResponse.status === 404 ? 404 : 400
        return res.status(responseStatus).json({ error: 'The image could not be downloaded.' })
      }

      const responseContentType = toLowerText(imageResponse.headers.get('content-type'), 200)
      const contentType = responseContentType.startsWith('image/')
        ? responseContentType.split(';')[0]
        : fallbackContentType
      const imageBytes = Buffer.from(await imageResponse.arrayBuffer())

      if (imageBytes.length === 0) {
        return res.status(400).json({ error: 'The image file is empty.' })
      }

      if (imageBytes.length > 15 * 1024 * 1024) {
        return res.status(413).json({ error: 'Image must be 15 MB or smaller.' })
      }

      res.set('content-type', contentType)
      res.set('cache-control', 'private, max-age=300')
      res.set('x-content-type-options', 'nosniff')

      return res.status(200).send(imageBytes)
    } catch (error) {
      next(error)
    }
  })

  app.put('/api/crm/quote-print-settings', requireFirebaseAuth, async (req, res, next) => {
    try {
      const { crmQuotePrintSettingsCollection } = await getCollections()
      const updatedAt = nowIso()
      const updatedByEmail = toLowerText(req.authUser?.email, 200) || null
      const settings = normalizeQuotePrintSettings(req.body, { updatedAt, updatedByEmail })

      await crmQuotePrintSettingsCollection.updateOne(
        { id: 'default' },
        { $set: settings },
        { upsert: true },
      )

      return res.json({ settings })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/quotes/convert-workbook', requireFirebaseAuth, async (req, res, next) => {
    try {
      const body = toOptionalObject(req.body)
      const workbookUrl = toTrimmedText(body.workbookUrl, 2000)
      const workbookName = toTrimmedText(body.workbookName, 500)
      const quoteNumber = toTrimmedText(body.quoteNumber, 120) || 'quote'
      const converterUrl = toTrimmedText(process.env.QUOTE_CONVERTER_URL, 2000)
      const converterToken = toTrimmedText(process.env.QUOTE_CONVERTER_TOKEN, 500)

      if (!workbookUrl || !workbookName) {
        return res.status(400).json({ error: 'workbookUrl and workbookName are required.' })
      }

      if (!/\.(xls|xlsx|xlsm|ods)$/i.test(workbookName)) {
        return res.status(400).json({ error: 'Only XLS, XLSX, XLSM, and ODS workbooks can be converted.' })
      }

      if (!converterUrl || !converterToken) {
        return res.status(503).json({ error: 'Workbook PDF conversion is not configured.' })
      }

      const workbookStorageTarget = extractFirebaseStorageObjectFromUrl(workbookUrl)
      const storage = getStorage()
      const bucket = storage.bucket()

      if (
        !workbookStorageTarget
        || workbookStorageTarget.bucketName !== bucket.name
        || !workbookStorageTarget.objectPath.startsWith('crm/opportunities/')
      ) {
        return res.status(400).json({ error: 'Workbook must be stored in this project\'s Opportunity files.' })
      }

      const workbookResponse = await fetch(workbookUrl, { signal: AbortSignal.timeout(60_000) })

      if (!workbookResponse.ok) {
        return res.status(400).json({ error: 'The uploaded workbook could not be downloaded.' })
      }

      const workbookBytes = Buffer.from(await workbookResponse.arrayBuffer())

      if (workbookBytes.length === 0 || workbookBytes.length > 25 * 1024 * 1024) {
        return res.status(400).json({ error: 'Workbook must be between 1 byte and 25 MB.' })
      }

      const conversionResponse = await fetch(`${converterUrl.replace(/\/$/, '')}/convert`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-conversion-token': converterToken,
          'x-file-name': workbookName,
        },
        body: workbookBytes,
        signal: AbortSignal.timeout(180_000),
      })

      if (!conversionResponse.ok) {
        const failureBody = await conversionResponse.text().catch(() => '')
        console.error('Quote workbook conversion service failed.', {
          status: conversionResponse.status,
          body: failureBody.slice(0, 1000),
        })
        return res.status(502).json({ error: 'Workbook could not be converted to PDF.' })
      }

      const pdfBytes = Buffer.from(await conversionResponse.arrayBuffer())

      if (pdfBytes.length === 0) {
        return res.status(502).json({ error: 'Workbook converter returned an empty PDF.' })
      }

      const safeQuoteNumber = quoteNumber.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'quote'
      const objectPath = `crm/opportunities/generated/${safeQuoteNumber}-${Date.now()}-${randomUUID()}.pdf`
      const downloadToken = randomUUID()
      const file = bucket.file(objectPath)

      await file.save(pdfBytes, {
        resumable: false,
        metadata: {
          contentType: 'application/pdf',
          cacheControl: 'private, max-age=0, no-store',
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
          },
        },
      })

      const convertedPdfUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(objectPath)}?alt=media&token=${encodeURIComponent(downloadToken)}`

      return res.json({
        convertedPdfUrl,
        convertedPdfName: `${safeQuoteNumber}.pdf`,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/quotes', requireFirebaseAuth, async (req, res, next) => {
    try {
      const accessScope = resolveCrmAccessScope(req)
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)
      const status = toLowerText(req.query?.status, 60)
      const lifecycle = normalizeQuoteLifecycle(req.query?.lifecycle)
      const dealerSourceId = toTrimmedText(req.query?.dealerSourceId, 160)
      const quoteNumber = toTrimmedText(req.query?.quoteNumber, 120)
      const salesRep = toTrimmedText(req.query?.salesRep, 200)
      const dealerState = normalizeUsStateCode(req.query?.dealerState)
      const projectType = normalizeProjectType(req.query?.projectType)
      const cardsOnly = toLowerText(req.query?.view, 40) === 'cards'
      const searchRegex = buildContainsRegex(req.query?.search, 220)
      const limit = Math.min(500, Math.max(1, toNonNegativeInteger(req.query?.limit, 120)))
      const collections = await getCollections()
      const { crmAccountsCollection, crmQuotesCollection } = collections
      const filterClauses = []

      if (quoteAccessScope.restrictToLinkedSalesRep && !quoteAccessScope.linkedSalesRepName) {
        return res.json({
          quotes: [],
        })
      }

      if (status && status !== 'all') {
        filterClauses.push({ status })
      }

      if (lifecycle === 'cancelled') {
        filterClauses.push({ status: 'cancelled' })
      } else if (lifecycle === 'converted') {
        filterClauses.push({
          $or: [
            { status: 'accepted' },
            { opportunityStage: 'order_placement' },
          ],
        })
      } else if (lifecycle === 'rejected') {
        filterClauses.push({ status: 'rejected' })
      } else if (lifecycle === 'open') {
        filterClauses.push({
          status: {
            $in: ['draft', 'sent'],
          },
        })
      }

      if (quoteAccessScope.restrictToLinkedSalesRep && quoteAccessScope.linkedSalesRepRegex) {
        filterClauses.push({
          salesRep: quoteAccessScope.linkedSalesRepRegex,
        })
      }

      if (dealerSourceId) {
        filterClauses.push({ dealerSourceId })
      }

      if (quoteNumber) {
        filterClauses.push({
          quoteNumber: new RegExp(`^${escapeRegex(quoteNumber)}$`, 'i'),
        })
      }

      if (salesRep) {
        filterClauses.push({
          salesRep: new RegExp(`^${escapeRegex(salesRep)}$`, 'i'),
        })
      }

      if (dealerState) {
        filterClauses.push({
          dealerState: new RegExp(`^${escapeRegex(dealerState)}$`, 'i'),
        })
      }

      if (projectType) {
        filterClauses.push({ projectType })
      }

      if (searchRegex) {
        filterClauses.push({
          $or: [
            { quoteNumber: searchRegex },
            { title: searchRegex },
            { companyName: searchRegex },
            { dealerName: searchRegex },
            { salesRep: searchRegex },
            { dealerState: searchRegex },
            { projectType: searchRegex },
            { contactName: searchRegex },
            { contactEmail: searchRegex },
          ],
        })
      }

      const filter = combineFilterClauses(filterClauses)

      const quotes = await crmQuotesCollection
        .find(
          filter,
          {
            projection: cardsOnly
              ? {
                _id: 0,
                id: 1,
                dealerSourceId: 1,
                dealerName: 1,
                dealerState: 1,
                companyName: 1,
                salesRep: 1,
                projectType: 1,
                opportunityDate: 1,
                opportunityStage: 1,
                quoteNumber: 1,
                baseQuoteNumber: 1,
                activeRevisionNumber: 1,
                revisionCount: 1,
                title: 1,
                status: 1,
                totalAmount: 1,
                currency: 1,
                lastFollowedUpAt: 1,
                lastLinkOpenedAt: 1,
                linkOpenCount: 1,
                lastStatusChangedAt: 1,
                createdAt: 1,
                updatedAt: 1,
              }
              : {
                _id: 0,
              },
          },
        )
        .sort({ updatedAt: -1, id: -1 })
        .limit(limit)
        .toArray()

      const quoteIds = quotes
        .map((quote) => toTrimmedText(quote?.id, 160))
        .filter(Boolean)
      const dealerSourceIds = [...new Set(
        quotes
          .map((quote) => toTrimmedText(quote?.dealerSourceId, 160))
          .filter(Boolean),
      )]
      const chatMessageCountByQuoteId = new Map()
      const dealerPictureUrlBySourceId = new Map()

      const [groupedCounts, dealerPictures] = await Promise.all([
        quoteIds.length > 0
          ? getCrmQuoteChatsCollection(collections).then((crmQuoteChatsCollection) =>
            crmQuoteChatsCollection
          .aggregate([
            {
              $match: {
                quoteId: {
                  $in: quoteIds,
                },
              },
            },
            {
              $group: {
                _id: '$quoteId',
                total: {
                  $sum: 1,
                },
              },
            },
          ])
          .toArray())
          : [],
        dealerSourceIds.length > 0
          ? crmAccountsCollection
            .find(
              {
                sourceId: { $in: dealerSourceIds },
                recordStatus: { $ne: crmRecordStatusDeleted },
              },
              {
                projection: {
                  _id: 0,
                  sourceId: 1,
                  pictureUrl: 1,
                  pictureUrlSource: 1,
                },
              },
            )
            .toArray()
          : [],
      ])

      groupedCounts.forEach((entry) => {
        const quoteId = toTrimmedText(entry?._id, 160)

        if (!quoteId) {
          return
        }

        chatMessageCountByQuoteId.set(quoteId, Number(entry?.total ?? 0))
      })

      dealerPictures.forEach((dealer) => {
        const sourceId = toTrimmedText(dealer?.sourceId, 160)
        const pictureUrl =
          toTrimmedText(dealer?.pictureUrl, 1200)
          || toTrimmedText(dealer?.pictureUrlSource, 1200)

        if (sourceId && pictureUrl) {
          dealerPictureUrlBySourceId.set(sourceId, pictureUrl)
        }
      })

      const quotesWithChatCounts = quotes.map((quote) => {
        const quoteId = toTrimmedText(quote?.id, 160)
        const quoteDealerSourceId = toTrimmedText(quote?.dealerSourceId, 160)

        return normalizeQuoteOpportunityStageForResponse({
          ...quote,
          dealerPictureUrl: quoteDealerSourceId
            ? dealerPictureUrlBySourceId.get(quoteDealerSourceId) ?? null
            : null,
          chatMessageCount: quoteId
            ? Number(chatMessageCountByQuoteId.get(quoteId) ?? 0)
            : 0,
        })
      })

      return res.json({
        quotes: quotesWithChatCounts,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/quotes/:quoteId/details', requireFirebaseAuth, async (req, res, next) => {
    try {
      const quoteId = toTrimmedText(req.params.quoteId, 160)
      if (!quoteId) return res.status(400).json({ error: 'quoteId is required.' })

      const accessScope = resolveCrmAccessScope(req)
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)
      if (quoteAccessScope.restrictToLinkedSalesRep && !quoteAccessScope.linkedSalesRepName) {
        return res.status(403).json({ error: 'Sales rep access is not linked to a CRM sales rep yet.' })
      }

      const { crmQuotesCollection } = await getCollections()
      const quote = await crmQuotesCollection.findOne(
        {
          $or: [
            { id: quoteId },
            { quoteNumber: new RegExp(`^${escapeRegex(quoteId)}$`, 'i') },
            { 'revisions.id': quoteId },
            { 'revisions.quoteNumber': new RegExp(`^${escapeRegex(quoteId)}$`, 'i') },
          ],
        },
        { projection: { _id: 0 } },
      )
      if (!quote) return res.status(404).json({ error: 'Quote not found.' })
      if (!canAccessQuoteBySalesRep(quote, quoteAccessScope)) {
        return res.status(403).json({ error: 'You can only access opportunities assigned to your linked sales rep.' })
      }

      const normalizedQuote = normalizeQuoteOpportunityStageForResponse(quote)
      const matchedRevision = (normalizedQuote.revisions || []).find((revision) => (
        toTrimmedText(revision?.id, 160) === quoteId
        || toTrimmedText(revision?.quoteNumber, 120).toLowerCase() === quoteId.toLowerCase()
      ))
      const responseQuote = matchedRevision
        ? {
          ...normalizedQuote,
          activeRevisionNumber: toNonNegativeInteger(
            matchedRevision.revisionNumber,
            normalizedQuote.activeRevisionNumber,
          ),
        }
        : normalizedQuote

      return res.json({ quote: responseQuote })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/quotes/:quoteId/follow-up', requireFirebaseAuth, async (req, res, next) => {
    try {
      const quoteId = toTrimmedText(req.params.quoteId, 160)
      if (!quoteId) return res.status(400).json({ error: 'quoteId is required.' })
      if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Follow-up confirmation is required.' })

      const accessScope = resolveCrmAccessScope(req)
      const { publicUser } = accessScope
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)
      const collections = await getCollections()
      const { crmQuotesCollection } = collections
      const crmQuoteChatsCollection = await getCrmQuoteChatsCollection(collections)
      const quote = await crmQuotesCollection.findOne({ id: quoteId }, { projection: { _id: 0 } })
      if (!quote) return res.status(404).json({ error: 'Quote not found.' })
      if (!canAccessQuoteBySalesRep(quote, quoteAccessScope)) {
        return res.status(403).json({ error: 'You can only update opportunities assigned to your linked sales rep.' })
      }

      const now = nowIso()
      const requesterUid = toTrimmedText(req.authUser?.uid, 200)
      const requesterEmail = toTrimmedText(req.authUser?.email, 200) || null
      const requesterName = toTrimmedText(publicUser?.displayName, 200)
        || requesterEmail
        || 'A team member'
      const activity = {
        id: randomUUID(),
        type: 'follow_up',
        occurredAt: now,
        createdByUid: requesterUid || null,
        createdByEmail: requesterEmail,
        createdByName: requesterName,
      }
      const chatMessage = {
        id: randomUUID(),
        quoteId: quote.id,
        dealerSourceId: quote.dealerSourceId,
        quoteNumber: quote.quoteNumber,
        message: `${requesterName} followed up on this quote.`,
        mentionUserUids: [],
        mentionUserEmails: [],
        reminder: null,
        createdAt: now,
        createdByUid: requesterUid || null,
        createdByEmail: requesterEmail,
        createdByName: requesterName,
      }

      await crmQuoteChatsCollection.insertOne(chatMessage)

      let updatedQuote
      try {
        updatedQuote = await crmQuotesCollection.findOneAndUpdate(
          { id: quoteId },
          {
            $set: { lastFollowedUpAt: now, updatedAt: now },
            $push: {
              followUpHistory: { $each: [activity], $slice: -500 },
              activityLog: { $each: [activity], $slice: -1000 },
            },
          },
          { returnDocument: 'after', projection: { _id: 0 } },
        )
      } catch (error) {
        await crmQuoteChatsCollection.deleteOne({ id: chatMessage.id, quoteId: quote.id })
        throw error
      }

      return res.json({
        quote: normalizeQuoteOpportunityStageForResponse(updatedQuote),
        chatMessage,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/reminder-settings/me', requireFirebaseAuth, async (req, res, next) => {
    try {
      const uid = toTrimmedText(req.authUser?.uid, 160)
      const { authUsersCollection } = await getCollections()
      const user = await authUsersCollection.findOne({ uid }, { projection: { _id: 0, quoteReminderSettings: 1 } })
      const settings = toOptionalObject(user?.quoteReminderSettings)
      const rules = Array.isArray(settings.rules) ? settings.rules : []
      return res.json({
        settings: {
          rules: rules.slice(0, 25).map((rule) => ({
            id: toTrimmedText(rule?.id, 160) || randomUUID(),
            kind: rule?.kind === 'customer_signed_bol_missing'
              ? 'customer_signed_bol_missing'
              : rule?.kind === 'link_opened'
                ? 'link_opened'
                : 'follow_up_due',
            days: Math.min(365, Math.max(0, toNonNegativeInteger(rule?.days, 10))),
            base: rule?.kind === 'customer_signed_bol_missing'
              ? 'shipped_date'
              : rule?.base === 'last_follow_up'
                ? 'last_follow_up'
                : 'quote_date',
          })),
        },
      })
    } catch (error) {
      next(error)
    }
  })

  app.put('/api/crm/reminder-settings/me', requireFirebaseAuth, async (req, res, next) => {
    try {
      const uid = toTrimmedText(req.authUser?.uid, 160)
      const rawRules = Array.isArray(req.body?.rules) ? req.body.rules : []
      const settings = {
        rules: rawRules.slice(0, 25).map((rule) => ({
          id: toTrimmedText(rule?.id, 160) || randomUUID(),
          kind: rule?.kind === 'customer_signed_bol_missing'
            ? 'customer_signed_bol_missing'
            : rule?.kind === 'link_opened'
              ? 'link_opened'
              : 'follow_up_due',
          days: Math.min(365, Math.max(0, toNonNegativeInteger(rule?.days, 10))),
          base: rule?.kind === 'customer_signed_bol_missing'
            ? 'shipped_date'
            : rule?.base === 'last_follow_up'
              ? 'last_follow_up'
              : 'quote_date',
        })),
      }
      const now = nowIso()
      const { authUsersCollection } = await getCollections()
      await authUsersCollection.updateOne(
        { uid },
        { $set: { quoteReminderSettings: settings, updatedAt: now } },
      )
      return res.json({ settings })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/quotes', requireFirebaseAuth, async (req, res, next) => {
    try {
      const accessScope = resolveCrmAccessScope(req)
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)
      const body = toOptionalObject(req.body)
      const quoteNumber = toTrimmedText(body.quoteNumber, 120) || null
      // A quote can be created with just a quote number; the rest is filled in
      // later (e.g. from the Excel quote sync), so title falls back to one
      // derived from the quote number.
      const title = toTrimmedText(body.title, 240)
        || (quoteNumber ? `Opportunity ${quoteNumber}` : 'Untitled opportunity')

      const status = normalizeStatus(body.status, quoteStatuses, 'draft')
      const opportunityStage = normalizeOpportunityStage(body.opportunityStage, 'proposal_submission')

      if (!status) {
        return res.status(400).json({
          error: `status must be one of: ${quoteStatuses.join(', ')}`,
        })
      }

      if (!opportunityStage) {
        return res.status(400).json({
          error: `opportunityStage must be one of: ${opportunityStages.join(', ')}`,
        })
      }

      const hasTotalAmount = body.totalAmount !== undefined
        && body.totalAmount !== null
        && body.totalAmount !== ''
      const totalAmount = hasTotalAmount ? toNonNegativeNumberOrNull(body.totalAmount) : 0
      const revisionCount = toNonNegativeInteger(body.revisionCount, 0)

      if (totalAmount === null) {
        return res.status(400).json({
          error: 'totalAmount must be a non-negative number.',
        })
      }

      if (quoteAccessScope.restrictToLinkedSalesRep && !quoteAccessScope.linkedSalesRepName) {
        return res.status(403).json({
          error: 'Sales rep access is not linked to a CRM sales rep yet.',
        })
      }

      const {
        crmAccountsCollection,
        crmContactsCollection,
        crmQuotesCollection,
      } = await getCollections()

      if (quoteNumber) {
        const requestedIdentity = parseQuoteRevisionIdentity(quoteNumber)
        const existingQuoteWithNumber = await crmQuotesCollection.findOne(
          {
            $or: [
              { baseQuoteNumber: new RegExp(`^${escapeRegex(requestedIdentity.baseQuoteNumber)}$`, 'i') },
              { quoteNumber: new RegExp(`^${escapeRegex(requestedIdentity.baseQuoteNumber)}(?:[-_\\s]*R\\d+)?$`, 'i') },
              { 'revisions.quoteNumber': new RegExp(`^${escapeRegex(requestedIdentity.baseQuoteNumber)}[-_\\s]*R\\d+$`, 'i') },
            ],
          },
          { projection: { _id: 0, id: 1, quoteNumber: 1 } },
        )

        if (existingQuoteWithNumber) {
          return res.status(409).json({
            error: `Quote number ${quoteNumber} already exists in another opportunity. Open that opportunity and create a revision instead.`,
            quoteId: existingQuoteWithNumber.id,
          })
        }
      }

      const requestedDealerSourceId = toTrimmedText(body.dealerSourceId, 160)
      const dealer = requestedDealerSourceId
        ? await resolveDealerOrThrow(crmAccountsCollection, requestedDealerSourceId)
        : null
      const requestedContactSourceId = toTrimmedText(body.contactSourceId, 160)
      const requestedContactName = toTrimmedText(body.contactName, 240) || null
      let nextContactSourceId = null
      let nextContactName = requestedContactName

      if (requestedContactSourceId) {
        const linkedContact = await crmContactsCollection.findOne(
          {
            sourceId: requestedContactSourceId,
          },
          {
            projection: {
              _id: 0,
              sourceId: 1,
              accountSourceId: 1,
              name: 1,
              firstName: 1,
              lastName: 1,
            },
          },
        )

        if (!linkedContact) {
          return res.status(400).json({
            error: 'Selected contact does not exist.',
          })
        }

        const contactDealerSourceId = toTrimmedText(linkedContact.accountSourceId, 160)

        if (dealer && contactDealerSourceId && contactDealerSourceId !== dealer.sourceId) {
          return res.status(400).json({
            error: 'Selected contact does not belong to the selected dealer.',
          })
        }

        nextContactSourceId = linkedContact.sourceId
        nextContactName = resolveContactDisplayName(linkedContact) || requestedContactName
      }

      const now = nowIso()
      const explicitDocumentUrl = toTrimmedText(body.documentUrl, 2000) || null
      const explicitDocumentName = toTrimmedText(body.documentName, 240) || null
      const normalizedDocuments = normalizeQuoteDocuments(body.documents)

      if (normalizedDocuments.length === 0 && explicitDocumentUrl) {
        normalizedDocuments.push({
          url: explicitDocumentUrl,
          name: explicitDocumentName,
        })
      }

      const primaryDocument = normalizedDocuments[0] || null
      const lineItems = normalizeQuoteLineItems(body.lineItems)
      const discountPercent = toNonNegativeNumberOrNull(body.discountPercent)

      if (discountPercent !== null && discountPercent > 100) {
        return res.status(400).json({ error: 'discountPercent must be between 0 and 100.' })
      }

      const nextQuote = {
        id: randomUUID(),
        dealerSourceId: dealer ? dealer.sourceId : null,
        dealerName: dealer ? (dealer.name || dealer.sourceId) : null,
        dealerState: normalizeUsStateCode(body.dealerState) || normalizeUsStateCode(dealer?.state) || null,
        companyName: toTrimmedText(body.companyName, 200) || null,
        salesRep: quoteAccessScope.restrictToLinkedSalesRep
          ? quoteAccessScope.linkedSalesRepName
          : (toTrimmedText(body.salesRep, 200) || null),
        projectType: normalizeProjectType(body.projectType),
        opportunityDate: toIsoDateOrNull(body.opportunityDate),
        opportunityStage,
        contactSourceId: nextContactSourceId,
        contactName: nextContactName,
        contactEmail: toTrimmedText(body.contactEmail, 200) || null,
        contactPhone: toTrimmedText(body.contactPhone, 80) || null,
        quoteNumber,
        poNumber: toTrimmedText(body.poNumber, 120) || null,
        acknowledgmentNumber: toTrimmedText(body.acknowledgmentNumber, 120) || null,
        orderNumber: toTrimmedText(body.orderNumber, 120) || null,
        paymentTerms: toTrimmedText(body.paymentTerms, 240) || null,
        leadTime: toTrimmedText(body.leadTime, 240) || null,
        subtotal: toNonNegativeNumberOrNull(body.subtotal),
        discountPercent,
        discountAmount: toNonNegativeNumberOrNull(body.discountAmount),
        discountScope: body.discountScope === 'products_and_freight' ? 'products_and_freight' : 'products',
        discountFreightAmount: toNonNegativeNumberOrNull(body.discountFreightAmount),
        freight: toNonNegativeNumberOrNull(body.freight),
        freightDescription: toTrimmedText(body.freightDescription, 1200) || null,
        lineItems,
        additionalServices: normalizeQuoteServiceItems(body.additionalServices),
        shippingServices: normalizeQuoteServiceItems(body.shippingServices),
        title,
        description: toTrimmedText(body.description, 2000) || null,
        documentUrl: primaryDocument?.url || explicitDocumentUrl || null,
        documentName: primaryDocument?.name || explicitDocumentName || null,
        documents: normalizedDocuments,
        origin: normalizeQuoteOrigin(body.origin, 'website'),
        sourceWorkbookUrl: toTrimmedText(body.sourceWorkbookUrl, 2000) || null,
        sourceWorkbookName: toTrimmedText(body.sourceWorkbookName, 500) || null,
        convertedPdfUrl: toTrimmedText(body.convertedPdfUrl, 2000) || null,
        convertedPdfName: toTrimmedText(body.convertedPdfName, 500) || null,
        revisionCount,
        status,
        totalAmount: Number(totalAmount.toFixed(2)),
        currency: toTrimmedText(body.currency, 16) || 'USD',
        sentAt: toIsoDateOrNull(body.sentAt),
        acceptedAt: status === 'accepted'
          ? (toIsoDateOrNull(body.acceptedAt) || now)
          : null,
        rejectedAt: status === 'rejected'
          ? (toIsoDateOrNull(body.rejectedAt) || now)
          : null,
        notes: toTrimmedText(body.notes, 4000) || null,
        lastStatusChangedAt: now,
        createdByUid: toTrimmedText(req.authUser?.uid, 160) || null,
        createdByEmail: toTrimmedText(req.authUser?.email, 200) || null,
        updatedAt: now,
      }

      const initialRevisionIdentity = parseQuoteRevisionIdentity(nextQuote.quoteNumber)
      nextQuote.baseQuoteNumber = initialRevisionIdentity.baseQuoteNumber
      nextQuote.activeRevisionNumber = initialRevisionIdentity.revisionNumber
      nextQuote.revisionCount = initialRevisionIdentity.revisionNumber
      nextQuote.quoteNumber = formatQuoteRevisionNumber(
        initialRevisionIdentity.baseQuoteNumber,
        initialRevisionIdentity.revisionNumber,
      ) || nextQuote.quoteNumber
      nextQuote.revisions = [
        buildQuoteRevisionSnapshot(nextQuote, {
          baseQuoteNumber: nextQuote.baseQuoteNumber,
          revisionNumber: nextQuote.activeRevisionNumber,
          createdAt: now,
          createdByUid: nextQuote.createdByUid,
          createdByEmail: nextQuote.createdByEmail,
          updatedAt: now,
          updatedByUid: nextQuote.createdByUid,
          updatedByEmail: nextQuote.createdByEmail,
        }),
      ]

      await crmQuotesCollection.insertOne(nextQuote)

      return res.status(201).json({
        quote: normalizeQuoteOpportunityStageForResponse(nextQuote),
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/crm/quotes/:quoteId', requireFirebaseAuth, async (req, res, next) => {
    try {
      const quoteId = toTrimmedText(req.params.quoteId, 160)

      if (!quoteId) {
        return res.status(400).json({
          error: 'quoteId is required.',
        })
      }

      const accessScope = resolveCrmAccessScope(req)
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)

      if (quoteAccessScope.restrictToLinkedSalesRep && !quoteAccessScope.linkedSalesRepName) {
        return res.status(403).json({
          error: 'Sales rep access is not linked to a CRM sales rep yet.',
        })
      }

      const body = toOptionalObject(req.body)
      const {
        crmAccountsCollection,
        crmContactsCollection,
        crmQuotesCollection,
      } = await getCollections()

      const existingQuote = await crmQuotesCollection.findOne(
        {
          id: quoteId,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!existingQuote) {
        return res.status(404).json({
          error: 'Quote not found.',
        })
      }

      if (!canAccessQuoteBySalesRep(existingQuote, quoteAccessScope)) {
        return res.status(403).json({
          error: 'You can only access opportunities assigned to your linked sales rep.',
        })
      }

      const updates = {}
      const now = nowIso()
      const existingRevisionState = resolveQuoteRevisionState(existingQuote)
      const requestedRevisionNumber = Object.prototype.hasOwnProperty.call(body, 'revisionNumber')
        ? toNonNegativeInteger(body.revisionNumber, -1)
        : existingRevisionState.activeRevisionNumber
      const requestedRevision = existingRevisionState.revisions.find(
        (revision) => revision.revisionNumber === requestedRevisionNumber,
      )
      const requestedActiveRevisionNumber = Object.prototype.hasOwnProperty.call(body, 'activeRevisionNumber')
        ? toNonNegativeInteger(body.activeRevisionNumber, -1)
        : existingRevisionState.activeRevisionNumber

      if (!requestedRevision) {
        return res.status(404).json({ error: 'The selected revision was not found.' })
      }

      if (!existingRevisionState.revisions.some(
        (revision) => revision.revisionNumber === requestedActiveRevisionNumber,
      )) {
        return res.status(404).json({ error: 'The revision selected as current was not found.' })
      }
      const hasDocumentsInput = Object.prototype.hasOwnProperty.call(body, 'documents')
      const hasLegacyDocumentUrlInput = Object.prototype.hasOwnProperty.call(body, 'documentUrl')
      const hasLegacyDocumentNameInput = Object.prototype.hasOwnProperty.call(body, 'documentName')
      const hasLegacyDocumentInput = hasLegacyDocumentUrlInput || hasLegacyDocumentNameInput

      if (Object.prototype.hasOwnProperty.call(body, 'title')) {
        const nextTitle = toTrimmedText(body.title, 240)

        if (!nextTitle) {
          return res.status(400).json({
            error: 'title cannot be empty.',
          })
        }

        updates.title = nextTitle
      }

      if (Object.prototype.hasOwnProperty.call(body, 'description')) {
        updates.description = toTrimmedText(body.description, 2000) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'opportunityStage')) {
        const currentStage =
          normalizeOpportunityStage(
            existingQuote.opportunityStage,
            'proposal_submission',
          ) || 'proposal_submission'
        const nextStage = normalizeOpportunityStage(body.opportunityStage, currentStage)

        if (!nextStage) {
          return res.status(400).json({
            error: `opportunityStage must be one of: ${opportunityStages.join(', ')}`,
          })
        }

        updates.opportunityStage = nextStage
      }

      if (Object.prototype.hasOwnProperty.call(body, 'quoteNumber')) {
        updates.quoteNumber = toTrimmedText(body.quoteNumber, 120) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'poNumber')) {
        updates.poNumber = toTrimmedText(body.poNumber, 120) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'acknowledgmentNumber')) {
        updates.acknowledgmentNumber = toTrimmedText(body.acknowledgmentNumber, 120) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'orderNumber')) {
        updates.orderNumber = toTrimmedText(body.orderNumber, 120) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'paymentTerms')) {
        updates.paymentTerms = toTrimmedText(body.paymentTerms, 240) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'leadTime')) {
        updates.leadTime = toTrimmedText(body.leadTime, 240) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'subtotal')) {
        updates.subtotal = toNonNegativeNumberOrNull(body.subtotal)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'discountPercent')) {
        const discountPercent = toNonNegativeNumberOrNull(body.discountPercent)
        if (discountPercent !== null && discountPercent > 100) {
          return res.status(400).json({ error: 'discountPercent must be between 0 and 100.' })
        }
        updates.discountPercent = discountPercent
      }

      if (Object.prototype.hasOwnProperty.call(body, 'discountAmount')) {
        updates.discountAmount = toNonNegativeNumberOrNull(body.discountAmount)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'discountScope')) {
        updates.discountScope = body.discountScope === 'products_and_freight'
          ? 'products_and_freight'
          : 'products'
      }

      if (Object.prototype.hasOwnProperty.call(body, 'discountFreightAmount')) {
        updates.discountFreightAmount = toNonNegativeNumberOrNull(body.discountFreightAmount)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'freight')) {
        updates.freight = toNonNegativeNumberOrNull(body.freight)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'freightDescription')) {
        updates.freightDescription = toTrimmedText(body.freightDescription, 1200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'contactEmail')) {
        updates.contactEmail = toTrimmedText(body.contactEmail, 200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'contactPhone')) {
        updates.contactPhone = toTrimmedText(body.contactPhone, 80) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'companyName')) {
        updates.companyName = toTrimmedText(body.companyName, 200) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'dealerState')) {
        updates.dealerState = normalizeUsStateCode(body.dealerState) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'projectType')) {
        updates.projectType = normalizeProjectType(body.projectType)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'lineItems')) {
        updates.lineItems = normalizeQuoteLineItems(body.lineItems)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'additionalServices')) {
        updates.additionalServices = normalizeQuoteServiceItems(body.additionalServices)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'shippingServices')) {
        updates.shippingServices = normalizeQuoteServiceItems(body.shippingServices)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'origin')) {
        updates.origin = normalizeQuoteOrigin(body.origin, normalizeQuoteOrigin(existingQuote.origin, 'website'))
      }

      for (const fieldName of ['sourceWorkbookUrl', 'sourceWorkbookName', 'convertedPdfUrl', 'convertedPdfName']) {
        if (Object.prototype.hasOwnProperty.call(body, fieldName)) {
          updates[fieldName] = toTrimmedText(body[fieldName], fieldName.endsWith('Url') ? 2000 : 500) || null
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'salesRep')) {
        if (quoteAccessScope.restrictToLinkedSalesRep) {
          const requestedSalesRep = toTrimmedText(body.salesRep, 200)

          if (
            requestedSalesRep
            && !quoteAccessScope.linkedSalesRepRegex?.test(requestedSalesRep)
          ) {
            return res.status(403).json({
              error: 'Sales reps can only assign opportunities to their linked sales rep.',
            })
          }

          updates.salesRep = quoteAccessScope.linkedSalesRepName
        } else {
          updates.salesRep = toTrimmedText(body.salesRep, 200) || null
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'opportunityDate')) {
        updates.opportunityDate = toIsoDateOrNull(body.opportunityDate)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'currency')) {
        updates.currency = toTrimmedText(body.currency, 16) || 'USD'
      }

      if (Object.prototype.hasOwnProperty.call(body, 'revisionCount')) {
        updates.revisionCount = toNonNegativeInteger(body.revisionCount, 0)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'totalAmount')) {
        const nextAmount = toNonNegativeNumberOrNull(body.totalAmount)

        if (nextAmount === null) {
          return res.status(400).json({
            error: 'totalAmount must be a non-negative number.',
          })
        }

        updates.totalAmount = Number(nextAmount.toFixed(2))
      }

      if (Object.prototype.hasOwnProperty.call(body, 'dealerSourceId')) {
        const dealer = await resolveDealerOrThrow(crmAccountsCollection, body.dealerSourceId)
        updates.dealerSourceId = dealer.sourceId
        updates.dealerName = dealer.name || dealer.sourceId

        if (!Object.prototype.hasOwnProperty.call(body, 'dealerState')) {
          updates.dealerState = normalizeUsStateCode(dealer.state) || null
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'contactSourceId')) {
        const nextContactSourceId = toTrimmedText(body.contactSourceId, 160)

        if (!nextContactSourceId) {
          updates.contactSourceId = null
          updates.contactName = null
        } else {
          const effectiveDealerSourceId = updates.dealerSourceId || existingQuote.dealerSourceId
          const linkedContact = await crmContactsCollection.findOne(
            {
              sourceId: nextContactSourceId,
            },
            {
              projection: {
                _id: 0,
                sourceId: 1,
                accountSourceId: 1,
                name: 1,
                firstName: 1,
                lastName: 1,
              },
            },
          )

          if (!linkedContact) {
            return res.status(400).json({
              error: 'Selected contact does not exist.',
            })
          }

          const contactDealerSourceId = toTrimmedText(linkedContact.accountSourceId, 160)

          if (contactDealerSourceId && contactDealerSourceId !== effectiveDealerSourceId) {
            return res.status(400).json({
              error: 'Selected contact does not belong to the selected dealer.',
            })
          }

          updates.contactSourceId = linkedContact.sourceId
          updates.contactName = resolveContactDisplayName(linkedContact)
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'contactName')) {
        updates.contactName = toTrimmedText(body.contactName, 240) || null
      }

      if (hasDocumentsInput) {
        const normalizedDocuments = normalizeQuoteDocuments(body.documents)
        const primaryDocument = normalizedDocuments[0] || null

        updates.documents = normalizedDocuments
        updates.documentUrl = primaryDocument?.url || null
        updates.documentName = primaryDocument?.name || null
      }

      if (!hasDocumentsInput && hasLegacyDocumentUrlInput) {
        updates.documentUrl = toTrimmedText(body.documentUrl, 2000) || null
      }

      if (!hasDocumentsInput && hasLegacyDocumentNameInput) {
        updates.documentName = toTrimmedText(body.documentName, 240) || null
      }

      if (!hasDocumentsInput && hasLegacyDocumentInput) {
        const nextDocumentUrl = toTrimmedText(
          updates.documentUrl ?? existingQuote.documentUrl,
          2000,
        ) || null
        const nextDocumentName = toTrimmedText(
          updates.documentName ?? existingQuote.documentName,
          240,
        ) || null

        updates.documents = nextDocumentUrl
          ? [{ url: nextDocumentUrl, name: nextDocumentName }]
          : []
      }

      if (Object.prototype.hasOwnProperty.call(body, 'sentAt')) {
        updates.sentAt = toIsoDateOrNull(body.sentAt)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
        updates.notes = toTrimmedText(body.notes, 4000) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        const nextStatus = normalizeStatus(body.status, quoteStatuses, existingQuote.status)

        if (!nextStatus) {
          return res.status(400).json({
            error: `status must be one of: ${quoteStatuses.join(', ')}`,
          })
        }

        updates.status = nextStatus

        if (nextStatus !== existingQuote.status) {
          updates.lastStatusChangedAt = now
        }

        if (nextStatus === 'accepted' && !existingQuote.acceptedAt) {
          updates.acceptedAt = now
        }

        if (nextStatus === 'rejected' && !existingQuote.rejectedAt) {
          updates.rejectedAt = now
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.json({
          quote: normalizeQuoteOpportunityStageForResponse(existingQuote),
        })
      }

      updates.updatedAt = now
      const requestedQuoteIdentity = parseQuoteRevisionIdentity(
        updates.quoteNumber || existingRevisionState.baseQuoteNumber || existingQuote.quoteNumber,
      )
      const nextBaseQuoteNumber = requestedQuoteIdentity.baseQuoteNumber || existingRevisionState.baseQuoteNumber
      const nextRequestedSnapshot = buildQuoteRevisionSnapshot(
        {
          ...requestedRevision,
          ...updates,
        },
        {
          id: requestedRevision.id,
          baseQuoteNumber: nextBaseQuoteNumber,
          revisionNumber: requestedRevisionNumber,
          createdAt: requestedRevision.createdAt,
          createdByUid: requestedRevision.createdByUid,
          createdByEmail: requestedRevision.createdByEmail,
          updatedAt: now,
          updatedByUid: toTrimmedText(req.authUser?.uid, 160) || null,
          updatedByEmail: toTrimmedText(req.authUser?.email, 200) || null,
        },
      )
      const nextRevisions = existingRevisionState.revisions.map((revision) => {
        const nextRevision = revision.revisionNumber === requestedRevisionNumber
          ? nextRequestedSnapshot
          : revision

        return {
          ...nextRevision,
          quoteNumber: formatQuoteRevisionNumber(nextBaseQuoteNumber, nextRevision.revisionNumber),
        }
      })
      const rootUpdates = { ...updates }
      const nextActiveRevision = nextRevisions.find(
        (revision) => revision.revisionNumber === requestedActiveRevisionNumber,
      )

      if (requestedRevisionNumber !== requestedActiveRevisionNumber) {
        // Revision-specific fields update only the chosen revision. Opportunity
        // folders and lifecycle fields remain shared at the root.
        for (const fieldName of quoteRevisionSnapshotFields) {
          delete rootUpdates[fieldName]
        }
      }

      if (nextActiveRevision) {
        for (const fieldName of quoteRevisionSnapshotFields) {
          if (Object.prototype.hasOwnProperty.call(nextActiveRevision, fieldName)) {
            rootUpdates[fieldName] = cloneQuoteRevisionValue(nextActiveRevision[fieldName])
          }
        }
      }

      rootUpdates.baseQuoteNumber = nextBaseQuoteNumber
      rootUpdates.activeRevisionNumber = requestedActiveRevisionNumber
      rootUpdates.revisionCount = existingRevisionState.revisionCount
      rootUpdates.revisions = nextRevisions
      rootUpdates.quoteNumber = formatQuoteRevisionNumber(
        nextBaseQuoteNumber,
        requestedActiveRevisionNumber,
      ) || existingQuote.quoteNumber

      const updatedQuote = await crmQuotesCollection.findOneAndUpdate(
        {
          id: quoteId,
        },
        {
          $set: rootUpdates,
        },
        {
          returnDocument: 'after',
          projection: {
            _id: 0,
          },
        },
      )

      // Remove files that were explicitly removed from a saved quote. Cleanup happens
      // only after MongoDB accepts the update, so cancelling an edit never breaks an
      // existing quote and deleted image references cannot accumulate orphaned files.
      const nextStorageTargetKeys = new Set(
        resolveQuoteStorageTargets(updatedQuote).map(
          (target) => `${target.bucketName.toLowerCase()}::${target.objectPath.toLowerCase()}`,
        ),
      )
      const removedStorageTargets = resolveQuoteStorageTargets(existingQuote).filter(
        (target) => !nextStorageTargetKeys.has(
          `${target.bucketName.toLowerCase()}::${target.objectPath.toLowerCase()}`,
        ),
      )

      if (removedStorageTargets.length > 0) {
        await deleteResolvedQuoteStorageTargets(removedStorageTargets)
      }

      return res.json({
        quote: normalizeQuoteOpportunityStageForResponse(updatedQuote),
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/quotes/:quoteId/revisions', requireFirebaseAuth, async (req, res, next) => {
    try {
      const quoteId = toTrimmedText(req.params.quoteId, 160)

      if (!quoteId) {
        return res.status(400).json({ error: 'quoteId is required.' })
      }

      const accessScope = resolveCrmAccessScope(req)
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)
      const body = toOptionalObject(req.body)
      const { crmQuotesCollection } = await getCollections()
      const existingQuote = await crmQuotesCollection.findOne(
        { id: quoteId },
        { projection: { _id: 0 } },
      )

      if (!existingQuote) {
        return res.status(404).json({ error: 'Quote not found.' })
      }

      if (!canAccessQuoteBySalesRep(existingQuote, quoteAccessScope)) {
        return res.status(403).json({
          error: 'You can only access opportunities assigned to your linked sales rep.',
        })
      }

      const revisionState = resolveQuoteRevisionState(existingQuote)
      const sourceRevisionNumber = Object.prototype.hasOwnProperty.call(body, 'sourceRevisionNumber')
        ? toNonNegativeInteger(body.sourceRevisionNumber, -1)
        : revisionState.activeRevisionNumber
      const sourceRevision = revisionState.revisions.find(
        (revision) => revision.revisionNumber === sourceRevisionNumber,
      )

      if (!sourceRevision) {
        return res.status(404).json({ error: 'The selected source revision was not found.' })
      }

      const now = nowIso()
      const actorUid = toTrimmedText(req.authUser?.uid, 160) || null
      const actorEmail = toTrimmedText(req.authUser?.email, 200) || null
      const nextRevisionNumber = revisionState.revisionCount + 1
      const nextRevision = buildQuoteRevisionSnapshot(
        {
          ...sourceRevision,
          // A new revision intentionally starts without a SketchUp/public 3D
          // model. Everything else is copied from the chosen revision.
          trimble3d: null,
        },
        {
          id: randomUUID(),
          baseQuoteNumber: revisionState.baseQuoteNumber,
          revisionNumber: nextRevisionNumber,
          archivedPdfUrl: null,
          archivedPdfName: null,
          createdAt: now,
          createdByUid: actorUid,
          createdByEmail: actorEmail,
          updatedAt: now,
          updatedByUid: actorUid,
          updatedByEmail: actorEmail,
        },
      )
      const revisions = [...revisionState.revisions]
      revisions.push(nextRevision)

      const rootUpdates = {
        baseQuoteNumber: revisionState.baseQuoteNumber,
        activeRevisionNumber: nextRevisionNumber,
        revisionCount: nextRevisionNumber,
        revisions,
        updatedAt: now,
      }

      for (const fieldName of quoteRevisionSnapshotFields) {
        if (Object.prototype.hasOwnProperty.call(nextRevision, fieldName)) {
          rootUpdates[fieldName] = cloneQuoteRevisionValue(nextRevision[fieldName])
        }
      }

      rootUpdates.quoteNumber = nextRevision.quoteNumber

      const updatedQuote = await crmQuotesCollection.findOneAndUpdate(
        { id: quoteId },
        { $set: rootUpdates },
        { returnDocument: 'after', projection: { _id: 0 } },
      )

      cacheDelete(OVERVIEW_CACHE_KEY)

      return res.status(201).json({
        quote: normalizeQuoteOpportunityStageForResponse(updatedQuote),
        revision: nextRevision,
      })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/crm/quotes/:quoteId/revisions/:revisionNumber', requireFirebaseAuth, async (req, res, next) => {
    try {
      const quoteId = toTrimmedText(req.params.quoteId, 160)
      const revisionNumber = toNonNegativeInteger(req.params.revisionNumber, -1)

      if (!quoteId || revisionNumber < 0) {
        return res.status(400).json({ error: 'A valid quoteId and revision number are required.' })
      }

      const accessScope = resolveCrmAccessScope(req)
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)
      const { crmQuotesCollection } = await getCollections()
      const existingQuote = await crmQuotesCollection.findOne(
        { id: quoteId },
        { projection: { _id: 0 } },
      )

      if (!existingQuote) {
        return res.status(404).json({ error: 'Quote not found.' })
      }

      if (!canAccessQuoteBySalesRep(existingQuote, quoteAccessScope)) {
        return res.status(403).json({
          error: 'You can only access opportunities assigned to your linked sales rep.',
        })
      }

      const revisionState = resolveQuoteRevisionState(existingQuote)
      const revisionToDelete = revisionState.revisions.find(
        (revision) => revision.revisionNumber === revisionNumber,
      )

      if (!revisionToDelete) {
        return res.status(404).json({ error: 'The selected revision was not found.' })
      }

      if (revisionState.revisions.length <= 1) {
        return res.status(409).json({
          error: 'Revision 0 is the only revision. Delete the entire opportunity instead.',
        })
      }

      const remainingOriginalRevisions = revisionState.revisions
        .filter((revision) => revision.id !== revisionToDelete.id)
        .sort((left, right) => left.revisionNumber - right.revisionNumber)
      const activeOriginalRevision = revisionState.revisions.find(
        (revision) => revision.revisionNumber === revisionState.activeRevisionNumber,
      )
      const nextActiveOriginalId = activeOriginalRevision?.id === revisionToDelete.id
        ? remainingOriginalRevisions[remainingOriginalRevisions.length - 1].id
        : activeOriginalRevision?.id
      const now = nowIso()
      const actorUid = toTrimmedText(req.authUser?.uid, 160) || null
      const actorEmail = toTrimmedText(req.authUser?.email, 200) || null
      const renumberedRevisions = remainingOriginalRevisions.map((revision, index) => (
        buildQuoteRevisionSnapshot(revision, {
          id: revision.id,
          baseQuoteNumber: revisionState.baseQuoteNumber,
          revisionNumber: index,
          createdAt: revision.createdAt,
          createdByUid: revision.createdByUid,
          createdByEmail: revision.createdByEmail,
          updatedAt: now,
          updatedByUid: actorUid,
          updatedByEmail: actorEmail,
        })
      ))
      const nextActiveRevision = renumberedRevisions.find(
        (revision) => revision.id === nextActiveOriginalId,
      ) || renumberedRevisions[renumberedRevisions.length - 1]
      const rootUpdates = {
        baseQuoteNumber: revisionState.baseQuoteNumber,
        activeRevisionNumber: nextActiveRevision.revisionNumber,
        revisionCount: renumberedRevisions.length - 1,
        revisions: renumberedRevisions,
        updatedAt: now,
      }

      for (const fieldName of quoteRevisionSnapshotFields) {
        if (Object.prototype.hasOwnProperty.call(nextActiveRevision, fieldName)) {
          rootUpdates[fieldName] = cloneQuoteRevisionValue(nextActiveRevision[fieldName])
        }
      }
      rootUpdates.quoteNumber = nextActiveRevision.quoteNumber

      const updatedQuote = await crmQuotesCollection.findOneAndUpdate(
        { id: quoteId },
        { $set: rootUpdates },
        { returnDocument: 'after', projection: { _id: 0 } },
      )

      const nextStorageTargetKeys = new Set(
        resolveQuoteStorageTargets(updatedQuote).map(
          (target) => `${target.bucketName.toLowerCase()}::${target.objectPath.toLowerCase()}`,
        ),
      )
      const removedStorageTargets = resolveQuoteStorageTargets(existingQuote).filter(
        (target) => !nextStorageTargetKeys.has(
          `${target.bucketName.toLowerCase()}::${target.objectPath.toLowerCase()}`,
        ),
      )

      if (removedStorageTargets.length > 0) {
        await deleteResolvedQuoteStorageTargets(removedStorageTargets)
      }

      cacheDelete(OVERVIEW_CACHE_KEY)

      return res.json({
        ok: true,
        quote: normalizeQuoteOpportunityStageForResponse(updatedQuote),
        deletedRevisionNumber: revisionNumber,
        revisionsRenumbered: true,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/quotes/convert-order-options', requireFirebaseAuth, async (_req, res, next) => {
    try {
      const [catalogBoards, suggestedAcknowledgmentNumber] = await Promise.all([
        typeof fetchMondayBoardsCatalog === 'function'
        ? await fetchMondayBoardsCatalog()
        : [],
        getSuggestedAcknowledgmentNumber(),
      ])
      const boardsById = new Map()

      ;(Array.isArray(catalogBoards) ? catalogBoards : []).forEach((board) => {
        const boardId = toTrimmedText(board?.id, 120)

        if (!boardId || boardsById.has(boardId)) {
          return
        }

        boardsById.set(boardId, {
          id: boardId,
          name: toTrimmedText(board?.name, 240) || null,
        })
      })

      if (!boardsById.has(mondayNewOrders2026BoardId)) {
        boardsById.set(mondayNewOrders2026BoardId, {
          id: mondayNewOrders2026BoardId,
          name: 'New Orders 2026',
        })
      }

      if (!boardsById.has(mondayDesignAkfBoardId)) {
        boardsById.set(mondayDesignAkfBoardId, {
          id: mondayDesignAkfBoardId,
          name: 'Design AKF',
        })
      }

      const boards = [...boardsById.values()].sort((left, right) => {
        const leftName = toTrimmedText(left?.name, 240).toLowerCase()
        const rightName = toTrimmedText(right?.name, 240).toLowerCase()
        const byName = leftName.localeCompare(rightName)

        if (byName !== 0) {
          return byName
        }

        return toTrimmedText(left?.id, 120).localeCompare(toTrimmedText(right?.id, 120))
      })

      return res.json({
        primaryBoardId: mondayNewOrders2026BoardId,
        secondaryBoardId: mondayDesignAkfBoardId,
        suggestedAcknowledgmentNumber,
        boards,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/quotes/:quoteId/convert-to-order', requireFirebaseAuth, async (req, res, next) => {
    const createdMondayItems = []
    let createdCanonicalOrderKey = null
    let canonicalOrdersCollection = null

    try {
      if (
        typeof createMondayItem !== 'function'
        || typeof updateMondayItemTextColumn !== 'function'
        || typeof updateMondayItemJsonColumn !== 'function'
      ) {
        return res.status(500).json({
          error: 'Monday conversion helpers are not configured on this server.',
        })
      }

      const quoteId = toTrimmedText(req.params.quoteId, 160)

      if (!quoteId) {
        return res.status(400).json({
          error: 'quoteId is required.',
        })
      }

      const accessScope = resolveCrmAccessScope(req)
      const quoteAccessScope = resolveSalesRepQuoteAccessScope(accessScope)

      if (quoteAccessScope.restrictToLinkedSalesRep && !quoteAccessScope.linkedSalesRepName) {
        return res.status(403).json({
          error: 'Sales rep access is not linked to a CRM sales rep yet.',
        })
      }

      const body = toOptionalObject(req.body)
      const rawPoDate = toTrimmedText(body.poDate, 80)
      const parsedPoDate = toIsoDateOnlyOrNull(rawPoDate)

      if (rawPoDate && !parsedPoDate) {
        return res.status(400).json({
          error: 'poDate must be a valid date.',
        })
      }

      const poDate = parsedPoDate || nowIso().slice(0, 10)
      const leadTime = toTrimmedText(body.leadTime, 500) || null

      const shipTo = toTrimmedText(body.shipTo, 2000)

      if (!shipTo) {
        return res.status(400).json({
          error: 'shipTo is required.',
        })
      }

      const acknowledgmentNumber = toTrimmedText(body.acknowledgmentNumber, 120)

      if (!acknowledgmentNumber) {
        return res.status(400).json({
          error: 'acknowledgmentNumber is required.',
        })
      }

      const poNumber = toTrimmedText(body.poNumber, 120) || null
      const notes = toTrimmedText(body.notes, 4000) || null
      if (typeof body.depositRequired !== 'boolean') {
        return res.status(400).json({ error: 'Select whether a deposit is required.' })
      }
      const depositRequired = body.depositRequired
      const depositPercent = depositRequired ? toNonNegativeNumberOrNull(body.depositPercent) : null
      if (depositRequired && (depositPercent === null || depositPercent <= 0 || depositPercent > 100)) {
        return res.status(400).json({ error: 'depositPercent must be greater than 0 and no more than 100.' })
      }
      const selectedLineItemIds = [...new Set((Array.isArray(body.selectedLineItemIds) ? body.selectedLineItemIds : []).map((value) => toTrimmedText(value, 160)).filter(Boolean))]
      const selectedAdditionalServiceIds = [...new Set((Array.isArray(body.selectedAdditionalServiceIds) ? body.selectedAdditionalServiceIds : []).map((value) => toTrimmedText(value, 160)).filter(Boolean))]
      const selectedShippingServiceIds = [...new Set((Array.isArray(body.selectedShippingServiceIds) ? body.selectedShippingServiceIds : []).map((value) => toTrimmedText(value, 160)).filter(Boolean))]
      const includeFreight = body.includeFreight === true
      if (selectedLineItemIds.length + selectedAdditionalServiceIds.length + selectedShippingServiceIds.length + (includeFreight ? 1 : 0) === 0) {
        return res.status(400).json({ error: 'Select at least one quote line to convert.' })
      }
      const {
        crmQuotesCollection,
        ordersUnifiedCollection,
      } = await getCollections()
      canonicalOrdersCollection = ordersUnifiedCollection

      const quote = await crmQuotesCollection.findOne(
        {
          id: quoteId,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!quote) {
        return res.status(404).json({
          error: 'Quote not found.',
        })
      }

      assertCanAccessQuoteBySalesRep(quote, quoteAccessScope)

      const dealerSourceId = toTrimmedText(quote?.dealerSourceId, 160)

      if (!dealerSourceId) {
        return res.status(400).json({
          error: 'Quote must be linked to a dealer account before conversion.',
        })
      }

      const orderNumber = acknowledgmentNumber
      const canonicalOrderId = randomUUID()
      const normalizedOrderNumberKey = orderNumber.toLowerCase().replace(/[^a-z0-9]+/g, '')
      const canonicalOrderKey = normalizedOrderNumberKey
        ? `order:${normalizedOrderNumberKey}`
        : `canonical:${canonicalOrderId}`

      const existingOrderWithSameNumber = await ordersUnifiedCollection.findOne(
        {
          order_number: new RegExp(`^${escapeRegex(orderNumber)}$`, 'i'),
          is_cancelled: { $ne: true },
          is_deleted: { $ne: true },
        },
        {
          projection: {
            _id: 0,
            id: 1,
          },
        },
      )

      if (existingOrderWithSameNumber) {
        return res.status(409).json({
          error: `Order number ${orderNumber} already exists. Use a different acknowledgement number.`,
        })
      }

      // Cancelled orders remain in MongoDB as audit history, but their natural
      // order key must not reserve the acknowledgement number forever. This
      // also repairs orders cancelled before the key-archiving behavior was
      // introduced, so the same quote can be converted again immediately.
      const staleCancelledOrder = await ordersUnifiedCollection.findOne(
        {
          orderKey: canonicalOrderKey,
          is_cancelled: true,
        },
        {
          projection: {
            _id: 1,
            canonical_order_id: 1,
            id: 1,
          },
        },
      )

      if (staleCancelledOrder) {
        const cancelledOrderIdentity = toTrimmedText(
          staleCancelledOrder?.canonical_order_id || staleCancelledOrder?.id,
          160,
        ) || String(staleCancelledOrder._id)

        await ordersUnifiedCollection.updateOne(
          {
            _id: staleCancelledOrder._id,
            orderKey: canonicalOrderKey,
            is_cancelled: true,
          },
          {
            $set: {
              orderKey: `cancelled:${cancelledOrderIdentity}`,
              canonical_updated_at: nowIso(),
              updatedAt: nowIso(),
            },
          },
        )
      }

      const lineItems = normalizeQuoteLineItems(quote?.lineItems)
      const additionalServices = normalizeQuoteServiceItems(quote?.additionalServices)
      const shippingServices = normalizeQuoteServiceItems(quote?.shippingServices)
      const convertedItemKeys = new Set((Array.isArray(quote?.convertedItemKeys) ? quote.convertedItemKeys : []).map((value) => toTrimmedText(value, 240)).filter(Boolean))
      const selectedLines = lineItems.filter((item) => selectedLineItemIds.includes(item.id) && Number(item.qty ?? 1) !== 0)
      const selectedAdditionalServices = additionalServices.filter((item) => selectedAdditionalServiceIds.includes(item.id) && (toNonNegativeNumberOrNull(item.extPrice ?? item.price) ?? 0) > 0)
      const selectedShippingServices = shippingServices.filter((item) => selectedShippingServiceIds.includes(item.id) && (toNonNegativeNumberOrNull(item.extPrice ?? item.price) ?? 0) > 0)
      const selectedKeys = [
        ...selectedLines.map((item) => `line:${item.id}`),
        ...selectedAdditionalServices.map((item) => `additional:${item.id}`),
        ...selectedShippingServices.map((item) => `shipping:${item.id}`),
        ...(includeFreight ? ['freight'] : []),
      ]
      if (selectedKeys.length === 0 || selectedKeys.some((key) => convertedItemKeys.has(key))) {
        return res.status(409).json({ error: 'One or more selected lines are unavailable or were already converted.' })
      }
      const productGrossValue = Number(([
        ...selectedLines.map((item) => toNonNegativeNumberOrNull(item.extPrice) ?? 0),
        ...selectedAdditionalServices.map((item) => toNonNegativeNumberOrNull(item.extPrice ?? item.price) ?? 0),
      ].reduce((sum, value) => sum + value, 0)).toFixed(2))
      const discountPercent = Math.min(100, Math.max(0, toNonNegativeNumberOrNull(quote?.discountPercent) ?? 0))
      const discountAmount = Number((productGrossValue * (discountPercent / 100)).toFixed(2))
      const productValue = Number((productGrossValue - discountAmount).toFixed(2))
      const freightGrossValue = Number((selectedShippingServices.reduce((sum, item) => sum + (toNonNegativeNumberOrNull(item.extPrice ?? item.price) ?? 0), 0) + (includeFreight ? (toNonNegativeNumberOrNull(quote?.freight) ?? 0) : 0)).toFixed(2))
      const discountScope = quote?.discountScope === 'products_and_freight'
        ? 'products_and_freight'
        : 'products'
      const freightDiscountAmount = discountScope === 'products_and_freight'
        ? Number((freightGrossValue * (discountPercent / 100)).toFixed(2))
        : 0
      const freightValue = Number((freightGrossValue - freightDiscountAmount).toFixed(2))
      const orderValue = Number((productValue + freightValue).toFixed(2))
      const depositAmount = depositRequired
        ? Number((productValue * (depositPercent / 100)).toFixed(2))
        : 0
      selectedKeys.forEach((key) => convertedItemKeys.add(key))
      const allBillableKeys = [
        ...lineItems.filter((item) => Number(item.qty ?? 1) !== 0).map((item) => `line:${item.id}`),
        ...additionalServices.filter((item) => (toNonNegativeNumberOrNull(item.extPrice ?? item.price) ?? 0) > 0).map((item) => `additional:${item.id}`),
        ...shippingServices.filter((item) => (toNonNegativeNumberOrNull(item.extPrice ?? item.price) ?? 0) > 0).map((item) => `shipping:${item.id}`),
        ...((toNonNegativeNumberOrNull(quote?.freight) ?? 0) > 0 ? ['freight'] : []),
      ]
      const isFullyConverted = allBillableKeys.length > 0 && allBillableKeys.every((key) => convertedItemKeys.has(key))

      let primaryAckColumnId = mondayNewOrders2026ColumnIds.ack
      let secondaryAckColumnId = mondayDesignAkfColumnIds.orderNumber

      if (typeof fetchMondayBoardColumns === 'function') {
        try {
          const [primaryBoardSnapshot, secondaryBoardSnapshot] = await Promise.all([
            fetchMondayBoardColumns({ boardId: mondayNewOrders2026BoardId }),
            fetchMondayBoardColumns({ boardId: mondayDesignAkfBoardId }),
          ])

          primaryAckColumnId =
            resolveAckColumnIdFromBoardColumns(primaryBoardSnapshot?.columns, primaryAckColumnId)
            || primaryAckColumnId
          secondaryAckColumnId =
            resolveAckColumnIdFromBoardColumns(secondaryBoardSnapshot?.columns, secondaryAckColumnId)
            || secondaryAckColumnId
        } catch {
          // Keep static fallback IDs when live board metadata cannot be loaded.
        }
      }

      const dealerLabel =
        toTrimmedText(quote?.companyName, 200)
        || toTrimmedText(quote?.dealerName, 240)
        || dealerSourceId
      const itemName = `${dealerLabel} / ${orderNumber}`
      const description =
        toTrimmedText(quote?.title, 240)
        || toTrimmedText(quote?.description, 2000)
        || `Opportunity ${toTrimmedText(quote?.quoteNumber, 120) || quoteId}`
      const salesRep = toTrimmedText(quote?.salesRep, 200) || null

      const updateTextIfPresent = async ({ boardId, itemId, columnId, value }) => {
        const textValue = toTrimmedText(value, 4000)

        if (!textValue) {
          return
        }

        await updateMondayItemTextColumn({
          boardId,
          itemId,
          columnId,
          textValue,
        })
      }

      const updateDateIfPresent = async ({ boardId, itemId, columnId, value }) => {
        const dateValue = toIsoDateOnlyOrNull(value)

        if (!dateValue) {
          return
        }

        await updateMondayItemJsonColumn({
          boardId,
          itemId,
          columnId,
          jsonValue: {
            date: dateValue,
          },
        })
      }

      const updateNumberIfPresent = async ({ boardId, itemId, columnId, value }) => {
        const numericValue = toNonNegativeNumberOrNull(value)

        if (numericValue === null) {
          return
        }

        await updateMondayItemTextColumn({
          boardId,
          itemId,
          columnId,
          textValue: String(Number(numericValue.toFixed(2))),
        })
      }

      const updateLocationIfPresent = async ({ boardId, itemId, columnId, value }) => {
        const address = toTrimmedText(value, 2000)

        if (!address) {
          return
        }

        await updateMondayItemJsonColumn({
          boardId,
          itemId,
          columnId,
          jsonValue: {
            address,
            lat: '0',
            lng: '0',
          },
        })
      }

      const primaryCreated = await createMondayItem({
        boardId: mondayNewOrders2026BoardId,
        itemName,
      })
      const primaryItemId = toTrimmedText(primaryCreated?.itemId, 120)

      if (!primaryItemId) {
        throw {
          status: 502,
          message: 'Monday did not return an item id for New Orders 2026.',
        }
      }

      createdMondayItems.push({
        boardId: mondayNewOrders2026BoardId,
        itemId: primaryItemId,
      })

      await updateTextIfPresent({
        boardId: mondayNewOrders2026BoardId,
        itemId: primaryItemId,
        columnId: primaryAckColumnId,
        value: orderNumber,
      })
      await updateTextIfPresent({
        boardId: mondayNewOrders2026BoardId,
        itemId: primaryItemId,
        columnId: mondayNewOrders2026ColumnIds.salesRep,
        value: salesRep,
      })
      await updateNumberIfPresent({
        boardId: mondayNewOrders2026BoardId,
        itemId: primaryItemId,
        columnId: mondayNewOrders2026ColumnIds.orderValue,
        value: productValue,
      })
      await updateNumberIfPresent({
        boardId: mondayNewOrders2026BoardId,
        itemId: primaryItemId,
        columnId: mondayNewOrders2026ColumnIds.freightValue,
        value: freightValue,
      })
      await updateDateIfPresent({
        boardId: mondayNewOrders2026BoardId,
        itemId: primaryItemId,
        columnId: mondayNewOrders2026ColumnIds.poDate,
        value: poDate,
      })
      await updateTextIfPresent({
        boardId: mondayNewOrders2026BoardId,
        itemId: primaryItemId,
        columnId: mondayNewOrders2026ColumnIds.poNumber,
        value: poNumber,
      })
      await updateTextIfPresent({
        boardId: mondayNewOrders2026BoardId,
        itemId: primaryItemId,
        columnId: mondayNewOrders2026ColumnIds.description,
        value: description,
      })
      await updateLocationIfPresent({
        boardId: mondayNewOrders2026BoardId,
        itemId: primaryItemId,
        columnId: mondayNewOrders2026ColumnIds.shipTo,
        value: shipTo,
      })
      await updateTextIfPresent({
        boardId: mondayNewOrders2026BoardId,
        itemId: primaryItemId,
        columnId: mondayNewOrders2026ColumnIds.notes,
        value: notes,
      })

      const secondaryCreated = await createMondayItem({
        boardId: mondayDesignAkfBoardId,
        itemName,
      })
      const secondaryItemId = toTrimmedText(secondaryCreated?.itemId, 120)

      if (!secondaryItemId) {
        throw {
          status: 502,
          message: 'Monday did not return an item id for Design AKF.',
        }
      }

      createdMondayItems.push({
        boardId: mondayDesignAkfBoardId,
        itemId: secondaryItemId,
      })

      const requestedInitialDesignStatus = depositRequired
        ? 'waiting on deposit'
        : 'NO DEPOSIT REQUIRED'
      let initialDesignStatus = requestedInitialDesignStatus
      let initialDesignStatusIndex = null

      if (typeof fetchMondayStatusColumnOptions === 'function') {
        const statusOptionsByColumn = await fetchMondayStatusColumnOptions({
          boardId: mondayDesignAkfBoardId,
          columnIds: [mondayDesignAkfColumnIds.designStatus],
        })
        const statusOptions = Array.isArray(
          statusOptionsByColumn?.[mondayDesignAkfColumnIds.designStatus],
        )
          ? statusOptionsByColumn[mondayDesignAkfColumnIds.designStatus]
          : []
        const matchedStatus = statusOptions.find(
          (option) => String(option?.label ?? '').trim().toLowerCase()
            === requestedInitialDesignStatus.toLowerCase(),
        )

        if (!matchedStatus) {
          throw {
            status: 409,
            message: `Monday Design status "${requestedInitialDesignStatus}" is not configured.`,
          }
        }

        initialDesignStatus = String(matchedStatus.label).trim()
        initialDesignStatusIndex = matchedStatus.index
      }

      await updateMondayItemStatusColumn({
        boardId: mondayDesignAkfBoardId,
        itemId: secondaryItemId,
        columnId: mondayDesignAkfColumnIds.designStatus,
        statusIndex: initialDesignStatusIndex,
        statusLabel: initialDesignStatus,
      })
      await updateTextIfPresent({
        boardId: mondayDesignAkfBoardId,
        itemId: secondaryItemId,
        columnId: secondaryAckColumnId,
        value: orderNumber,
      })
      await updateDateIfPresent({
        boardId: mondayDesignAkfBoardId,
        itemId: secondaryItemId,
        columnId: mondayDesignAkfColumnIds.poDate,
        value: poDate,
      })
      await updateTextIfPresent({
        boardId: mondayDesignAkfBoardId,
        itemId: secondaryItemId,
        columnId: mondayDesignAkfColumnIds.poNumber,
        value: poNumber,
      })
      await updateTextIfPresent({
        boardId: mondayDesignAkfBoardId,
        itemId: secondaryItemId,
        columnId: mondayDesignAkfColumnIds.description,
        value: description,
      })
      await updateLocationIfPresent({
        boardId: mondayDesignAkfBoardId,
        itemId: secondaryItemId,
        columnId: mondayDesignAkfColumnIds.shipTo,
        value: shipTo,
      })
      await updateTextIfPresent({
        boardId: mondayDesignAkfBoardId,
        itemId: secondaryItemId,
        columnId: mondayDesignAkfColumnIds.notes,
        value: notes,
      })

      const now = nowIso()
      const initialProgressStatusDetails = [{
        key: 'design',
        label: 'Design',
        weight: 13,
        columnId: mondayDesignAkfColumnIds.designStatus,
        status: initialDesignStatus,
        options: [],
        optionStyles: [],
      }]
      const nextOrder = {
        id: canonicalOrderId,
        dealerSourceId,
        dealerName: dealerLabel,
        orderNumber,
        sourceQuoteId: quoteId,
        sourceQuoteNumber: toTrimmedText(quote?.quoteNumber, 120) || null,
        sourceQuoteTitle: toTrimmedText(quote?.title, 240) || null,
        mondayPrimaryBoardId: mondayNewOrders2026BoardId,
        mondayPrimaryItemId: primaryItemId,
        mondaySecondaryBoardId: mondayDesignAkfBoardId,
        mondaySecondaryItemId: secondaryItemId,
        poDate: poDate || null,
        poNumber,
        leadTime,
        shipTo,
        title: description,
        status: 'pending',
        progressPercent: 5,
        progressStatusDetails: initialProgressStatusDetails,
        orderValue,
        productValue,
        productGrossValue,
        discountPercent,
        discountAmount,
        discountScope,
        freightGrossValue,
        freightDiscountAmount,
        freightValue,
        depositRequired,
        depositPercent,
        depositAmount,
        currency: toTrimmedText(quote?.currency, 16) || 'USD',
        dueDate: null,
        selectedLineItems: selectedLines,
        selectedAdditionalServices,
        selectedShippingServices,
        includeFreight,
        depositRequestUrl: null,
        depositRequestName: null,
        orderConfirmationUrl: toTrimmedText(body.orderConfirmationUrl, 2000) || null,
        orderConfirmationName: toTrimmedText(body.orderConfirmationName, 500) || null,
        workOrderUrl: toTrimmedText(body.workOrderUrl, 2000) || null,
        workOrderName: toTrimmedText(body.workOrderName, 500) || null,
        proformaInvoiceUrl: toTrimmedText(body.proformaInvoiceUrl, 2000) || null,
        proformaInvoiceName: toTrimmedText(body.proformaInvoiceName, 500) || null,
        shippedAt: null,
        deliveredAt: null,
        notes: notes || `Created from quote ${toTrimmedText(quote?.quoteNumber, 120) || quoteId}`,
        createdByUid: toTrimmedText(req.authUser?.uid, 160) || null,
        createdByEmail: toTrimmedText(req.authUser?.email, 200) || null,
        lastStatusChangedAt: now,
        createdAt: now,
        updatedAt: now,
      }

      const quoteSnapshot = {
        ...quote,
        lineItems: selectedLines,
        additionalServices: selectedAdditionalServices,
        shippingServices: selectedShippingServices,
        freight: includeFreight ? freightValue : 0,
        subtotal: productValue,
        totalAmount: orderValue,
        acceptedAt: toIsoDateOrNull(quote?.acceptedAt) || now,
        acknowledgmentNumber: isFullyConverted ? orderNumber : null,
        orderNumber: isFullyConverted ? orderNumber : null,
        poNumber,
        leadTime,
        updatedAt: now,
      }
      delete quoteSnapshot._id

      await ordersUnifiedCollection.insertOne({
        orderKey: canonicalOrderKey,
        ...nextOrder,
        crmStatus: nextOrder.status,
        id: canonicalOrderId,
        canonical_order_id: canonicalOrderId,
        is_canonical_order: true,
        has_crm_record: true,
        order_number: orderNumber,
        order_name: description,
        dealer_source_id: dealerSourceId,
        dealer_name: dealerLabel,
        source_quote_id: quoteId,
        source_quote_number: toTrimmedText(quote?.quoteNumber, 120) || null,
        source_quote_title: toTrimmedText(quote?.title, 240) || null,
        source_quote_snapshot: quoteSnapshot,
        quote_created_at: toIsoDateOrNull(quote?.createdAt),
        quote_sent_at: toIsoDateOrNull(quote?.sentAt),
        quote_viewed_at: toIsoDateOrNull(quote?.viewedAt) || toIsoDateOrNull(quote?.readAt),
        quote_accepted_at: toIsoDateOrNull(quote?.acceptedAt) || now,
        converted_at: now,
        converted_by_uid: toTrimmedText(req.authUser?.uid, 160) || null,
        converted_by_email: toTrimmedText(req.authUser?.email, 200) || null,
        canonical_status: 'pending',
        canonical_progress_percent: 5,
        canonical_order_value: orderValue,
        website_calculated_order_total: orderValue,
        website_calculated_order_total_at: now,
        canonical_product_value: productValue,
        canonical_product_gross_value: productGrossValue,
        discount_percent: discountPercent,
        discount_amount: discountAmount,
        discount_scope: discountScope,
        discount_freight_amount: freightDiscountAmount,
        canonical_freight_value: freightValue,
        canonical_freight_gross_value: freightGrossValue,
        deposit_required: depositRequired,
        deposit_percent: depositPercent,
        deposit_amount: depositAmount,
        canonical_currency: toTrimmedText(quote?.currency, 16) || 'USD',
        canonical_notes: nextOrder.notes,
        canonical_created_at: now,
        canonical_updated_at: now,
        monday_primary_board_id: mondayNewOrders2026BoardId,
        monday_primary_item_id: primaryItemId,
        monday_secondary_board_id: mondayDesignAkfBoardId,
        monday_secondary_item_id: secondaryItemId,
        monday_item_id: secondaryItemId,
        monday_board_id: mondayDesignAkfBoardId,
        monday_board_name: 'Design AKF',
        Monday_status: initialDesignStatus,
        po_number: poNumber,
        lead_time_text: leadTime,
        ship_to: shipTo,
        order_date: poDate || null,
        Due_date: null,
        selected_line_items: selectedLines,
        selected_additional_services: selectedAdditionalServices,
        selected_shipping_services: selectedShippingServices,
        include_quote_freight: includeFreight,
        deposit_request_url: null,
        deposit_request_name: null,
        order_confirmation_url: toTrimmedText(body.orderConfirmationUrl, 2000) || null,
        order_confirmation_name: toTrimmedText(body.orderConfirmationName, 500) || null,
        work_order_url: toTrimmedText(body.workOrderUrl, 2000) || null,
        work_order_name: toTrimmedText(body.workOrderName, 500) || null,
        proforma_invoice_url: toTrimmedText(body.proformaInvoiceUrl, 2000) || null,
        proforma_invoice_name: toTrimmedText(body.proformaInvoiceName, 500) || null,
        monday_notes: nextOrder.notes,
        monday_description: description,
        is_shipped: false,
        status: [],
        progress_percent: 5,
        progress_status_details: initialProgressStatusDetails,
        has_monday_record: true,
        has_quickbooks_record: false,
        in_design: true,
        hazard_reason: 'Order Track item not found in QuickBooks projects.',
        source: 'monday',
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: now,
      })
      createdCanonicalOrderKey = canonicalOrderKey

      const nextQuoteStatus = isFullyConverted ? 'accepted' : 'sent'
      const currentQuoteStatus = normalizeStatus(quote?.status, quoteStatuses, 'draft') || 'draft'
      const quoteUpdates = {
        opportunityStage: isFullyConverted ? 'order_placement' : 'proposal_submission',
        status: nextQuoteStatus,
        acceptedAt: isFullyConverted ? (toIsoDateOrNull(quote?.acceptedAt) || now) : null,
        acknowledgmentNumber: isFullyConverted ? orderNumber : null,
        orderNumber: isFullyConverted ? orderNumber : null,
        convertedOrderId: isFullyConverted ? canonicalOrderId : null,
        convertedOrderNumber: isFullyConverted ? orderNumber : null,
        convertedItemKeys: [...convertedItemKeys],
        convertedOrders: [...(Array.isArray(quote?.convertedOrders) ? quote.convertedOrders : []), { orderId: canonicalOrderId, orderNumber, convertedAt: now, itemKeys: selectedKeys }].slice(-100),
        convertedAt: now,
        poNumber,
        leadTime: leadTime || quote?.leadTime || null,
        updatedAt: now,
      }

      if (currentQuoteStatus !== nextQuoteStatus) {
        quoteUpdates.lastStatusChangedAt = now
      }

      const updatedQuote = await crmQuotesCollection.findOneAndUpdate(
        {
          id: quoteId,
        },
        {
          $set: quoteUpdates,
        },
        {
          returnDocument: 'after',
          projection: {
            _id: 0,
          },
        },
      )

      return res.status(201).json({
        order: nextOrder,
        quote: normalizeQuoteOpportunityStageForResponse(updatedQuote),
        monday: {
          primaryBoardId: mondayNewOrders2026BoardId,
          primaryItemId,
          secondaryBoardId: mondayDesignAkfBoardId,
          secondaryItemId,
        },
      })
    } catch (error) {
      if (canonicalOrdersCollection && createdCanonicalOrderKey) {
        try {
          await canonicalOrdersCollection.deleteOne({ orderKey: createdCanonicalOrderKey })
        } catch {
          // Best effort rollback; preserve original conversion error.
        }
      }

      if (typeof deleteMondayItem === 'function' && createdMondayItems.length > 0) {
        for (const item of [...createdMondayItems].reverse()) {
          try {
            // Best effort rollback to avoid half-converted Monday state.
            // eslint-disable-next-line no-await-in-loop
            await deleteMondayItem({
              boardId: item.boardId,
              itemId: item.itemId,
            })
          } catch {
            // Ignore rollback errors and surface original failure.
          }
        }
      }

      next(error)
    }
  })

  app.delete('/api/crm/quotes/:quoteId', requireFirebaseAuth, requireOfficeManagerOrAdminRole, async (req, res, next) => {
    try {
      const quoteId = toTrimmedText(req.params.quoteId, 160)

      if (!quoteId) {
        return res.status(400).json({
          error: 'quoteId is required.',
        })
      }

      const { crmQuotesCollection, ordersUnifiedCollection } = await getCollections()
      const existingQuote = await crmQuotesCollection.findOne(
        { id: quoteId },
        { projection: { _id: 0 } },
      )

      if (!existingQuote) {
        return res.status(404).json({
          error: 'Quote not found.',
        })
      }

      const now = nowIso()
      const convertedOrderId = toTrimmedText(existingQuote?.convertedOrderId, 160)

      if (convertedOrderId) {
        await ordersUnifiedCollection.updateOne(
          {
            $or: [
              { canonical_order_id: convertedOrderId },
              { source_quote_id: quoteId },
            ],
          },
          {
            $set: {
              source_quote_deleted_at: now,
              source_quote_deleted_snapshot: existingQuote,
              canonical_updated_at: now,
              updatedAt: now,
            },
            $unset: {
              source_quote_id: '',
              sourceQuoteId: '',
            },
          },
        )
      }

      const deletedQuote = await crmQuotesCollection.findOneAndDelete(
        {
          id: quoteId,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!deletedQuote) {
        return res.status(404).json({
          error: 'Quote not found.',
        })
      }

      const documentCleanup = await deleteQuoteStorageTargets(deletedQuote)

      cacheDelete(OVERVIEW_CACHE_KEY)

      return res.json({
        ok: true,
        quote: deletedQuote,
        documentCleanup,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/quotes/:quoteId/cancel-order', requireFirebaseAuth, requireOfficeManagerOrAdminRole, async (req, res, next) => {
    try {
      const quoteId = toTrimmedText(req.params.quoteId, 160)

      if (!quoteId) {
        return res.status(400).json({ error: 'quoteId is required.' })
      }

      const { crmQuotesCollection, ordersUnifiedCollection } = await getCollections()
      const quote = await crmQuotesCollection.findOne(
        { id: quoteId },
        { projection: { _id: 0 } },
      )

      if (!quote) {
        return res.status(404).json({ error: 'Quote not found.' })
      }

      const convertedOrderId = toTrimmedText(quote?.convertedOrderId, 160)
      const isAccepted = normalizeStatus(quote?.status, quoteStatuses, 'draft') === 'accepted'

      if (!convertedOrderId || !isAccepted) {
        return res.status(409).json({ error: 'Only an accepted quote with a linked order can be canceled.' })
      }

      const order = await ordersUnifiedCollection.findOne({
        $or: [
          { canonical_order_id: convertedOrderId },
          { source_quote_id: quoteId },
        ],
        is_canonical_order: true,
        is_cancelled: { $ne: true },
      })

      if (!order) {
        return res.status(404).json({ error: 'Linked order not found.' })
      }

      const now = nowIso()
      const warnings = []
      const mondayItems = [
        {
          boardId: toTrimmedText(order?.monday_primary_board_id || order?.mondayPrimaryBoardId, 120),
          itemId: toTrimmedText(order?.monday_primary_item_id || order?.mondayPrimaryItemId, 120),
        },
        {
          boardId: toTrimmedText(order?.monday_secondary_board_id || order?.mondaySecondaryBoardId, 120),
          itemId: toTrimmedText(order?.monday_secondary_item_id || order?.mondaySecondaryItemId, 120),
        },
      ].filter((item, index, items) => (
        item.itemId && items.findIndex((candidate) => candidate.itemId === item.itemId) === index
      ))

      if (typeof deleteMondayItem === 'function') {
        for (const item of mondayItems) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await deleteMondayItem({ boardId: item.boardId || null, itemId: item.itemId })
          } catch (error) {
            warnings.push(`Could not remove Monday item ${item.itemId}: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }
      }

      const generatedDocumentCleanup = await deleteGeneratedOrderStorageTargets(order)
      if (generatedDocumentCleanup.failedCount > 0) {
        warnings.push(`Could not remove ${generatedDocumentCleanup.failedCount} generated order document${generatedDocumentCleanup.failedCount === 1 ? '' : 's'} from storage.`)
      }

      const canceledByUid = toTrimmedText(req.authUser?.uid, 160) || null
      const canceledByEmail = toTrimmedText(req.authUser?.email, 200) || null

      await ordersUnifiedCollection.updateOne(
        { _id: order._id },
        {
          $set: {
            orderKey: `cancelled:${convertedOrderId}`,
            is_cancelled: true,
            cancelled_at: now,
            cancelled_by_uid: canceledByUid,
            cancelled_by_email: canceledByEmail,
            cancelled_source_quote_id: quoteId,
            canonical_status: 'cancelled',
            crmStatus: 'cancelled',
            has_monday_record: false,
            deposit_request_deleted_at: now,
            order_confirmation_deleted_at: now,
            work_order_deleted_at: now,
            proforma_invoice_deleted_at: now,
            canonical_updated_at: now,
            updatedAt: now,
          },
          $unset: {
            source_quote_id: '',
            sourceQuoteId: '',
            deposit_request_url: '',
            deposit_request_name: '',
            order_confirmation_url: '',
            order_confirmation_name: '',
            work_order_url: '',
            work_order_name: '',
            proforma_invoice_url: '',
            proforma_invoice_name: '',
          },
        },
      )

      const canceledItemKeys = [
        ...(Array.isArray(order?.selected_line_items) ? order.selected_line_items : []).map((item) => `line:${toTrimmedText(item?.id, 160)}`).filter((key) => key !== 'line:'),
        ...(Array.isArray(order?.selected_additional_services) ? order.selected_additional_services : []).map((item) => `additional:${toTrimmedText(item?.id, 160)}`).filter((key) => key !== 'additional:'),
        ...(Array.isArray(order?.selected_shipping_services) ? order.selected_shipping_services : []).map((item) => `shipping:${toTrimmedText(item?.id, 160)}`).filter((key) => key !== 'shipping:'),
        ...(order?.include_quote_freight === true ? ['freight'] : []),
      ]
      const canceledItemKeySet = new Set(canceledItemKeys)
      const remainingConvertedItemKeys = (Array.isArray(quote?.convertedItemKeys) ? quote.convertedItemKeys : [])
        .map((value) => toTrimmedText(value, 240))
        .filter((value) => value && !canceledItemKeySet.has(value))
      const remainingConvertedOrders = (Array.isArray(quote?.convertedOrders) ? quote.convertedOrders : [])
        .filter((entry) => toTrimmedText(entry?.orderId, 160) !== convertedOrderId)
      const revisionState = resolveQuoteRevisionState(quote)
      const activeRevision = revisionState.revisions.find(
        (revision) => revision.revisionNumber === revisionState.activeRevisionNumber,
      )
      const reopenedActiveRevision = activeRevision
        ? buildQuoteRevisionSnapshot(
          {
            ...activeRevision,
            status: 'sent',
            acceptedAt: null,
            rejectedAt: null,
          },
          {
            id: activeRevision.id,
            baseQuoteNumber: revisionState.baseQuoteNumber,
            revisionNumber: revisionState.activeRevisionNumber,
            createdAt: activeRevision.createdAt,
            createdByUid: activeRevision.createdByUid,
            createdByEmail: activeRevision.createdByEmail,
            updatedAt: now,
            updatedByUid: canceledByUid,
            updatedByEmail: canceledByEmail,
          },
        )
        : null
      const reopenedRevisions = reopenedActiveRevision
        ? revisionState.revisions.map((revision) => (
          revision.revisionNumber === revisionState.activeRevisionNumber
            ? reopenedActiveRevision
            : revision
        ))
        : revisionState.revisions

      const updatedQuote = await crmQuotesCollection.findOneAndUpdate(
        { id: quoteId },
        {
          $set: {
            status: 'sent',
            opportunityStage: 'proposal_submission',
            acceptedAt: null,
            rejectedAt: null,
            cancelledOrderId: convertedOrderId,
            cancelledOrderNumber: toTrimmedText(quote?.convertedOrderNumber || order?.order_number, 120) || null,
            cancelledOrderAt: now,
            cancelledOrderByUid: canceledByUid,
            cancelledOrderByEmail: canceledByEmail,
            convertedItemKeys: remainingConvertedItemKeys,
            convertedOrders: remainingConvertedOrders,
            revisions: reopenedRevisions,
            lastStatusChangedAt: now,
            updatedAt: now,
          },
          $unset: {
            convertedOrderId: '',
            convertedOrderNumber: '',
            convertedAt: '',
            orderNumber: '',
            acknowledgmentNumber: '',
          },
        },
        { returnDocument: 'after', projection: { _id: 0 } },
      )

      cacheDelete(OVERVIEW_CACHE_KEY)

      return res.json({
        ok: true,
        quote: normalizeQuoteOpportunityStageForResponse(updatedQuote),
        canceledOrderId: convertedOrderId,
        generatedDocumentCleanup,
        warnings,
      })
    } catch (error) {
      next(error)
    }
  })

  // --------------------------------------------------------------------------
  // Excel quote sync (public, no auth)
  //
  // These two endpoints back the Excel quote macro (excel-quote-macro/Arnold.bas)
  // so it can talk to the CRM directly without an API key. They are intentionally
  // unauthenticated and scoped to the single "find a quote by number and advance
  // it through the pipeline" workflow.
  // --------------------------------------------------------------------------
  function parseExcelQuoteNumberParts(quoteNumber) {
    const normalized = toTrimmedText(quoteNumber, 120)
    const match = normalized.match(/^(.+?)(?:[-_\s]*)r(\d+)$/i)

    if (!match) {
      return {
        normalized,
        baseNumber: '',
        hasRevisionSuffix: false,
      }
    }

    const baseNumber = toTrimmedText(match[1], 110)

    if (!baseNumber) {
      return {
        normalized,
        baseNumber: '',
        hasRevisionSuffix: false,
      }
    }

    return {
      normalized,
      baseNumber,
      hasRevisionSuffix: true,
      revisionNumber: toNonNegativeInteger(match[2], 0),
    }
  }

  function buildFlexibleQuoteBasePattern(baseNumber) {
    const baseParts = toTrimmedText(baseNumber, 110)
      .split(/[-_\s]+/)
      .filter(Boolean)

    if (baseParts.length === 0) {
      return ''
    }

    return baseParts
      .map((part) => escapeRegex(part))
      .join('[-_\\s]*')
  }

  function findQuoteByParsedNumberFilter(parsed) {
    const quoteNumberText = toTrimmedText(parsed?.normalized, 120)

    if (!parsed?.baseNumber || !parsed.hasRevisionSuffix) {
      return {
        $or: [
          { quoteNumber: new RegExp(`^${escapeRegex(quoteNumberText)}(?:[-_\\s]*R0)?$`, 'i') },
          { baseQuoteNumber: new RegExp(`^${escapeRegex(quoteNumberText)}$`, 'i') },
          { 'revisions.quoteNumber': new RegExp(`^${escapeRegex(quoteNumberText)}(?:[-_\\s]*R0)?$`, 'i') },
        ],
      }
    }

    const basePattern = buildFlexibleQuoteBasePattern(parsed.baseNumber)

    if (!basePattern) {
      return {
        quoteNumber: new RegExp(`^${escapeRegex(quoteNumberText)}$`, 'i'),
      }
    }

    return {
      $or: [
        { quoteNumber: new RegExp(`^${escapeRegex(quoteNumberText)}$`, 'i') },
        { 'revisions.quoteNumber': new RegExp(`^${escapeRegex(quoteNumberText)}$`, 'i') },
        { baseQuoteNumber: new RegExp(`^${basePattern}$`, 'i') },
        { quoteNumber: new RegExp(`^${basePattern}[-_\\s]*R\\d+$`, 'i') },
      ],
    }
  }

  async function findLatestExcelQuoteMatch(crmQuotesCollection, quoteNumber, projection = { _id: 0 }) {
    const parsed = parseExcelQuoteNumberParts(quoteNumber)
    const findOptions = {
      sort: {
        updatedAt: -1,
        id: -1,
      },
      projection,
    }

    return crmQuotesCollection.findOne(
      findQuoteByParsedNumberFilter(parsed),
      findOptions,
    )
  }

  // Standalone shared secret for the Excel macro — independent of the API-key
  // system. The macro sends it in the `x-excel-sync-token` header; it must match
  // the EXCEL_SYNC_TOKEN env var. Fails closed when the env var is unset.
  function requireExcelSyncToken(req, res, next) {
    const expected = String(process.env.EXCEL_SYNC_TOKEN ?? '').trim()

    if (!expected) {
      return res.status(503).json({ error: 'Excel sync is not configured.' })
    }

    const provided = String(req.headers?.['x-excel-sync-token'] ?? '').trim()

    if (!provided) {
      return res.status(401).json({ error: 'Missing sync token.' })
    }

    const expectedHash = createHash('sha256').update(expected).digest()
    const providedHash = createHash('sha256').update(provided).digest()

    if (!timingSafeEqual(expectedHash, providedHash)) {
      return res.status(401).json({ error: 'Invalid sync token.' })
    }

    return next()
  }

  async function lookupExcelQuoteByNumber(quoteNumberInput, options = {}) {
    const quoteNumber = toTrimmedText(quoteNumberInput, 120)
    const quoteAccessScope = resolveSalesRepQuoteAccessScope(toOptionalObject(options.accessScope))

    if (!quoteNumber) {
      return {
        status: 400,
        body: {
          error: 'quoteNumber is required.',
        },
      }
    }

    if (quoteAccessScope.restrictToLinkedSalesRep && !quoteAccessScope.linkedSalesRepName) {
      return {
        status: 403,
        body: {
          error: 'Sales rep access is not linked to a CRM sales rep yet.',
        },
      }
    }

    const { crmQuotesCollection } = await getCollections()
    const quote = await findLatestExcelQuoteMatch(
      crmQuotesCollection,
      quoteNumber,
      {
        _id: 0,
        id: 1,
        quoteNumber: 1,
        opportunityStage: 1,
        status: 1,
        dealerName: 1,
        title: 1,
        salesRep: 1,
        dealerState: 1,
        projectType: 1,
      },
    )

    if (!quote) {
      return {
        status: 200,
        body: {
          found: false,
        },
      }
    }

    if (!canAccessQuoteBySalesRep(quote, quoteAccessScope)) {
      return {
        status: 200,
        body: {
          found: false,
        },
      }
    }

    return {
      status: 200,
      body: {
        found: true,
        id: quote.id,
        quoteNumber: quote.quoteNumber || null,
        opportunityStage: normalizeOpportunityStage(
          quote.opportunityStage,
          'proposal_submission',
        ) || 'proposal_submission',
        status: quote.status || null,
        dealerName: quote.dealerName || null,
        title: quote.title || null,
        salesRep: quote.salesRep || null,
        dealerState: normalizeUsStateCode(quote.dealerState) || null,
        projectType: normalizeProjectType(quote.projectType),
      },
    }
  }

  app.get('/api/crm/excel/quote', requireExcelSyncToken, async (req, res, next) => {
    try {
      const lookupResult = await lookupExcelQuoteByNumber(req.query?.quoteNumber)
      return res.status(lookupResult.status).json(lookupResult.body)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/quotes/excel-lookup', requireFirebaseAuth, async (req, res, next) => {
    try {
      const accessScope = resolveCrmAccessScope(req)
      const lookupResult = await lookupExcelQuoteByNumber(req.query?.quoteNumber, {
        accessScope,
      })
      return res.status(lookupResult.status).json(lookupResult.body)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/excel/options', requireExcelSyncToken, async (_req, res, next) => {
    try {
      const { crmSalesRepsCollection } = await getCollections()

      const salesRepRows = await crmSalesRepsCollection
        .find(
          {
            isDeleted: {
              $ne: true,
            },
          },
          {
            projection: {
              _id: 0,
              name: 1,
            },
          },
        )
        .sort({ companyNameLower: 1, nameLower: 1, name: 1, id: 1 })
        .toArray()

      const dynamicSalesRepNames = uniqueSorted(
        salesRepRows
          .map((row) => toTrimmedText(row?.name, 200))
          .filter(Boolean),
      )

      const salesRepOptions = [
        'House',
        ...dynamicSalesRepNames.filter((name) => toLowerText(name, 200) !== 'house'),
      ]

      const stateOptions = usStateCodes.map((stateCode) => {
        const stateName = usStateNameByCode[stateCode] || stateCode
        return `${stateCode} - ${stateName}`
      })

      return res.json({
        stateOptions,
        salesRepOptions,
        projectTypeOptions: quoteProjectTypes,
      })
    } catch (error) {
      next(error)
    }
  })

  async function syncExcelQuotePayload(rawBody, options = {}) {
    const body = toOptionalObject(rawBody)
    const quoteNumber = toTrimmedText(body.quoteNumber, 120)
    const quoteAccessScope = resolveSalesRepQuoteAccessScope(toOptionalObject(options.accessScope))

    if (!quoteNumber) {
      return {
        status: 400,
        body: {
          error: 'quoteNumber is required.',
        },
      }
    }

    if (quoteAccessScope.restrictToLinkedSalesRep && !quoteAccessScope.linkedSalesRepName) {
      return {
        status: 403,
        body: {
          error: 'Sales rep access is not linked to a CRM sales rep yet.',
        },
      }
    }

    const { crmQuotesCollection } = await getCollections()
    const existingQuote = await findLatestExcelQuoteMatch(
      crmQuotesCollection,
      quoteNumber,
      {
        _id: 0,
      },
    )

    if (!existingQuote) {
        const now = nowIso()
        const subtotal = toNonNegativeNumberOrNull(body.subtotal)
        const freight = toNonNegativeNumberOrNull(body.freight)
        const explicitTotalAmount = toNonNegativeNumberOrNull(body.totalAmount)
        const derivedTotalAmount = explicitTotalAmount !== null
          ? explicitTotalAmount
          : Number(((subtotal || 0) + (freight || 0)).toFixed(2))
        const nextQuote = {
          id: randomUUID(),
          dealerSourceId: null,
          dealerName: null,
          dealerState: normalizeUsStateCode(body.dealerState) || null,
          companyName: toTrimmedText(body.companyName, 200) || null,
          salesRep: quoteAccessScope.restrictToLinkedSalesRep
            ? quoteAccessScope.linkedSalesRepName
            : (toTrimmedText(body.salesRep, 200) || null),
          projectType: normalizeProjectType(body.projectType),
          opportunityDate: toIsoDateOrNull(body.opportunityDate),
          opportunityStage: 'proposal_submission',
          contactSourceId: null,
          contactName: toTrimmedText(body.contactName, 240) || null,
          contactEmail: toTrimmedText(body.contactEmail, 200) || null,
          contactPhone: toTrimmedText(body.contactPhone, 80) || null,
          quoteNumber,
          poNumber: null,
          acknowledgmentNumber: null,
          orderNumber: null,
          paymentTerms: toTrimmedText(body.paymentTerms, 240) || null,
          leadTime: toTrimmedText(body.leadTime, 240) || null,
          subtotal,
          freight,
          freightDescription: toTrimmedText(body.freightDescription, 1200) || null,
          lineItems: normalizeQuoteLineItems(body.lineItems),
          title: toTrimmedText(body.title, 240) || `Opportunity ${quoteNumber}`,
          description: null,
          documentUrl: null,
          documentName: null,
          documents: [],
          origin: 'excel',
          sourceWorkbookUrl: toTrimmedText(body.sourceWorkbookUrl, 2000) || null,
          sourceWorkbookName: toTrimmedText(body.sourceWorkbookName, 500) || null,
          convertedPdfUrl: toTrimmedText(body.convertedPdfUrl, 2000) || null,
          convertedPdfName: toTrimmedText(body.convertedPdfName, 500) || null,
          revisionCount: 0,
          status: 'sent',
          totalAmount: Number(derivedTotalAmount.toFixed(2)),
          currency: 'USD',
          sentAt: now,
          acceptedAt: null,
          rejectedAt: null,
          notes: null,
          lastStatusChangedAt: now,
          createdByUid: null,
          createdByEmail: null,
          updatedAt: now,
        }

        const initialRevisionIdentity = parseQuoteRevisionIdentity(nextQuote.quoteNumber)
        nextQuote.baseQuoteNumber = initialRevisionIdentity.baseQuoteNumber
        nextQuote.activeRevisionNumber = initialRevisionIdentity.revisionNumber
        nextQuote.revisionCount = initialRevisionIdentity.revisionNumber
        nextQuote.quoteNumber = formatQuoteRevisionNumber(
          initialRevisionIdentity.baseQuoteNumber,
          initialRevisionIdentity.revisionNumber,
        ) || nextQuote.quoteNumber
        nextQuote.revisions = [
          buildQuoteRevisionSnapshot(nextQuote, {
            baseQuoteNumber: nextQuote.baseQuoteNumber,
            revisionNumber: nextQuote.activeRevisionNumber,
            createdAt: now,
            updatedAt: now,
          }),
        ]

        await crmQuotesCollection.insertOne(nextQuote)
        cacheDelete(OVERVIEW_CACHE_KEY)

        return {
          status: 200,
          body: {
            ok: true,
            found: false,
            created: true,
            fromStage: 'not_found',
            toStage: 'proposal_submission',
            quoteNumber,
            quote: normalizeQuoteOpportunityStageForResponse(nextQuote),
            message: 'A new opportunity was created directly from the uploaded file.',
          },
        }
    }

    if (!canAccessQuoteBySalesRep(existingQuote, quoteAccessScope)) {
      return {
        status: 403,
        body: {
          error: 'You can only sync opportunities assigned to your linked sales rep.',
        },
      }
    }

    const fromStage =
      normalizeOpportunityStage(
        existingQuote.opportunityStage,
        'proposal_submission',
      ) || 'proposal_submission'
    const now = nowIso()
    const updates = {}

    const setExcelFieldUpdateIfChanged = (fieldName, nextValue) => {
      const previousValue = Object.prototype.hasOwnProperty.call(existingQuote, fieldName)
        ? existingQuote[fieldName]
        : null
      const normalizedPrevious = previousValue === undefined ? null : previousValue
      const normalizedNext = nextValue === undefined ? null : nextValue

      const hasChanged = (
        Array.isArray(normalizedNext)
        || (normalizedNext && typeof normalizedNext === 'object')
      )
        ? JSON.stringify(normalizedPrevious ?? null) !== JSON.stringify(normalizedNext ?? null)
        : normalizedPrevious !== normalizedNext

      if (!hasChanged) {
        return
      }

      updates[fieldName] = normalizedNext
    }

    setExcelFieldUpdateIfChanged('origin', 'excel')

    const title = toTrimmedText(body.title, 240)
    if (title) {
      setExcelFieldUpdateIfChanged('title', title)
    }

    if (body.companyName !== undefined) {
      setExcelFieldUpdateIfChanged('companyName', toTrimmedText(body.companyName, 200) || null)
    }

    if (body.salesRep !== undefined) {
      if (quoteAccessScope.restrictToLinkedSalesRep) {
        setExcelFieldUpdateIfChanged('salesRep', quoteAccessScope.linkedSalesRepName)
      } else {
        setExcelFieldUpdateIfChanged('salesRep', toTrimmedText(body.salesRep, 200) || null)
      }
    }

    if (body.dealerState !== undefined) {
      setExcelFieldUpdateIfChanged('dealerState', normalizeUsStateCode(body.dealerState) || null)
    }

    if (body.projectType !== undefined) {
      setExcelFieldUpdateIfChanged('projectType', normalizeProjectType(body.projectType))
    }

    if (body.opportunityDate !== undefined) {
      setExcelFieldUpdateIfChanged('opportunityDate', toIsoDateOrNull(body.opportunityDate))
    }

    if (body.contactName !== undefined) {
      setExcelFieldUpdateIfChanged('contactName', toTrimmedText(body.contactName, 240) || null)
    }

    if (body.contactEmail !== undefined) {
      setExcelFieldUpdateIfChanged('contactEmail', toTrimmedText(body.contactEmail, 200) || null)
    }

    if (body.contactPhone !== undefined) {
      setExcelFieldUpdateIfChanged('contactPhone', toTrimmedText(body.contactPhone, 80) || null)
    }

    if (body.paymentTerms !== undefined) {
      setExcelFieldUpdateIfChanged('paymentTerms', toTrimmedText(body.paymentTerms, 240) || null)
    }

    if (body.leadTime !== undefined) {
      setExcelFieldUpdateIfChanged('leadTime', toTrimmedText(body.leadTime, 240) || null)
    }

    if (body.subtotal !== undefined) {
      setExcelFieldUpdateIfChanged('subtotal', toNonNegativeNumberOrNull(body.subtotal))
    }

    if (body.freight !== undefined) {
      setExcelFieldUpdateIfChanged('freight', toNonNegativeNumberOrNull(body.freight))
    }

    if (body.freightDescription !== undefined) {
      setExcelFieldUpdateIfChanged('freightDescription', toTrimmedText(body.freightDescription, 1200) || null)
    }

    if (body.totalAmount !== undefined) {
      const nextAmount = toNonNegativeNumberOrNull(body.totalAmount)
      if (nextAmount !== null) {
        setExcelFieldUpdateIfChanged('totalAmount', Number(nextAmount.toFixed(2)))
      }
    }

    if (body.lineItems !== undefined) {
      setExcelFieldUpdateIfChanged('lineItems', normalizeExcelQuoteLineItems(body.lineItems, existingQuote.lineItems))
    }

    for (const fieldName of ['sourceWorkbookUrl', 'sourceWorkbookName', 'convertedPdfUrl', 'convertedPdfName']) {
      if (body[fieldName] !== undefined) {
        setExcelFieldUpdateIfChanged(
          fieldName,
          toTrimmedText(body[fieldName], fieldName.endsWith('Url') ? 2000 : 500) || null,
        )
      }
    }

    let toStage = fromStage

    if (fromStage === 'proposal_submission') {
      toStage = 'proposal_submission'
    } else {
      return {
        status: 409,
        body: {
          found: true,
          ok: false,
          fromStage,
          message: `Quote is in stage '${fromStage}', which the Excel sync does not manage.`,
        },
      }
    }

    const syncIdentity = parseExcelQuoteNumberParts(quoteNumber)
    const revisionState = resolveQuoteRevisionState(existingQuote)
    const requestedSyncRevisionNumber = syncIdentity.hasRevisionSuffix
      ? toNonNegativeInteger(syncIdentity.revisionNumber, revisionState.activeRevisionNumber)
      : revisionState.activeRevisionNumber

    if (
      Object.keys(updates).length === 0
      && requestedSyncRevisionNumber === revisionState.activeRevisionNumber
    ) {
      return {
        status: 200,
        body: {
          ok: true,
          found: true,
          fromStage,
          toStage,
          quoteNumber: existingQuote?.quoteNumber || quoteNumber,
          quote: normalizeQuoteOpportunityStageForResponse(existingQuote),
          message: 'No Excel data changes detected; stage unchanged.',
        },
      }
    }

    updates.updatedAt = now
    const targetRevisionNumber = requestedSyncRevisionNumber
    const existingTargetRevision = revisionState.revisions.find(
      (revision) => revision.revisionNumber === targetRevisionNumber,
    )
    const sourceRevision = existingTargetRevision
      || revisionState.revisions.find(
        (revision) => revision.revisionNumber === revisionState.activeRevisionNumber,
      )
      || buildQuoteRevisionSnapshot(existingQuote, {
        baseQuoteNumber: revisionState.baseQuoteNumber,
        revisionNumber: revisionState.activeRevisionNumber,
      })
    const nextTargetRevision = buildQuoteRevisionSnapshot(
      {
        ...sourceRevision,
        ...updates,
      },
      {
        id: existingTargetRevision?.id || randomUUID(),
        baseQuoteNumber: revisionState.baseQuoteNumber,
        revisionNumber: targetRevisionNumber,
        archivedPdfUrl: existingTargetRevision?.archivedPdfUrl || null,
        archivedPdfName: existingTargetRevision?.archivedPdfName || null,
        createdAt: existingTargetRevision?.createdAt || now,
        createdByUid: existingTargetRevision?.createdByUid || null,
        createdByEmail: existingTargetRevision?.createdByEmail || null,
        updatedAt: now,
      },
    )
    const nextRevisions = revisionState.revisions.filter(
      (revision) => revision.revisionNumber !== targetRevisionNumber,
    )
    nextRevisions.push(nextTargetRevision)
    nextRevisions.sort((left, right) => left.revisionNumber - right.revisionNumber)
    updates.baseQuoteNumber = revisionState.baseQuoteNumber
    updates.revisions = nextRevisions
    updates.revisionCount = Math.max(revisionState.revisionCount, targetRevisionNumber)

    if (targetRevisionNumber >= revisionState.activeRevisionNumber) {
      updates.activeRevisionNumber = targetRevisionNumber
      updates.quoteNumber = nextTargetRevision.quoteNumber
      for (const fieldName of quoteRevisionSnapshotFields) {
        if (Object.prototype.hasOwnProperty.call(nextTargetRevision, fieldName)) {
          updates[fieldName] = cloneQuoteRevisionValue(nextTargetRevision[fieldName])
        }
      }
    } else {
      // Re-uploading an older workbook updates only that archived revision. The
      // opportunity continues to display its current revision.
      for (const fieldName of quoteRevisionSnapshotFields) {
        delete updates[fieldName]
      }
    }

    const updatedQuote = await crmQuotesCollection.findOneAndUpdate(
      { id: existingQuote.id },
      { $set: updates },
      { returnDocument: 'after', projection: { _id: 0 } },
    )

    cacheDelete(OVERVIEW_CACHE_KEY)

    return {
      status: 200,
      body: {
        ok: true,
        found: true,
        fromStage,
        toStage,
        quoteNumber: updatedQuote?.quoteNumber || quoteNumber,
        quote: normalizeQuoteOpportunityStageForResponse(updatedQuote) || null,
      },
    }
  }

  app.post('/api/crm/quotes/excel-sync', requireFirebaseAuth, async (req, res, next) => {
    try {
      const accessScope = resolveCrmAccessScope(req)
      const syncResult = await syncExcelQuotePayload(req.body, {
        accessScope,
      })
      return res.status(syncResult.status).json(syncResult.body)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/excel/quote/sync', requireExcelSyncToken, async (req, res, next) => {
    try {
      const syncResult = await syncExcelQuotePayload(req.body)
      return res.status(syncResult.status).json(syncResult.body)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/orders', requireFirebaseAuth, async (req, res, next) => {
    try {
      const status = toLowerText(req.query?.status, 60)
      const dealerSourceId = toTrimmedText(req.query?.dealerSourceId, 160)
      const limit = Math.min(500, Math.max(1, toNonNegativeInteger(req.query?.limit, 120)))
      const { ordersUnifiedCollection } = await getCollections()
      const filterClauses = [
        { is_canonical_order: true },
        { is_cancelled: { $ne: true } },
      ]

      if (status && status !== 'all') {
        filterClauses.push({ crmStatus: status })
      }

      if (dealerSourceId) {
        filterClauses.push({
          $or: [
            { dealer_source_id: dealerSourceId },
            { dealerSourceId },
          ],
        })
      }

      const orders = await ordersUnifiedCollection
        .find(
          combineFilterClauses(filterClauses),
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ canonical_created_at: -1, createdAt: -1, updatedAt: -1 })
        .limit(limit)
        .toArray()

      return res.json({
        orders: orders.map(toCrmOrderResponse).filter(Boolean),
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/orders', requireFirebaseAuth, async (req, res, next) => {
    try {
      const body = toOptionalObject(req.body)
      const title = toTrimmedText(body.title, 240)

      if (!title) {
        return res.status(400).json({
          error: 'title is required.',
        })
      }

      const status = normalizeStatus(body.status, orderStatuses, 'pending')

      if (!status) {
        return res.status(400).json({
          error: `status must be one of: ${orderStatuses.join(', ')}`,
        })
      }

      const progressPercentInput = toPercentInRangeOrNull(body.progressPercent)
      const progressPercent = progressPercentInput ?? inferProgressFromOrderStatus(status)
      const orderValue = toNonNegativeNumberOrNull(body.orderValue)

      if (orderValue === null) {
        return res.status(400).json({
          error: 'orderValue must be a non-negative number.',
        })
      }

      const {
        crmAccountsCollection,
        ordersUnifiedCollection,
      } = await getCollections()

      const dealer = await resolveDealerOrThrow(crmAccountsCollection, body.dealerSourceId)
      const now = nowIso()

      const nextOrder = {
        id: randomUUID(),
        dealerSourceId: dealer.sourceId,
        dealerName: dealer.name || dealer.sourceId,
        orderNumber: toTrimmedText(body.orderNumber, 120) || null,
        title,
        status,
        progressPercent: Number(progressPercent.toFixed(2)),
        orderValue: Number(orderValue.toFixed(2)),
        currency: toTrimmedText(body.currency, 16) || 'USD',
        dueDate: toIsoDateOrNull(body.dueDate),
        shippedAt: toIsoDateOrNull(body.shippedAt),
        deliveredAt: toIsoDateOrNull(body.deliveredAt),
        notes: toTrimmedText(body.notes, 4000) || null,
        createdByUid: toTrimmedText(req.authUser?.uid, 160) || null,
        createdByEmail: toTrimmedText(req.authUser?.email, 200) || null,
        lastStatusChangedAt: now,
        createdAt: now,
        updatedAt: now,
      }

      const normalizedOrderNumberKey = (nextOrder.orderNumber || nextOrder.id)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
      const orderKey = normalizedOrderNumberKey
        ? `order:${normalizedOrderNumberKey}`
        : `canonical:${nextOrder.id}`

      await ordersUnifiedCollection.insertOne({
        ...nextOrder,
        orderKey,
        canonical_order_id: nextOrder.id,
        is_canonical_order: true,
        has_crm_record: true,
        dealer_source_id: nextOrder.dealerSourceId,
        dealer_name: nextOrder.dealerName,
        order_number: nextOrder.orderNumber || nextOrder.id,
        order_name: nextOrder.title,
        canonical_status: nextOrder.status,
        crmStatus: nextOrder.status,
        canonical_progress_percent: nextOrder.progressPercent,
        canonical_order_value: nextOrder.orderValue,
        website_calculated_order_total: nextOrder.orderValue,
        website_calculated_order_total_at: now,
        canonical_currency: nextOrder.currency,
        canonical_notes: nextOrder.notes,
        canonical_created_at: now,
        canonical_updated_at: now,
        is_shipped: nextOrder.status === 'shipped' || nextOrder.status === 'delivered',
        status: [],
        progress_percent: nextOrder.progressPercent,
        progress_status_details: [],
        has_monday_record: false,
        has_quickbooks_record: false,
        in_design: false,
        hazard_reason: 'Website order is missing from Monday and QuickBooks.',
        source: 'website',
      })

      return res.status(201).json({
        order: nextOrder,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/crm/orders/:orderId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const orderId = toTrimmedText(req.params.orderId, 160)

      if (!orderId) {
        return res.status(400).json({
          error: 'orderId is required.',
        })
      }

      const body = toOptionalObject(req.body)
      const {
        crmAccountsCollection,
        crmOrdersCollection,
      } = await getCollections()

      const existingOrder = await crmOrdersCollection.findOne(
        {
          id: orderId,
        },
        {
          projection: {
            _id: 0,
          },
        },
      )

      if (!existingOrder) {
        return res.status(404).json({
          error: 'Order not found.',
        })
      }

      const existingOrderResponse = toCrmOrderResponse(existingOrder)
      const updates = {}
      const now = nowIso()

      if (Object.prototype.hasOwnProperty.call(body, 'title')) {
        const nextTitle = toTrimmedText(body.title, 240)

        if (!nextTitle) {
          return res.status(400).json({
            error: 'title cannot be empty.',
          })
        }

        updates.title = nextTitle
      }

      if (Object.prototype.hasOwnProperty.call(body, 'orderNumber')) {
        updates.orderNumber = toTrimmedText(body.orderNumber, 120) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'currency')) {
        updates.currency = toTrimmedText(body.currency, 16) || 'USD'
      }

      if (Object.prototype.hasOwnProperty.call(body, 'orderValue')) {
        const nextOrderValue = toNonNegativeNumberOrNull(body.orderValue)

        if (nextOrderValue === null) {
          return res.status(400).json({
            error: 'orderValue must be a non-negative number.',
          })
        }

        updates.orderValue = Number(nextOrderValue.toFixed(2))
      }

      if (Object.prototype.hasOwnProperty.call(body, 'dealerSourceId')) {
        const dealer = await resolveDealerOrThrow(crmAccountsCollection, body.dealerSourceId)
        updates.dealerSourceId = dealer.sourceId
        updates.dealerName = dealer.name || dealer.sourceId
      }

      if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        const nextStatus = normalizeStatus(body.status, orderStatuses, existingOrderResponse?.status)

        if (!nextStatus) {
          return res.status(400).json({
            error: `status must be one of: ${orderStatuses.join(', ')}`,
          })
        }

        updates.status = nextStatus

        if (nextStatus !== existingOrderResponse?.status) {
          updates.lastStatusChangedAt = now
        }

        if (nextStatus === 'shipped' && !existingOrderResponse?.shippedAt) {
          updates.shippedAt = now
        }

        if (nextStatus === 'delivered' && !existingOrderResponse?.deliveredAt) {
          updates.deliveredAt = now
        }

        if (!Object.prototype.hasOwnProperty.call(body, 'progressPercent')) {
          updates.progressPercent = inferProgressFromOrderStatus(nextStatus, existingOrderResponse?.progressPercent)
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'progressPercent')) {
        const nextProgress = toPercentInRangeOrNull(body.progressPercent)

        if (nextProgress === null) {
          return res.status(400).json({
            error: 'progressPercent must be a number between 0 and 100.',
          })
        }

        updates.progressPercent = nextProgress
      }

      if (Object.prototype.hasOwnProperty.call(body, 'dueDate')) {
        updates.dueDate = toIsoDateOrNull(body.dueDate)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'shippedAt')) {
        updates.shippedAt = toIsoDateOrNull(body.shippedAt)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'deliveredAt')) {
        updates.deliveredAt = toIsoDateOrNull(body.deliveredAt)
      }

      if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
        updates.notes = toTrimmedText(body.notes, 4000) || null
      }

      if (Object.keys(updates).length === 0) {
        return res.json({
          order: existingOrderResponse,
        })
      }

      updates.updatedAt = now
      updates.canonical_updated_at = now

      if (Object.prototype.hasOwnProperty.call(updates, 'title')) {
        updates.order_name = updates.title
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'orderNumber')) {
        updates.order_number = updates.orderNumber
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'dealerSourceId')) {
        updates.dealer_source_id = updates.dealerSourceId
        updates.dealer_name = updates.dealerName
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        updates.crmStatus = updates.status
        updates.canonical_status = updates.status
        updates.is_shipped = updates.status === 'shipped' || updates.status === 'delivered'
        delete updates.status
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'progressPercent')) {
        updates.canonical_progress_percent = updates.progressPercent
        updates.progress_percent = updates.progressPercent
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'orderValue')) {
        updates.canonical_order_value = updates.orderValue
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'currency')) {
        updates.canonical_currency = updates.currency
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'notes')) {
        updates.canonical_notes = updates.notes
      }

      const updatedOrder = await crmOrdersCollection.findOneAndUpdate(
        {
          id: orderId,
        },
        {
          $set: updates,
        },
        {
          returnDocument: 'after',
          projection: {
            _id: 0,
          },
        },
      )

      return res.json({
        order: toCrmOrderResponse(updatedOrder),
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/imports/commit', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const confirmText = toTrimmedText(req.body?.confirmText, 120)

      if (confirmText !== importConfirmText) {
        return res.status(400).json({
          error: `confirmText must be exactly ${importConfirmText}.`,
        })
      }

      const analysis = buildImportAnalysis(req.body?.payload)
      const responsePreview = toImportResponse(analysis)
      const providedFingerprint = toTrimmedText(req.body?.previewFingerprint, 120)

      if (!providedFingerprint) {
        return res.status(400).json({
          error: 'previewFingerprint is required. Run preview and commit using the returned fingerprint.',
        })
      }

      if (providedFingerprint !== responsePreview.importFingerprint) {
        return res.status(400).json({
          error: 'previewFingerprint does not match payload fingerprint. Run preview again before commit.',
        })
      }

      const validationSummary = analysis.summary.validation

      if (
        validationSummary.skippedAccountsMissingSourceId > 0
        || validationSummary.skippedAccountsMissingName > 0
        || validationSummary.skippedContactsMissingSourceId > 0
      ) {
        return res.status(400).json({
          error: 'Import blocked because records are missing required fields. Resolve data quality issues first.',
          validation: validationSummary,
        })
      }

      if (
        responsePreview.conflictGroupCounts.accountSourceIdDuplicates > 0
        || responsePreview.conflictGroupCounts.contactSourceIdDuplicates > 0
      ) {
        return res.status(400).json({
          error: 'Import blocked because duplicate source IDs were detected. Resolve source ID collisions first.',
          conflictGroupCounts: {
            accountSourceIdDuplicates: responsePreview.conflictGroupCounts.accountSourceIdDuplicates,
            contactSourceIdDuplicates: responsePreview.conflictGroupCounts.contactSourceIdDuplicates,
          },
        })
      }

      const {
        crmAccountsCollection,
        crmContactsCollection,
        crmDuplicateQueueCollection,
        crmImportRunsCollection,
        mongoClientsByDomain,
      } = await getCollections()

      const importedAt = nowIso()
      const importRunId = randomUUID()
      const importedByUid = toTrimmedText(req.authUser?.uid, 160)
      const importedByEmail = toTrimmedText(req.authUser?.email, 200)

      const accountWrites = analysis.accounts.map((account) => {
        const sourceId = account.sourceId
        const emailLower = toLowerText(account.email, 200)
        const ownerEmailLower = toLowerText(account.ownerEmail, 200)
        const socialMediaLinks = Object.keys(toOptionalObject(account.socialMediaLinks)).length > 0
          ? account.socialMediaLinks
          : null
        const normalizedEmails = normalizeEmailList(account.emails)

        return {
          updateOne: {
            filter: {
              sourceId,
            },
            update: {
              $set: {
                id: sourceId,
                sourceId,
                name: account.name,
                nameLower: toLowerText(account.name, 240),
                phone: account.phone || null,
                phone2: account.phone2 || null,
                email: account.email || null,
                emailLower: emailLower || null,
                email2: account.email2 || null,
                emails: normalizedEmails,
                address: account.address || null,
                city: account.city || null,
                state: account.state || null,
                zip: account.zip || null,
                country: account.country || null,
                industry: account.industry || null,
                accountClass: account.accountClass || null,
                accountType: account.accountType || null,
                salesRep: account.salesRep || null,
                website: account.website || null,
                accountText: account.accountText || null,
                createdDateSource: account.createdDate,
                modifiedDateSource: account.modifiedDate,
                owner: account.owner || null,
                ownerEmail: account.ownerEmail || null,
                ownerEmailLower: ownerEmailLower || null,
                pictureUrlSource: account.pictureUrlSource || null,
                socialMedia: account.socialMedia || null,
                socialMediaLinks,
                recordStatus: account.recordStatus || crmRecordStatusActive,
                isArchived: account.isArchived,
                isFavorite: account.isFavorite,
                contactCountSource: account.contacts.length,
                lastImportRunId: importRunId,
                lastImportedAt: importedAt,
                updatedAt: importedAt,
              },
              $setOnInsert: {
                createdAt: importedAt,
              },
            },
            upsert: true,
          },
        }
      })

      const contactWrites = analysis.contacts.map((contact) => {
        const sourceId = contact.sourceId
        const primaryEmailLower = toLowerText(contact.primaryEmail, 200)
        const secondaryEmailLower = toLowerText(contact.secondaryEmail, 200)

        return {
          updateOne: {
            filter: {
              sourceId,
            },
            update: {
              $set: {
                id: sourceId,
                sourceId,
                name: contact.name || null,
                nameLower: toLowerText(contact.name, 240) || null,
                createdDateSource: contact.createdDate,
                city: contact.city || null,
                state: contact.state || null,
                country: contact.country || null,
                address: contact.address || null,
                zip: contact.zip || null,
                primaryEmail: contact.primaryEmail || null,
                primaryEmailLower: primaryEmailLower || null,
                secondaryEmail: contact.secondaryEmail || null,
                secondaryEmailLower: secondaryEmailLower || null,
                email3: contact.email3 || null,
                email4: contact.email4 || null,
                salesUnit: contact.salesUnit || null,
                accountSourceId: contact.accountSourceId || null,
                accountName: contact.accountName || null,
                phone: contact.phone || null,
                phone2: contact.phone2 || null,
                phoneAlt: contact.phoneAlt || null,
                firstName: contact.firstName || null,
                lastName: contact.lastName || null,
                gender: contact.gender || null,
                contactTypeId: contact.contactTypeId || null,
                photoUrl: contact.photoUrl || null,
                recordStatus: contact.recordStatus || crmRecordStatusActive,
                isArchived: contact.isArchived,
                contactOrigin: contact.contactOrigin,
                lastImportRunId: importRunId,
                lastImportedAt: importedAt,
                updatedAt: importedAt,
              },
              $setOnInsert: {
                createdAt: importedAt,
              },
            },
            upsert: true,
          },
        }
      })

      const conflictQueueEntries = buildConflictQueueEntries({
        conflicts: analysis.conflicts,
        importRunId,
        createdAt: importedAt,
        randomUUID,
      })

      // All writes are wrapped in a single transaction so a partial failure
      // (e.g. network drop after accounts are written but before contacts) can
      // never leave the database in an inconsistent half-imported state.
      let importRunDocument
      const session = mongoClientsByDomain.crm.startSession()

      try {
        await session.withTransaction(async () => {
          const [accountWriteResult, contactWriteResult] = await Promise.all([
            accountWrites.length > 0
              ? crmAccountsCollection.bulkWrite(accountWrites, { ordered: false, session })
              : null,
            contactWrites.length > 0
              ? crmContactsCollection.bulkWrite(contactWrites, { ordered: false, session })
              : null,
          ])

          await crmDuplicateQueueCollection.updateMany(
            {
              status: 'open',
            },
            {
              $set: {
                status: 'superseded',
                supersededByImportRunId: importRunId,
                updatedAt: importedAt,
              },
            },
            { session },
          )

          if (conflictQueueEntries.length > 0) {
            await crmDuplicateQueueCollection.insertMany(conflictQueueEntries, { session })
          }

          importRunDocument = {
            id: importRunId,
            status: 'completed',
            importedAt,
            importedByUid: importedByUid || null,
            importedByEmail: importedByEmail || null,
            importFingerprint: responsePreview.importFingerprint,
            metadata: analysis.metadata,
            summary: analysis.summary,
            conflictGroupCounts: responsePreview.conflictGroupCounts,
            writeSummary: {
              accountMatchedCount: Number(accountWriteResult?.matchedCount ?? 0),
              accountModifiedCount: Number(accountWriteResult?.modifiedCount ?? 0),
              accountUpsertedCount: Number(accountWriteResult?.upsertedCount ?? 0),
              contactMatchedCount: Number(contactWriteResult?.matchedCount ?? 0),
              contactModifiedCount: Number(contactWriteResult?.modifiedCount ?? 0),
              contactUpsertedCount: Number(contactWriteResult?.upsertedCount ?? 0),
              duplicateQueueInsertedCount: conflictQueueEntries.length,
            },
            createdAt: importedAt,
            updatedAt: importedAt,
          }

          await crmImportRunsCollection.insertOne(importRunDocument, { session })
        })
      } finally {
        await session.endSession()
      }

      // Dealers and overview data have changed — bust both caches so the next
      // request reflects the newly imported data instead of stale values.
      cacheDeleteByPrefix(DEALERS_CACHE_PREFIX)
      cacheDelete(OVERVIEW_CACHE_KEY)

      return res.json({
        ok: true,
        importRun: {
          id: importRunId,
          importedAt,
          importedByEmail: importedByEmail || null,
          summary: analysis.summary,
          conflictGroupCounts: responsePreview.conflictGroupCounts,
          writeSummary: importRunDocument.writeSummary,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/imports', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const limit = Math.min(80, Math.max(1, toNonNegativeInteger(req.query?.limit, 20)))
      const { crmImportRunsCollection } = await getCollections()

      const imports = await crmImportRunsCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              id: 1,
              status: 1,
              importedAt: 1,
              importedByEmail: 1,
              metadata: 1,
              summary: 1,
              conflictGroupCounts: 1,
              writeSummary: 1,
            },
          },
        )
        .sort({ importedAt: -1 })
        .limit(limit)
        .toArray()

      return res.json({
        imports,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/conflicts', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const status = toLowerText(req.query?.status, 40) || 'open'
      const limit = Math.min(500, Math.max(1, toNonNegativeInteger(req.query?.limit, 120)))
      const { crmDuplicateQueueCollection } = await getCollections()

      const conflicts = await crmDuplicateQueueCollection
        .find(
          {
            status,
          },
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ createdAt: -1, sourceCount: -1 })
        .limit(limit)
        .toArray()

      return res.json({
        conflicts,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/overview', requireFirebaseAuth, requireAdminRole, async (_req, res, next) => {
    try {
      const cached = cacheGet(OVERVIEW_CACHE_KEY)

      if (cached) {
        return res.json(cached)
      }

      const {
        crmAccountsCollection,
        crmContactsCollection,
        crmDuplicateQueueCollection,
        crmImportRunsCollection,
        crmQuotesCollection,
        crmOrdersCollection,
      } = await getCollections()

      const overview = await computeCrmOverview({
        crmAccountsCollection,
        crmContactsCollection,
        crmDuplicateQueueCollection,
        crmImportRunsCollection,
        crmQuotesCollection,
        crmOrdersCollection,
      })

      cacheSet(OVERVIEW_CACHE_KEY, overview, OVERVIEW_CACHE_TTL_MS)

      return res.json(overview)
    } catch (error) {
      next(error)
    }
  })

}

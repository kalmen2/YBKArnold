import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Simple in-memory cache
// ---------------------------------------------------------------------------
// Stores expensive read results so repeated requests within the TTL window
// hit memory instead of MongoDB. Each entry is keyed by a string and expires
// after `ttlMs` milliseconds. Entries are lazily evicted on next access.
//
// This is intentionally simple — no LRU, no max-size, because the number of
// distinct cache keys is small and bounded.

const _cacheStore = new Map()

function cacheGet(key) {
  const entry = _cacheStore.get(key)

  if (!entry) {
    return undefined
  }

  if (Date.now() > entry.expiresAt) {
    _cacheStore.delete(key)
    return undefined
  }

  return entry.value
}

function cacheSet(key, value, ttlMs) {
  _cacheStore.set(key, { value, expiresAt: Date.now() + ttlMs })
}

function cacheDelete(key) {
  _cacheStore.delete(key)
}

function cacheDeleteByPrefix(prefix) {
  for (const key of _cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      _cacheStore.delete(key)
    }
  }
}

const DEALERS_CACHE_PREFIX = 'crm:dealers:'
const OVERVIEW_CACHE_KEY = 'crm:overview'
const DEALERS_CACHE_TTL_MS = 10 * 60 * 1000  // 10 minutes
const OVERVIEW_CACHE_TTL_MS = 3 * 60 * 1000  // 3 minutes

const importConfirmText = 'I_UNDERSTAND_IMPORT_OVERWRITES'
const maxConflictGroupsInResponse = 200
const maxIdsPerConflictGroup = 25
const quoteStatuses = ['draft', 'sent', 'accepted', 'rejected', 'cancelled']
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

function toTrimmedText(value, maxLength = 4000) {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value).trim().slice(0, maxLength)
}

function toLowerText(value, maxLength = 4000) {
  return toTrimmedText(value, maxLength).toLowerCase()
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

function normalizeAccount(rawAccount) {
  const account = toOptionalObject(rawAccount)
  const socialMediaLinks = normalizeSocialMediaLinks(account.social_media)
  const socialMediaText = typeof account.social_media === 'string'
    ? toTrimmedText(account.social_media, 2000)
    : toCompactSocialMediaText(socialMediaLinks)

  return {
    sourceId: toTrimmedText(account.id, 160),
    name: toTrimmedText(account.name, 240),
    pictureUrlSource: toTrimmedText(account.picture_url, 500),
    phone: toTrimmedText(account.phone, 80),
    phone2: toTrimmedText(account.phone2, 80),
    email: toTrimmedText(account.email, 200),
    email2: toTrimmedText(account.email2, 200),
    address: toTrimmedText(account.address, 400),
    city: toTrimmedText(account.city, 160),
    state: toTrimmedText(account.state, 80),
    zip: toTrimmedText(account.zip, 40),
    country: toTrimmedText(account.country, 120),
    industry: toTrimmedText(account.industry, 160),
    accountClass: toTrimmedText(account.account_class, 160),
    accountType: toTrimmedText(account.account_type, 160),
    website: toTrimmedText(account.website, 240),
    accountText: toTrimmedText(account.account_text, 4000),
    createdDate: toIsoDateOrNull(account.created),
    modifiedDate: toIsoDateOrNull(account.modified),
    owner: toTrimmedText(account.owner, 200),
    ownerEmail: toTrimmedText(account.owner_email, 200),
    socialMedia: socialMediaText,
    socialMediaLinks,
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
    crmOrdersCollection.countDocuments({}),
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
    generatedAt: new Date().toISOString(),
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

export function registerCrmRoutes(app, deps) {
  const {
    getCollections,
    randomUUID,
    requireAdminRole,
    requireFirebaseAuth,
  } = deps

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
      },
      {
        projection: {
          _id: 0,
          sourceId: 1,
          name: 1,
          isArchived: 1,
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
      isArchived: toBoolean(dealer.isArchived),
    }
  }

  app.post('/api/crm/imports/preview', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const analysis = buildImportAnalysis(req.body?.payload)

      return res.json(toImportResponse(analysis))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/dealers', requireFirebaseAuth, async (req, res, next) => {
    try {
      const searchRegex = buildContainsRegex(req.query?.search, 200)
      const includeArchived = toBoolean(req.query?.includeArchived)
      const ownerEmail = toLowerText(req.query?.ownerEmail, 200)
      const hasEmail = toNullableBoolean(req.query?.hasEmail)
      const offset = toNonNegativeInteger(req.query?.offset, 0)
      const limit = Math.min(2500, Math.max(1, toNonNegativeInteger(req.query?.limit, 1200)))

      // Build a stable cache key from the normalized query params. Requests
      // without filters (the bulk "load all dealers for dropdown" calls) will
      // almost always hit the same key, so they only touch MongoDB once per TTL.
      const cacheKey = `${DEALERS_CACHE_PREFIX}${JSON.stringify({
        search: req.query?.search ?? '',
        includeArchived,
        ownerEmail,
        hasEmail,
        offset,
        limit,
      })}`

      const cached = cacheGet(cacheKey)

      if (cached) {
        return res.json(cached)
      }

      const { crmAccountsCollection } = await getCollections()
      const filterClauses = []

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
                phone: 1,
                email: 1,
                ownerEmail: 1,
                city: 1,
                state: 1,
                country: 1,
                industry: 1,
                accountType: 1,
                accountClass: 1,
                website: 1,
                pictureUrl: 1,
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

      const payload = {
        dealers,
        total,
        offset,
        limit,
        hasMore: offset + dealers.length < total,
      }

      cacheSet(cacheKey, payload, DEALERS_CACHE_TTL_MS)

      return res.json(payload)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/dealers/:dealerSourceId', requireFirebaseAuth, async (req, res, next) => {
    try {
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
            website: 1,
            accountText: 1,
            owner: 1,
            ownerEmail: 1,
            pictureUrl: 1,
            pictureUrlSource: 1,
            socialMedia: 1,
            socialMediaLinks: 1,
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
              primaryEmail: contactSearchRegex,
            },
            {
              secondaryEmail: contactSearchRegex,
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
                city: 1,
                state: 1,
                country: 1,
                isArchived: 1,
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

  app.get('/api/crm/contacts', requireFirebaseAuth, async (req, res, next) => {
    try {
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

      const { crmContactsCollection } = await getCollections()
      const filterClauses = []

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

  app.get('/api/crm/quotes', requireFirebaseAuth, async (req, res, next) => {
    try {
      const status = toLowerText(req.query?.status, 60)
      const dealerSourceId = toTrimmedText(req.query?.dealerSourceId, 160)
      const limit = Math.min(500, Math.max(1, toNonNegativeInteger(req.query?.limit, 120)))
      const { crmQuotesCollection } = await getCollections()
      const filter = {}

      if (status && status !== 'all') {
        filter.status = status
      }

      if (dealerSourceId) {
        filter.dealerSourceId = dealerSourceId
      }

      const quotes = await crmQuotesCollection
        .find(
          filter,
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ createdAt: -1, updatedAt: -1 })
        .limit(limit)
        .toArray()

      return res.json({
        quotes,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/quotes', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const body = toOptionalObject(req.body)
      const title = toTrimmedText(body.title, 240)

      if (!title) {
        return res.status(400).json({
          error: 'title is required.',
        })
      }

      const status = normalizeStatus(body.status, quoteStatuses, 'draft')

      if (!status) {
        return res.status(400).json({
          error: `status must be one of: ${quoteStatuses.join(', ')}`,
        })
      }

      const totalAmount = toNonNegativeNumberOrNull(body.totalAmount)

      if (totalAmount === null) {
        return res.status(400).json({
          error: 'totalAmount must be a non-negative number.',
        })
      }

      const {
        crmAccountsCollection,
        crmQuotesCollection,
      } = await getCollections()

      const dealer = await resolveDealerOrThrow(crmAccountsCollection, body.dealerSourceId)
      const now = new Date().toISOString()

      const nextQuote = {
        id: randomUUID(),
        dealerSourceId: dealer.sourceId,
        dealerName: dealer.name || dealer.sourceId,
        quoteNumber: toTrimmedText(body.quoteNumber, 120) || null,
        title,
        description: toTrimmedText(body.description, 2000) || null,
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
        createdAt: now,
        updatedAt: now,
      }

      await crmQuotesCollection.insertOne(nextQuote)

      return res.status(201).json({
        quote: nextQuote,
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/crm/quotes/:quoteId', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
    try {
      const quoteId = toTrimmedText(req.params.quoteId, 160)

      if (!quoteId) {
        return res.status(400).json({
          error: 'quoteId is required.',
        })
      }

      const body = toOptionalObject(req.body)
      const {
        crmAccountsCollection,
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

      const updates = {}
      const now = new Date().toISOString()

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

      if (Object.prototype.hasOwnProperty.call(body, 'quoteNumber')) {
        updates.quoteNumber = toTrimmedText(body.quoteNumber, 120) || null
      }

      if (Object.prototype.hasOwnProperty.call(body, 'currency')) {
        updates.currency = toTrimmedText(body.currency, 16) || 'USD'
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
          quote: existingQuote,
        })
      }

      updates.updatedAt = now

      const updatedQuote = await crmQuotesCollection.findOneAndUpdate(
        {
          id: quoteId,
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
        quote: updatedQuote,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/crm/orders', requireFirebaseAuth, async (req, res, next) => {
    try {
      const status = toLowerText(req.query?.status, 60)
      const dealerSourceId = toTrimmedText(req.query?.dealerSourceId, 160)
      const limit = Math.min(500, Math.max(1, toNonNegativeInteger(req.query?.limit, 120)))
      const { crmOrdersCollection } = await getCollections()
      const filter = {}

      if (status && status !== 'all') {
        filter.status = status
      }

      if (dealerSourceId) {
        filter.dealerSourceId = dealerSourceId
      }

      const orders = await crmOrdersCollection
        .find(
          filter,
          {
            projection: {
              _id: 0,
            },
          },
        )
        .sort({ createdAt: -1, updatedAt: -1 })
        .limit(limit)
        .toArray()

      return res.json({
        orders,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/crm/orders', requireFirebaseAuth, requireAdminRole, async (req, res, next) => {
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
        crmOrdersCollection,
      } = await getCollections()

      const dealer = await resolveDealerOrThrow(crmAccountsCollection, body.dealerSourceId)
      const now = new Date().toISOString()

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

      await crmOrdersCollection.insertOne(nextOrder)

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

      const updates = {}
      const now = new Date().toISOString()

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
        const nextStatus = normalizeStatus(body.status, orderStatuses, existingOrder.status)

        if (!nextStatus) {
          return res.status(400).json({
            error: `status must be one of: ${orderStatuses.join(', ')}`,
          })
        }

        updates.status = nextStatus

        if (nextStatus !== existingOrder.status) {
          updates.lastStatusChangedAt = now
        }

        if (nextStatus === 'shipped' && !existingOrder.shippedAt) {
          updates.shippedAt = now
        }

        if (nextStatus === 'delivered' && !existingOrder.deliveredAt) {
          updates.deliveredAt = now
        }

        if (!Object.prototype.hasOwnProperty.call(body, 'progressPercent')) {
          updates.progressPercent = inferProgressFromOrderStatus(nextStatus, existingOrder.progressPercent)
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
          order: existingOrder,
        })
      }

      updates.updatedAt = now

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
        order: updatedOrder,
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
      } = await getCollections()

      const importedAt = new Date().toISOString()
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
                address: account.address || null,
                city: account.city || null,
                state: account.state || null,
                zip: account.zip || null,
                country: account.country || null,
                industry: account.industry || null,
                accountClass: account.accountClass || null,
                accountType: account.accountType || null,
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

      const [accountWriteResult, contactWriteResult] = await Promise.all([
        accountWrites.length > 0
          ? crmAccountsCollection.bulkWrite(accountWrites, { ordered: false })
          : null,
        contactWrites.length > 0
          ? crmContactsCollection.bulkWrite(contactWrites, { ordered: false })
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
      )

      if (conflictQueueEntries.length > 0) {
        await crmDuplicateQueueCollection.insertMany(conflictQueueEntries)
      }

      const importRunDocument = {
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

      await crmImportRunsCollection.insertOne(importRunDocument)

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

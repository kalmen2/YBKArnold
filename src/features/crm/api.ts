export type CrmImportMetadataSummary = {
  exportedAt: string | null
  source: string
  totalAccounts: number
  totalContacts: number
  linkedContacts: number
  unlinkedContacts: number
}

export type CrmImportValidationSummary = {
  skippedAccountsMissingSourceId: number
  skippedAccountsMissingName: number
  skippedContactsMissingSourceId: number
  skippedLinkedContactsInvalidParent: number
}

export type CrmImportCountSummary = {
  accounts: number
  linkedContacts: number
  unlinkedContacts: number
  contacts: number
  archivedAccounts: number
  archivedContacts: number
  accountsWithEmail: number
  contactsWithPrimaryEmail: number
  uniqueOwnerEmails: number
  ownerEmails: string[]
}

export type CrmImportPreviewSummary = {
  metadata: CrmImportMetadataSummary
  counts: CrmImportCountSummary
  validation: CrmImportValidationSummary
}

export type CrmConflictGroup = {
  key: string
  count: number
  sourceIds: string[]
  hasMoreSourceIds: boolean
}

export type CrmImportConflictGroupCounts = {
  accountSourceIdDuplicates: number
  accountNameDuplicates: number
  accountEmailDuplicates: number
  contactSourceIdDuplicates: number
  contactEmailDuplicates: number
  unlinkedEmailOverlaps: number
  totalConflictGroups: number
}

export type CrmImportPreviewResponse = {
  importFingerprint: string
  confirmTextRequired: string
  summary: CrmImportPreviewSummary
  conflicts: {
    accountSourceIdDuplicates: CrmConflictGroup[]
    accountNameDuplicates: CrmConflictGroup[]
    accountEmailDuplicates: CrmConflictGroup[]
    contactSourceIdDuplicates: CrmConflictGroup[]
    contactEmailDuplicates: CrmConflictGroup[]
    unlinkedEmailOverlaps: CrmConflictGroup[]
  }
  conflictGroupCounts: CrmImportConflictGroupCounts
}

export type CrmImportRunRecord = {
  id: string
  status: string
  importedAt: string
  importedByEmail: string | null
  metadata: CrmImportMetadataSummary
  summary: CrmImportPreviewSummary
  conflictGroupCounts: CrmImportConflictGroupCounts
  writeSummary: {
    accountMatchedCount: number
    accountModifiedCount: number
    accountUpsertedCount: number
    contactMatchedCount: number
    contactModifiedCount: number
    contactUpsertedCount: number
    duplicateQueueInsertedCount: number
  }
}

export type CrmCommitResponse = {
  ok: boolean
  importRun: Omit<CrmImportRunRecord, 'metadata'>
}

export type CrmImportsResponse = {
  imports: CrmImportRunRecord[]
}

export type CrmConflictRecord = {
  id: string
  importRunId: string
  entityType: string
  conflictType: string
  conflictKey: string
  sourceIds: string[]
  sourceCount: number
  status: string
  createdAt: string
  updatedAt: string
}

export type CrmConflictsResponse = {
  conflicts: CrmConflictRecord[]
}

export type CrmOverviewResponse = {
  generatedAt: string
  dealers: {
    totalAccounts: number
    totalContacts: number
    openConflictCount: number
    latestImport: {
      id: string
      importedAt: string
      importedByEmail: string | null
      summary: CrmImportPreviewSummary
      conflictGroupCounts: CrmImportConflictGroupCounts
      status: string
    } | null
  }
  quotes: {
    totalQuotes: number
    acceptedQuotes: number
    rejectedQuotes: number
    acceptanceRate: number
    quotedValue: number
    acceptedValue: number
    topDealersByAcceptedValue: Array<{
      dealerSourceId: string
      dealerName: string
      acceptedValue: number
    }>
  }
  orders: {
    totalOrders: number
  }
}

export type CrmDealer = {
  sourceId: string
  name: string
  pictureUrl?: string | null
  phone?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  industry?: string | null
  accountType?: string | null
  accountClass?: string | null
  website?: string | null
  contactCountSource?: number
  email: string | null
  ownerEmail: string | null
  isArchived: boolean
  lastImportedAt: string | null
}

export type CrmDealerDetail = CrmDealer & {
  phone2: string | null
  email2: string | null
  address: string | null
  zip: string | null
  accountText: string | null
  owner: string | null
  pictureUrl: string | null
  pictureUrlSource: string | null
  socialMedia: string | null
  socialMediaLinks: Record<string, string> | null
  isFavorite: boolean
  createdDateSource: string | null
  modifiedDateSource: string | null
}

export type CrmDealersResponse = {
  dealers: CrmDealer[]
  total?: number
  offset?: number
  limit?: number
  hasMore?: boolean
}

export type CrmDealersQueryOptions = {
  limit?: number
  offset?: number
  includeArchived?: boolean
  search?: string
  ownerEmail?: string
  hasEmail?: boolean | null
}

export type CrmContact = {
  sourceId: string
  name: string | null
  firstName: string | null
  lastName: string | null
  primaryEmail: string | null
  secondaryEmail: string | null
  email3: string | null
  email4: string | null
  salesUnit: string | null
  accountSourceId: string | null
  accountName: string | null
  phone: string | null
  phone2: string | null
  phoneAlt: string | null
  city: string | null
  state: string | null
  country: string | null
  photoUrl: string | null
  isArchived: boolean
  contactOrigin: string
  createdDateSource: string | null
  lastImportedAt: string | null
}

export type CrmDealerDetailResponse = {
  dealer: CrmDealerDetail
  contacts: CrmContact[]
  contactsTotal: number
  contactOffset: number
  contactLimit: number
  hasMoreContacts: boolean
}

export type CrmContactsResponse = {
  contacts: CrmContact[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

export type CrmContactsQueryOptions = {
  limit?: number
  offset?: number
  includeArchived?: boolean
  search?: string
  dealerSourceId?: string
  salesUnit?: string
  state?: string
  country?: string
  contactOrigin?: string
  hasEmail?: boolean | null
}

export type CrmDealerContactsQueryOptions = {
  includeArchivedContacts?: boolean
  contactSearch?: string
  contactOffset?: number
  contactLimit?: number
}

export type CrmQuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'cancelled'

export type CrmQuote = {
  id: string
  dealerSourceId: string
  dealerName: string
  quoteNumber: string | null
  title: string
  description: string | null
  status: CrmQuoteStatus
  totalAmount: number
  currency: string
  sentAt: string | null
  acceptedAt: string | null
  rejectedAt: string | null
  notes: string | null
  lastStatusChangedAt: string
  createdByUid: string | null
  createdByEmail: string | null
  createdAt: string
  updatedAt: string
}

export type CrmQuotesResponse = {
  quotes: CrmQuote[]
}

export type CrmQuoteUpsertInput = {
  dealerSourceId: string
  title: string
  quoteNumber?: string | null
  description?: string | null
  status?: CrmQuoteStatus
  totalAmount: number
  currency?: string | null
  sentAt?: string | null
  acceptedAt?: string | null
  rejectedAt?: string | null
  notes?: string | null
}

export type CrmOrderStatus =
  | 'draft'
  | 'pending'
  | 'in_progress'
  | 'on_hold'
  | 'ready_to_ship'
  | 'shipped'
  | 'delivered'
  | 'cancelled'

export type CrmOrder = {
  id: string
  dealerSourceId: string
  dealerName: string
  orderNumber: string | null
  title: string
  status: CrmOrderStatus
  progressPercent: number
  orderValue: number
  currency: string
  dueDate: string | null
  shippedAt: string | null
  deliveredAt: string | null
  notes: string | null
  createdByUid: string | null
  createdByEmail: string | null
  lastStatusChangedAt: string
  createdAt: string
  updatedAt: string
}

export type CrmOrdersResponse = {
  orders: CrmOrder[]
}

export type CrmOrderUpsertInput = {
  dealerSourceId: string
  title: string
  orderNumber?: string | null
  status?: CrmOrderStatus
  progressPercent?: number | null
  orderValue: number
  currency?: string | null
  dueDate?: string | null
  shippedAt?: string | null
  deliveredAt?: string | null
  notes?: string | null
}

function withQuery(path: string, query: Record<string, string | number | null | undefined>) {
  const url = new URL(path, window.location.origin)

  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      return
    }

    url.searchParams.set(key, String(value))
  })

  return `${url.pathname}${url.search}`
}

async function requestWithAuth<T>(
  path: string,
  idToken: string,
  options: RequestInit = {},
) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      'x-client-platform': 'web',
      ...(options.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'Request failed.')
  }

  return payload as T
}

export function previewCrmImport(
  idToken: string,
  payload: unknown,
) {
  return requestWithAuth<CrmImportPreviewResponse>('/api/crm/imports/preview', idToken, {
    method: 'POST',
    body: JSON.stringify({ payload }),
  })
}

export function commitCrmImport(
  idToken: string,
  payload: unknown,
  confirmText: string,
  previewFingerprint: string,
) {
  return requestWithAuth<CrmCommitResponse>('/api/crm/imports/commit', idToken, {
    method: 'POST',
    body: JSON.stringify({
      payload,
      confirmText,
      previewFingerprint,
    }),
  })
}

export function fetchCrmOverview(idToken: string) {
  return requestWithAuth<CrmOverviewResponse>('/api/crm/overview', idToken)
}

export function fetchCrmImports(idToken: string, limit = 20) {
  return requestWithAuth<CrmImportsResponse>(
    withQuery('/api/crm/imports', {
      limit,
    }),
    idToken,
  )
}

export function fetchCrmConflicts(idToken: string, status = 'open', limit = 150) {
  return requestWithAuth<CrmConflictsResponse>(
    withQuery('/api/crm/conflicts', {
      status,
      limit,
    }),
    idToken,
  )
}

export function fetchCrmDealers(
  idToken: string,
  limitOrOptions: number | CrmDealersQueryOptions = 2000,
  includeArchived = false,
) {
  const options = typeof limitOrOptions === 'number'
    ? {
        limit: limitOrOptions,
        includeArchived,
      }
    : limitOrOptions

  return requestWithAuth<CrmDealersResponse>(
    withQuery('/api/crm/dealers', {
      limit: options.limit ?? 2000,
      offset: options.offset ?? undefined,
      includeArchived: options.includeArchived ? 'true' : undefined,
      search: options.search ?? undefined,
      ownerEmail: options.ownerEmail ?? undefined,
      hasEmail: options.hasEmail === null || options.hasEmail === undefined
        ? undefined
        : (options.hasEmail ? 'true' : 'false'),
    }),
    idToken,
  )
}

export function fetchCrmDealerDetail(
  idToken: string,
  dealerSourceId: string,
  options: CrmDealerContactsQueryOptions = {},
) {
  return requestWithAuth<CrmDealerDetailResponse>(
    withQuery(`/api/crm/dealers/${encodeURIComponent(dealerSourceId)}`, {
      includeArchivedContacts: options.includeArchivedContacts ? 'true' : undefined,
      contactSearch: options.contactSearch ?? undefined,
      contactOffset: options.contactOffset ?? 0,
      contactLimit: options.contactLimit ?? 250,
    }),
    idToken,
  )
}

export function fetchCrmContacts(
  idToken: string,
  options: CrmContactsQueryOptions = {},
) {
  return requestWithAuth<CrmContactsResponse>(
    withQuery('/api/crm/contacts', {
      limit: options.limit ?? 150,
      offset: options.offset ?? 0,
      includeArchived: options.includeArchived ? 'true' : undefined,
      search: options.search ?? undefined,
      dealerSourceId: options.dealerSourceId ?? undefined,
      salesUnit: options.salesUnit ?? undefined,
      state: options.state ?? undefined,
      country: options.country ?? undefined,
      contactOrigin: options.contactOrigin ?? undefined,
      hasEmail: options.hasEmail === null || options.hasEmail === undefined
        ? undefined
        : (options.hasEmail ? 'true' : 'false'),
    }),
    idToken,
  )
}

export function fetchCrmQuotes(
  idToken: string,
  options: {
    limit?: number
    status?: string
    dealerSourceId?: string
  } = {},
) {
  return requestWithAuth<CrmQuotesResponse>(
    withQuery('/api/crm/quotes', {
      limit: options.limit ?? 150,
      status: options.status ?? undefined,
      dealerSourceId: options.dealerSourceId ?? undefined,
    }),
    idToken,
  )
}

export function createCrmQuote(idToken: string, input: CrmQuoteUpsertInput) {
  return requestWithAuth<{ quote: CrmQuote }>('/api/crm/quotes', idToken, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateCrmQuote(
  idToken: string,
  quoteId: string,
  input: Partial<CrmQuoteUpsertInput>,
) {
  return requestWithAuth<{ quote: CrmQuote }>(`/api/crm/quotes/${encodeURIComponent(quoteId)}`, idToken, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function fetchCrmOrders(
  idToken: string,
  options: {
    limit?: number
    status?: string
    dealerSourceId?: string
  } = {},
) {
  return requestWithAuth<CrmOrdersResponse>(
    withQuery('/api/crm/orders', {
      limit: options.limit ?? 150,
      status: options.status ?? undefined,
      dealerSourceId: options.dealerSourceId ?? undefined,
    }),
    idToken,
  )
}

export function createCrmOrder(idToken: string, input: CrmOrderUpsertInput) {
  return requestWithAuth<{ order: CrmOrder }>('/api/crm/orders', idToken, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateCrmOrder(
  idToken: string,
  orderId: string,
  input: Partial<CrmOrderUpsertInput>,
) {
  return requestWithAuth<{ order: CrmOrder }>(`/api/crm/orders/${encodeURIComponent(orderId)}`, idToken, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

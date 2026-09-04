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
  quoteCompanyName?: string | null
  pictureUrl?: string | null
  chatMessageCount?: number
  phone?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  industry?: string | null
  accountType?: string | null
  accountClass?: string | null
  salesRep?: string | null
  paymentTerms?: string | null
  website?: string | null
  emails?: string[] | null
  contactCountSource?: number
  recordStatus?: 'active' | 'deleted' | null
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
  accountType?: 'dealer' | 'designer' | 'all' | string
  dealerStates?: string[]
  salesReps?: string[]
  ownerEmail?: string
  hasEmail?: boolean | null
}

export type CrmSalesRep = {
  id: string
  name: string
  companyName: string | null
  logoUrl: string | null
  contractUrl?: string | null
  contractSignedDate?: string | null
  contractNet?: string | null
  email: string | null
  email2: string | null
  phone: string | null
  phone2: string | null
  states: string[]
  createdAt: string | null
  updatedAt: string | null
}

export type CrmSalesRepsResponse = {
  salesReps: CrmSalesRep[]
  availableStates: string[]
}

export type CrmSalesRepUpsertInput = {
  name: string
  companyName?: string | null
  logoUrl?: string | null
  contractUrl?: string | null
  contractSignedDate?: string | null
  contractNet?: string | null
  email?: string | null
  email2?: string | null
  phone?: string | null
  phone2?: string | null
  states: string[]
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
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  gender: string | null
  contactTypeId: string | null
  photoUrl: string | null
  recordStatus?: 'active' | 'deleted' | null
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

export type CrmDealerChatMessage = {
  id: string
  dealerSourceId: string
  message: string
  mentionUserUids?: string[]
  mentionUserEmails?: string[]
  reminder?: {
    id: string
    dueDate: string
    note: string | null
    targetUserUids: string[]
    targetUserEmails: string[]
    notifiedAt?: string | null
    notifiedRecipientUids?: string[]
    createdAt: string
  } | null
  createdAt: string
  createdByUid: string | null
  createdByEmail: string | null
  createdByName: string | null
  updatedAt?: string | null
  updatedByUid?: string | null
  updatedByEmail?: string | null
  updatedByName?: string | null
}

export type CrmDealerChatsResponse = {
  messages: CrmDealerChatMessage[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

export type CrmQuoteChatMessage = {
  id: string
  quoteId: string
  dealerSourceId?: string | null
  quoteNumber?: string | null
  message: string
  mentionUserUids?: string[]
  mentionUserEmails?: string[]
  reminder?: {
    id: string
    dueDate: string
    note: string | null
    targetUserUids: string[]
    targetUserEmails: string[]
    notifiedAt?: string | null
    notifiedRecipientUids?: string[]
    createdAt: string
  } | null
  createdAt: string
  createdByUid: string | null
  createdByEmail: string | null
  createdByName: string | null
  updatedAt?: string | null
  updatedByUid?: string | null
  updatedByEmail?: string | null
  updatedByName?: string | null
}

export type CrmQuoteChatsResponse = {
  messages: CrmQuoteChatMessage[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

export type CrmChatUser = {
  uid: string
  email: string
  displayName: string | null
  isAdmin: boolean
  isSalesRep: boolean
  hasWebAccess: boolean
  hasAppAccess: boolean
  lastActivityAt: string | null
}

export type CrmChatUsersResponse = {
  users: CrmChatUser[]
}

export type CrmDealerChatMessageCreateInput = {
  message: string
  mentionUserUids?: string[]
  reminder?: {
    dueDate: string
    note?: string | null
    targetUserUids?: string[]
  } | null
}

export type CrmQuoteChatMessageCreateInput = {
  message: string
  mentionUserUids?: string[]
  reminder?: {
    dueDate: string
    note?: string | null
    targetUserUids?: string[]
  } | null
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

export type CrmDealerCreateInput = {
  sourceId?: string | null
  name: string
  quoteCompanyName?: string | null
  phone?: string | null
  phone2?: string | null
  emails?: string[]
  email?: string | null
  email2?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  industry?: string | null
  accountClass?: string | null
  accountType?: string | null
  salesRep?: string | null
  paymentTerms?: string | null
  website?: string | null
  accountText?: string | null
  owner?: string | null
  ownerEmail?: string | null
  pictureUrl?: string | null
  pictureUrlSource?: string | null
  socialMedia?: string | null
  socialMediaLinks?: Record<string, string> | null
  createdDateSource?: string | null
  modifiedDateSource?: string | null
}

export type CrmDealerUpdateInput = Partial<{
  name: string | null
  quoteCompanyName: string | null
  phone: string | null
  phone2: string | null
  emails: string[]
  email: string | null
  email2: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  industry: string | null
  accountClass: string | null
  accountType: string | null
  salesRep: string | null
  paymentTerms: string | null
  website: string | null
  accountText: string | null
  owner: string | null
  ownerEmail: string | null
  pictureUrl: string | null
  pictureUrlSource: string | null
  socialMedia: string | null
  socialMediaLinks: Record<string, string> | null
  isArchived: boolean
  isFavorite: boolean
}>

export type CrmDealerDeleteResponse = {
  dealer: CrmDealerDetail
  archivedContactsCount: number
  archiveContactsApplied: boolean
  queuedForDeletion?: boolean
}

export type CrmContactMutationInput = Partial<{
  sourceId: string
  name: string | null
  firstName: string | null
  lastName: string | null
  primaryEmail: string | null
  secondaryEmail: string | null
  email3: string | null
  email4: string | null
  salesUnit: string | null
  phone: string | null
  phone2: string | null
  phoneAlt: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  gender: string | null
  contactTypeId: string | null
  photoUrl: string | null
  isArchived: boolean
  dealerSourceId: string | null
  contactOrigin: 'linked' | 'unlinked' | 'manual'
  createdDateSource: string | null
}>

export type CrmDeletionQueueRecordDealer = {
  sourceId: string
  name: string | null
  state: string | null
  accountType: string | null
  accountClass: string | null
  salesRep: string | null
  deleteRequestedAt: string | null
  deleteRequestedByUid: string | null
  deleteRequestedByEmail: string | null
  deletedAt: string | null
  deletedByEmail: string | null
  updatedAt: string | null
}

export type CrmDeletionQueueRecordContact = {
  sourceId: string
  name: string | null
  accountSourceId: string | null
  accountName: string | null
  state: string | null
  deleteRequestedAt: string | null
  deleteRequestedByUid: string | null
  deleteRequestedByEmail: string | null
  deletedAt: string | null
  deletedByEmail: string | null
  updatedAt: string | null
}

export type CrmDeletionQueueResponse = {
  dealers: CrmDeletionQueueRecordDealer[]
  contacts: CrmDeletionQueueRecordContact[]
  total: number
}

export type CrmQuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'cancelled'

export type CrmOpportunityStage =
  | 'proposal_submission'
  | 'order_placement'

export type CrmQuoteLineImage = {
  id: string
  url: string
  name: string | null
  width: number | null
  height: number | null
  shape?: 'square' | 'landscape' | 'wide' | 'portrait' | null
  displaySize?: 'small' | 'medium' | 'large' | null
  pdfLayout?: {
    x: number
    y: number
    width: number
  } | null
}

export type CrmQuoteLineItem = {
  id?: string
  parentLineId?: string | null
  itemNumber: number
  detailLabel?: string | null
  description: string | null
  qty: number | null
  unitPrice: number | null
  extPrice: number | null
  images?: CrmQuoteLineImage[]
}

export type CrmQuoteLineLibraryEntry = {
  id: string
  name: string
  lines: CrmQuoteLineItem[]
  recordStatus?: 'active' | 'deleted'
  createdAt: string | null
  createdByUid: string | null
  createdByEmail: string | null
  updatedAt: string | null
  updatedByEmail: string | null
  deleteRequestedAt: string | null
  deleteRequestedByUid: string | null
  deleteRequestedByEmail: string | null
}

export type CrmQuoteLineLibraryInput = {
  name: string
  lines: CrmQuoteLineItem[]
}

export type CrmQuoteServiceLocation = {
  label: string
  address: string | null
  city: string | null
  state: string | null
  postalCode: string | null
}

export type CrmQuoteServiceItem = {
  id: string
  title: string
  description: string | null
  qty?: number | null
  unitPrice?: number | null
  extPrice?: number | null
  price: number | null
  images?: CrmQuoteLineImage[]
  location?: CrmQuoteServiceLocation | null
}

export type CrmPlaceSuggestion = {
  kind: 'address' | 'city' | 'state'
  label: string
  address: string | null
  city: string | null
  state: string | null
  postalCode: string | null
}

export type CrmQuoteOrigin = 'website' | 'excel'
export type CrmQuoteTotalPriceType = 'list' | 'net'

export type CrmQuotePrintSettings = {
  id: 'default'
  logoUrl: string | null
  logoName: string | null
  companyName: string
  addressLines: string[]
  phone: string | null
  email: string | null
  website: string | null
  headerText: string | null
  footerText: string | null
  accentColor: string
  showPaymentTerms: boolean
  showLeadTime: boolean
  showFreight: boolean
  customerInformation: string
  projectManagers: string
  depositRequestBody: string
  depositRequestTerms: string
  orderConfirmationRequestedInfo: string
  orderConfirmationNotes: string
  orderConfirmationTerms: string
  updatedAt: string | null
  updatedByEmail: string | null
}

export type CrmQuotePrintSettingsInput = Omit<CrmQuotePrintSettings, 'id' | 'updatedAt' | 'updatedByEmail'>

export type CrmDocumentType =
  | 'quote'
  | 'order_confirmation'
  | 'proforma_invoice'
  | 'work_order'
  | 'bill_of_lading'
  | 'change_order'

export type CrmDocumentTerm = {
  id: string
  kind: 'document_term'
  documentType: CrmDocumentType
  title: string
  body: string
  sortOrder: number
  isDefault: boolean
  includedDealerSourceIds: string[]
  excludedDealerSourceIds: string[]
  isBuiltIn: boolean
  appliesToDealer?: boolean
  createdAt: string | null
  createdByEmail: string | null
  updatedAt: string | null
  updatedByEmail: string | null
}

export type CrmDocumentTermsResponse = {
  documentTypes: CrmDocumentType[]
  terms: CrmDocumentTerm[]
}

export type CrmDocumentTermInput = {
  documentType: CrmDocumentType
  title: string
  body: string
  sortOrder?: number
  isDefault?: boolean
  includedDealerSourceIds?: string[]
  excludedDealerSourceIds?: string[]
}

export type CrmQuote = {
  id: string
  dealerSourceId: string
  dealerName: string
  dealerPictureUrl?: string | null
  convertedItemKeys?: string[]
  chatMessageCount?: number
  dealerState?: string | null
  companyName?: string | null
  salesRep?: string | null
  projectType?: string | null
  opportunityDate?: string | null
  opportunityStage?: CrmOpportunityStage | null
  contactSourceId?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  quoteNumber: string | null
  poNumber?: string | null
  acknowledgmentNumber?: string | null
  orderNumber?: string | null
  convertedOrderId?: string | null
  convertedOrderNumber?: string | null
  convertedAt?: string | null
  paymentTerms?: string | null
  leadTime?: string | null
  subtotal?: number | null
  discountPercent?: number | null
  discountAmount?: number | null
  discountScope?: 'products' | 'products_and_freight' | null
  discountFreightAmount?: number | null
  totalPriceType?: CrmQuoteTotalPriceType | null
  freight?: number | null
  freightDescription?: string | null
  lineItems?: CrmQuoteLineItem[] | null
  additionalServices?: CrmQuoteServiceItem[] | null
  shippingServices?: CrmQuoteServiceItem[] | null
  title: string
  description: string | null
  origin?: CrmQuoteOrigin | null
  sourceWorkbookUrl?: string | null
  sourceWorkbookName?: string | null
  convertedPdfUrl?: string | null
  convertedPdfName?: string | null
  baseQuoteNumber?: string | null
  activeRevisionNumber?: number | null
  revisions?: CrmQuoteRevision[] | null
  revisionCount?: number | null
  status: CrmQuoteStatus
  totalAmount: number
  currency: string
  sentAt: string | null
  acceptedAt: string | null
  rejectedAt: string | null
  notes: string | null
  lastFollowedUpAt?: string | null
  lastLinkOpenedAt?: string | null
  linkOpenCount?: number | null
  activityLog?: Array<{
    id: string
    type: 'follow_up' | string
    occurredAt: string
    createdByUid?: string | null
    createdByEmail?: string | null
    link?: string | null
    userAgent?: string | null
    ipAddress?: string | null
    browser?: string | null
    operatingSystem?: string | null
    deviceType?: string | null
    referrer?: string | null
    acceptLanguage?: string | null
    location?: {
      city?: string | null
      region?: string | null
      country?: string | null
      coordinates?: string | null
    } | null
  }> | null
  lastStatusChangedAt: string
  createdByUid: string | null
  createdByEmail: string | null
  createdAt?: string | null
  updatedAt: string
}

export type CrmQuoteRevision = Partial<Omit<CrmQuote, 'revisions'>> & {
  id: string
  revisionNumber: number
  quoteNumber: string | null
  createdAt?: string | null
  createdByUid?: string | null
  createdByEmail?: string | null
  updatedByUid?: string | null
  updatedByEmail?: string | null
}

export type CrmQuotesResponse = {
  quotes: CrmQuote[]
}

export type CrmQuoteUpsertInput = {
  revisionNumber?: number
  activeRevisionNumber?: number | null
  dealerSourceId?: string | null
  title: string
  dealerState?: string | null
  companyName?: string | null
  salesRep?: string | null
  projectType?: string | null
  opportunityDate?: string | null
  opportunityStage?: CrmOpportunityStage | null
  contactSourceId?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  quoteNumber?: string | null
  poNumber?: string | null
  acknowledgmentNumber?: string | null
  orderNumber?: string | null
  paymentTerms?: string | null
  leadTime?: string | null
  subtotal?: number | null
  discountPercent?: number | null
  discountAmount?: number | null
  discountScope?: 'products' | 'products_and_freight' | null
  discountFreightAmount?: number | null
  totalPriceType?: CrmQuoteTotalPriceType | null
  freight?: number | null
  freightDescription?: string | null
  lineItems?: CrmQuoteLineItem[] | null
  additionalServices?: CrmQuoteServiceItem[] | null
  shippingServices?: CrmQuoteServiceItem[] | null
  description?: string | null
  origin?: CrmQuoteOrigin | null
  sourceWorkbookUrl?: string | null
  sourceWorkbookName?: string | null
  convertedPdfUrl?: string | null
  convertedPdfName?: string | null
  revisionCount?: number | null
  status?: CrmQuoteStatus
  totalAmount: number
  currency?: string | null
  sentAt?: string | null
  acceptedAt?: string | null
  rejectedAt?: string | null
  notes?: string | null
}

export type CrmExcelQuoteSyncInput = {
  quoteNumber: string
  origin?: CrmQuoteOrigin | null
  title?: string | null
  companyName?: string | null
  salesRep?: string | null
  dealerState?: string | null
  projectType?: string | null
  opportunityDate?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  paymentTerms?: string | null
  leadTime?: string | null
  subtotal?: number | null
  freight?: number | null
  freightDescription?: string | null
  totalAmount?: number | null
  lineItems?: CrmQuoteLineItem[]
  sourceWorkbookUrl?: string | null
  sourceWorkbookName?: string | null
  convertedPdfUrl?: string | null
  convertedPdfName?: string | null
}

export type CrmExcelQuoteImportSummary = {
  sheetName: string
  mainLineCount: number
  sublineCount: number
  pairedSublineCount: number
  singleColumnSublineCount: number
  embeddedImageCount: number
  matchedImageCount: number
  unmatchedImageCount: number
}

export type CrmExcelQuoteSyncResponse = {
  ok: boolean
  found: boolean
  created?: boolean
  fromStage: CrmOpportunityStage | string
  toStage: CrmOpportunityStage | string
  quoteNumber: string
  quote: CrmQuote | null
  message?: string
}

export type CrmExcelQuoteLookupResponse = {
  found: boolean
  id?: string
  quoteNumber?: string | null
  opportunityStage?: CrmOpportunityStage | string | null
  status?: string | null
  dealerName?: string | null
  title?: string | null
  salesRep?: string | null
  dealerState?: string | null
  projectType?: string | null
  error?: string
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
  sourceQuoteId?: string | null
  sourceQuoteNumber?: string | null
  sourceQuoteTitle?: string | null
  mondayPrimaryBoardId?: string | null
  mondayPrimaryItemId?: string | null
  mondaySecondaryBoardId?: string | null
  mondaySecondaryItemId?: string | null
  poDate?: string | null
  poNumber?: string | null
  leadTimeDate?: string | null
  shipTo?: string | null
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

export type CrmConvertOrderBoardOption = {
  id: string
  name: string | null
}

export type CrmConvertOrderBoardsResponse = {
  primaryBoardId: string
  secondaryBoardId: string
  suggestedAcknowledgmentNumber: string
  boards: CrmConvertOrderBoardOption[]
}

export type CrmConvertQuoteToOrderInput = {
  acknowledgmentNumber: string
  poDate?: string | null
  poNumber?: string | null
  leadTime?: string | null
  shipTo: string
  notes?: string | null
  selectedLineItemIds: string[]
  selectedAdditionalServiceIds: string[]
  selectedShippingServiceIds: string[]
  includeFreight: boolean
  depositRequired: boolean
  depositPercent?: number | null
  depositRequestUrl?: string | null
  depositRequestName?: string | null
  orderConfirmationUrl?: string | null
  orderConfirmationName?: string | null
  workOrderUrl?: string | null
  workOrderName?: string | null
  proformaInvoiceUrl?: string | null
  proformaInvoiceName?: string | null
  bolUrl?: string | null
  bolName?: string | null
}

export type CrmConvertQuoteToOrderResponse = {
  order: CrmOrder
  quote: CrmQuote
  monday: {
    primaryBoardId: string
    primaryItemId: string
    secondaryBoardId: string
    secondaryItemId: string
  }
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

import { apiRequest } from '../api-client'

export function previewCrmImport(payload: unknown) {
  return apiRequest<CrmImportPreviewResponse>('/api/crm/imports/preview', {
    method: 'POST',
    body: JSON.stringify({ payload }),
  })
}

export function commitCrmImport(
  payload: unknown,
  confirmText: string,
  previewFingerprint: string,
) {
  return apiRequest<CrmCommitResponse>('/api/crm/imports/commit', {
    method: 'POST',
    body: JSON.stringify({ payload, confirmText, previewFingerprint }),
  })
}

export function fetchCrmOverview() {
  return apiRequest<CrmOverviewResponse>('/api/crm/overview')
}

export function fetchCrmImports(limit = 20) {
  return apiRequest<CrmImportsResponse>(withQuery('/api/crm/imports', { limit }))
}

export function fetchCrmConflicts(status = 'open', limit = 150) {
  return apiRequest<CrmConflictsResponse>(withQuery('/api/crm/conflicts', { status, limit }))
}

export function fetchCrmDealers(
  limitOrOptions: number | CrmDealersQueryOptions = 2000,
  includeArchived = false,
) {
  const options = typeof limitOrOptions === 'number'
    ? { limit: limitOrOptions, includeArchived }
    : limitOrOptions

  return apiRequest<CrmDealersResponse>(
    withQuery('/api/crm/dealers', {
      limit: options.limit ?? 2000,
      offset: options.offset ?? undefined,
      includeArchived: options.includeArchived ? 'true' : undefined,
      search: options.search ?? undefined,
      accountType: options.accountType ?? undefined,
      dealerStates: Array.isArray(options.dealerStates) && options.dealerStates.length > 0
        ? options.dealerStates.map((value) => String(value ?? '').trim()).filter(Boolean).join(',')
        : undefined,
      salesReps: Array.isArray(options.salesReps) && options.salesReps.length > 0
        ? options.salesReps.map((value) => String(value ?? '').trim()).filter(Boolean).join(',')
        : undefined,
      ownerEmail: options.ownerEmail ?? undefined,
      hasEmail: options.hasEmail === null || options.hasEmail === undefined
        ? undefined
        : (options.hasEmail ? 'true' : 'false'),
    }),
  )
}

export function fetchCrmSalesReps() {
  return apiRequest<CrmSalesRepsResponse>('/api/crm/sales-reps')
}

export function createCrmSalesRep(input: CrmSalesRepUpsertInput) {
  return apiRequest<{ salesRep: CrmSalesRep }>('/api/crm/sales-reps', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateCrmSalesRep(salesRepId: string, input: Partial<CrmSalesRepUpsertInput>) {
  return apiRequest<{ salesRep: CrmSalesRep }>(`/api/crm/sales-reps/${encodeURIComponent(salesRepId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function removeCrmSalesRep(salesRepId: string) {
  return apiRequest<{ ok: boolean; salesRepId: string }>(`/api/crm/sales-reps/${encodeURIComponent(salesRepId)}`, {
    method: 'DELETE',
  })
}

export function fetchCrmDealerDetail(
  dealerSourceId: string,
  options: CrmDealerContactsQueryOptions = {},
) {
  return apiRequest<CrmDealerDetailResponse>(
    withQuery(`/api/crm/dealers/${encodeURIComponent(dealerSourceId)}`, {
      includeArchivedContacts: options.includeArchivedContacts ? 'true' : undefined,
      contactSearch: options.contactSearch ?? undefined,
      contactOffset: options.contactOffset ?? 0,
      contactLimit: options.contactLimit ?? 250,
    }),
  )
}

export function createCrmDealer(input: CrmDealerCreateInput) {
  return apiRequest<{ dealer: CrmDealerDetail }>('/api/crm/dealers', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function fetchCrmDealerChats(
  dealerSourceId: string,
  options: { limit?: number; offset?: number } = {},
) {
  return apiRequest<CrmDealerChatsResponse>(
    withQuery(`/api/crm/dealers/${encodeURIComponent(dealerSourceId)}/chats`, {
      limit: options.limit ?? 150,
      offset: options.offset ?? 0,
    }),
  )
}

export function fetchCrmChatUsers() {
  return apiRequest<CrmChatUsersResponse>('/api/crm/chat-users')
}

export function createCrmDealerChatMessage(
  dealerSourceId: string,
  input: string | CrmDealerChatMessageCreateInput,
) {
  const payload = typeof input === 'string'
    ? { message: input }
    : input

  return apiRequest<{ message: CrmDealerChatMessage }>(`/api/crm/dealers/${encodeURIComponent(dealerSourceId)}/chats`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateCrmDealerChatMessage(dealerSourceId: string, messageId: string, message: string) {
  return apiRequest<{ message: CrmDealerChatMessage }>(
    `/api/crm/dealers/${encodeURIComponent(dealerSourceId)}/chats/${encodeURIComponent(messageId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ message }),
    },
  )
}

export function removeCrmDealerChatMessage(dealerSourceId: string, messageId: string) {
  return apiRequest<{ ok: boolean; messageId: string }>(
    `/api/crm/dealers/${encodeURIComponent(dealerSourceId)}/chats/${encodeURIComponent(messageId)}`,
    {
      method: 'DELETE',
    },
  )
}

export function fetchCrmQuoteChats(
  quoteId: string,
  options: { limit?: number; offset?: number } = {},
) {
  return apiRequest<CrmQuoteChatsResponse>(
    withQuery(`/api/crm/quotes/${encodeURIComponent(quoteId)}/chats`, {
      limit: options.limit ?? 150,
      offset: options.offset ?? 0,
    }),
  )
}

export function createCrmQuoteChatMessage(
  quoteId: string,
  input: string | CrmQuoteChatMessageCreateInput,
) {
  const payload = typeof input === 'string'
    ? { message: input }
    : input

  return apiRequest<{ message: CrmQuoteChatMessage }>(`/api/crm/quotes/${encodeURIComponent(quoteId)}/chats`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateCrmQuoteChatMessage(quoteId: string, messageId: string, message: string) {
  return apiRequest<{ message: CrmQuoteChatMessage }>(
    `/api/crm/quotes/${encodeURIComponent(quoteId)}/chats/${encodeURIComponent(messageId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ message }),
    },
  )
}

export function removeCrmQuoteChatMessage(quoteId: string, messageId: string) {
  return apiRequest<{ ok: boolean; messageId: string }>(
    `/api/crm/quotes/${encodeURIComponent(quoteId)}/chats/${encodeURIComponent(messageId)}`,
    {
      method: 'DELETE',
    },
  )
}

export function updateCrmDealer(dealerSourceId: string, input: CrmDealerUpdateInput) {
  return apiRequest<{ dealer: CrmDealerDetail }>(`/api/crm/dealers/${encodeURIComponent(dealerSourceId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function removeCrmDealer(dealerSourceId: string, options: { archiveContacts?: boolean } = {}) {
  return apiRequest<CrmDealerDeleteResponse>(
    withQuery(`/api/crm/dealers/${encodeURIComponent(dealerSourceId)}`, {
      archiveContacts: options.archiveContacts ? 'true' : 'false',
    }),
    {
      method: 'DELETE',
    },
  )
}

export function createCrmDealerContact(dealerSourceId: string, input: CrmContactMutationInput) {
  return apiRequest<{ contact: CrmContact }>(`/api/crm/dealers/${encodeURIComponent(dealerSourceId)}/contacts`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateCrmContact(contactSourceId: string, input: CrmContactMutationInput) {
  return apiRequest<{ contact: CrmContact }>(`/api/crm/contacts/${encodeURIComponent(contactSourceId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function removeCrmContact(contactSourceId: string) {
  return apiRequest<{ contact: CrmContact; queuedForDeletion?: boolean }>(`/api/crm/contacts/${encodeURIComponent(contactSourceId)}`, {
    method: 'DELETE',
  })
}

export function fetchCrmContacts(options: CrmContactsQueryOptions = {}) {
  return apiRequest<CrmContactsResponse>(
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
  )
}

export function fetchCrmDeletionQueue(limit = 500) {
  return apiRequest<CrmDeletionQueueResponse>(withQuery('/api/crm/deletion-queue', { limit }))
}

export function confirmCrmDeletion(
  entityType: 'dealer' | 'contact',
  sourceId: string,
  options: { includeContacts?: boolean } = {},
) {
  return apiRequest<{
    ok: boolean
    entityType: 'dealer' | 'contact'
    sourceId: string
    deletedDealerCount?: number
    deletedContactCount?: number
  }>(`/api/crm/deletion-queue/${encodeURIComponent(entityType)}/${encodeURIComponent(sourceId)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({
      includeContacts: options.includeContacts,
    }),
  })
}

export function restoreCrmDeletion(entityType: 'dealer' | 'contact', sourceId: string) {
  return apiRequest<{
    ok: boolean
    entityType: 'dealer' | 'contact'
    sourceId: string
    dealer?: CrmDealerDetail
    contact?: CrmContact
  }>(`/api/crm/deletion-queue/${encodeURIComponent(entityType)}/${encodeURIComponent(sourceId)}/restore`, {
    method: 'POST',
  })
}

export function fetchCrmQuotes(options: {
  limit?: number
  status?: string
  dealerSourceId?: string
  quoteNumber?: string
  search?: string
  salesRep?: string
  dealerState?: string
  projectType?: string
  lifecycle?: string
  view?: 'cards' | 'full'
} = {}) {
  return apiRequest<CrmQuotesResponse>(
    withQuery('/api/crm/quotes', {
      limit: options.limit ?? 150,
      status: options.status ?? undefined,
      dealerSourceId: options.dealerSourceId ?? undefined,
      quoteNumber: options.quoteNumber ?? undefined,
      search: options.search ?? undefined,
      salesRep: options.salesRep ?? undefined,
      dealerState: options.dealerState ?? undefined,
      projectType: options.projectType ?? undefined,
      lifecycle: options.lifecycle ?? undefined,
      view: options.view ?? undefined,
    }),
  )
}

export function fetchCrmQuoteDetails(quoteId: string) {
  return apiRequest<{ quote: CrmQuote }>(`/api/crm/quotes/${encodeURIComponent(quoteId)}/details`)
}

export function markCrmQuoteFollowedUp(quoteId: string) {
  return apiRequest<{ quote: CrmQuote }>(`/api/crm/quotes/${encodeURIComponent(quoteId)}/follow-up`, {
    method: 'POST',
    body: JSON.stringify({ confirmed: true }),
  })
}

export type CrmQuoteReminderSettings = {
  rules: Array<{
    id: string
    kind: 'follow_up_due' | 'link_opened' | 'customer_signed_bol_missing'
    days: number
    base: 'quote_date' | 'last_follow_up' | 'shipped_date'
  }>
}

export function fetchCrmQuoteReminderSettings() {
  return apiRequest<{ settings: CrmQuoteReminderSettings }>('/api/crm/reminder-settings/me')
}

export function updateCrmQuoteReminderSettings(settings: CrmQuoteReminderSettings) {
  return apiRequest<{ settings: CrmQuoteReminderSettings }>('/api/crm/reminder-settings/me', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}

export function fetchCrmQuoteLineLibrary(options: { includeDeleted?: boolean } = {}) {
  return apiRequest<{ entries: CrmQuoteLineLibraryEntry[] }>(
    withQuery('/api/crm/quote-line-library', { includeDeleted: options.includeDeleted ? 'true' : undefined }),
  )
}

export function createCrmQuoteLineLibraryEntry(input: CrmQuoteLineLibraryInput) {
  return apiRequest<{ entry: CrmQuoteLineLibraryEntry }>('/api/crm/quote-line-library', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateCrmQuoteLineLibraryEntry(entryId: string, input: CrmQuoteLineLibraryInput) {
  return apiRequest<{ entry: CrmQuoteLineLibraryEntry }>(`/api/crm/quote-line-library/${encodeURIComponent(entryId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function removeCrmQuoteLineLibraryEntry(entryId: string) {
  return apiRequest<{ ok: true; queuedForDeletion: true; entry: CrmQuoteLineLibraryEntry }>(
    `/api/crm/quote-line-library/${encodeURIComponent(entryId)}`,
    { method: 'DELETE' },
  )
}

export function restoreCrmQuoteLineLibraryEntry(entryId: string) {
  return apiRequest<{ ok: true; entry: CrmQuoteLineLibraryEntry }>(
    `/api/crm/quote-line-library/${encodeURIComponent(entryId)}/restore`,
    { method: 'POST' },
  )
}

export function confirmCrmQuoteLineLibraryEntryDeletion(entryId: string) {
  return apiRequest<{ ok: true; entryId: string }>(
    `/api/crm/quote-line-library/${encodeURIComponent(entryId)}/confirm-delete`,
    { method: 'POST' },
  )
}

export function fetchCrmPlaceSuggestions(query: string) {
  return apiRequest<{ suggestions: CrmPlaceSuggestion[]; unavailable?: boolean }>(
    withQuery('/api/crm/places/suggest', { q: query }),
  )
}

export function fetchCrmQuotePrintSettings() {
  return apiRequest<{ settings: CrmQuotePrintSettings }>('/api/crm/quote-print-settings')
}

export function updateCrmQuotePrintSettings(input: CrmQuotePrintSettingsInput) {
  return apiRequest<{ settings: CrmQuotePrintSettings }>('/api/crm/quote-print-settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function fetchCrmDocumentTerms(dealerSourceId?: string | null) {
  return apiRequest<CrmDocumentTermsResponse>(withQuery('/api/crm/document-terms', {
    dealerSourceId: dealerSourceId || undefined,
  }))
}

export function createCrmDocumentTerm(input: CrmDocumentTermInput) {
  return apiRequest<{ term: CrmDocumentTerm }>('/api/crm/document-terms', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateCrmDocumentTerm(termId: string, input: Partial<CrmDocumentTermInput>) {
  return apiRequest<{ term: CrmDocumentTerm }>(`/api/crm/document-terms/${encodeURIComponent(termId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function removeCrmDocumentTerm(termId: string) {
  return apiRequest<{ ok: boolean; termId: string }>(`/api/crm/document-terms/${encodeURIComponent(termId)}`, {
    method: 'DELETE',
  })
}

export function convertCrmQuoteWorkbook(input: {
  workbookUrl: string
  workbookName: string
  quoteNumber: string
}) {
  return apiRequest<{ convertedPdfUrl: string; convertedPdfName: string }>('/api/crm/quotes/convert-workbook', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function createCrmQuote(input: CrmQuoteUpsertInput) {
  return apiRequest<{ quote: CrmQuote }>('/api/crm/quotes', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateCrmQuote(quoteId: string, input: Partial<CrmQuoteUpsertInput>) {
  return apiRequest<{ quote: CrmQuote }>(`/api/crm/quotes/${encodeURIComponent(quoteId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function createCrmQuoteRevision(quoteId: string, input: {
  sourceRevisionNumber: number
}) {
  return apiRequest<{ quote: CrmQuote; revision: CrmQuoteRevision }>(
    `/api/crm/quotes/${encodeURIComponent(quoteId)}/revisions`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function removeCrmQuoteRevision(quoteId: string, revisionNumber: number) {
  return apiRequest<{ ok: true; quote: CrmQuote; deletedRevisionNumber: number; revisionsRenumbered: true }>(
    `/api/crm/quotes/${encodeURIComponent(quoteId)}/revisions/${revisionNumber}`,
    { method: 'DELETE' },
  )
}

export function removeCrmQuote(quoteId: string) {
  return apiRequest<{ ok: boolean; quote: CrmQuote }>(`/api/crm/quotes/${encodeURIComponent(quoteId)}`, {
    method: 'DELETE',
  })
}

export function cancelCrmQuoteOrder(quoteId: string) {
  return apiRequest<{
    ok: boolean
    quote: CrmQuote
    canceledOrderId: string
    warnings: string[]
  }>(`/api/crm/quotes/${encodeURIComponent(quoteId)}/cancel-order`, {
    method: 'POST',
  })
}

export function syncCrmQuoteFromExcel(input: CrmExcelQuoteSyncInput) {
  return apiRequest<CrmExcelQuoteSyncResponse>('/api/crm/quotes/excel-sync', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function fetchCrmExcelQuoteLookup(quoteNumber: string) {
  return apiRequest<CrmExcelQuoteLookupResponse>(
    withQuery('/api/crm/quotes/excel-lookup', {
      quoteNumber,
    }),
  )
}

export function fetchCrmConvertOrderBoards() {
  return apiRequest<CrmConvertOrderBoardsResponse>('/api/crm/quotes/convert-order-options')
}

export function convertCrmQuoteToOrder(quoteId: string, input: CrmConvertQuoteToOrderInput) {
  return apiRequest<CrmConvertQuoteToOrderResponse>(`/api/crm/quotes/${encodeURIComponent(quoteId)}/convert-to-order`, {
    method: 'POST',
    body: JSON.stringify(input),
  }, { processTracking: false })
}

export function fetchCrmOrders(options: { limit?: number; status?: string; dealerSourceId?: string } = {}) {
  return apiRequest<CrmOrdersResponse>(
    withQuery('/api/crm/orders', {
      limit: options.limit ?? 150,
      status: options.status ?? undefined,
      dealerSourceId: options.dealerSourceId ?? undefined,
    }),
  )
}

export function createCrmOrder(input: CrmOrderUpsertInput) {
  return apiRequest<{ order: CrmOrder }>('/api/crm/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateCrmOrder(orderId: string, input: Partial<CrmOrderUpsertInput>) {
  return apiRequest<{ order: CrmOrder }>(`/api/crm/orders/${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

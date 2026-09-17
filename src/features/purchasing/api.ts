import { apiFetch, apiRequest } from '../api-client'

export type PurchasingItemSummary = {
  itemKey: string
  itemRaw: string
  descriptions: string[]
  vendorRaws: string[]
  vendorCount: number
  totalSpent: number
  totalQty: number
  transactionCount: number
  firstPurchaseDate: string | null
  lastPurchaseDate: string | null
  requiresDimensions?: boolean
  defaultDimensions?: string | null
  requiresVeneerDirection?: boolean
  defaultVeneerDirection?: 'length' | 'width' | 'none' | null
}

export type PurchasingItemsResponse = {
  generatedAt: string
  page: number
  pageSize: number
  totalPages: number
  totalCount: number
  count: number
  refreshSummary?: PurchasingRefreshSummary | null
  sync?: PurchasingSyncMetadata | null
  aiAssist?: PurchasingItemsAiAssistMeta | null
  items: PurchasingItemSummary[]
}

export type PurchasingItemsAiAssistMeta = {
  enabled: boolean
  used: boolean
  mode: 'none' | 'rerank' | 'fallback'
  matchedCount: number
  topConfidence: number | null
  usedFallback: boolean
  message: string | null
}

export type PurchasingRefreshSummary = {
  source: string | null
  lastAttemptedRefreshAt: string | null
  lastSuccessfulRefreshAt: string | null
  lastQuickBooksBillUpdatedAt: string | null
  billCountFetched: number
  lineCountFetched: number
  newTransactionCount: number
  updatedTransactionCount: number
  touchedItemCount: number
  rebuiltItemCount: number
  truncated: boolean
  lastErrorMessage: string | null
  lastErrorAt: string | null
}

export type PurchasingSyncMetadata = {
  source: string | null
  lastAttemptedRefreshAt: string | null
  lastSuccessfulRefreshAt: string | null
  lastQuickBooksBillUpdatedAt: string | null
  lastErrorMessage: string | null
  lastErrorAt: string | null
  truncated: boolean
}

export type PurchasingRefreshResponse = {
  generatedAt: string
  summary: PurchasingRefreshSummary
}

export type PurchasingItemPhoto = {
  path: string
  url: string
  createdAt: string
}

export type PurchasingItemPhotosResponse = {
  itemKey: string
  photos: PurchasingItemPhoto[]
}

export type PurchasingAiPriceStatus = 'green' | 'yellow' | 'red'

export type PurchasingAiOption = {
  vendorName: string
  productTitle: string
  url: string
  unitPrice: number | null
  currency: string
  shippingEvidence: string
  exactMatchEvidence: string
  notes: string
  priceStatus: PurchasingAiPriceStatus
  deltaPercent: number | null
  thresholdPercent: number | null
}

export type PurchasingAiSearchResponse = {
  generatedAt: string
  itemKey: string | null
  itemName: string
  deliveryLocation: string
  referencePrice: number | null
  candidatesScanned: number
  matchedOptionCount: number
  excludedCandidateCount: number
  options: PurchasingAiOption[]
}

export type PurchasingTransaction = {
  id: string
  source: string
  type: string
  date: string | null
  poDate: string | null
  poNumber: string | null
  itemKey: string
  itemRaw: string
  itemDescription: string | null
  vendorKey: string
  vendorRaw: string | null
  qty: number
  unitCost: number
  amount: number
  memo: string | null
  shipDate: string | null
  delivDate: string | null
  shipDays: number | null
}

export type PurchasingVendorBreakdown = {
  vendorKey: string
  vendorRaw: string
  totalSpent: number
  totalQty: number
  transactionCount: number
  poCount: number
  receiptCount: number
  firstPurchaseDate: string | null
  lastPurchaseDate: string | null
  fastestShipDays: number | null
  slowestShipDays: number | null
  averageShipDays: number | null
  shipSampleCount: number
  highestPrice: number | null
  lowestPrice: number | null
  averagePrice: number | null
  priceSampleCount: number
}

export type PurchasingItemDetailResponse = {
  generatedAt: string
  item: PurchasingItemSummary
  summary: {
    totalSpent: number
    totalQty: number
    transactionCount: number
    vendorCount: number
    fastestShipDays: number | null
    slowestShipDays: number | null
    averageShipDays: number | null
    shipSampleCount: number
    highestPrice: number | null
    lowestPrice: number | null
    averagePrice: number | null
    priceSampleCount: number
  }
  vendors: PurchasingVendorBreakdown[]
  transactions: PurchasingTransaction[]
}

export type PurchasingPoContextVendor = {
  id: string
  name: string
  active: boolean
}

export type PurchasingPoContextProject = {
  id: string
  name: string
  projectNumber: string
  customerName: string
  active: boolean
}

export type PurchasingPoContextResponse = {
  generatedAt: string
  vendors: PurchasingPoContextVendor[]
  projects: PurchasingPoContextProject[]
  truncated?: {
    vendors?: boolean
    projects?: boolean
  }
}

export type PurchasingPoCreateLineInput = {
  lineId?: string
  itemName?: string
  productNumber: string
  vendorId: string
  vendorName?: string
  projectNumber?: string
  projectId?: string
  description?: string | null
  quantity: number
  unitPrice?: number | null
}

export type PurchasingPoCreateRequest = {
  projectNumber?: string
  projectId?: string
  poDate?: string
  memo?: string
  lines: PurchasingPoCreateLineInput[]
}

export type PurchasingPoCreatedOrder = {
  quickBooksId: string | null
  docNumber: string
  vendorId: string
  vendorName: string
  lineCount: number
  totalAmount: number
}

export type PurchasingPoCreateResponse = {
  generatedAt: string
  project: PurchasingPoContextProject
  createdProject: PurchasingPoContextProject | null
  startingPoNumber: string
  poCount: number
  lineCount: number
  /** Items that did not exist in QuickBooks and were created for this order. */
  createdItems?: { id: string, name: string }[]
  purchaseOrders: PurchasingPoCreatedOrder[]
}

export function fetchPurchasingItems(
  options: { search?: string; page?: number; pageSize?: number; aiAssist?: boolean } = {},
) {
  const params = new URLSearchParams()
  if (options.search) params.set('search', options.search)
  if (options.page) params.set('page', String(options.page))
  if (options.pageSize) params.set('pageSize', String(options.pageSize))
  if (options.aiAssist) params.set('aiAssist', '1')
  const query = params.toString()
  return apiRequest<PurchasingItemsResponse>(
    query ? `/api/purchasing/items?${query}` : '/api/purchasing/items',
  )
}

export function fetchPurchasingItemDetail(itemKey: string) {
  // Use query string so itemKeys with '/', '(', '"', etc. survive URL
  // normalization (Firebase Hosting decodes %2F back to '/' in path segments,
  // which breaks Express :itemKey route matching and yields a 404).
  return apiRequest<PurchasingItemDetailResponse>(
    `/api/purchasing/items/detail?key=${encodeURIComponent(itemKey)}`,
  )
}

export function updatePurchasingItemSettings(itemKey: string, input: {
  requiresDimensions: boolean
  defaultDimensions?: string | null
  requiresVeneerDirection?: boolean
  defaultVeneerDirection?: 'length' | 'width' | 'none' | null
}) {
  return apiRequest<{ item: PurchasingItemSummary }>(
    `/api/purchasing/items/settings?key=${encodeURIComponent(itemKey)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ itemKey, ...input }),
    },
  )
}

export function refreshPurchasingFromQuickBooks(options: { force?: boolean } = {}) {
  const params = new URLSearchParams()
  if (options.force) {
    params.set('force', '1')
  }
  const query = params.toString()

  return apiRequest<PurchasingRefreshResponse>(
    query ? `/api/purchasing/refresh?${query}` : '/api/purchasing/refresh',
    { method: 'POST' },
    { timeoutMs: 180000 },
  )
}

export function fetchPurchasingItemPhotos(itemKey: string) {
  return apiRequest<PurchasingItemPhotosResponse>(
    `/api/purchasing/items/photos?key=${encodeURIComponent(itemKey)}`,
  )
}

export function uploadPurchasingItemPhoto(
  itemKey: string,
  payload: { imageBase64: string; mimeType?: string },
) {
  return apiRequest<{ itemKey: string; photo: PurchasingItemPhoto }>(
    '/api/purchasing/items/photos',
    {
      method: 'POST',
      body: JSON.stringify({
        key: itemKey,
        imageBase64: payload.imageBase64,
        mimeType: payload.mimeType,
      }),
    },
    { timeoutMs: 120000 },
  )
}

export function deletePurchasingItemPhoto(itemKey: string, path: string) {
  const query = new URLSearchParams({
    key: itemKey,
    path,
  }).toString()

  return apiRequest<{ ok: boolean; itemKey: string; path: string }>(
    `/api/purchasing/items/photos?${query}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ key: itemKey, path }),
    },
  )
}

export function runPurchasingAiSearch(payload: {
  key?: string
  itemName?: string
  referencePrice?: number | null
}) {
  return apiRequest<PurchasingAiSearchResponse>(
    '/api/purchasing/items/ai-search',
    {
      method: 'POST',
      body: JSON.stringify({
        key: payload.key,
        itemName: payload.itemName,
        referencePrice: payload.referencePrice,
      }),
    },
    { timeoutMs: 120000 },
  )
}

export function fetchPurchasingPoContext(options: { refresh?: boolean; includeProjects?: boolean } = {}) {
  const params = new URLSearchParams()

  if (options.refresh) {
    params.set('refresh', '1')
  }

  if (options.includeProjects) {
    params.set('includeProjects', '1')
  }

  const query = params.toString()

  return apiRequest<PurchasingPoContextResponse>(
    query ? `/api/purchasing/po/context?${query}` : '/api/purchasing/po/context',
  )
}

export function createPurchasingPurchaseOrders(payload: PurchasingPoCreateRequest) {
  return apiRequest<PurchasingPoCreateResponse>(
    '/api/purchasing/po/create',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { timeoutMs: 180000 },
  )
}

// ---------------------------------------------------------------------------
// The buying list
// ---------------------------------------------------------------------------

/**
 * What a line needs next. Decided on the server so the page, any report and
 * any alert never disagree about what "late" means.
 */
export type BuyingLineState =
  | 'not_ordered'
  | 'overdue_order'
  | 'ordered'
  | 'overdue_arrival'
  | 'received'

export type BuyingLine = {
  lineId: string
  kind: 'order_part' | 'standalone'
  partId?: string
  requestId?: string
  orderKey: string | null
  orderNumber: string | null
  orderName: string | null
  /** The order is the project. Standalone lines have none. */
  projectNumber: string | null
  projectId: string | null
  projectName?: string | null
  itemKey: string | null
  itemName: string
  description: string | null
  dimensions: string | null
  quantity: number
  vendor: string | null
  source: 'purchase' | 'stock'
  orderByDate: string | null
  dueDate: string | null
  dateOrdered: string | null
  dateReceived: string | null
  status: string | null
  notes?: string | null
  state: BuyingLineState
  /** No order-by and no needed-by date, so nothing can be planned around it. */
  missingDates: boolean
  daysUntilOrderBy: number | null
  daysUntilDue: number | null
}

export type BuyingListResponse = {
  generatedAt: string
  today: string
  counts: Partial<Record<BuyingLineState | 'missing_dates', number>>
  /** Cancelled, made in house, supplied by others, or taken from stock. */
  excludedCount: number
  /** Blank rows Monday creates on its own. Goes away with Monday. */
  mondayPlaceholderCount: number
  lines: BuyingLine[]
}

export function fetchBuyingList() {
  return apiRequest<BuyingListResponse>('/api/purchasing/buying-list')
}

export type PurchasingRequestInput = {
  itemName: string
  itemKey?: string | null
  description?: string | null
  /** Required. Even general shop spend has a QuickBooks project. */
  projectId: string
  projectNumber?: string | null
  projectName?: string | null
  quantity: number
  vendor?: string | null
  source?: 'purchase' | 'stock'
  orderByDate?: string | null
  dueDate?: string | null
  notes?: string | null
}

export function createPurchasingRequest(input: PurchasingRequestInput) {
  return apiRequest<{ request: { id: string } }>('/api/purchasing/requests', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updatePurchasingRequest(
  requestId: string,
  changes: Partial<PurchasingRequestInput> & {
    dateOrdered?: string | null
    dateReceived?: string | null
  },
) {
  return apiRequest<{ request: { id: string } }>(
    `/api/purchasing/requests/${encodeURIComponent(requestId)}`,
    { method: 'PATCH', body: JSON.stringify(changes) },
  )
}

export function deletePurchasingRequest(requestId: string) {
  return apiRequest<{ ok: boolean }>(
    `/api/purchasing/requests/${encodeURIComponent(requestId)}`,
    { method: 'DELETE' },
  )
}

// ---------------------------------------------------------------------------
// Purchase orders raised
// ---------------------------------------------------------------------------

export type PurchaseOrderLine = {
  lineId: string
  itemName: string
  description: string | null
  projectName: string | null
  quantity: number | null
  unitPrice: number | null
  amount: number
}

export type PurchaseOrderRecord = {
  id: string
  docNumber: string | null
  txnDate: string | null
  vendorId: string | null
  vendorName: string | null
  /** QuickBooks POStatus: Open until the order has been fully billed. */
  status: string | null
  totalAmount: number
  memo: string | null
  lineCount: number
  lines: PurchaseOrderLine[]
}

export type PurchaseOrdersResponse = {
  generatedAt: string
  truncated: boolean
  purchaseOrders: PurchaseOrderRecord[]
}

export function fetchPurchaseOrders() {
  return apiRequest<PurchaseOrdersResponse>('/api/purchasing/purchase-orders', undefined, {
    timeoutMs: 120000,
  })
}

/**
 * The document the vendor is sent, fetched from QuickBooks rather than redrawn.
 *
 * Read through apiFetch rather than opened as a plain URL, because the endpoint
 * needs the Firebase token and a new browser tab carries no headers.
 */
export async function fetchPurchaseOrderPdf(purchaseOrderId: string, docNumber: string | null) {
  const query = docNumber ? `?docNumber=${encodeURIComponent(docNumber)}` : ''
  const response = await apiFetch(
    `/api/purchasing/purchase-orders/${encodeURIComponent(purchaseOrderId)}/pdf${query}`,
  )
  const blob = await response.blob()

  if (!blob || blob.size === 0) {
    throw new Error('QuickBooks returned an empty purchase order file.')
  }

  return blob
}

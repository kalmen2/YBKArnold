import { apiRequest } from '../api-client'

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

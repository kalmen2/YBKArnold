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
  items: PurchasingItemSummary[]
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
  options: { search?: string; page?: number; pageSize?: number } = {},
) {
  const params = new URLSearchParams()
  if (options.search) params.set('search', options.search)
  if (options.page) params.set('page', String(options.page))
  if (options.pageSize) params.set('pageSize', String(options.pageSize))
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

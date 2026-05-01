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
  }
  vendors: PurchasingVendorBreakdown[]
  transactions: PurchasingTransaction[]
}

export function fetchPurchasingItems(options: { search?: string; limit?: number } = {}) {
  const params = new URLSearchParams()
  if (options.search) params.set('search', options.search)
  if (options.limit) params.set('limit', String(options.limit))
  const query = params.toString()
  return apiRequest<PurchasingItemsResponse>(
    query ? `/api/purchasing/items?${query}` : '/api/purchasing/items',
  )
}

export function fetchPurchasingItemDetail(itemKey: string) {
  return apiRequest<PurchasingItemDetailResponse>(
    `/api/purchasing/items/${encodeURIComponent(itemKey)}`,
  )
}

// Dealer linking backfill — temporary. Delete alongside DealerLinkingPage.tsx
// and functions/src/routes/dealer-linking-routes.mjs once the backfill is done.
import { apiRequest } from '../api-client'

export type DealerLinkingCandidate = {
  sourceId: string
  name: string
  city: string | null
  state: string | null
  isArchived: boolean
  score: number
  matchesShipToState: boolean
}

export type DealerLinkingOrder = {
  orderKey: string
  orderNumber: string
  orderName: string
  shipTo: string | null
  shipToState: string | null
  orderDate: string | null
  orderValue: number | null
  isPriorOwner: boolean
}

export type DealerLinkingGroup = {
  key: string
  label: string
  orderCount: number
  states: string[]
  quickBooksCodes: string[]
  confidence: number
  orders: DealerLinkingOrder[]
  candidates: DealerLinkingCandidate[]
}

export type DealerLinkingAccount = {
  sourceId: string
  name: string
  city: string | null
  state: string | null
  isArchived: boolean
}

export type DealerLinkingSnapshot = {
  generatedAt: string
  summary: {
    totalOrders: number
    linkedOrders: number
    skippedOrders: number
    unlinkedOrders: number
    groupCount: number
  }
  groups: DealerLinkingGroup[]
  accounts: DealerLinkingAccount[]
}

export type DealerLinkingApplyResult = {
  action: string
  matchedCount: number
  modifiedCount: number
  dealerName: string | null
}

export function fetchDealerLinking() {
  return apiRequest<DealerLinkingSnapshot>('/api/admin/dealer-linking')
}

export function applyDealerLinking(body: {
  action: 'link' | 'skip' | 'reset'
  orderKeys: string[]
  dealerSourceId?: string
}) {
  return apiRequest<DealerLinkingApplyResult>('/api/admin/dealer-linking/apply', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

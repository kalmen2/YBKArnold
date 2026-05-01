import { apiRequest } from '../api-client'

export type OrdersLedgerStatus = 'shipped' | 'not_shipped'

export type OrdersLedgerOrder = {
  orderKey: string
  orderNumber: string | null
  orderName: string | null
  orderNames: string[]
  status: OrdersLedgerStatus
  mondayStatusLabel: string | null
  progressPercent: number | null
  invoiceNumber: string | null
  poAmount: number | null
  dueDate: string | null
  effectiveDueDate: string | null
  shippedAt: string | null
  mondayUpdatedAt: string | null
  latestSourceBoardId: string | null
  latestSourceBoardName: string | null
  latestSourceBoardUrl: string | null
  mondayItemIds: string[]
  mondayItemUrls: string[]
  firstSeenAt: string | null
  lastSeenAt: string | null
  updatedAt: string | null
}

export type OrdersLedgerOverviewResponse = {
  generatedAt: string
  refreshed: boolean
  refreshSource: 'monday_live' | 'monday_stored' | null
  refreshWarning: string | null
  refreshSummary: {
    source?: 'monday_live' | 'monday_stored'
    refreshedAt: string
    orderTrackOrdersFetched: number
    shippedOrdersFetched: number
    storedOrdersFetched?: number
    mergedOrderCount: number
    insertedCount: number
    updatedCount: number
    statusChangedCount: number
  } | null
  filters: {
    search: string
    status: 'all' | OrdersLedgerStatus
    limit: number
  }
  counts: {
    total: number
    shipped: number
    notShipped: number
    visible: number
  }
  orders: OrdersLedgerOrder[]
}

type FetchOrdersLedgerOverviewOptions = {
  refresh?: boolean
  search?: string
  status?: 'all' | OrdersLedgerStatus
  limit?: number
}

function buildOrdersLedgerPath(options: FetchOrdersLedgerOverviewOptions) {
  const params = new URLSearchParams()

  if (options.refresh) {
    params.set('refresh', '1')
  }

  if (options.search) {
    params.set('search', options.search)
  }

  if (options.status && options.status !== 'all') {
    params.set('status', options.status)
  }

  if (Number.isFinite(options.limit)) {
    params.set('limit', String(options.limit))
  }

  const query = params.toString()

  return query
    ? `/api/orders-ledger/overview?${query}`
    : '/api/orders-ledger/overview'
}

export function fetchOrdersLedgerOverview(options: FetchOrdersLedgerOverviewOptions = {}) {
  return apiRequest<OrdersLedgerOverviewResponse>(
    buildOrdersLedgerPath(options),
    {},
    {
      timeoutMs: options.refresh ? 90_000 : undefined,
    },
  )
}

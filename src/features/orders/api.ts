import { apiRequest } from '../api-client'

export type OrdersOverviewOrder = {
  id: string
  mondayItemId: string
  jobNumber: string
  orderName: string | null
  poAmount: number | null
  progressPercent: number | null
  estimatedReadyAt: string | null
  statusLabel: string | null
  isShipped: boolean
  shippedAt: string | null
  movedToShippedAt: string | null
  mondayBoardId: string | null
  mondayBoardName: string | null
  mondayUpdatedAt: string | null
  mondayItemUrl: string | null
  dueDate: string | null
  shopDrawingCachedUrl: string | null
  shopDrawingUrl: string | null
  shopDrawingFileName: string | null
}

export type OrdersOverviewResponse = {
  generatedAt: string
  includeShipped: boolean
  refreshed: boolean
  counts: {
    total: number
    shipped: number
    visible: number
  }
  orders: OrdersOverviewOrder[]
}

type FetchOrdersOverviewOptions = {
  includeShipped?: boolean
  refresh?: boolean
}

function buildOrdersOverviewPath(options: FetchOrdersOverviewOptions) {
  const params = new URLSearchParams()

  if (options.refresh) {
    params.set('refresh', '1')
  }

  if (options.includeShipped) {
    params.set('includeShipped', '1')
  }

  const query = params.toString()

  if (!query) {
    return '/api/orders/overview'
  }

  return `/api/orders/overview?${query}`
}

export function fetchOrdersOverview(options: FetchOrdersOverviewOptions = {}) {
  return apiRequest<OrdersOverviewResponse>(buildOrdersOverviewPath(options))
}

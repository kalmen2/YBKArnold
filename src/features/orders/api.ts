import { apiRequest } from '../api-client'

export type OrdersOverviewOrder = {
  id: string
  mondayItemId: string
  jobNumber: string
  orderName: string | null
  poAmount: number | null
  invoiceNumber: string | null
  progressPercent: number | null
  mondayStatusLabel: string | null
  managerReadyPercent: number | null
  managerReadyDate: string | null
  managerReadyUpdatedAt: string | null
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

export type OrdersJobDetailEntry = {
  id: string
  workerId: string
  workerName: string
  stageId: string
  stageName: string | null
  date: string
  jobName: string
  hours: number
  overtimeHours: number
  payRate: number
  regularHours: number
  totalHours: number
  rate: number
  laborCost: number
  notes: string
  createdAt: string
}

export type OrdersJobDetailWorker = {
  workerId: string
  workerName: string
  totalRegularHours: number
  totalOvertimeHours: number
  totalHours: number
  totalLaborCost: number
}

export type OrdersManagerHistoryRow = {
  id: string | null
  date: string | null
  jobName: string | null
  readyPercent: number | null
  updatedAt: string | null
}

export type OrdersJobDetailsResponse = {
  generatedAt: string
  job: {
    mondayItemId: string | null
    jobNumber: string | null
    orderName: string | null
    mondayStatusLabel: string | null
    mondayItemUrl: string | null
    mondayBoardId: string | null
    mondayBoardName: string | null
    mondayUpdatedAt: string | null
    latestManagerReadyPercent: number | null
    latestManagerReadyDate: string | null
    latestManagerReadyUpdatedAt: string | null
  }
  summary: {
    entryCount: number
    workerCount: number
    totalRegularHours: number
    totalOvertimeHours: number
    totalHours: number
    totalLaborCost: number
  }
  workers: OrdersJobDetailWorker[]
  entries: OrdersJobDetailEntry[]
  managerHistory: OrdersManagerHistoryRow[]
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
  return apiRequest<OrdersOverviewResponse>(
    buildOrdersOverviewPath(options),
    {},
    {
      // Forced refresh hits Monday + persistence and can occasionally stall.
      timeoutMs: options.refresh ? 60_000 : undefined,
    },
  )
}

type FetchOrdersJobDetailsOptions = {
  mondayItemId?: string | null
  jobNumber?: string | null
  orderName?: string | null
}

function buildOrdersJobDetailsPath(options: FetchOrdersJobDetailsOptions) {
  const params = new URLSearchParams()

  const mondayItemId = String(options.mondayItemId ?? '').trim()
  const jobNumber = String(options.jobNumber ?? '').trim()
  const orderName = String(options.orderName ?? '').trim()

  if (mondayItemId) {
    params.set('mondayItemId', mondayItemId)
  }

  if (jobNumber) {
    params.set('jobNumber', jobNumber)
  }

  if (orderName) {
    params.set('orderName', orderName)
  }

  const query = params.toString()

  return query
    ? `/api/orders/job-details?${query}`
    : '/api/orders/job-details'
}

export function fetchOrdersJobDetails(options: FetchOrdersJobDetailsOptions) {
  return apiRequest<OrdersJobDetailsResponse>(buildOrdersJobDetailsPath(options))
}

import { apiRequest } from '../api-client'

export type OrdersStatusHistoryRow = {
  id: string | null
  date: string | null
  jobName: string | null
  readyPercent: number | null
  updatedAt: string | null
}

export type OrdersProgressStatusDetail = {
  key: string | null
  label: string | null
  weight: number
  columnId: string | null
  status: string | null
  options: string[]
  optionStyles: Array<{
    label: string
    color: string | null
    border: string | null
    varName: string | null
  }>
}

export type OrdersMondayProgressDetailsOrder = {
  mondayItemId: string
  mondayStatus: string | null
  rowStatus: string
  progressPercent: number | null
  progressStatusDetails: OrdersProgressStatusDetail[]
  mondayUpdatedAt: string | null
}

export type OrdersMondayProgressDetailsResponse = {
  generatedAt: string
  order: OrdersMondayProgressDetailsOrder
}

export type OrdersMondayProgressStatusUpdateResponse = OrdersMondayProgressDetailsResponse & {
  ok: boolean
}

export type OrdersOverviewOrder = {
  id: string
  mondayItemId: string
  orderNumber: string
  jobNumber: string
  orderName: string | null
  shipTo: string | null
  shipNotes: string | null
  bol: string | null
  bolCachedUrl: string | null
  bolUrl: string | null
  poNumber: string | null
  notes: string | null
  description: string | null
  poAmount: number | null
  billedAmount: number | null
  invoiceAmount: number | null
  invoiceNumber: string | null
  paidInFull: boolean | null
  amountOwed: number | null
  billBalanceAmount: number | null
  totalHours: number | null
  totalLaborCost: number | null
  orderDate: string | null
  mondayStatus: string | null
  rowStatus: string
  managerReadyPercent: number | null
  managerReadyDate: string | null
  managerReadyUpdatedAt: string | null
  progressPercent: number | null
  progressStatusDetails: OrdersProgressStatusDetail[]
  leadTimeDays: number | null
  statusHistory: OrdersStatusHistoryRow[]
  isShipped: boolean
  shippedAt: string | null
  mondayBoardId: string | null
  mondayBoardName: string | null
  mondayUpdatedAt: string | null
  mondayItemUrl: string | null
  dueDate: string | null
  shopDrawingCachedUrl: string | null
  shopDrawingUrl: string | null
  cutListCachedUrl: string | null
  cutListUrl: string | null
  source: 'monday' | 'quickbooks' | 'merged'
  hasMondayRecord: boolean
  hasQuickBooksRecord: boolean
  inDesign: boolean
  quickBooksProjectId: string | null
  quickBooksProjectName: string | null
  quickBooksProjectIds: string[]
  quickBooksProjectNames: string[]
  hazardReason: string | null
}

export type OrdersOverviewResponse = {
  generatedAt: string
  lastRefreshedAt: string | null
  lastRefreshWarnings: string[]
  quickBooksSyncedAt: string | null
  counts: {
    total: number
    shipped: number
    nonShipped: number
    hazard: number
    mondayOnly: number
    quickBooksOnly: number
  }
  orders: OrdersOverviewOrder[]
}

export type OrdersRefreshSummary = {
  refreshedAt: string
  mergedOrderCount: number
  mondayOrderCount: number
  shippedBoardOrderCount: number
  preproductionCandidateCount: number
  preproductionMatchedCount: number
  preproductionBoardOrderCount: number
  preproductionBoardRefreshed: boolean
  quickBooksProjectCount: number
  carryoverCheckedCount: number
  carryoverMarkedShippedCount: number
  carryoverHazardCount: number
  quickBooksSyncedAt: string | null
  warnings: string[]
}

export type OrdersRefreshResponse = {
  ok: boolean
  summary: OrdersRefreshSummary
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

export type OrdersManagerHistoryRow = OrdersStatusHistoryRow

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

export function fetchOrdersOverview() {
  return apiRequest<OrdersOverviewResponse>('/api/orders/overview')
}

export function postOrdersRefresh() {
  return apiRequest<OrdersRefreshResponse>(
    '/api/orders/refresh',
    { method: 'POST' },
    { timeoutMs: 90_000 },
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

export function ordersJobDetailsQueryKey(options: FetchOrdersJobDetailsOptions) {
  return [
    'orders',
    'job-details',
    String(options.mondayItemId ?? '').trim(),
    String(options.jobNumber ?? '').trim(),
    String(options.orderName ?? '').trim(),
  ] as const
}

export function fetchOrdersMondayProgressDetails(mondayItemId: string) {
  const normalizedMondayItemId = String(mondayItemId ?? '').trim()

  if (!normalizedMondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  const params = new URLSearchParams({ mondayItemId: normalizedMondayItemId })

  return apiRequest<OrdersMondayProgressDetailsResponse>(
    `/api/orders/monday/progress-details?${params.toString()}`,
  )
}

type UpdateOrdersMondayProgressStatusInput = {
  mondayItemId: string
  columnId: string
  status: string
}

export function postOrdersMondayProgressStatusUpdate(input: UpdateOrdersMondayProgressStatusInput) {
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const columnId = String(input?.columnId ?? '').trim()
  const status = String(input?.status ?? '').trim()

  if (!mondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  if (!columnId) {
    throw new Error('columnId is required.')
  }

  if (!status) {
    throw new Error('status is required.')
  }

  return apiRequest<OrdersMondayProgressStatusUpdateResponse>(
    '/api/orders/monday/progress-status',
    {
      method: 'POST',
      body: JSON.stringify({ mondayItemId, columnId, status }),
    },
  )
}

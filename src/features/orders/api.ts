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
  // Set when Monday was unreachable: the edit is saved on the website and
  // queued to sync to Monday automatically.
  queued?: boolean
  warning?: string | null
}

export type OrdersMondayProgressStatusBulkUpdateFailedRow = {
  mondayItemId: string
  columnId: string
  status: string
  error: string
}

export type OrdersMondayProgressStatusBulkQueuedRow = {
  mondayItemId: string
  columnId: string
  status: string
}

export type OrdersMondayProgressStatusBulkUpdateResponse = {
  ok: boolean
  updatedCount: number
  queuedCount: number
  failedCount: number
  failedUpdates: OrdersMondayProgressStatusBulkUpdateFailedRow[]
  queuedUpdates: OrdersMondayProgressStatusBulkQueuedRow[]
  orders?: OrdersMondayProgressDetailsOrder[]
  warnings: string[]
}

export type OrdersOrderNumberUpdateResponse = {
  ok: boolean
  noChange?: boolean
  order: {
    mondayItemId: string
    orderNumber: string
    previousOrderNumber: string
    mondayUpdatedAt?: string | null
  }
  updatedVia?: 'monday_order_number_column' | 'monday_item_name'
  warning?: string | null
}

export type OrdersOrderNumberContactAdminResponse = {
  ok: boolean
  alert?: unknown
}

export type OrdersOrderDetailsUpdateResponse = {
  ok: boolean
  order: {
    mondayItemId: string
    orderName: string | null
    poNumber: string | null
    notes: string | null
    description: string | null
    orderDate: string | null
    dueDate: string | null
    leadTimeDays: number | null
    podDate: string | null
    mondayUpdatedAt: string | null
  }
  warning?: string | null
}

export type OrdersCreateResponse = {
  ok: boolean
  order: {
    orderKey: string
    mondayItemId: string
    orderNumber: string
    orderName: string | null
    mondayItemUrl: string | null
    poDate: string | null
    poNumber: string | null
    description: string | null
    shipTo: string | null
    notes: string | null
    salesRep: string | null
    orderValue: number | null
    freightValue: number | null
    mondayBoardId?: string | null
    mondayBoardName?: string | null
    mondayBoardYear?: number | null
    mondayUpdatedAt: string | null
  }
  warnings: string[]
}

export type OrdersCreateBoardOption = {
  id: string
  name: string
  year: number
  isDefault: boolean
  url: string | null
}

export type OrdersCreateBoardsResponse = {
  ok: boolean
  defaultYear: number
  defaultBoardId: string
  boards: OrdersCreateBoardOption[]
}

export type OrdersCreateBoardColumn = {
  id: string
  title: string | null
  type: string | null
}

export type OrdersCreateBoardColumnsResponse = {
  ok: boolean
  board: {
    id: string
    name: string
    year: number
    isDefault: boolean
    url: string | null
  }
  columns: OrdersCreateBoardColumn[]
}

export type OrdersDeleteResponse = {
  ok: boolean
  deleted: {
    orderKey: string | null
    orderNumber: string | null
    orderName: string | null
    mondayItemId: string | null
    mondayDeleteMode: string | null
  }
  warning?: string | null
  warnings?: string[]
}

export type OrdersDeleteRequestResponse = {
  ok: boolean
  alert?: unknown
}

export type OrdersShopDrawingManageResponse = {
  ok: boolean
  document?: {
    fileName: string
    mimeType: string
    url: string
    uploadedAt: string
  }
  order: {
    mondayItemId: string
    orderNumber: string | null
    shopDrawingCachedUrl: string | null
    shopDrawingUrl: string | null
    mondayUpdatedAt: string | null
  }
  warning?: string | null
}

export type OrdersCutListManageResponse = {
  ok: boolean
  document?: {
    fileName: string
    mimeType: string
    url: string
    uploadedAt: string
  }
  order: {
    mondayItemId: string
    orderNumber: string | null
    cutListCachedUrl: string | null
    cutListUrl: string | null
    mondayUpdatedAt: string | null
  }
  warning?: string | null
}

export type OrdersWarrantyManageResponse = {
  ok: boolean
  order: {
    mondayItemId: string
    orderNumber: string | null
    isShipped: boolean
    warrantyIssueActive: boolean
    warrantyIssueDescription: string | null
    warrantyIssueReportedAt: string | null
    warrantyIssueLeadTimeDate: string | null
    warrantyIssueDoneAt: string | null
    warrantyLastCompletedDescription: string | null
    warrantyLastCompletedReportedAt: string | null
    warrantyLastCompletedLeadTimeDate: string | null
    warrantyLastCompletedDoneAt: string | null
    warrantyLastCompletedDurationDays: number | null
    warrantyLastCompletedLeadTimeVarianceDays: number | null
  }
}

export type OrdersShippingDocumentType = 'signed_bol' | 'inspection_sheet'

export type OrdersShippingDocumentUploadResponse = {
  ok: boolean
  document: {
    type: OrdersShippingDocumentType
    label: string
    fileName: string
    mimeType: string
    url: string
    uploadedAt: string
  }
  order: {
    orderKey: string | null
    mondayItemId: string | null
    orderNumber: string | null
    isShipped: boolean
    signedBol: string | null
    signedBolUrl: string | null
    inspectionSheet: string | null
    inspectionSheetUrl: string | null
  }
}

export type OrdersShippingDocumentDeleteResponse = {
  ok: boolean
  document: {
    type: OrdersShippingDocumentType
    label: string
    deletedAt: string
  }
  order: {
    orderKey: string | null
    mondayItemId: string | null
    orderNumber: string | null
    isShipped: boolean
    signedBol: string | null
    signedBolUrl: string | null
    inspectionSheet: string | null
    inspectionSheetUrl: string | null
  }
}

export type OrdersShipResponse = {
  ok: boolean
  move: {
    itemId: string
    sourceBoardId: string | null
    sourceBoardName: string | null
    targetBoardId: string | null
    targetBoardName: string | null
    targetGroupId: string | null
    targetGroupTitle: string | null
    mappingMode: 'explicit' | 'best_match_fallback' | string
    mappedColumnCount: number
    totalSourceColumnCount: number
  }
  order: {
    orderKey: string | null
    mondayItemId: string
    orderNumber: string | null
    isShipped: boolean
    shippedAt: string | null
    mondayStatus: string | null
    mondayBoardId: string | null
    mondayBoardName: string | null
  }
}

export type OrdersChatMessage = {
  id: string
  orderId: string
  orderNumber: string | null
  mondayItemId: string | null
  orderName: string | null
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

export type OrdersChatsResponse = {
  messages: OrdersChatMessage[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

export type OrdersChatUser = {
  uid: string
  email: string
  displayName: string | null
  isAdmin: boolean
  isSalesRep: boolean
  hasWebAccess: boolean
  hasAppAccess: boolean
  lastActivityAt: string | null
}

export type OrdersChatUsersResponse = {
  users: OrdersChatUser[]
}

export type OrdersChatMessageCreateInput = {
  message: string
  orderNumber?: string | null
  mondayItemId?: string | null
  orderName?: string | null
  mentionUserUids?: string[]
  reminder?: {
    dueDate: string
    note?: string | null
    targetUserUids?: string[]
  } | null
}

export type OrdersOverviewOrder = {
  id: string
  canonicalOrderId: string | null
  sourceQuoteId: string | null
  sourceQuoteNumber: string | null
  sourceQuoteTitle: string | null
  quoteCreatedAt: string | null
  quoteSentAt: string | null
  quoteViewedAt: string | null
  quoteAcceptedAt: string | null
  convertedAt: string | null
  convertedByEmail: string | null
  dealerSourceId: string | null
  dealerName: string | null
  mondayItemId: string
  orderNumber: string
  jobNumber: string
  orderName: string | null
  shipTo: string | null
  shipNotes: string | null
  bol: string | null
  bolCachedUrl: string | null
  bolUrl: string | null
  signedBol: string | null
  signedBolUrl: string | null
  inspectionSheet: string | null
  inspectionSheetUrl: string | null
  poNumber: string | null
  notes: string | null
  description: string | null
  poAmount: number | null
  billedAmount: number | null
  invoiceAmount: number | null
  invoiceNumber: string | null
  invoiceCachedUrl: string | null
  invoiceFileName: string | null
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
  shippedAtInferred: boolean | null
  warrantyIssueActive: boolean
  warrantyIssueDescription: string | null
  warrantyIssueReportedAt: string | null
  warrantyIssueLeadTimeDate: string | null
  warrantyIssueDoneAt: string | null
  warrantyLastCompletedDescription: string | null
  warrantyLastCompletedReportedAt: string | null
  warrantyLastCompletedLeadTimeDate: string | null
  warrantyLastCompletedDoneAt: string | null
  warrantyLastCompletedDurationDays: number | null
  warrantyLastCompletedLeadTimeVarianceDays: number | null
  mondayBoardId: string | null
  mondayBoardName: string | null
  mondayUpdatedAt: string | null
  mondayItemUrl: string | null
  dueDate: string | null
  shopDrawingCachedUrl: string | null
  shopDrawingUrl: string | null
  cutListCachedUrl: string | null
  cutListUrl: string | null
  source: 'monday' | 'quickbooks' | 'merged' | 'website'
  hasMondayRecord: boolean
  hasQuickBooksRecord: boolean
  inDesign: boolean
  quickBooksProjectId: string | null
  quickBooksProjectName: string | null
  quickBooksProjectIds: string[]
  quickBooksProjectNames: string[]
  hazardReason: string | null
  parentOrderNumber: string | null
  familyRollup?: OrdersFamilyRollup | null
}

// Present on a main order that has linked sub-orders: the combined money and
// labor view of the whole order family (main + sub-orders).
export type OrdersFamilyRollup = {
  orderNumbers: string[]
  subOrderCount: number
  totalHours: number | null
  totalLaborCost: number | null
  poAmount: number | null
  billedAmount: number | null
  invoiceAmount: number | null
  amountOwed: number | null
  billBalanceAmount: number | null
}

export type OrdersSubOrderLinkResponse = {
  ok: boolean
  orderNumber: string | null
  parentOrderNumber: string | null
}

export function postOrdersSubOrderLink(input: {
  orderKey?: string | null
  mondayItemId?: string | null
  orderNumber?: string | null
  parentOrderNumber: string | null
}) {
  return apiRequest<OrdersSubOrderLinkResponse>('/api/orders/suborder-link', {
    method: 'POST',
    body: JSON.stringify(input),
  })
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
  orderTrackOrderCount: number
  designBoardCandidateCount: number
  designBoardMatchedCount: number
  quickBooksProjectCount: number
  carryoverCheckedCount: number
  carryoverMarkedShippedCount: number
  carryoverHazardCount: number
  shippedLookupCandidateCount: number
  quickBooksOnlyShippedCheckedCount: number
  quickBooksOnlyMarkedShippedCount: number
  shippedDetailEnrichedCount: number
  mondayMovedToShippedOutsideWebsiteCount: number
  mondayMovedToShippedOutsideWebsiteOrders: Array<{
    orderKey: string | null
    orderNumber: string | null
    orderName: string | null
    mondayItemId: string | null
    mondayItemUrl: string | null
    shippedAt: string | null
  }>
  shippedProgressTrackedOrderCount: number
  shippedProgressUpsertedCount: number
  shippedProgressCorrectedCount: number
  staleQuickBooksDeletedCount: number
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
  status?: string | null
}

type BulkUpdateOrdersMondayProgressStatusInput = {
  updates: Array<{
    mondayItemId: string
    columnId: string
    status?: string | null
  }>
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

  return apiRequest<OrdersMondayProgressStatusUpdateResponse>(
    '/api/orders/monday/progress-status',
    {
      method: 'POST',
      body: JSON.stringify({ mondayItemId, columnId, status }),
    },
  )
}

export function postOrdersMondayProgressStatusBulkUpdate(
  input: BulkUpdateOrdersMondayProgressStatusInput,
) {
  const updates = Array.isArray(input?.updates)
    ? input.updates
      .map((entry) => ({
        mondayItemId: String(entry?.mondayItemId ?? '').trim(),
        columnId: String(entry?.columnId ?? '').trim(),
        status: String(entry?.status ?? '').trim(),
      }))
      .filter((entry) => entry.mondayItemId && entry.columnId)
    : []

  if (updates.length === 0) {
    throw new Error('updates is required.')
  }

  return apiRequest<OrdersMondayProgressStatusBulkUpdateResponse>(
    '/api/orders/monday/progress-status/bulk',
    {
      method: 'POST',
      body: JSON.stringify({ updates }),
    },
    { timeoutMs: 120_000 },
  )
}

type UpdateOrdersOrderNumberInput = {
  mondayItemId: string
  orderNumber: string
  currentOrderNumber?: string | null
}

export function postOrdersOrderNumberUpdate(input: UpdateOrdersOrderNumberInput) {
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const orderNumber = String(input?.orderNumber ?? '').trim()
  const currentOrderNumber = String(input?.currentOrderNumber ?? '').trim()

  if (!mondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  if (!orderNumber) {
    throw new Error('orderNumber is required.')
  }

  return apiRequest<OrdersOrderNumberUpdateResponse>(
    '/api/orders/monday/order-number',
    {
      method: 'POST',
      body: JSON.stringify({
        mondayItemId,
        orderNumber,
        currentOrderNumber: currentOrderNumber || undefined,
      }),
    },
  )
}

type ContactAdminForOrderNumberInput = {
  mondayItemId: string
  requestedOrderNumber: string
  currentOrderNumber?: string | null
}

export function postOrdersOrderNumberContactAdmin(input: ContactAdminForOrderNumberInput) {
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const requestedOrderNumber = String(input?.requestedOrderNumber ?? '').trim()
  const currentOrderNumber = String(input?.currentOrderNumber ?? '').trim()

  if (!mondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  if (!requestedOrderNumber) {
    throw new Error('requestedOrderNumber is required.')
  }

  return apiRequest<OrdersOrderNumberContactAdminResponse>(
    '/api/orders/monday/order-number/contact-admin',
    {
      method: 'POST',
      body: JSON.stringify({
        mondayItemId,
        requestedOrderNumber,
        currentOrderNumber: currentOrderNumber || undefined,
      }),
    },
  )
}

type UpdateOrdersOrderDetailsInput = {
  mondayItemId: string
  orderName?: string | null
  poNumber?: string | null
  notes?: string | null
  description?: string | null
  orderDate?: string | null
  dueDate?: string | null
  leadTimeDays?: number | string | null
  podDate?: string | null
}

export function postOrdersOrderDetailsUpdate(input: UpdateOrdersOrderDetailsInput) {
  const mondayItemId = String(input?.mondayItemId ?? '').trim()

  if (!mondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  const payload: Record<string, unknown> = {
    mondayItemId,
  }

  if (Object.prototype.hasOwnProperty.call(input, 'orderName')) {
    payload.orderName = input.orderName ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'poNumber')) {
    payload.poNumber = input.poNumber ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'notes')) {
    payload.notes = input.notes ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'description')) {
    payload.description = input.description ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'orderDate')) {
    payload.orderDate = input.orderDate ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'dueDate')) {
    payload.dueDate = input.dueDate ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'leadTimeDays')) {
    const value = input.leadTimeDays
    payload.leadTimeDays = value === null || value === undefined ? '' : value
  }

  if (Object.prototype.hasOwnProperty.call(input, 'podDate')) {
    payload.podDate = input.podDate ?? ''
  }

  return apiRequest<OrdersOrderDetailsUpdateResponse>(
    '/api/orders/monday/order-details',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

type CreateOrdersManualInput = {
  name: string
  acknowledgementNumber: string
  boardId?: string | null
  salesRep?: string | null
  orderValue?: number | string | null
  freightValue?: number | string | null
  poDate?: string | null
  poNumber?: string | null
  description?: string | null
  shipTo?: string | null
  notes?: string | null
}

export function postOrdersCreate(input: CreateOrdersManualInput) {
  const name = String(input?.name ?? '').trim()
  const acknowledgementNumber = String(input?.acknowledgementNumber ?? '').trim()

  if (!name) {
    throw new Error('name is required.')
  }

  if (!acknowledgementNumber) {
    throw new Error('acknowledgementNumber is required.')
  }

  const payload: Record<string, unknown> = {
    name,
    acknowledgementNumber,
  }

  if (Object.prototype.hasOwnProperty.call(input, 'boardId')) {
    payload.boardId = input.boardId ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'salesRep')) {
    payload.salesRep = input.salesRep ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'orderValue')) {
    payload.orderValue = input.orderValue ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'freightValue')) {
    payload.freightValue = input.freightValue ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'poDate')) {
    payload.poDate = input.poDate ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'poNumber')) {
    payload.poNumber = input.poNumber ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'description')) {
    payload.description = input.description ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'shipTo')) {
    payload.shipTo = input.shipTo ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(input, 'notes')) {
    payload.notes = input.notes ?? ''
  }

  return apiRequest<OrdersCreateResponse>(
    '/api/orders/create',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

export function getOrdersCreateBoards(options: { refresh?: boolean } = {}) {
  const shouldRefresh = options.refresh === true
  const query = shouldRefresh
    ? '?refresh=1'
    : ''

  return apiRequest<OrdersCreateBoardsResponse>(
    `/api/orders/create/boards${query}`,
    {
      method: 'GET',
    },
  )
}

export function getOrdersCreateBoardColumns(boardId?: string | null) {
  const normalizedBoardId = String(boardId ?? '').trim()
  const query = normalizedBoardId
    ? `?boardId=${encodeURIComponent(normalizedBoardId)}`
    : ''

  return apiRequest<OrdersCreateBoardColumnsResponse>(
    `/api/orders/create/board-columns${query}`,
    {
      method: 'GET',
    },
  )
}

type DeleteOrdersInput = {
  orderKey?: string | null
  mondayItemId?: string | null
  orderNumber?: string | null
}

export function postOrdersDelete(input: DeleteOrdersInput) {
  const orderKey = String(input?.orderKey ?? '').trim()
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const orderNumber = String(input?.orderNumber ?? '').trim()

  if (!orderKey && !mondayItemId && !orderNumber) {
    throw new Error('orderKey, mondayItemId, or orderNumber is required.')
  }

  return apiRequest<OrdersDeleteResponse>(
    '/api/orders/delete',
    {
      method: 'POST',
      body: JSON.stringify({
        orderKey: orderKey || undefined,
        mondayItemId: mondayItemId || undefined,
        orderNumber: orderNumber || undefined,
      }),
    },
  )
}

type DeleteOrdersRequestInput = DeleteOrdersInput & {
  reason?: string | null
}

export function postOrdersDeleteRequest(input: DeleteOrdersRequestInput) {
  const orderKey = String(input?.orderKey ?? '').trim()
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const orderNumber = String(input?.orderNumber ?? '').trim()
  const reason = String(input?.reason ?? '').trim()

  if (!orderKey && !mondayItemId && !orderNumber) {
    throw new Error('orderKey, mondayItemId, or orderNumber is required.')
  }

  return apiRequest<OrdersDeleteRequestResponse>(
    '/api/orders/delete-request',
    {
      method: 'POST',
      body: JSON.stringify({
        orderKey: orderKey || undefined,
        mondayItemId: mondayItemId || undefined,
        orderNumber: orderNumber || undefined,
        reason: reason || undefined,
      }),
    },
  )
}

type UploadOrdersShopDrawingInput = {
  mondayItemId: string
  fileName: string
  mimeType: string
  fileBase64: string
}

export function postOrdersShopDrawingUpload(input: UploadOrdersShopDrawingInput) {
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const fileName = String(input?.fileName ?? '').trim()
  const mimeType = String(input?.mimeType ?? '').trim().toLowerCase()
  const fileBase64 = String(input?.fileBase64 ?? '').trim()

  if (!mondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  if (!fileName) {
    throw new Error('fileName is required.')
  }

  if (!mimeType) {
    throw new Error('mimeType is required.')
  }

  if (!fileBase64) {
    throw new Error('fileBase64 is required.')
  }

  return apiRequest<OrdersShopDrawingManageResponse>(
    '/api/orders/monday/shop-drawing/upload',
    {
      method: 'POST',
      body: JSON.stringify({
        mondayItemId,
        fileName,
        mimeType,
        fileBase64,
      }),
    },
    { timeoutMs: 90_000 },
  )
}

export function postOrdersShopDrawingDelete(input: { mondayItemId: string }) {
  const mondayItemId = String(input?.mondayItemId ?? '').trim()

  if (!mondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  return apiRequest<OrdersShopDrawingManageResponse>(
    '/api/orders/monday/shop-drawing/delete',
    {
      method: 'POST',
      body: JSON.stringify({ mondayItemId }),
    },
  )
}

type UploadOrdersCutListInput = {
  mondayItemId: string
  fileName: string
  mimeType: string
  fileBase64: string
}

export function postOrdersCutListUpload(input: UploadOrdersCutListInput) {
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const fileName = String(input?.fileName ?? '').trim()
  const mimeType = String(input?.mimeType ?? '').trim().toLowerCase()
  const fileBase64 = String(input?.fileBase64 ?? '').trim()

  if (!mondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  if (!fileName) {
    throw new Error('fileName is required.')
  }

  if (!mimeType) {
    throw new Error('mimeType is required.')
  }

  if (!fileBase64) {
    throw new Error('fileBase64 is required.')
  }

  return apiRequest<OrdersCutListManageResponse>(
    '/api/orders/monday/cut-list/upload',
    {
      method: 'POST',
      body: JSON.stringify({
        mondayItemId,
        fileName,
        mimeType,
        fileBase64,
      }),
    },
    { timeoutMs: 90_000 },
  )
}

export function postOrdersCutListDelete(input: { mondayItemId: string }) {
  const mondayItemId = String(input?.mondayItemId ?? '').trim()

  if (!mondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  return apiRequest<OrdersCutListManageResponse>(
    '/api/orders/monday/cut-list/delete',
    {
      method: 'POST',
      body: JSON.stringify({ mondayItemId }),
    },
  )
}

type CreateOrdersWarrantyIssueInput = {
  mondayItemId: string
  description: string
  reportedDate?: string | null
}

export function postOrdersWarrantyIssueCreate(input: CreateOrdersWarrantyIssueInput) {
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const description = String(input?.description ?? '').trim()
  const reportedDate = String(input?.reportedDate ?? '').trim()

  if (!mondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  if (!description) {
    throw new Error('description is required.')
  }

  return apiRequest<OrdersWarrantyManageResponse>(
    '/api/orders/warranty/issue',
    {
      method: 'POST',
      body: JSON.stringify({
        mondayItemId,
        description,
        reportedDate: reportedDate || undefined,
      }),
    },
  )
}

type UpdateOrdersWarrantyLeadTimeInput = {
  mondayItemId: string
  leadTimeDate?: string | null
}

export function postOrdersWarrantyLeadTimeUpdate(input: UpdateOrdersWarrantyLeadTimeInput) {
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const leadTimeDate = String(input?.leadTimeDate ?? '').trim()

  if (!mondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  return apiRequest<OrdersWarrantyManageResponse>(
    '/api/orders/warranty/lead-time',
    {
      method: 'POST',
      body: JSON.stringify({
        mondayItemId,
        leadTimeDate,
      }),
    },
  )
}

type MarkOrdersWarrantyDoneInput = {
  mondayItemId: string
  doneDate?: string | null
}

export function postOrdersWarrantyMarkDone(input: MarkOrdersWarrantyDoneInput) {
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const doneDate = String(input?.doneDate ?? '').trim()

  if (!mondayItemId) {
    throw new Error('mondayItemId is required.')
  }

  return apiRequest<OrdersWarrantyManageResponse>(
    '/api/orders/warranty/done',
    {
      method: 'POST',
      body: JSON.stringify({
        mondayItemId,
        doneDate: doneDate || undefined,
      }),
    },
  )
}

type UploadOrdersShippingDocumentInput = {
  documentType: OrdersShippingDocumentType
  fileName: string
  mimeType: string
  fileBase64: string
  orderKey?: string | null
  mondayItemId?: string | null
  orderNumber?: string | null
}

export function postOrdersShippingDocumentUpload(input: UploadOrdersShippingDocumentInput) {
  const orderKey = String(input?.orderKey ?? '').trim()
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const orderNumber = String(input?.orderNumber ?? '').trim()
  const documentType = String(input?.documentType ?? '').trim().toLowerCase()
  const fileName = String(input?.fileName ?? '').trim()
  const mimeType = String(input?.mimeType ?? '').trim().toLowerCase()
  const fileBase64 = String(input?.fileBase64 ?? '').trim()

  if (!orderKey && !mondayItemId && !orderNumber) {
    throw new Error('orderKey, mondayItemId, or orderNumber is required.')
  }

  if (documentType !== 'signed_bol' && documentType !== 'inspection_sheet') {
    throw new Error('documentType must be signed_bol or inspection_sheet.')
  }

  if (!fileName) {
    throw new Error('fileName is required.')
  }

  if (!mimeType) {
    throw new Error('mimeType is required.')
  }

  if (!fileBase64) {
    throw new Error('fileBase64 is required.')
  }

  return apiRequest<OrdersShippingDocumentUploadResponse>(
    '/api/orders/documents/upload',
    {
      method: 'POST',
      body: JSON.stringify({
        orderKey: orderKey || undefined,
        mondayItemId: mondayItemId || undefined,
        orderNumber: orderNumber || undefined,
        documentType,
        fileName,
        mimeType,
        fileBase64,
      }),
    },
    { timeoutMs: 90_000 },
  )
}

type DeleteOrdersShippingDocumentInput = {
  documentType: OrdersShippingDocumentType
  orderKey?: string | null
  mondayItemId?: string | null
  orderNumber?: string | null
}

export function postOrdersShippingDocumentDelete(input: DeleteOrdersShippingDocumentInput) {
  const orderKey = String(input?.orderKey ?? '').trim()
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const orderNumber = String(input?.orderNumber ?? '').trim()
  const documentType = String(input?.documentType ?? '').trim().toLowerCase()

  if (!orderKey && !mondayItemId && !orderNumber) {
    throw new Error('orderKey, mondayItemId, or orderNumber is required.')
  }

  if (documentType !== 'signed_bol' && documentType !== 'inspection_sheet') {
    throw new Error('documentType must be signed_bol or inspection_sheet.')
  }

  return apiRequest<OrdersShippingDocumentDeleteResponse>(
    '/api/orders/documents/delete',
    {
      method: 'POST',
      body: JSON.stringify({
        orderKey: orderKey || undefined,
        mondayItemId: mondayItemId || undefined,
        orderNumber: orderNumber || undefined,
        documentType,
      }),
    },
    { timeoutMs: 90_000 },
  )
}

type PostOrdersShipInput = {
  orderKey?: string | null
  mondayItemId?: string | null
  orderNumber?: string | null
}

export function postOrdersShip(input: PostOrdersShipInput) {
  const orderKey = String(input?.orderKey ?? '').trim()
  const mondayItemId = String(input?.mondayItemId ?? '').trim()
  const orderNumber = String(input?.orderNumber ?? '').trim()

  if (!orderKey && !mondayItemId && !orderNumber) {
    throw new Error('orderKey, mondayItemId, or orderNumber is required.')
  }

  return apiRequest<OrdersShipResponse>(
    '/api/orders/ship',
    {
      method: 'POST',
      body: JSON.stringify({
        orderKey: orderKey || undefined,
        mondayItemId: mondayItemId || undefined,
        orderNumber: orderNumber || undefined,
      }),
    },
    { timeoutMs: 90_000 },
  )
}

function normalizeRequiredOrderChatId(orderId: string) {
  const normalizedOrderId = String(orderId ?? '').trim()

  if (!normalizedOrderId) {
    throw new Error('orderId is required.')
  }

  return normalizedOrderId
}

export function ordersChatMessagesQueryKey(orderId: string) {
  return ['orders', 'chat', normalizeRequiredOrderChatId(orderId)] as const
}

export function fetchOrdersChatUsers() {
  return apiRequest<OrdersChatUsersResponse>('/api/orders/chat-users')
}

export function fetchOrderChats(
  orderId: string,
  options: { limit?: number; offset?: number } = {},
) {
  const normalizedOrderId = normalizeRequiredOrderChatId(orderId)

  const params = new URLSearchParams({
    limit: String(options.limit ?? 200),
    offset: String(options.offset ?? 0),
  })

  return apiRequest<OrdersChatsResponse>(
    `/api/orders/${encodeURIComponent(normalizedOrderId)}/chats?${params.toString()}`,
  )
}

export function createOrderChatMessage(
  orderId: string,
  input: string | OrdersChatMessageCreateInput,
) {
  const normalizedOrderId = normalizeRequiredOrderChatId(orderId)
  const payload = typeof input === 'string'
    ? { message: input }
    : input

  return apiRequest<{ message: OrdersChatMessage }>(
    `/api/orders/${encodeURIComponent(normalizedOrderId)}/chats`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

export function updateOrderChatMessage(orderId: string, messageId: string, message: string) {
  const normalizedOrderId = normalizeRequiredOrderChatId(orderId)
  const normalizedMessageId = String(messageId ?? '').trim()

  if (!normalizedMessageId) {
    throw new Error('messageId is required.')
  }

  return apiRequest<{ message: OrdersChatMessage }>(
    `/api/orders/${encodeURIComponent(normalizedOrderId)}/chats/${encodeURIComponent(normalizedMessageId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ message }),
    },
  )
}

export function removeOrderChatMessage(orderId: string, messageId: string) {
  const normalizedOrderId = normalizeRequiredOrderChatId(orderId)
  const normalizedMessageId = String(messageId ?? '').trim()

  if (!normalizedMessageId) {
    throw new Error('messageId is required.')
  }

  return apiRequest<{ ok: boolean; messageId: string }>(
    `/api/orders/${encodeURIComponent(normalizedOrderId)}/chats/${encodeURIComponent(normalizedMessageId)}`,
    {
      method: 'DELETE',
    },
  )
}

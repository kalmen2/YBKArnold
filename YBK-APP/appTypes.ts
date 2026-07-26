export type DashboardOrder = {
  id: string
  mondayItemId?: string | null
  orderNumber?: string | null
  poNumber?: string | null
  name: string
  mondaySourceBoardType?: 'orders_track' | 'shipped_orders'
  movedToShippedAt?: string | null
  groupTitle: string
  statusLabel: string
  stageLabel?: string
  readyLabel?: string
  leadTimeDays?: number | null
  progressPercent?: number | null
  orderDate?: string | null
  shippedAt?: string | null
  dueDate?: string | null
  computedDueDate?: string | null
  effectiveDueDate: string | null
  daysUntilDue: number | null
  isDone: boolean
  updatedAt?: string | null
  itemUrl?: string | null
  shopDrawingUrl?: string | null
  shopDrawingFileName?: string | null
  shopDrawingCachedUrl?: string | null
  invoiceNumber?: string | null
  paidInFull?: boolean | null
  amountOwed?: number | null
  poAmount?: number | null
}

export type MondayDashboardSnapshot = {
  generatedAt: string
  metrics: {
    activeOrders: number
    lateOrders: number
    missingDueDateOrders: number
  }
  details: {
    lateOrders: DashboardOrder[]
    activeOrders: DashboardOrder[]
    missingDueDateOrders: DashboardOrder[]
  }
  orders: DashboardOrder[]
}

export type ZendeskTicketSummarySnapshot = {
  generatedAt: string
  metrics: {
    newTickets: number
    inProgressTickets: number
    openTickets: number
    pendingTickets: number
    solvedTickets: number
  }
}

export type SupportTicket = {
  id: number | string
  subject: string
  orderNumber: string | null
  status: string
  statusLabel: string
  assigneeName: string
}

export type SupportTicketsSnapshot = {
  generatedAt: string
  tickets: SupportTicket[]
}

export type OrderPhoto = {
  path: string
  url: string
  createdAt: string
}

export type MobileTimesheetWorker = {
  id?: string
  workerNumber: string
  fullName: string
}

export type MobileTimesheetEntry = {
  id: string
  workerId?: string
  date: string
  jobName: string
  stageId?: string
  hours: number
  notes: string
}

export type MobileTimesheetStage = {
  id: string
  name: string
}

export type MobileAuthUser = {
  isApproved: boolean
  role: 'standard' | 'manager' | 'sales_rep' | 'shop_worker' | 'admin'
  isAdmin: boolean
  isManager: boolean
  isSalesRep?: boolean
  isShopWorker?: boolean
}

export type MobileManagerOrderProgress = {
  id: string
  date: string
  jobName: string
  readyPercent: number
  createdAt: string
  updatedAt: string
}

export type MobileAlertTargetMode = 'all' | 'selected'

export type MobileAlert = {
  id: string
  title: string
  message: string
  targetMode: MobileAlertTargetMode
  targetUserCount: number
  pushTokenCount: number
  pushAcceptedCount: number
  pushErrorCount: number
  createdAt: string | null
  createdByEmail: string | null
  isUpdate?: boolean
  isRead?: boolean
  readAt?: string | null
}

export type MobileChatUser = {
  uid: string
  email: string
  displayName: string | null
  isAdmin: boolean
  isManager: boolean
  isSalesRep: boolean
  hasWebAccess: boolean
  hasAppAccess: boolean
}

export type MobileChatAttachment = {
  kind: 'image' | 'voice'
  mimeType: string | null
  fileName: string | null
  sizeBytes: number | null
  dataUrl: string | null
  deletedAt: string | null
  deletedByUid: string | null
  deletedByEmail: string | null
} | null

export type MobileChatThread = {
  id: string
  type: 'direct' | 'group'
  name: string | null
  memberUids: string[]
  memberProfiles: MobileChatUser[]
  createdAt: string | null
  updatedAt: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  lastMessageType: 'text' | 'image' | 'voice' | 'mixed' | 'deleted'
  createdByUid: string | null
  createdByEmail: string | null
  createdByName: string | null
}

export type MobileChatMessage = {
  id: string
  chatId: string
  text: string | null
  messageType: 'text' | 'image' | 'voice' | 'mixed' | 'deleted'
  attachment: MobileChatAttachment
  createdAt: string | null
  createdByUid: string | null
  createdByEmail: string | null
  createdByName: string | null
  updatedAt: string | null
  updatedByUid: string | null
  updatedByEmail: string | null
  updatedByName: string | null
  deletedAt: string | null
  deletedByUid: string | null
  deletedByEmail: string | null
}

export type OrderJobDetailsSnapshot = {
  generatedAt: string
  order?: {
    id: string | null
    mondayItemId: string | null
    orderNumber: string | null
    jobNumber: string | null
    orderName: string | null
    poNumber: string | null
    shopDrawingCachedUrl: string | null
    shopDrawingUrl: string | null
    cutListCachedUrl: string | null
    cutListUrl: string | null
    mondayStatus: string | null
    leadTimeDays: number | null
    orderDate: string | null
    dueDate: string | null
    paidInFull: boolean | null
    amountOwed: number | null
    totalHours: number | null
    shippedAt: string | null
    shipTo: string | null
    shipNotes: string | null
    invoiceNumber: string | null
    bol?: string | null
    bolCachedUrl?: string | null
    bolUrl?: string | null
    notes?: string | null
    description?: string | null
    poAmount?: number | null
    billedAmount?: number | null
    invoiceAmount?: number | null
    billBalanceAmount?: number | null
    totalLaborCost?: number | null
    managerReadyPercent?: number | null
    managerReadyDate?: string | null
    managerReadyUpdatedAt?: string | null
    progressPercent?: number | null
    progressStatusDetails?: Array<{
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
    }>
    isShipped?: boolean
    shippedAtInferred?: boolean | null
    mondayBoardId?: string | null
    mondayBoardName?: string | null
    mondayUpdatedAt?: string | null
    mondayItemUrl?: string | null
    source?: string | null
    hasMondayRecord?: boolean
    hasQuickBooksRecord?: boolean
    inDesign?: boolean
    quickBooksProjectId?: string | null
    quickBooksProjectName?: string | null
    quickBooksProjectIds?: string[]
    quickBooksProjectNames?: string[]
    hazardReason?: string | null
    rowStatus: string | null
    statusHistory: Array<{
      id: string | null
      date: string | null
      jobName: string | null
      readyPercent: number | null
      updatedAt: string | null
    }>
  } | null
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
  workers: Array<{
    workerId: string
    workerName: string
    totalRegularHours: number
    totalOvertimeHours: number
    totalHours: number
    totalLaborCost: number
  }>
  entries: Array<{
    id: string
    workerId?: string
    stageId?: string
    date: string
    jobName: string
    notes: string
    workerName: string
    stageName: string | null
    regularHours: number
    overtimeHours: number
    totalHours: number
    laborCost: number
  }>
  managerHistory: Array<{
    id: string | null
    date: string | null
    jobName: string | null
    readyPercent: number | null
    updatedAt: string | null
  }>
}

export type MetricTone = {
  cardBackground: string
  borderColor: string
  labelColor: string
  valueColor: string
}

export type AppScreen = 'dashboard' | 'orders' | 'pictures' | 'timesheet' | 'manager' | 'alerts' | 'chat' | 'admin' | 'settings'
export type AppLanguage = 'en' | 'es' | 'he'

export type OrderMetricKey =
  | 'lateOrders'
  | 'dueThisWeekOrders'
  | 'dueInTwoWeeksOrders'
  | 'activeOrders'
  | 'missingDueDateOrders'

export type TicketMetricKey =
  | 'newTickets'
  | 'inProgressTickets'
  | 'openTickets'
  | 'pendingTickets'
  | 'solvedTickets'

export type DetailSelection =
  | {
      type: 'order'
      key: OrderMetricKey
      label: string
    }
  | {
      type: 'ticket'
      key: TicketMetricKey
      label: string
    }
  | null

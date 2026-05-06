export type DashboardOrder = {
  id: string
  name: string
  groupTitle: string
  statusLabel: string
  effectiveDueDate: string | null
  daysUntilDue: number | null
  isDone: boolean
  shopDrawingUrl?: string | null
  shopDrawingFileName?: string | null
  shopDrawingCachedUrl?: string | null
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
  role: 'standard' | 'manager' | 'admin'
  isAdmin: boolean
  isManager: boolean
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

export type MetricTone = {
  cardBackground: string
  borderColor: string
  labelColor: string
  valueColor: string
}

export type AppScreen = 'dashboard' | 'orders' | 'pictures' | 'timesheet' | 'manager' | 'alerts' | 'settings'
export type AppLanguage = 'en' | 'es'

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

export type DashboardBucket = {
  label: string
  count: number
}

export type DashboardOrder = {
  id: string
  name: string
  groupTitle: string
  statusLabel: string
  stageLabel: string
  readyLabel: string
  leadTimeDays: number | null
  progressPercent: number | null
  orderDate: string | null
  shippedAt: string | null
  dueDate: string | null
  computedDueDate: string | null
  effectiveDueDate: string | null
  daysUntilDue: number | null
  isDone: boolean
  isLate: boolean
  daysLate: number
  updatedAt: string | null
  itemUrl: string | null
}

export type MondayDashboardSnapshot = {
  board: {
    id: string
    name: string
    url: string | null
  }
  generatedAt: string
  metrics: {
    totalOrders: number
    activeOrders: number
    completedOrders: number
    lateOrders: number
    dueSoonOrders: number
    missingDueDateOrders: number
    averageLeadTimeDays: number | null
  }
  buckets: {
    byStatus: DashboardBucket[]
    byGroup: DashboardBucket[]
  }
  details: {
    lateOrders: DashboardOrder[]
    dueSoonOrders: DashboardOrder[]
    activeOrders: DashboardOrder[]
    completedOrders: DashboardOrder[]
    missingDueDateOrders: DashboardOrder[]
  }
  orders: DashboardOrder[]
  columnDetection: {
    statusColumnId: string | null
    readyColumnId: string | null
    shipDateColumnId: string | null
    leadTimeColumnId: string | null
    dueDateColumnId: string | null
    orderDateColumnId: string | null
    progressStatusColumns: Array<{
      key: string
      weight: number
      columnId: string | null
    }>
  }
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error ?? 'Request failed.')
  }

  return payload as T
}

export function fetchMondayDashboardSnapshot() {
  return request<MondayDashboardSnapshot>('/api/dashboard/monday')
}

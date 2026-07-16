import type { DashboardOrder } from './api'

export type DashboardOrderGroups = {
  lateOrders: DashboardOrder[]
  dueThisWeekOrders: DashboardOrder[]
  dueInTwoWeeksOrders: DashboardOrder[]
  readyOrders: DashboardOrder[]
  inProgressOrders: DashboardOrder[]
  missingDueDateOrders: DashboardOrder[]
}

function normalizeStatus(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function isReadyStatusLabel(status: string) {
  return status === 'ready'
    || status.startsWith('ready ')
    || status === 'ready to ship'
    || status === 'ready for shipping'
}

export function isReadyOrder(order: DashboardOrder) {
  if (order.isDone) {
    return false
  }

  const statuses = [
    normalizeStatus(order.rowStatus),
    normalizeStatus(order.statusLabel),
    normalizeStatus(order.stageLabel),
  ].filter((status) => Boolean(status))

  return statuses.some((status) => isReadyStatusLabel(status))
}

function isOpenProductionOrder(order: DashboardOrder) {
  return !order.isDone && order.isProductionStarted !== false
}

function isDueBetween(order: DashboardOrder, minimumDays: number, maximumDays: number) {
  return isOpenProductionOrder(order)
    && !isReadyOrder(order)
    && typeof order.daysUntilDue === 'number'
    && order.daysUntilDue >= minimumDays
    && order.daysUntilDue <= maximumDays
}

export function buildDashboardOrderGroups(orders: DashboardOrder[]): DashboardOrderGroups {
  return {
    lateOrders: orders.filter((order) => isOpenProductionOrder(order) && order.isLate),
    dueThisWeekOrders: orders.filter((order) => isDueBetween(order, 0, 7)),
    dueInTwoWeeksOrders: orders.filter((order) => isDueBetween(order, 8, 14)),
    readyOrders: orders.filter(isReadyOrder),
    inProgressOrders: orders.filter(
      (order) => isOpenProductionOrder(order) && !isReadyOrder(order),
    ),
    missingDueDateOrders: orders.filter(
      (order) => isOpenProductionOrder(order)
        && !isReadyOrder(order)
        && order.effectiveDueDate === null,
    ),
  }
}
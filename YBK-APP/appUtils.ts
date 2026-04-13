import type { DashboardOrder } from './appTypes'

function formatDateValue(
  value: string | null | undefined,
  locale: string,
  emptyEn: string,
  emptyEs: string,
  options: Intl.DateTimeFormatOptions,
) {
  const isSpanishLocale = locale.toLowerCase().startsWith('es')

  if (!value) {
    return isSpanishLocale ? emptyEs : emptyEn
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(locale, options).format(parsed)
}

export function formatSyncTimestamp(value: string | null | undefined, locale = 'en-US') {
  return formatDateValue(value, locale, 'Unknown', 'Desconocido', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDisplayDate(value: string | null | undefined, locale = 'en-US') {
  return formatDateValue(value, locale, 'Not set', 'Sin fecha', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateInput(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function normalizeTicketStatus(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

export function resolveDaysUntilDue(order: DashboardOrder) {
  if (typeof order.daysUntilDue === 'number' && Number.isFinite(order.daysUntilDue)) {
    return order.daysUntilDue
  }

  const rawDueDate = String(order.effectiveDueDate ?? '').trim()

  if (!rawDueDate) {
    return null
  }

  const parsedDueDate = new Date(rawDueDate)

  if (Number.isNaN(parsedDueDate.getTime())) {
    return null
  }

  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dueDateStart = new Date(
    parsedDueDate.getFullYear(),
    parsedDueDate.getMonth(),
    parsedDueDate.getDate(),
  )

  return Math.round((dueDateStart.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000))
}

export function isOpenOrderDueWithinRange(order: DashboardOrder, minDays: number, maxDays: number) {
  if (order.isDone) {
    return false
  }

  const daysUntilDue = resolveDaysUntilDue(order)

  return daysUntilDue !== null && daysUntilDue >= minDays && daysUntilDue <= maxDays
}

export function buildOrderBuckets(orders: DashboardOrder[]) {
  return {
    dueThisWeekOrders: orders.filter((order) => isOpenOrderDueWithinRange(order, 0, 7)),
    dueInTwoWeeksOrders: orders.filter((order) => isOpenOrderDueWithinRange(order, 8, 14)),
  }
}

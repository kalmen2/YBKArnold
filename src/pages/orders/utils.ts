import type { OrdersOverviewOrder } from '../../features/orders/api'

export function formatProgress(value: number | null) {
  if (!Number.isFinite(value)) {
    return '—'
  }

  return `${Math.max(0, Math.min(100, Math.round(Number(value))))}%`
}

export function resolveOrderProjectIds(order: OrdersOverviewOrder | null) {
  if (!order) {
    return []
  }

  const ids = Array.isArray(order.quickBooksProjectIds)
    ? order.quickBooksProjectIds.map((value) => String(value ?? '').trim()).filter(Boolean)
    : []
  const fallbackId = String(order.quickBooksProjectId ?? '').trim()

  return [...new Set(fallbackId ? [fallbackId, ...ids] : ids)]
}

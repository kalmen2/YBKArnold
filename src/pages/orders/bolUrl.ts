import type { OrdersOverviewOrder } from '../../features/orders/api'

function normalizeUrl(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return ''
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized
  }

  return ''
}

export function resolveBolUrl(
  order: Pick<OrdersOverviewOrder, 'bolCachedUrl' | 'bolUrl' | 'bol'> | null | undefined,
) {
  return (
    normalizeUrl(order?.bolCachedUrl)
    || normalizeUrl(order?.bolUrl)
    || normalizeUrl(order?.bol)
  )
}

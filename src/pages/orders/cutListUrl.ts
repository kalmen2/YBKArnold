import type { OrdersOverviewOrder } from '../../features/orders/api'

export function resolveCutListUrl(
  order: Pick<OrdersOverviewOrder, 'cutListCachedUrl' | 'cutListUrl'> | null | undefined,
) {
  return String(order?.cutListCachedUrl ?? '').trim() || String(order?.cutListUrl ?? '').trim()
}

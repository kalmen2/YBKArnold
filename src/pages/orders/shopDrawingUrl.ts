import type { OrdersOverviewOrder } from '../../features/orders/api'

export function resolveShopDrawingUrl(
  order: Pick<OrdersOverviewOrder, 'shopDrawingCachedUrl' | 'shopDrawingUrl'> | null | undefined,
) {
  return String(order?.shopDrawingCachedUrl ?? '').trim() || String(order?.shopDrawingUrl ?? '').trim()
}

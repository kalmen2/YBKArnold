import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import {
  fetchOrdersOverview,
  postOrdersRefresh,
  type OrdersOverviewOrder,
  type OrdersOverviewResponse,
  type OrdersRefreshResponse,
} from '../../features/orders/api'
import { useDebounceValue } from '../../hooks/useDebounceValue'
import { QUERY_KEYS } from '../../lib/queryKeys'

export type UseOrdersOverview = ReturnType<typeof useOrdersOverview>

function normalizeSearchValue(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function toSearchMoneyTokens(value: unknown) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return []
  }

  const fixed2 = parsed.toFixed(2)
  const localized = parsed.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return [
    String(parsed),
    fixed2,
    fixed2.replace(/,/g, ''),
    String(Math.round(parsed)),
    localized,
    localized.replace(/,/g, ''),
    `$${localized}`,
  ]
}

function buildOrderSearchTokens(order: OrdersOverviewOrder) {
  const textTokens = [
    order.orderNumber,
    order.jobNumber,
    order.orderName,
    order.invoiceNumber,
    order.rowStatus,
    order.mondayStatus,
    order.quickBooksProjectId,
    order.quickBooksProjectName,
    ...(Array.isArray(order.quickBooksProjectIds) ? order.quickBooksProjectIds : []),
    ...(Array.isArray(order.quickBooksProjectNames) ? order.quickBooksProjectNames : []),
    order.hazardReason,
    order.source,
    order.mondayBoardName,
    order.dueDate,
    order.orderDate,
    order.shippedAt,
    order.mondayItemId,
  ]
    .map(normalizeSearchValue)
    .filter(Boolean)

  const moneyTokens = [
    ...toSearchMoneyTokens(order.poAmount),
    ...toSearchMoneyTokens(order.billedAmount),
    ...toSearchMoneyTokens(order.billBalanceAmount),
    ...toSearchMoneyTokens(order.invoiceAmount),
    ...toSearchMoneyTokens(order.amountOwed),
    ...toSearchMoneyTokens(order.totalAmountOwed),
    ...toSearchMoneyTokens(order.totalHours),
    ...toSearchMoneyTokens(order.totalLaborCost),
    ...toSearchMoneyTokens(order.leadTimeDays),
    ...toSearchMoneyTokens(order.progressPercent),
  ]
    .map(normalizeSearchValue)
    .filter(Boolean)

  return [...textTokens, ...moneyTokens]
}

function orderMatchesSearch(order: OrdersOverviewOrder, searchText: string) {
  const normalizedSearch = normalizeSearchValue(searchText)

  if (!normalizedSearch) {
    return true
  }

  const tokens = buildOrderSearchTokens(order)

  return tokens.some((token) => token.includes(normalizedSearch))
}

export function useOrdersOverview() {
  const queryClient = useQueryClient()
  const [includeShipped, setIncludeShipped] = useState(false)
  const [searchText, setSearchText] = useState('')
  const debouncedSearchText = useDebounceValue(searchText, 220)

  const ordersQuery = useQuery<OrdersOverviewResponse>({
    queryKey: QUERY_KEYS.ordersOverview,
    queryFn: fetchOrdersOverview,
    staleTime: 60 * 1000,
  })

  const refreshMutation = useMutation<OrdersRefreshResponse>({
    mutationFn: postOrdersRefresh,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
    },
  })

  const data = ordersQuery.data
  const allOrders = useMemo(
    () => (Array.isArray(data?.orders) ? data.orders : []),
    [data],
  )

  const visibleOrders = useMemo(() => {
    const shippedFilteredOrders = includeShipped
      ? allOrders
      : allOrders.filter((order) => !order.isShipped)

    if (!debouncedSearchText) {
      return shippedFilteredOrders
    }

    return shippedFilteredOrders.filter((order) => orderMatchesSearch(order, debouncedSearchText))
  }, [allOrders, includeShipped, debouncedSearchText])

  const counts = useMemo(() => {
    const apiCounts = data?.counts
    return {
      total: apiCounts?.total ?? allOrders.length,
      shipped: apiCounts?.shipped ?? 0,
      nonShipped: apiCounts?.nonShipped ?? 0,
      hazard: apiCounts?.hazard ?? 0,
      mondayOnly: apiCounts?.mondayOnly ?? 0,
      quickBooksOnly: apiCounts?.quickBooksOnly ?? 0,
      visible: visibleOrders.length,
    }
  }, [allOrders.length, data, visibleOrders.length])

  const refresh = useCallback(() => refreshMutation.mutateAsync(), [refreshMutation])

  return {
    visibleOrders,
    counts,
    includeShipped,
    setIncludeShipped,
    searchText,
    setSearchText,
    isLoading: ordersQuery.isLoading,
    isFetching: ordersQuery.isFetching,
    isRefreshing: refreshMutation.isPending,
    queryError: ordersQuery.error instanceof Error ? ordersQuery.error.message : null,
    refreshError: refreshMutation.error instanceof Error ? refreshMutation.error.message : null,
    refreshWarnings: ordersQuery.data?.lastRefreshWarnings ?? [],
    lastRefreshedAt: ordersQuery.data?.lastRefreshedAt ?? null,
    quickBooksSyncedAt: ordersQuery.data?.quickBooksSyncedAt ?? null,
    generatedAt: ordersQuery.data?.generatedAt ?? null,
    refresh,
  }
}

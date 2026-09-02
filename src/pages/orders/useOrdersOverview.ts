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
export type OrdersListTab = 'all' | 'orders' | 'design' | 'waiting_production' | 'shipped' | 'archive'

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
    order.shipTo,
    order.shipNotes,
    order.bol,
    order.poNumber,
    order.notes,
    order.description,
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
    order.warrantyIssueDescription,
    order.warrantyIssueReportedAt,
    order.warrantyIssueLeadTimeDate,
    order.warrantyLastCompletedDescription,
    order.warrantyLastCompletedDoneAt,
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
  const [activeTab, setActiveTab] = useState<OrdersListTab>('orders')
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
    const tabFilteredOrders = allOrders.filter((order) => {
      if (activeTab === 'archive') {
        return order.isArchived === true
      }

      // "All" is the complete order history, including archived records.
      if (activeTab === 'all') {
        return true
      }

      if (order.isArchived === true) {
        return false
      }

      if (activeTab === 'shipped') {
        return order.isShipped
      }

      if (activeTab === 'design') {
        return !order.isShipped && order.inDesign && order.productionHandoffStatus !== 'waiting_for_production'
      }

      if (activeTab === 'waiting_production') {
        return !order.isShipped && order.inDesign && order.productionHandoffStatus === 'waiting_for_production'
      }

      return !order.isShipped && !order.inDesign
    })

    if (!debouncedSearchText) {
      return tabFilteredOrders
    }

    return tabFilteredOrders.filter((order) => orderMatchesSearch(order, debouncedSearchText))
  }, [allOrders, activeTab, debouncedSearchText])

  const tabCounts = useMemo(() => {
    let orders = 0
    let all = 0
    let design = 0
    let waitingProduction = 0
    let shipped = 0
    let archive = 0

    allOrders.forEach((order) => {
      all += 1

      if (order.isArchived === true) {
        archive += 1
        return
      }

      if (order.isShipped) {
        shipped += 1
        return
      }

      if (order.inDesign) {
        if (order.productionHandoffStatus === 'waiting_for_production') waitingProduction += 1
        else design += 1
        return
      }

      orders += 1
    })

    return {
      all,
      orders,
      design,
      waitingProduction,
      shipped,
      archive,
    }
  }, [allOrders])

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
    allOrders,
    visibleOrders,
    counts,
    activeTab,
    setActiveTab,
    tabCounts,
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

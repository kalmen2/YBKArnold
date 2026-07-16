import * as XLSX from 'xlsx'
import { useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Stack,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { apiFetch } from '../features/api-client'
import {
  postOrdersCreate,
  postOrdersDelete,
  postOrdersDeleteRequest,
  type OrdersMondayProgressStatusBulkQueuedRow,
  type OrdersOverviewOrder,
  type OrdersOverviewResponse,
} from '../features/orders/api'
import { QUERY_KEYS } from '../lib/queryKeys'
import {
  JobDetailsDialog,
  type JobDetailsMode,
  type JobDetailsTab,
} from './orders/JobDetailsDialog'
import {
  OrdersGrid,
  type OrdersQuickBooksDrilldownMetric,
  type OrdersViewMode,
} from './orders/OrdersGrid'
import {
  AddManualOrderDialog,
  type AddManualOrderDialogForm,
} from './orders/AddManualOrderDialog'
import { OrdersToolbar } from './orders/OrdersToolbar'
import { QuickBooksProjectDialog } from './orders/QuickBooksProjectDialog'
import {
  CutListPreview,
  type CutListPreviewHandle,
} from './orders/CutListPreview'
import {
  InvoicePreview,
  type InvoicePreviewHandle,
} from './orders/InvoicePreview'
import {
  ShopDrawingPreview,
  type ShopDrawingPreviewHandle,
} from './orders/ShopDrawingPreview'
import { UpdateOrdersDialog } from './orders/UpdateOrdersDialog'
import { useOrdersOverview } from './orders/useOrdersOverview'

const FEEDBACK_TOAST_MS = 2000
const WARNING_TOAST_MS = 3000

type ApiRequestError = Error & {
  status?: number
  payload?: unknown
}

function applyQueuedProgressStatusUpdates(
  order: OrdersOverviewOrder,
  queuedUpdates: OrdersMondayProgressStatusBulkQueuedRow[],
) {
  const updatesByColumnId = new Map(
    (Array.isArray(queuedUpdates) ? queuedUpdates : [])
      .map((entry) => [
        String(entry?.columnId ?? '').trim(),
        String(entry?.status ?? '').trim(),
      ] as const)
      .filter(([columnId]) => Boolean(columnId)),
  )

  if (updatesByColumnId.size === 0 || !Array.isArray(order.progressStatusDetails)) {
    return order
  }

  const nextProgressStatusDetails = order.progressStatusDetails.map((detail) => {
    const columnId = String(detail?.columnId ?? '').trim()

    if (!columnId || !updatesByColumnId.has(columnId)) {
      return detail
    }

    const nextStatus = updatesByColumnId.get(columnId)

    return {
      ...detail,
      status: nextStatus ? nextStatus : null,
    }
  })

  return {
    ...order,
    progressStatusDetails: nextProgressStatusDetails,
    mondayUpdatedAt: new Date().toISOString(),
  }
}

export default function OrdersPage() {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()
  const overview = useOrdersOverview()
  const { allOrders, setActiveTab, visibleOrders } = overview
  const [searchParams] = useSearchParams()
  const requestedOrderId = String(searchParams.get('orderId') ?? '').trim()
  const canUseAdminView = appUser?.isAdmin === true
  const canEditMondayStages = appUser?.isAdmin === true || appUser?.isManager === true

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [warningMessage, setWarningMessage] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<OrdersViewMode>('standard')
  const [jobDialogMode, setJobDialogMode] = useState<JobDetailsMode | null>(null)
  const [jobDialogInitialTab, setJobDialogInitialTab] = useState<JobDetailsTab>('info')
  const [selectedOrder, setSelectedOrder] = useState<OrdersOverviewOrder | null>(null)
  const [quickBooksDialogOrder, setQuickBooksDialogOrder] = useState<OrdersOverviewOrder | null>(null)
  const [quickBooksDialogMetric, setQuickBooksDialogMetric] =
    useState<OrdersQuickBooksDrilldownMetric | null>(null)
  const [updateOrdersDialogOpen, setUpdateOrdersDialogOpen] = useState(false)
  const [addManualOrderDialogOpen, setAddManualOrderDialogOpen] = useState(false)
  const [isCreatingManualOrder, setIsCreatingManualOrder] = useState(false)
  const [deletingOrderKey, setDeletingOrderKey] = useState<string | null>(null)
  const openedDeepLinkRef = useRef<string | null>(null)

  const shopDrawingHandle = useRef<ShopDrawingPreviewHandle | null>(null)
  const cutListHandle = useRef<CutListPreviewHandle | null>(null)
  const invoiceHandle = useRef<InvoicePreviewHandle | null>(null)
  const bindShopDrawing = useCallback((handle: ShopDrawingPreviewHandle) => {
    shopDrawingHandle.current = handle
  }, [])
  const bindCutList = useCallback((handle: CutListPreviewHandle) => {
    cutListHandle.current = handle
  }, [])
  const bindInvoice = useCallback((handle: InvoicePreviewHandle) => {
    invoiceHandle.current = handle
  }, [])

  const handleOpenBolDocument = useCallback(async (order: OrdersOverviewOrder) => {
    const orderId = String(order?.mondayItemId ?? '').trim()

    if (!orderId) {
      setErrorMessage('No BOL is available for this order yet.')
      return
    }

    try {
      const query = new URLSearchParams({ orderId })
      const response = await apiFetch(`/api/dashboard/monday/bol/download?${query.toString()}`)
      const blob = await response.blob()

      if (!blob || blob.size <= 0) {
        throw new Error('Could not open BOL document.')
      }

      const objectUrl = URL.createObjectURL(blob)
      window.open(objectUrl, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (requestError) {
      setErrorMessage(
        requestError instanceof Error
          ? requestError.message
          : 'Could not open BOL document.',
      )
    }
  }, [])

  // Auto-dismiss success toasts so they don't stick forever.
  useEffect(() => {
    if (!successMessage) {
      return
    }
    const timer = window.setTimeout(() => setSuccessMessage(null), FEEDBACK_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [successMessage])

  // Auto-dismiss error toasts (including refresh rate-limit errors).
  useEffect(() => {
    if (!errorMessage) {
      return
    }
    const timer = window.setTimeout(() => setErrorMessage(null), FEEDBACK_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [errorMessage])

  // Show refresh warnings as temporary alerts instead of sticky page state.
  useEffect(() => {
    if (overview.refreshWarnings.length === 0) {
      return
    }
    setWarningMessage(overview.refreshWarnings.join(' '))
  }, [overview.lastRefreshedAt, overview.refreshWarnings])

  useEffect(() => {
    if (!warningMessage) {
      return
    }
    const timer = window.setTimeout(() => setWarningMessage(null), WARNING_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [warningMessage])

  useEffect(() => {
    if (canUseAdminView || viewMode === 'standard') {
      return
    }
    setViewMode('standard')
  }, [canUseAdminView, viewMode])

  useEffect(() => {
    if (!selectedOrder) {
      return
    }

    const refreshedSelectedOrder = visibleOrders.find((order) => {
      const selectedId = String(selectedOrder.id ?? '').trim()
      const orderId = String(order.id ?? '').trim()
      const selectedMondayItemId = String(selectedOrder.mondayItemId ?? '').trim()
      const orderMondayItemId = String(order.mondayItemId ?? '').trim()

      return (
        (selectedId && orderId && selectedId === orderId)
        || (selectedMondayItemId && orderMondayItemId && selectedMondayItemId === orderMondayItemId)
      )
    })

    if (!refreshedSelectedOrder) {
      return
    }

    if (refreshedSelectedOrder === selectedOrder) {
      return
    }

    setSelectedOrder(refreshedSelectedOrder)
  }, [selectedOrder, visibleOrders])

  useEffect(() => {
    if (!requestedOrderId || openedDeepLinkRef.current === requestedOrderId) {
      return
    }

    const targetOrder = allOrders.find((order) => {
      return [order.id, order.mondayItemId, order.orderNumber]
        .map((value) => String(value ?? '').trim())
        .some((value) => value === requestedOrderId)
    })

    if (!targetOrder) {
      return
    }

    openedDeepLinkRef.current = requestedOrderId
    setActiveTab(targetOrder.isShipped ? 'shipped' : targetOrder.inDesign ? 'design' : 'orders')
    setJobDialogMode('details')
    setJobDialogInitialTab('info')
    setSelectedOrder(targetOrder)
  }, [allOrders, requestedOrderId, setActiveTab])

  const handleRefresh = useCallback(async () => {
    setErrorMessage(null)
    try {
      await overview.refresh()
      setSuccessMessage('Orders refreshed from Monday and QuickBooks.')
    } catch (refreshError) {
      setErrorMessage(
        refreshError instanceof Error
          ? refreshError.message
          : 'Could not refresh orders right now.',
      )
    }
  }, [overview])

  const handleOpenJobDialog = useCallback((order: OrdersOverviewOrder, mode: JobDetailsMode) => {
    if (!order.hasMondayRecord && !order.inDesign) {
      setErrorMessage('This QuickBooks project is not linked to a Monday order yet.')
      return
    }
    setJobDialogMode(mode)
    setJobDialogInitialTab('info')
    setSelectedOrder(order)
  }, [])

  const handleOpenOrderChat = useCallback((order: OrdersOverviewOrder) => {
    setJobDialogMode('details')
    setJobDialogInitialTab('chat')
    setSelectedOrder(order)
  }, [])

  const handleCloseJobDialog = useCallback(() => {
    setJobDialogMode(null)
    setJobDialogInitialTab('info')
    setSelectedOrder(null)
  }, [])

  const handleCopyOrderNumber = useCallback(async (orderNumber: string) => {
    const normalized = String(orderNumber ?? '').trim()
    if (!normalized) {
      setErrorMessage('No order number available to copy.')
      return
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalized)
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea')
        textarea.value = normalized
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'absolute'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      } else {
        throw new Error('Clipboard is not supported in this browser.')
      }
      setSuccessMessage(`Copied order number ${normalized}.`)
      setErrorMessage(null)
    } catch (copyError) {
      setErrorMessage(
        copyError instanceof Error ? copyError.message : 'Could not copy order number.',
      )
    }
  }, [])

  const handleMissingMondayLink = useCallback(() => {
    setErrorMessage('This QuickBooks project is not linked to a Monday order yet.')
  }, [])

  const handleOpenQuickBooksDialog = useCallback(
    (order: OrdersOverviewOrder, metric: OrdersQuickBooksDrilldownMetric) => {
      if (!order.hasQuickBooksRecord || !order.quickBooksProjectId) {
        setErrorMessage('This order is not linked to a QuickBooks project yet.')
        return
      }
      setQuickBooksDialogOrder(order)
      setQuickBooksDialogMetric(metric)
    },
    [],
  )

  const handleCloseQuickBooksDialog = useCallback(() => {
    setQuickBooksDialogOrder(null)
    setQuickBooksDialogMetric(null)
  }, [])

  const handleOpenUpdateOrdersDialog = useCallback(() => {
    setUpdateOrdersDialogOpen(true)
  }, [])

  const handleCloseUpdateOrdersDialog = useCallback(() => {
    setUpdateOrdersDialogOpen(false)
  }, [])

  const handleOpenAddManualOrderDialog = useCallback(() => {
    setAddManualOrderDialogOpen(true)
  }, [])

  const handleCloseAddManualOrderDialog = useCallback(() => {
    if (isCreatingManualOrder) {
      return
    }

    setAddManualOrderDialogOpen(false)
  }, [isCreatingManualOrder])

  const handleCreateManualOrder = useCallback(async (form: AddManualOrderDialogForm) => {
    if (isCreatingManualOrder) {
      return
    }

    setErrorMessage(null)
    setWarningMessage(null)
    setIsCreatingManualOrder(true)

    try {
      const response = await postOrdersCreate({
        boardId: form.boardId,
        name: form.name,
        acknowledgementNumber: form.acknowledgementNumber,
        salesRep: form.salesRep || undefined,
        orderValue: form.orderValue || undefined,
        freightValue: form.freightValue || undefined,
        poDate: form.poDate || undefined,
        poNumber: form.poNumber || undefined,
        description: form.description || undefined,
        shipTo: form.shipTo || undefined,
        notes: form.notes || undefined,
      })

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      setAddManualOrderDialogOpen(false)
      setSuccessMessage(`Created order ${response.order.orderNumber}.`)

      const warningText = (Array.isArray(response.warnings) ? response.warnings : [])
        .map((entry) => String(entry ?? '').trim())
        .filter(Boolean)
        .join(' ')

      if (warningText) {
        setWarningMessage(warningText)
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not create manual order.',
      )
    } finally {
      setIsCreatingManualOrder(false)
    }
  }, [isCreatingManualOrder, queryClient])

  const handleDeleteOrder = useCallback(async (order: OrdersOverviewOrder) => {
    const orderKey = String(order?.id ?? '').trim()
    const mondayItemId = String(order?.mondayItemId ?? '').trim()
    const orderNumber = String(order?.orderNumber ?? '').trim()
    const orderLabel = orderNumber || String(order?.orderName ?? '').trim() || mondayItemId || 'this order'
    const requestPayload = {
      orderKey: orderKey || undefined,
      mondayItemId: mondayItemId || undefined,
      orderNumber: orderNumber || undefined,
    }

    if (!requestPayload.orderKey && !requestPayload.mondayItemId && !requestPayload.orderNumber) {
      setErrorMessage('Could not determine which order to delete.')
      return
    }

    if (deletingOrderKey) {
      return
    }

    const pendingKey = orderKey || mondayItemId || orderNumber || 'order-delete'
    const sendDeleteRequest = async () => {
      setDeletingOrderKey(pendingKey)

      try {
        await postOrdersDeleteRequest(requestPayload)
        setSuccessMessage(`Delete request sent to admin for order ${orderLabel}.`)
      } catch (requestError) {
        setErrorMessage(
          requestError instanceof Error
            ? requestError.message
            : 'Could not send delete request to admin.',
        )
      } finally {
        setDeletingOrderKey(null)
      }
    }

    setErrorMessage(null)

    if (order.hasQuickBooksRecord) {
      const shouldRequest = window.confirm(
        `Order ${orderLabel} is linked to QuickBooks and cannot be deleted directly. Send delete request to admin?`,
      )

      if (!shouldRequest) {
        return
      }

      await sendDeleteRequest()
      return
    }

    const shouldDelete = window.confirm(
      `Delete order ${orderLabel} from website and Monday? This action cannot be undone.`,
    )

    if (!shouldDelete) {
      return
    }

    setDeletingOrderKey(pendingKey)

    try {
      const response = await postOrdersDelete(requestPayload)

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      setSuccessMessage(`Deleted order ${orderLabel}.`)

      const warningText = String(response?.warning ?? '').trim()

      if (warningText) {
        setWarningMessage(warningText)
      }
    } catch (deleteError) {
      const requestError = deleteError as ApiRequestError
      const payload = requestError?.payload && typeof requestError.payload === 'object'
        ? requestError.payload as Record<string, unknown>
        : {}
      const requiresAdminRequest = Boolean(payload?.requiresAdminRequest)

      if (Number(requestError?.status) === 409 && requiresAdminRequest) {
        const shouldRequest = window.confirm(
          `${requestError.message} Send delete request to admin now?`,
        )

        if (shouldRequest) {
          await sendDeleteRequest()
          return
        }
      }

      setErrorMessage(
        requestError instanceof Error
          ? requestError.message
          : 'Could not delete order.',
      )
    } finally {
      setDeletingOrderKey(null)
    }
  }, [deletingOrderKey, queryClient])

  const handleSavedBulkOrderUpdates = useCallback((summary: {
    updatedCount: number
    queuedCount: number
    failedCount: number
    queuedUpdates: OrdersMondayProgressStatusBulkQueuedRow[]
    warnings: string[]
  }) => {
    const warningMessages = (Array.isArray(summary.warnings) ? summary.warnings : [])
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean)
    const queuedCount = Number.isFinite(Number(summary.queuedCount))
      ? Number(summary.queuedCount)
      : Number(summary.updatedCount ?? 0)

    if (summary.failedCount > 0) {
      setWarningMessage(`Saved ${queuedCount} updates to backend. ${summary.failedCount} failed.`)
    } else if (warningMessages.length > 0) {
      setWarningMessage(`Saved ${queuedCount} updates. ${warningMessages[0]}`)
    } else {
      setSuccessMessage(`Saved ${queuedCount} updates. Monday sync is running in the background.`)
    }

    const queuedUpdates = Array.isArray(summary.queuedUpdates)
      ? summary.queuedUpdates
      : []

    if (queuedUpdates.length > 0) {
      const updatesByItemId = queuedUpdates.reduce((accumulator, entry) => {
        const mondayItemId = String(entry?.mondayItemId ?? '').trim()

        if (!mondayItemId) {
          return accumulator
        }

        if (!accumulator.has(mondayItemId)) {
          accumulator.set(mondayItemId, [])
        }

        const queuedItemUpdates = accumulator.get(mondayItemId)

        if (queuedItemUpdates) {
          queuedItemUpdates.push(entry)
        }

        return accumulator
      }, new Map<string, OrdersMondayProgressStatusBulkQueuedRow[]>())

      queryClient.setQueryData<OrdersOverviewResponse>(
        QUERY_KEYS.ordersOverview,
        (current) => {
          if (!current || !Array.isArray(current.orders) || updatesByItemId.size === 0) {
            return current
          }

          const nextOrders = current.orders.map((order) => {
            const queuedOrderUpdates = updatesByItemId.get(String(order.mondayItemId ?? '').trim())

            if (!queuedOrderUpdates || queuedOrderUpdates.length === 0) {
              return order
            }

            return applyQueuedProgressStatusUpdates(order, queuedOrderUpdates)
          })

          return {
            ...current,
            generatedAt: new Date().toISOString(),
            orders: nextOrders,
          }
        },
      )
    }
  }, [queryClient])

  const bulkEditableOrders = overview.visibleOrders.filter(
    (order) => order.hasMondayRecord && !order.isShipped,
  )

  const handleOpenShopDrawingDocument = useCallback((order: OrdersOverviewOrder) => {
    if (!shopDrawingHandle.current) {
      setErrorMessage('Shop drawing preview is not ready yet. Please try again.')
      return
    }

    shopDrawingHandle.current.closeHover()
    void shopDrawingHandle.current.openDialog(order)
  }, [])

  const handleOpenCutListDocument = useCallback((order: OrdersOverviewOrder) => {
    if (!cutListHandle.current) {
      setErrorMessage('Cut list preview is not ready yet. Please try again.')
      return
    }

    cutListHandle.current.closeHover()
    void cutListHandle.current.openDialog(order)
  }, [])

  const handleOpenInvoiceDocument = useCallback((order: OrdersOverviewOrder) => {
    if (!invoiceHandle.current) {
      setErrorMessage('Invoice preview is not ready yet. Please try again.')
      return
    }

    void invoiceHandle.current.openDialog(order)
  }, [])

  const handleExport = useCallback(() => {
    const rows = overview.visibleOrders.map((order) => {
      const invoice = Number(order.invoiceAmount)
      const billed = Number(order.billedAmount)
      const labor = Number(order.totalLaborCost)
      const profit =
        Number.isFinite(invoice) && Number.isFinite(billed) && Number.isFinite(labor)
          ? Number((invoice - billed - labor).toFixed(2))
          : ''
      return {
        'Order #': order.orderNumber ?? '',
        'Order Name': order.orderName ?? '',
        'PO Number': order.poNumber ?? '',
        'Description': order.description ?? '',
        'Notes': order.notes ?? '',
        'Ship To': order.shipTo ?? '',
        'Ship Notes': order.shipNotes ?? '',
        'BOL': order.bol ?? '',
        'BOL URL': order.bolCachedUrl ?? order.bolUrl ?? '',
        'Monday Status': order.rowStatus ?? '',
        'Invoice #': order.invoiceNumber ?? '',
        'PO Amount': Number.isFinite(Number(order.poAmount)) ? Number(order.poAmount) : '',
        'Billed Amount': Number.isFinite(billed) ? billed : '',
        'Bills Left to Pay':
          order.billBalanceAmount !== null
          && order.billBalanceAmount !== undefined
          && Number.isFinite(Number(order.billBalanceAmount))
          ? Math.max(0, Number(Number(order.billBalanceAmount).toFixed(2)))
          : '',
        'PO Not Yet Billed': Number.isFinite(Number(order.poAmount)) && Number.isFinite(billed)
          ? Math.max(0, Number((Number(order.poAmount) - billed).toFixed(2)))
          : '',
        'Invoice Amount': Number.isFinite(invoice) ? invoice : '',
        'Amount Owed': Number.isFinite(Number(order.amountOwed)) ? Number(order.amountOwed) : '',
        'Total Hours': Number.isFinite(Number(order.totalHours)) ? Number(order.totalHours) : '',
        'Total Cost': Number.isFinite(labor) ? labor : '',
        'Total Profit': profit,
        Paid: order.paidInFull === true ? 'Yes' : order.paidInFull === false ? 'No' : '',
        'Order Date': order.orderDate ?? '',
        'Shipped': order.isShipped ? 'Yes' : 'No',
        'Shipped At': order.shippedAt ?? '',
        'Cut List URL': order.cutListCachedUrl ?? order.cutListUrl ?? '',
        'Source': order.source ?? '',
      }
    })
    const sheet = XLSX.utils.json_to_sheet(rows)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Orders')
    const date = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(book, `orders-export-${date}.xlsx`)
  }, [overview.visibleOrders])

  return (
    <Stack spacing={3}>
      <OrdersToolbar
        totalRows={overview.counts.visible}
        lastRefreshedAt={overview.lastRefreshedAt}
        activeTab={overview.activeTab}
        onActiveTabChange={overview.setActiveTab}
        tabCounts={overview.tabCounts}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        canUseAdminView={canUseAdminView}
        canOpenBulkUpdate={canEditMondayStages}
        onOpenBulkUpdate={handleOpenUpdateOrdersDialog}
        bulkUpdateDisabled={bulkEditableOrders.length === 0}
        canAddOrder={canEditMondayStages}
        onAddOrder={handleOpenAddManualOrderDialog}
        addOrderDisabled={isCreatingManualOrder || Boolean(deletingOrderKey)}
        searchText={overview.searchText}
        onSearchTextChange={overview.setSearchText}
        isRefreshing={overview.isRefreshing}
        onRefresh={handleRefresh}
        onExport={handleExport}
      />

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}
      {overview.queryError ? <Alert severity="error">{overview.queryError}</Alert> : null}
      {warningMessage ? <Alert severity="warning">{warningMessage}</Alert> : null}

      <OrdersGrid
        orders={overview.visibleOrders}
        activeTab={overview.activeTab}
        viewMode={viewMode}
        canEditMondayStages={canEditMondayStages}
        lastRefreshedAt={overview.lastRefreshedAt}
        isLoading={overview.isLoading || overview.isFetching || overview.isRefreshing}
        shopDrawingHandle={shopDrawingHandle}
        onOpenBolDocument={handleOpenBolDocument}
        onOpenJobDialog={handleOpenJobDialog}
        onOpenQuickBooksDialog={handleOpenQuickBooksDialog}
        onCopyOrderNumber={handleCopyOrderNumber}
        onOpenOrderChat={handleOpenOrderChat}
        canDeleteOrders={canEditMondayStages}
        onDeleteOrder={handleDeleteOrder}
        onMissingMondayLink={handleMissingMondayLink}
      />

      <ShopDrawingPreview onError={setErrorMessage} bind={bindShopDrawing} />
      <CutListPreview onError={setErrorMessage} bind={bindCutList} />
      <InvoicePreview onError={setErrorMessage} bind={bindInvoice} />

      <JobDetailsDialog
        open={Boolean(jobDialogMode && selectedOrder)}
        mode={jobDialogMode}
        order={selectedOrder}
        initialTab={jobDialogInitialTab}
        onOpenBolDocument={handleOpenBolDocument}
        onOpenShopDrawingDocument={handleOpenShopDrawingDocument}
        onOpenCutListDocument={handleOpenCutListDocument}
        onOpenInvoiceDocument={handleOpenInvoiceDocument}
        onClose={handleCloseJobDialog}
      />

      <QuickBooksProjectDialog
        key={`${quickBooksDialogOrder?.id ?? 'none'}:${quickBooksDialogMetric ?? 'none'}`}
        open={Boolean(quickBooksDialogOrder)}
        order={quickBooksDialogOrder}
        metric={quickBooksDialogMetric}
        onClose={handleCloseQuickBooksDialog}
      />

      <UpdateOrdersDialog
        open={updateOrdersDialogOpen}
        orders={bulkEditableOrders}
        shopDrawingHandle={shopDrawingHandle}
        onClose={handleCloseUpdateOrdersDialog}
        onSaved={handleSavedBulkOrderUpdates}
      />

      <AddManualOrderDialog
        open={addManualOrderDialogOpen}
        isSubmitting={isCreatingManualOrder}
        onClose={handleCloseAddManualOrderDialog}
        onSubmit={handleCreateManualOrder}
      />
    </Stack>
  )
}

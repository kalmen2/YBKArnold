import * as XLSX from 'xlsx'
import { useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Autocomplete,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { apiFetch } from '../features/api-client'
import {
  postOrdersArchiveUpdate,
  postOrdersCreate,
  postOrdersDelete,
  postOrdersDeleteRequest,
  postOrdersSubOrderLink,
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
  const requestedInitialTab = String(searchParams.get('tab') ?? '').trim()
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
  const [deletingOrderLabel, setDeletingOrderLabel] = useState<string | null>(null)
  const [archivingOrderKey, setArchivingOrderKey] = useState<string | null>(null)
  const [linkOrderTarget, setLinkOrderTarget] = useState<OrdersOverviewOrder | null>(null)
  const [selectedParentOrder, setSelectedParentOrder] = useState<OrdersOverviewOrder | null>(null)
  const [isLinkingOrder, setIsLinkingOrder] = useState(false)
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
      return [order.canonicalOrderId, order.id, order.mondayItemId, order.orderNumber]
        .map((value) => String(value ?? '').trim())
        .some((value) => value === requestedOrderId)
    })

    if (!targetOrder) {
      return
    }

    openedDeepLinkRef.current = requestedOrderId
    setActiveTab(
      targetOrder.isArchived
        ? 'archive'
        : targetOrder.isShipped
          ? 'shipped'
          : targetOrder.inDesign
            ? 'design'
            : 'orders',
    )
    setJobDialogMode('details')
    setJobDialogInitialTab(requestedInitialTab === 'shipping' ? 'shipping' : 'info')
    setSelectedOrder(targetOrder)
  }, [allOrders, requestedInitialTab, requestedOrderId, setActiveTab])

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

  const handleOpenJobDialog = useCallback((order: OrdersOverviewOrder, mode: JobDetailsMode, initialTab: JobDetailsTab = 'info') => {
    if (!order.hasMondayRecord && !order.inDesign && !order.canonicalOrderId) {
      setErrorMessage('This QuickBooks project is not linked to a Monday order yet.')
      return
    }
    setJobDialogMode(mode)
    setJobDialogInitialTab(initialTab)
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
      setDeletingOrderLabel(orderLabel)

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
        setDeletingOrderLabel(null)
      }
    }

    setErrorMessage(null)

    if (order.hasQuickBooksRecord && !order.parentOrderNumber) {
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
    setDeletingOrderLabel(orderLabel)

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
      setDeletingOrderLabel(null)
    }
  }, [deletingOrderKey, queryClient])

  const handleArchiveOrder = useCallback(async (
    order: OrdersOverviewOrder,
    archived: boolean,
  ) => {
    const operationKey = String(order.id || order.mondayItemId || order.orderNumber).trim()

    if (!operationKey || archivingOrderKey) {
      return
    }

    const orderLabel = String(order.orderNumber || order.orderName || 'this order').trim()
    const actionLabel = archived ? 'Archive' : 'Unarchive'
    const shouldContinue = window.confirm(
      `${actionLabel} order ${orderLabel}? This only changes the website and will not change Monday.`,
    )

    if (!shouldContinue) {
      return
    }

    setArchivingOrderKey(operationKey)
    setErrorMessage(null)

    try {
      await postOrdersArchiveUpdate({
        orderKey: order.id,
        mondayItemId: order.mondayItemId,
        orderNumber: order.orderNumber,
        archived,
      })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      setSuccessMessage(
        archived
          ? `Order ${orderLabel} was archived.`
          : `Order ${orderLabel} was returned to its normal order tab.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : `Could not ${archived ? 'archive' : 'unarchive'} the order.`,
      )
    } finally {
      setArchivingOrderKey(null)
    }
  }, [archivingOrderKey, queryClient])

  const linkOrderCandidates = useMemo(() => {
    if (!linkOrderTarget) {
      return []
    }

    const targetNumber = String(linkOrderTarget.orderNumber ?? '').trim().toLowerCase()

    return allOrders
      .filter((order) => {
        const orderNumber = String(order.orderNumber ?? '').trim()

        return Boolean(orderNumber)
          && orderNumber.toLowerCase() !== targetNumber
          && !order.parentOrderNumber
      })
      .sort((left, right) => String(left.orderNumber).localeCompare(String(right.orderNumber), undefined, {
        numeric: true,
        sensitivity: 'base',
      }))
  }, [allOrders, linkOrderTarget])

  const handleOpenLinkOrder = useCallback((order: OrdersOverviewOrder) => {
    const currentParentNumber = String(order.parentOrderNumber ?? '').trim().toLowerCase()
    const currentParent = currentParentNumber
      ? allOrders.find((candidate) => String(candidate.orderNumber ?? '').trim().toLowerCase() === currentParentNumber) ?? null
      : null

    setLinkOrderTarget(order)
    setSelectedParentOrder(currentParent)
    setErrorMessage(null)
  }, [allOrders])

  const handleCloseLinkOrder = useCallback(() => {
    if (isLinkingOrder) {
      return
    }

    setLinkOrderTarget(null)
    setSelectedParentOrder(null)
  }, [isLinkingOrder])

  const saveOrderLink = useCallback(async (parentOrderNumber: string | null) => {
    if (!linkOrderTarget || isLinkingOrder) {
      return
    }

    setIsLinkingOrder(true)
    setErrorMessage(null)

    try {
      const response = await postOrdersSubOrderLink({
        orderKey: linkOrderTarget.id,
        mondayItemId: linkOrderTarget.mondayItemId,
        orderNumber: linkOrderTarget.orderNumber,
        parentOrderNumber,
      })

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      setSuccessMessage(
        response.parentOrderNumber
          ? `Order ${response.orderNumber ?? linkOrderTarget.orderNumber} is now linked to order ${response.parentOrderNumber}.`
          : `Order ${response.orderNumber ?? linkOrderTarget.orderNumber} is no longer linked to another order.`,
      )
      setLinkOrderTarget(null)
      setSelectedParentOrder(null)
    } catch (linkError) {
      setErrorMessage(linkError instanceof Error ? linkError.message : 'Could not link the order.')
    } finally {
      setIsLinkingOrder(false)
    }
  }, [isLinkingOrder, linkOrderTarget, queryClient])

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
        'Customer Name': order.orderName ?? '',
        'PO Number': order.poNumber ?? '',
        'Description': order.description ?? '',
        'Notes': order.notes ?? '',
        'Ship To': order.shipTo ?? '',
        'Ship Notes': order.shipNotes ?? '',
        'BOL': order.bol ?? '',
        'BOL URL': order.bolCachedUrl ?? order.bolUrl ?? '',
        'Job Status': order.rowStatus ?? '',
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
      {deletingOrderLabel ? (
        <Alert
          severity="info"
          icon={<CircularProgress size={18} color="inherit" />}
          sx={{ position: 'sticky', top: 8, zIndex: 20, fontWeight: 700 }}
        >
          Deleting order {deletingOrderLabel} from the website and Monday…
        </Alert>
      ) : null}

      <OrdersGrid
        orders={overview.visibleOrders}
        activeTab={overview.activeTab}
        viewMode={viewMode}
        canEditMondayStages={canEditMondayStages}
        canEditOrderInfo={
          appUser?.isOfficeWorker === true
          || appUser?.isManager === true
          || appUser?.isAdmin === true
        }
        columnPreferenceKey={appUser?.uid ?? appUser?.email ?? 'anonymous'}
        canViewOrderValue={appUser?.canViewOrderValue === true}
        canViewFullFinancials={appUser?.canViewFullFinancials === true}
        lastRefreshedAt={overview.lastRefreshedAt}
        isLoading={overview.isLoading || overview.isFetching || overview.isRefreshing}
        shopDrawingHandle={shopDrawingHandle}
        onOpenBolDocument={handleOpenBolDocument}
        onOpenJobDialog={handleOpenJobDialog}
        onOpenQuickBooksDialog={handleOpenQuickBooksDialog}
        onCopyOrderNumber={handleCopyOrderNumber}
        onOpenOrderChat={handleOpenOrderChat}
        canDeleteOrders
        onDeleteOrder={handleDeleteOrder}
        onArchiveOrder={handleArchiveOrder}
        onLinkOrder={handleOpenLinkOrder}
        onMissingMondayLink={handleMissingMondayLink}
      />

      <ShopDrawingPreview onError={setErrorMessage} bind={bindShopDrawing} />
      <CutListPreview onError={setErrorMessage} bind={bindCutList} />
      <InvoicePreview onError={setErrorMessage} bind={bindInvoice} />

      <JobDetailsDialog
        open={Boolean(jobDialogMode && selectedOrder)}
        mode={jobDialogMode}
        order={selectedOrder}
        allowShipOrder={overview.activeTab === 'orders'}
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

      <Dialog open={Boolean(linkOrderTarget)} onClose={handleCloseLinkOrder} fullWidth maxWidth="sm">
        <DialogTitle>Link to another order</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography color="text.secondary">
              Link order <strong>{linkOrderTarget?.orderNumber}</strong> to its original order. Its costs and
              QuickBooks activity will use the original order's project while it remains a separate order in Monday.
            </Typography>
            <Autocomplete
              options={linkOrderCandidates}
              value={selectedParentOrder}
              onChange={(_event, value) => setSelectedParentOrder(value)}
              getOptionLabel={(option) => {
                const name = String(option.orderName ?? '').trim()
                return name ? `${option.orderNumber} — ${name}` : String(option.orderNumber ?? '')
              }}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              renderInput={(params) => (
                <TextField {...params} label="Original order" placeholder="Search all orders" autoFocus />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          {linkOrderTarget?.parentOrderNumber ? (
            <Button color="error" disabled={isLinkingOrder} onClick={() => void saveOrderLink(null)}>
              Remove link
            </Button>
          ) : null}
          <Button onClick={handleCloseLinkOrder} disabled={isLinkingOrder}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!selectedParentOrder || isLinkingOrder}
            onClick={() => void saveOrderLink(String(selectedParentOrder?.orderNumber ?? '').trim())}
          >
            {isLinkingOrder ? 'Saving…' : 'Link order'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

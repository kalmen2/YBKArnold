import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  fetchOrdersJobDetails,
  ordersJobDetailsQueryKey,
  type OrdersOverviewOrder,
} from '../../features/orders/api'
import { formatCurrency, formatDate } from '../../lib/formatters'
import type { JobDetailsMode } from './JobDetailsDialog'
import { type ShopDrawingPreviewHandle } from './ShopDrawingPreview'
import { resolveShopDrawingUrl } from './shopDrawingUrl'
import { formatProgress, resolveOrderProjectIds } from './utils'

export type OrdersQuickBooksDrilldownMetric = 'purchaseOrders' | 'bills' | 'invoices'

function resolveSourceLabel(order: OrdersOverviewOrder) {
  if (order.source === 'quickbooks') {
    const ids = resolveOrderProjectIds(order)
    if (ids.length > 1) {
      return `QuickBooks projects only (${ids.length} linked IDs)`
    }
    const id = ids[0] || ''
    return id ? `QuickBooks project only (ID ${id})` : 'QuickBooks project only'
  }
  if (order.source === 'merged') {
    return 'Monday + QuickBooks'
  }
  return 'Monday order'
}

// "When does this order have to be ready?"
//  - if the row already has an explicit due date (from Monday), show that
//  - otherwise, derive from order date + lead time days
function resolveLeadTimeDueDate(order: OrdersOverviewOrder) {
  if (order.dueDate) {
    return order.dueDate
  }
  if (!order.orderDate || !Number.isFinite(Number(order.leadTimeDays))) {
    return null
  }
  const [y, m, d] = order.orderDate.split('-').map(Number)
  if (!y || !m || !d) {
    return null
  }
  const target = new Date(y, m - 1, d)
  target.setDate(target.getDate() + Number(order.leadTimeDays))
  const yy = target.getFullYear()
  const mm = String(target.getMonth() + 1).padStart(2, '0')
  const dd = String(target.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function daysUntil(isoDate: string | null) {
  if (!isoDate) {
    return null
  }
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) {
    return null
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(y, m - 1, d)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function toIsoDay(value: string | null | undefined) {
  const parsed = new Date(String(value ?? '').trim())

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatMonthDay(value: string | null | undefined) {
  const parsed = new Date(String(value ?? '').trim())

  if (Number.isNaN(parsed.getTime())) {
    return 'unknown date'
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(parsed)
}

type OrdersGridProps = {
  orders: OrdersOverviewOrder[]
  lastRefreshedAt: string | null
  isLoading: boolean
  shopDrawingHandle: React.MutableRefObject<ShopDrawingPreviewHandle | null>
  onOpenJobDialog: (order: OrdersOverviewOrder, mode: JobDetailsMode) => void
  onOpenQuickBooksDialog: (
    order: OrdersOverviewOrder,
    metric: OrdersQuickBooksDrilldownMetric,
  ) => void
  onCopyOrderNumber: (orderNumber: string) => void
  onMissingMondayLink: () => void
}

export function OrdersGrid({
  orders,
  lastRefreshedAt,
  isLoading,
  shopDrawingHandle,
  onOpenJobDialog,
  onOpenQuickBooksDialog,
  onCopyOrderNumber,
  onMissingMondayLink,
}: OrdersGridProps) {
  const queryClient = useQueryClient()

  // Prefetch job details on row hover so clicking the Order # / Status History
  // button shows the dialog instantly out of the React Query cache.
  const prefetchJobDetails = (order: OrdersOverviewOrder) => {
    if (!order.hasMondayRecord) {
      return
    }
    void queryClient.prefetchQuery({
      queryKey: ordersJobDetailsQueryKey({
        mondayItemId: order.mondayItemId,
        jobNumber: order.jobNumber,
        orderName: order.orderName ?? '',
      }),
      queryFn: () => fetchOrdersJobDetails({
        mondayItemId: order.mondayItemId,
        jobNumber: order.jobNumber,
        orderName: order.orderName,
      }),
      staleTime: 60 * 1000,
    })
  }

  const renderQuickBooksButton = (
    row: OrdersOverviewOrder,
    label: string,
    metric: OrdersQuickBooksDrilldownMetric,
    color: string = 'primary.main',
  ) => {
    const normalizedLabel = String(label ?? '').trim()
    if (!normalizedLabel || normalizedLabel === '—') {
      return <Typography variant="body2" color="text.secondary">—</Typography>
    }

    const projectIds = resolveOrderProjectIds(row)

    if (projectIds.length === 0 || !row.hasQuickBooksRecord) {
      return <Typography variant="body2">{normalizedLabel}</Typography>
    }

    return (
      <Button
        size="small"
        variant="text"
        sx={{
          minWidth: 0,
          px: 0,
          textTransform: 'none',
          fontWeight: 700,
          color,
        }}
        onClick={() => onOpenQuickBooksDialog(row, metric)}
      >
        {normalizedLabel}
      </Button>
    )
  }

  const columns = useMemo<GridColDef<OrdersOverviewOrder>[]>(() => [
    {
      field: 'orderNumber',
      headerName: 'Order #',
      minWidth: 190,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ width: 'fit-content' }}>
          {row.hasMondayRecord ? (
            <Button
              size="small"
              variant="text"
              sx={{
                minWidth: 0,
                p: 0,
                textTransform: 'none',
                fontWeight: 700,
                color: row.hasQuickBooksRecord ? 'success.main' : 'error.main',
              }}
              onMouseEnter={() => prefetchJobDetails(row)}
              onClick={() => {
                if (!row.hasMondayRecord) {
                  onMissingMondayLink()
                  return
                }
                onOpenJobDialog(row, 'details')
              }}
            >
              {row.orderNumber}
            </Button>
          ) : (
            <Typography variant="body2" fontWeight={700} color="warning.dark">
              {row.orderNumber}
            </Typography>
          )}
          {row.hazardReason ? (
            <Tooltip title={row.hazardReason}>
              <WarningAmberRoundedIcon sx={{ color: 'warning.main', fontSize: '0.72rem' }} />
            </Tooltip>
          ) : null}
          <IconButton
            size="small"
            aria-label="Copy order number"
            title="Copy order number"
            onClick={() => onCopyOrderNumber(row.orderNumber)}
          >
            <ContentCopyRoundedIcon fontSize="inherit" />
          </IconButton>
          {row.mondayItemUrl ? (
            <IconButton
              size="small"
              aria-label="Open Monday item"
              title="Open Monday item"
              href={row.mondayItemUrl}
              target="_blank"
              rel="noreferrer"
            >
              <OpenInNewRoundedIcon fontSize="inherit" />
            </IconButton>
          ) : null}
        </Stack>
      ),
    },
    {
      field: 'orderName',
      headerName: 'Order Name',
      minWidth: 260,
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => (
        <Typography
          variant="body2"
          sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={resolveSourceLabel(row)}
        >
          {row.orderName || '—'}
        </Typography>
      ),
    },
    {
      field: 'shopDrawingUrl',
      headerName: 'Drawings',
      width: 78,
      align: 'center',
      headerAlign: 'center',
      sortable: false,
      renderCell: ({ row }) => {
        const url = resolveShopDrawingUrl(row)
        if (!url) {
          return <Typography variant="body2" color="text.secondary">—</Typography>
        }
        return (
          <IconButton
            size="small"
            aria-label="Drawing preview"
            title="Click to open drawing preview."
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
            onClick={(event) => {
              // Only explicit pointer clicks should open drawing previews.
              if (event.detail === 0) {
                return
              }
              event.preventDefault()
              event.stopPropagation()
              shopDrawingHandle.current?.closeHover()
              void shopDrawingHandle.current?.openDialog(row)
            }}
          >
            <PictureAsPdfRoundedIcon fontSize="inherit" />
          </IconButton>
        )
      },
    },
    {
      field: 'rowStatus',
      headerName: 'Monday Status',
      minWidth: 170,
      sortable: false,
      renderCell: ({ row }) => {
        const shippedDay = toIsoDay(row.shippedAt)
        const refreshDay = toIsoDay(lastRefreshedAt)
        const inferredFromRefresh = Boolean(
          row.isShipped && shippedDay && refreshDay && shippedDay === refreshDay,
        )
        const inferredLabelDay = formatMonthDay(lastRefreshedAt)
        const statusLabel = row.isShipped
          ? inferredFromRefresh
            ? `Shipped prior to ${inferredLabelDay}`
            : `Shipped${row.shippedAt ? ` (${formatDate(row.shippedAt)})` : ''}`
          : row.rowStatus
        const tooltipTitle = inferredFromRefresh
          ? `Detected as shipped on ${inferredLabelDay}; actual ship date was earlier.`
          : null

        return (
          <Tooltip title={tooltipTitle ?? ''} disableHoverListener={!tooltipTitle}>
            <Chip
              size="small"
              label={statusLabel}
              color={row.isShipped ? 'success' : 'default'}
              variant={row.isShipped ? 'filled' : 'outlined'}
            />
          </Tooltip>
        )
      },
    },
    {
      field: 'dueDate',
      headerName: 'Due Date',
      minWidth: 120,
      renderCell: ({ row }) => (row.dueDate ? formatDate(row.dueDate) : '—'),
    },
    {
      field: 'leadTimeDays',
      headerName: 'Lead Time',
      minWidth: 140,
      sortable: false,
      renderCell: ({ row }) => {
        const targetDate = resolveLeadTimeDueDate(row)
        if (!targetDate) {
          return <Typography variant="body2" color="text.secondary">—</Typography>
        }
        const days = daysUntil(targetDate)
        const formattedTarget = formatDate(targetDate)
        if (days === null) {
          return <Typography variant="body2">{formattedTarget}</Typography>
        }
        const absDays = Math.abs(days)
        const dayLabel = `${absDays} day${absDays === 1 ? '' : 's'}`
        const tooltipTitle =
          days < 0
            ? `${dayLabel} overdue`
            : days === 0
              ? 'Due today (next 7 days)'
              : days <= 7
                ? `Due in ${dayLabel} (next 7 days)`
                : days <= 14
                  ? `Due in ${dayLabel} (next 14 days)`
                  : `Due in ${dayLabel}`
        const textColor =
          days < 0
            ? '#d32f2f' // red
            : days <= 7
              ? '#ef6c00' // orange
              : days <= 14
                ? '#f9a825' // yellow
                : '#000000' // black

        return (
          <Tooltip title={tooltipTitle}>
            <Typography variant="body2" fontWeight={700} sx={{ color: textColor, cursor: 'help' }}>
              {formattedTarget}
            </Typography>
          </Tooltip>
        )
      },
    },
    {
      field: 'orderDate',
      headerName: 'Order Date',
      minWidth: 120,
      renderCell: ({ row }) => (row.orderDate ? formatDate(row.orderDate) : '—'),
    },
    {
      field: 'invoiceNumber',
      headerName: 'Invoice #',
      minWidth: 120,
      renderCell: ({ row }) => renderQuickBooksButton(
        row,
        row.invoiceNumber || '—',
        'invoices',
      ),
    },
    {
      field: 'billedAmount',
      headerName: 'Billed Amount',
      minWidth: 130,
      renderCell: ({ row }) => renderQuickBooksButton(
        row,
        Number.isFinite(Number(row.billedAmount))
          ? formatCurrency(Number(row.billedAmount), 2)
          : '—',
        'bills',
      ),
    },
    {
      field: 'billBalanceAmount',
      headerName: 'Bills Left to Pay',
      minWidth: 145,
      renderCell: ({ row }) => {
        const rawBillBalance = row.billBalanceAmount
        if (rawBillBalance === null || rawBillBalance === undefined) {
          return <Typography variant="body2" color="text.secondary">—</Typography>
        }
        const billBalance = Number(rawBillBalance)
        if (!Number.isFinite(billBalance)) {
          return <Typography variant="body2" color="text.secondary">—</Typography>
        }
        const normalized = Math.max(0, Number(billBalance.toFixed(2)))
        return renderQuickBooksButton(
          row,
          normalized <= 0 ? 'Paid' : formatCurrency(normalized, 2),
          'bills',
          normalized <= 0 ? 'success.main' : 'warning.main',
        )
      },
    },
    {
      field: 'remainingToBill',
      headerName: 'PO Not Yet Billed',
      minWidth: 145,
      sortable: false,
      renderCell: ({ row }) => {
        const po = Number(row.poAmount)
        const billed = Number(row.billedAmount)
        if (!Number.isFinite(po) || !Number.isFinite(billed)) {
          return <Typography variant="body2" color="text.secondary">—</Typography>
        }
        const remaining = Math.max(0, Number((po - billed).toFixed(2)))
        const color = remaining <= 0 ? 'success.main' : 'warning.main'
        return (
          <Typography variant="body2" fontWeight={700} color={color}>
            {remaining <= 0 ? 'All PO billed' : formatCurrency(remaining, 2)}
          </Typography>
        )
      },
    },
    {
      field: 'poAmount',
      headerName: 'PO Amount',
      minWidth: 120,
      renderCell: ({ row }) => renderQuickBooksButton(
        row,
        Number.isFinite(Number(row.poAmount))
          ? formatCurrency(Number(row.poAmount), 2)
          : '—',
        'purchaseOrders',
      ),
    },
    {
      field: 'invoiceAmount',
      headerName: 'Invoice Amount',
      minWidth: 130,
      renderCell: ({ row }) => renderQuickBooksButton(
        row,
        Number.isFinite(Number(row.invoiceAmount))
          ? formatCurrency(Number(row.invoiceAmount), 2)
          : '—',
        'invoices',
      ),
    },
    {
      field: 'amountOwed',
      headerName: 'Total Amount Owed',
      minWidth: 130,
      renderCell: ({ row }) => renderQuickBooksButton(
        row,
        Number.isFinite(Number(row.totalAmountOwed))
          ? formatCurrency(Number(row.totalAmountOwed), 2)
          : '—',
        'invoices',
      ),
    },
    {
      field: 'totalHours',
      headerName: 'Total Hours',
      minWidth: 110,
      renderCell: ({ row }) => (
        Number.isFinite(Number(row.totalHours)) ? Number(row.totalHours).toFixed(2) : '—'
      ),
    },
    {
      field: 'totalLaborCost',
      headerName: 'Total Cost',
      minWidth: 120,
      renderCell: ({ row }) => (
        Number.isFinite(Number(row.totalLaborCost))
          ? formatCurrency(Number(row.totalLaborCost), 2)
          : '—'
      ),
    },
    {
      field: 'totalProfit',
      headerName: 'Total Profit',
      minWidth: 140,
      sortable: false,
      renderCell: ({ row }) => {
        const invoice = Number(row.invoiceAmount)
        const billed = Number(row.billedAmount)
        const labor = Number(row.totalLaborCost)
        if (!Number.isFinite(invoice) || !Number.isFinite(billed) || !Number.isFinite(labor)) {
          return <Typography variant="body2" color="text.secondary">—</Typography>
        }
        const profit = invoice - billed - labor
        const color = profit >= 0 ? 'success.main' : 'error.main'
        return (
          <Typography variant="body2" fontWeight={700} color={color}>
            {formatCurrency(profit, 2)}
          </Typography>
        )
      },
    },
    {
      field: 'paidInFull',
      headerName: 'Paid In Full',
      minWidth: 120,
      sortable: false,
      renderCell: ({ row }) => {
        if (typeof row.paidInFull !== 'boolean') {
          return '—'
        }
        return (
          <Chip
            size="small"
            label={row.paidInFull ? 'Yes' : 'No'}
            color={row.paidInFull ? 'success' : 'warning'}
            variant="outlined"
          />
        )
      },
    },
    {
      field: 'managerReadyPercent',
      headerName: 'Status History',
      minWidth: 170,
      sortable: false,
      renderCell: ({ row }) => {
        const hasManagerStatus = Number.isFinite(Number(row.managerReadyPercent))
        const historyCount = Array.isArray(row.statusHistory) ? row.statusHistory.length : 0
        const label = `${hasManagerStatus ? formatProgress(row.managerReadyPercent) : 'History'} (${historyCount})`

        if (!row.hasMondayRecord || (!hasManagerStatus && historyCount === 0)) {
          return <Typography variant="body2" color="text.secondary">—</Typography>
        }

        return (
          <Button
            size="small"
            variant="text"
            startIcon={<HistoryRoundedIcon fontSize="small" />}
            sx={{ minWidth: 0, px: 0, textTransform: 'none' }}
            title={row.managerReadyDate ? `Last update: ${formatDate(row.managerReadyDate)}` : undefined}
            onMouseEnter={() => prefetchJobDetails(row)}
            onClick={() => onOpenJobDialog(row, 'history')}
          >
            {label}
          </Button>
        )
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [
    lastRefreshedAt,
    shopDrawingHandle,
    onOpenJobDialog,
    onOpenQuickBooksDialog,
    onCopyOrderNumber,
    onMissingMondayLink,
  ])

  const prioritizedRows = useMemo(() => {
    if (orders.length < 2) {
      return orders
    }
    return [...orders].sort((a, b) => {
      const aPriority = a.hasMondayRecord ? 0 : 1
      const bPriority = b.hasMondayRecord ? 0 : 1
      if (aPriority !== bPriority) {
        return aPriority - bPriority
      }
      return 0
    })
  }, [orders])

  return (
    <Paper variant="outlined" sx={{ height: 'calc(72vh + 98px)', minHeight: 698 }}>
      <DataGrid
        rows={prioritizedRows}
        columns={columns}
        loading={isLoading}
        disableRowSelectionOnClick
        density="compact"
        rowHeight={38}
        columnHeaderHeight={54}
        pageSizeOptions={[25, 50, 100]}
        initialState={{
          pagination: {
            paginationModel: { pageSize: 50, page: 0 },
          },
        }}
        getRowClassName={({ row }) => {
          if (row.hazardReason) {
            return 'orders-row--hazard'
          }
          if (!row.hasMondayRecord) {
            return 'orders-row--quickbooks-only'
          }
          return ''
        }}
        localeText={{ noRowsLabel: 'No orders to show.' }}
        sx={{
          border: 0,
          fontSize: '0.74rem',
          '& .MuiDataGrid-columnHeaders': {
            borderBottom: '1px solid rgba(15, 23, 42, 0.14)',
            backgroundColor: 'rgba(15, 23, 42, 0.04)',
          },
          '& .MuiDataGrid-cell': { alignItems: 'center', py: 0 },
          '& .MuiDataGrid-columnHeader': { py: 0.25 },
          '& .MuiDataGrid-columnSeparator': { color: 'rgba(15, 23, 42, 0.14)' },
          '& .MuiDataGrid-columnHeaderTitle': {
            fontWeight: 700,
            fontSize: '0.74rem',
            letterSpacing: '0.01em',
            lineHeight: 1,
          },
          '& .MuiDataGrid-cell .MuiButton-root': {
            minHeight: 20,
            fontSize: '0.7rem',
            px: 0.45,
            py: 0,
            lineHeight: 1,
          },
          '& .MuiDataGrid-cell .MuiChip-root': { height: 17, fontSize: '0.66rem' },
          '& .MuiDataGrid-cell .MuiIconButton-root': { padding: 1 },
          '& .MuiDataGrid-cell .MuiSvgIcon-root': { fontSize: '0.88rem' },
          '& .orders-row--hazard': { backgroundColor: 'rgba(237, 108, 2, 0.08)' },
          '& .orders-row--quickbooks-only': { backgroundColor: 'rgba(2, 136, 209, 0.06)' },
        }}
      />
    </Paper>
  )
}

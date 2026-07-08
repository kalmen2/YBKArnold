import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  MenuItem,
  Paper,
  Popover,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  DataGrid,
  type GridColDef,
  type GridColumnGroupingModel,
  type GridRowSelectionModel,
  getGridDateOperators,
} from '@mui/x-data-grid'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchOrdersJobDetails,
  fetchOrdersMondayProgressDetails,
  ordersJobDetailsQueryKey,
  type OrdersOverviewOrder,
  type OrdersOverviewResponse,
  postOrdersMondayProgressStatusUpdate,
} from '../../features/orders/api'
import { formatCurrency, formatDate } from '../../lib/formatters'
import { QUERY_KEYS } from '../../lib/queryKeys'
import type { JobDetailsMode } from './JobDetailsDialog'
import { type ShopDrawingPreviewHandle } from './ShopDrawingPreview'
import type { OrdersListTab } from './useOrdersOverview'
import { resolveBolUrl } from './bolUrl'
import { resolveShopDrawingUrl } from './shopDrawingUrl'
import { formatProgress, resolveOrderProjectIds } from './utils'

export type OrdersQuickBooksDrilldownMetric = 'purchaseOrders' | 'bills' | 'invoices'
export type OrdersViewMode = 'standard' | 'admin'

const mondayProgressBreakdownConfig = [
  { key: 'design', label: 'Design', weight: 13 },
  { key: 'baseform', label: 'Base/Form', weight: 13 },
  { key: 'build', label: 'Build', weight: 13 },
  { key: 'sandorlam', label: 'Sand or lam', weight: 13 },
  { key: 'sealer', label: 'Sealer', weight: 12 },
  { key: 'lacquer', label: 'Lacquer', weight: 12 },
  { key: 'ready', label: 'Ready', weight: 12 },
] as const

type WebsiteProgressStatusKey = 'working' | 'done' | 'stuck'

type TrackedProgressStageState = {
  key: (typeof mondayProgressBreakdownConfig)[number]['key']
  label: (typeof mondayProgressBreakdownConfig)[number]['label']
  index: number
  status: WebsiteProgressStatusKey
}

const mondayProgressStageLabelByKey = new Map<string, string>(
  mondayProgressBreakdownConfig.map((stage) => [stage.key, stage.label]),
)

function normalizeProgressStatusKey(value: string | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

function normalizeWebsiteProgressStatusKey(
  value: string | null | undefined,
): WebsiteProgressStatusKey | null {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

  if (!normalized) {
    return null
  }

  if (normalized === 'working on it' || normalized === 'working') {
    return 'working'
  }

  if (normalized === 'done' || normalized === 'ready') {
    return 'done'
  }

  if (normalized === 'stuck' || normalized === 'stock') {
    return 'stuck'
  }

  return null
}

function normalizeWebsiteProgressStatusOptions(options: unknown) {
  return normalizeProgressStatusOptions(options)
}

function buildTrackedProgressStageStates(
  progressStatusDetails: OrdersOverviewOrder['progressStatusDetails'] | null | undefined,
) {
  const statusByStage = new Map<string, WebsiteProgressStatusKey>()

  ;(Array.isArray(progressStatusDetails) ? progressStatusDetails : []).forEach((entry) => {
    const normalizedStatus = normalizeWebsiteProgressStatusKey(entry?.status)

    if (!normalizedStatus) {
      return
    }

    const candidateKeys = [
      normalizeProgressStatusKey(entry?.key),
      normalizeProgressStatusKey(entry?.label),
    ]

    candidateKeys.forEach((candidateKey) => {
      if (!candidateKey || !mondayProgressStageLabelByKey.has(candidateKey) || statusByStage.has(candidateKey)) {
        return
      }

      statusByStage.set(candidateKey, normalizedStatus)
    })
  })

  return mondayProgressBreakdownConfig
    .map((stage, index) => {
      const status = statusByStage.get(stage.key)

      if (!status) {
        return null
      }

      return {
        key: stage.key,
        label: stage.label,
        index,
        status,
      }
    })
    .filter((stage): stage is TrackedProgressStageState => Boolean(stage))
}

function resolveNewestTrackedStuckStageLabel(
  progressStatusDetails: OrdersOverviewOrder['progressStatusDetails'] | null | undefined,
) {
  const stuckStages = buildTrackedProgressStageStates(progressStatusDetails)
    .filter((stage) => stage.status === 'stuck')

  if (stuckStages.length === 0) {
    return null
  }

  return stuckStages[stuckStages.length - 1]?.label ?? null
}

function resolveNewestTrackedRowStatusLabel(
  progressStatusDetails: OrdersOverviewOrder['progressStatusDetails'] | null | undefined,
) {
  const trackedStages = buildTrackedProgressStageStates(progressStatusDetails)
  const newestStage = trackedStages[trackedStages.length - 1]

  if (!newestStage) {
    return null
  }

  if (newestStage.status === 'working') {
    return `${newestStage.label} working on it`
  }

  if (newestStage.status === 'stuck') {
    return `${newestStage.label} stuck`
  }

  return newestStage.key === 'ready'
    ? 'Ready'
    : `${newestStage.label} ready`
}

function resolveDesignStageStatusLabel(
  progressStatusDetails: OrdersOverviewOrder['progressStatusDetails'] | null | undefined,
) {
  const details = Array.isArray(progressStatusDetails) ? progressStatusDetails : []

  for (const entry of details) {
    const entryKey = normalizeProgressStatusKey(entry?.key)
    const entryLabel = normalizeProgressStatusKey(entry?.label)

    if (entryKey !== 'design' && entryLabel !== 'design') {
      continue
    }

    const status = String(entry?.status ?? '').trim()

    if (status) {
      return status
    }
  }

  return null
}

function resolveDesignStageProgressEntry(
  progressStatusDetails: OrdersOverviewOrder['progressStatusDetails'] | null | undefined,
) {
  const details = Array.isArray(progressStatusDetails) ? progressStatusDetails : []
  let fallbackEntry: {
    status: string | null
    optionStyles: Array<{
      label: string
      color: string | null
      border: string | null
      varName: string | null
    }>
  } | null = null

  for (const entry of details) {
    const entryStatus = String(entry?.status ?? '').trim() || null
    const entryOptionStyles = normalizeProgressStatusOptionStyles(entry?.optionStyles)
    const entryData = {
      status: entryStatus,
      optionStyles: entryOptionStyles,
    }
    const entryKey = normalizeProgressStatusKey(entry?.key)
    const entryLabel = normalizeProgressStatusKey(entry?.label)

    if (!fallbackEntry && (entryStatus || entryOptionStyles.length > 0)) {
      fallbackEntry = entryData
    }

    if (entryKey === 'design' || entryLabel === 'design') {
      return entryData
    }
  }

  return fallbackEntry
}

type RowStatusVisualTone = 'working' | 'stuck' | 'stageReady' | 'finalReady' | 'neutral'

function resolveRowStatusVisual(rowStatus: string | null | undefined) {
  const rawStatus = String(rowStatus ?? '').trim()
  const normalizedStatus = rawStatus.toLowerCase()

  if (!rawStatus) {
    return {
      tone: 'neutral' as RowStatusVisualTone,
      topLabel: 'Status',
      stageLabel: 'Open',
      isFinalReady: false,
    }
  }

  if (normalizedStatus === 'ready') {
    return {
      tone: 'finalReady' as RowStatusVisualTone,
      topLabel: 'Ready',
      stageLabel: 'Ready',
      isFinalReady: true,
    }
  }

  if (normalizedStatus.endsWith(' working on it')) {
    const stageLabel = rawStatus
      .slice(0, rawStatus.length - ' working on it'.length)
      .trim()

    return {
      tone: 'working' as RowStatusVisualTone,
      topLabel: 'Working on it',
      stageLabel: stageLabel || rawStatus,
      isFinalReady: false,
    }
  }

  if (normalizedStatus.endsWith(' stuck') || normalizedStatus.endsWith(' stock')) {
    const stuckSuffix = normalizedStatus.endsWith(' stock')
      ? ' stock'
      : ' stuck'
    const stageLabel = rawStatus
      .slice(0, rawStatus.length - stuckSuffix.length)
      .trim()

    return {
      tone: 'stuck' as RowStatusVisualTone,
      topLabel: 'Stuck',
      stageLabel: stageLabel || rawStatus,
      isFinalReady: false,
    }
  }

  if (normalizedStatus.endsWith(' ready')) {
    const stageLabel = rawStatus
      .slice(0, rawStatus.length - ' ready'.length)
      .trim()

    return {
      tone: 'stageReady' as RowStatusVisualTone,
      topLabel: 'Ready',
      stageLabel: stageLabel || rawStatus,
      isFinalReady: false,
    }
  }

  return {
    tone: 'neutral' as RowStatusVisualTone,
    topLabel: 'Status',
    stageLabel: rawStatus,
    isFinalReady: false,
  }
}

function resolveRowStatusPalette(tone: RowStatusVisualTone) {
  const defaultYellowPalette = {
    stageBg: 'rgba(249, 168, 37, 0.12)',
    stageBorder: '#f9a825',
    stageText: '#f9a825',
  }

  const redPalette = {
    stageBg: 'rgba(220, 38, 38, 0.16)',
    stageBorder: '#dc2626',
    stageText: '#b91c1c',
  }

  const greenPalette = {
    stageBg: 'rgba(34, 197, 94, 0.16)',
    stageBorder: '#22c55e',
    stageText: '#15803d',
  }

  const stagePalette = tone === 'stuck'
    ? redPalette
    : tone === 'finalReady'
      ? greenPalette
      : defaultYellowPalette

  return {
    topText: '#1976d2',
    ...stagePalette,
  }
}

function normalizeProgressStatusOptions(options: unknown) {
  return [...new Set(
    (Array.isArray(options) ? options : [])
      .map((option) => {
        if (typeof option === 'string') {
          return String(option).trim()
        }

        if (option && typeof option === 'object') {
          return String(option?.label ?? '').trim()
        }

        return ''
      })
      .filter(Boolean),
  )]
}

function normalizeProgressStatusOptionStyles(optionStyles: unknown) {
  const stylesByLabel = new Map<string, {
    label: string
    color: string | null
    border: string | null
    varName: string | null
  }>()

  ;(Array.isArray(optionStyles) ? optionStyles : []).forEach((entry) => {
    const label = String(
      (entry && typeof entry === 'object')
        ? entry?.label
        : entry,
    ).trim()

    if (!label || stylesByLabel.has(label)) {
      return
    }

    const normalizedEntry = entry && typeof entry === 'object'
      ? entry
      : {}

    stylesByLabel.set(label, {
      label,
      color: String(normalizedEntry?.color ?? '').trim() || null,
      border: String(normalizedEntry?.border ?? '').trim() || null,
      varName: String(
        normalizedEntry?.varName
        ?? normalizedEntry?.var_name
        ?? '',
      ).trim() || null,
    })
  })

  return [...stylesByLabel.values()]
}

function parseHexColorRgb(hexColor: string | null | undefined) {
  const normalizedHex = String(hexColor ?? '').trim().replace('#', '')
  const expandedHex = normalizedHex.length === 3
    ? normalizedHex.split('').map((char) => `${char}${char}`).join('')
    : normalizedHex

  if (!/^[0-9a-fA-F]{6}$/.test(expandedHex)) {
    return null
  }

  return {
    red: Number.parseInt(expandedHex.slice(0, 2), 16),
    green: Number.parseInt(expandedHex.slice(2, 4), 16),
    blue: Number.parseInt(expandedHex.slice(4, 6), 16),
  }
}

function hexToRgba(hexColor: string | null | undefined, alpha: number) {
  const rgb = parseHexColorRgb(hexColor)

  if (!rgb) {
    return null
  }

  const boundedAlpha = Math.max(0, Math.min(1, Number(alpha)))

  return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${boundedAlpha})`
}

function resolveReadableTextColor(hexColor: string | null | undefined) {
  const rgb = parseHexColorRgb(hexColor)

  if (!rgb) {
    return 'rgba(15, 23, 42, 0.9)'
  }

  const luminance = (0.299 * rgb.red + 0.587 * rgb.green + 0.114 * rgb.blue) / 255

  return luminance > 0.65 ? 'rgba(15, 23, 42, 0.92)' : '#ffffff'
}

function resolveFallbackProgressStatusColor(statusLabel: string | null | undefined) {
  const normalized = String(statusLabel ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

  if (!normalized) {
    return null
  }

  if (normalized.includes('stuck') || normalized.includes('stock')) {
    return '#e2445c'
  }

  if (normalized.includes('working on it') || normalized === 'working') {
    return '#fdab3d'
  }

  if (normalized.includes('waiting for approval')) {
    return '#0086c0'
  }

  if (normalized.includes('approved')) {
    return '#00c875'
  }

  if (normalized.includes('waiting on deposit')) {
    return '#fd6f3a'
  }

  if (normalized.includes('deposit received')) {
    return '#9e9e9e'
  }

  if (normalized.includes('no deposit required')) {
    return '#ff007f'
  }

  if (normalized.includes('cancel order')) {
    return '#a25ddc'
  }

  if (normalized.includes('cancel')) {
    return '#ffcb00'
  }

  if (normalized.includes('ready') || normalized.includes('done')) {
    return '#00c875'
  }

  return null
}

function resolveProgressStatusVisual(
  statusLabel: string | null | undefined,
  optionStyles: unknown,
) {
  const normalizedStatusLabel = String(statusLabel ?? '').trim()
  const normalizedStatusLookup = normalizedStatusLabel.toLowerCase()
  const styles = normalizeProgressStatusOptionStyles(optionStyles)
  const matchingStyle = styles.find(
    (entry) => entry.label.toLowerCase() === normalizedStatusLookup,
  )

  const mondayColor = matchingStyle?.color || null
  const fallbackColor = resolveFallbackProgressStatusColor(normalizedStatusLabel)
  const effectiveColor = mondayColor || fallbackColor
  const mondayBorder = matchingStyle?.border || effectiveColor

  if (!effectiveColor) {
    return {
      borderColor: 'rgba(15, 23, 42, 0.18)',
      panelBg: 'rgba(15, 23, 42, 0.08)',
      selectBg: 'rgba(248, 250, 252, 0.85)',
      textColor: 'rgba(15, 23, 42, 0.9)',
      accentColor: 'rgba(15, 23, 42, 0.35)',
      solidBg: 'rgba(226, 232, 240, 0.95)',
    }
  }

  return {
    borderColor: mondayBorder || 'rgba(15, 23, 42, 0.25)',
    panelBg: hexToRgba(effectiveColor, 0.26) || 'rgba(15, 23, 42, 0.08)',
    selectBg: hexToRgba(effectiveColor, 0.42) || 'rgba(241, 245, 249, 0.9)',
    textColor: resolveReadableTextColor(effectiveColor),
    accentColor: mondayBorder || effectiveColor,
    solidBg: effectiveColor,
  }
}

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
//  - use only the explicit due date from Monday
function resolveLeadTimeDueDate(order: OrdersOverviewOrder) {
  return order.dueDate || null
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

function resolveLeadTimeSortValue(order: OrdersOverviewOrder) {
  if (order.isShipped) {
    return null
  }

  const targetDate = resolveLeadTimeDueDate(order)
  if (!targetDate) {
    return null
  }

  const [y, m, d] = targetDate.split('-').map(Number)
  if (!y || !m || !d) {
    return null
  }

  return new Date(y, m - 1, d)
}

const leadTimeFilterOperators = getGridDateOperators()
  .filter((operator) => ['before', 'onOrBefore', 'is', 'after', 'onOrAfter'].includes(String(operator.value)))
  .map((operator) => {
    if (operator.value === 'is') {
      return { ...operator, label: 'Equals date' }
    }
    if (operator.value === 'onOrBefore') {
      return { ...operator, label: 'Before or equals' }
    }
    if (operator.value === 'onOrAfter') {
      return { ...operator, label: 'After or equals' }
    }
    return operator
  })

function normalizeOrderCode(value: string | null | undefined) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function resolveDisplayOrderName(order: OrdersOverviewOrder) {
  const rawName = String(order.orderName ?? '').trim()
  if (!rawName) {
    return '—'
  }

  const rawOrderNumber = String(order.orderNumber ?? '').trim()
  if (!rawOrderNumber) {
    return rawName
  }
  const normalizedOrderNumber = normalizeOrderCode(rawOrderNumber)
  if (!normalizedOrderNumber) {
    return rawName
  }

  if (!rawName.includes('/')) {
    return rawName
  }

  // Remove slash-delimited repeated codes like "9636 / ... / 9636" or "... / 25-R / ..."
  // when the segment matches this row's order number (letters + numbers).
  const segments = rawName
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  if (segments.length === 0) {
    return rawName
  }

  const filteredSegments = segments.filter(
    (segment) => normalizeOrderCode(segment) !== normalizedOrderNumber,
  )

  if (filteredSegments.length === 0 || filteredSegments.length === segments.length) {
    return rawName
  }

  return filteredSegments.join(' / ')
}

function comparePaidStatus(
  left: boolean | null | undefined,
  right: boolean | null | undefined,
) {
  const leftKnown = typeof left === 'boolean'
  const rightKnown = typeof right === 'boolean'

  if (!leftKnown && !rightKnown) {
    return 0
  }

  if (!leftKnown) {
    return 1
  }

  if (!rightKnown) {
    return -1
  }

  if (left === right) {
    return 0
  }

  return left ? 1 : -1
}

type OrdersGridProps = {
  orders: OrdersOverviewOrder[]
  activeTab: OrdersListTab
  viewMode: OrdersViewMode
  canEditMondayStages: boolean
  lastRefreshedAt: string | null
  isLoading: boolean
  shopDrawingHandle: React.MutableRefObject<ShopDrawingPreviewHandle | null>
  onOpenBolDocument: (order: OrdersOverviewOrder) => void
  onOpenJobDialog: (order: OrdersOverviewOrder, mode: JobDetailsMode) => void
  onOpenQuickBooksDialog: (
    order: OrdersOverviewOrder,
    metric: OrdersQuickBooksDrilldownMetric,
  ) => void
  onCopyOrderNumber: (orderNumber: string) => void
  onOpenOrderChat: (order: OrdersOverviewOrder) => void
  onMissingMondayLink: () => void
}

export function OrdersGrid({
  orders,
  activeTab,
  viewMode,
  canEditMondayStages,
  lastRefreshedAt,
  isLoading,
  shopDrawingHandle,
  onOpenBolDocument,
  onOpenJobDialog,
  onOpenQuickBooksDialog,
  onCopyOrderNumber,
  onOpenOrderChat,
  onMissingMondayLink,
}: OrdersGridProps) {
  const queryClient = useQueryClient()
  const statusColumnHeader = activeTab === 'shipped'
    ? 'Ship Date'
    : activeTab === 'warranty'
      ? 'Warranty'
      : 'Monday Status'
  const [rowSelectionModel, setRowSelectionModel] = useState<GridRowSelectionModel>({
    type: 'include',
    ids: new Set(),
  })
  const [statusPopoverAnchorEl, setStatusPopoverAnchorEl] = useState<HTMLElement | null>(null)
  const [statusPopoverOrder, setStatusPopoverOrder] = useState<OrdersOverviewOrder | null>(null)
  const [statusPopoverError, setStatusPopoverError] = useState<string | null>(null)
  const [isStatusPopoverLoading, setIsStatusPopoverLoading] = useState(false)
  const [updatingStatusColumnKey, setUpdatingStatusColumnKey] = useState<string | null>(null)

  const handleOpenStatusPopover = useCallback((event: React.MouseEvent<HTMLElement>, order: OrdersOverviewOrder) => {
    event.preventDefault()
    event.stopPropagation()
    setStatusPopoverError(null)
    setStatusPopoverAnchorEl(event.currentTarget)
    setStatusPopoverOrder(order)
  }, [])

  const handleCloseStatusPopover = useCallback(() => {
    setStatusPopoverAnchorEl(null)
    setStatusPopoverOrder(null)
    setStatusPopoverError(null)
    setIsStatusPopoverLoading(false)
    setUpdatingStatusColumnKey(null)
  }, [])

  const applyProgressDetailsToOrder = useCallback(
    (order: OrdersOverviewOrder, nextOrder: {
      mondayStatus: string | null
      rowStatus: string
      progressPercent: number | null
      progressStatusDetails: OrdersOverviewOrder['progressStatusDetails']
      mondayUpdatedAt: string | null
    }): OrdersOverviewOrder => ({
      ...order,
      mondayStatus: nextOrder.mondayStatus,
      rowStatus: nextOrder.rowStatus,
      progressPercent: nextOrder.progressPercent,
      progressStatusDetails: nextOrder.progressStatusDetails,
      mondayUpdatedAt: nextOrder.mondayUpdatedAt,
    }),
    [],
  )

  const updateOrdersOverviewCache = useCallback((mondayItemId: string, nextOrder: {
    mondayStatus: string | null
    rowStatus: string
    progressPercent: number | null
    progressStatusDetails: OrdersOverviewOrder['progressStatusDetails']
    mondayUpdatedAt: string | null
  }) => {
    queryClient.setQueryData<OrdersOverviewResponse>(
      QUERY_KEYS.ordersOverview,
      (current) => {
        if (!current || !Array.isArray(current.orders)) {
          return current
        }

        return {
          ...current,
          orders: current.orders.map((order) => {
            if (String(order.mondayItemId ?? '').trim() !== mondayItemId) {
              return order
            }

            return applyProgressDetailsToOrder(order, nextOrder)
          }),
        }
      },
    )
  }, [applyProgressDetailsToOrder, queryClient])

  useEffect(() => {
    const mondayItemId = String(statusPopoverOrder?.mondayItemId ?? '').trim()
    const popoverOpen = Boolean(statusPopoverAnchorEl && mondayItemId)

    if (!popoverOpen || !mondayItemId) {
      return
    }

    let isActive = true
    setStatusPopoverError(null)
    setIsStatusPopoverLoading(true)

    void fetchOrdersMondayProgressDetails(mondayItemId)
      .then((response) => {
        if (!isActive) {
          return
        }

        setStatusPopoverOrder((currentOrder) => {
          if (!currentOrder || String(currentOrder.mondayItemId ?? '').trim() !== mondayItemId) {
            return currentOrder
          }

          return applyProgressDetailsToOrder(currentOrder, response.order)
        })

        updateOrdersOverviewCache(mondayItemId, response.order)
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return
        }

        setStatusPopoverError(
          error instanceof Error
            ? error.message
            : 'Could not load live Monday stage details.',
        )
      })
      .finally(() => {
        if (!isActive) {
          return
        }

        setIsStatusPopoverLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [
    applyProgressDetailsToOrder,
    statusPopoverAnchorEl,
    statusPopoverOrder?.mondayItemId,
    updateOrdersOverviewCache,
  ])

  const handleUpdateStageStatus = useCallback(
    async (entry: {
      key: string
      columnId: string | null
      status: string | null
      options: string[]
    }, nextStatus: string) => {
      const mondayItemId = String(statusPopoverOrder?.mondayItemId ?? '').trim()
      const normalizedColumnId = String(entry?.columnId ?? '').trim()
      const normalizedNextStatus = String(nextStatus ?? '').trim()
      const normalizedCurrentStatus = String(entry?.status ?? '').trim()

      if (!canEditMondayStages) {
        setStatusPopoverError('Only managers and admins can edit Monday stage statuses.')
        return
      }

      if (!mondayItemId || !normalizedColumnId) {
        setStatusPopoverError('Could not resolve the Monday column for this stage.')
        return
      }

      if (!normalizedNextStatus) {
        setStatusPopoverError('Please choose a valid status value.')
        return
      }

      if (normalizedNextStatus === normalizedCurrentStatus) {
        return
      }

      setStatusPopoverError(null)
      setUpdatingStatusColumnKey(entry.key)

      try {
        const response = await postOrdersMondayProgressStatusUpdate({
          mondayItemId,
          columnId: normalizedColumnId,
          status: normalizedNextStatus,
        })

        setStatusPopoverOrder((currentOrder) => {
          if (!currentOrder || String(currentOrder.mondayItemId ?? '').trim() !== mondayItemId) {
            return currentOrder
          }

          return applyProgressDetailsToOrder(currentOrder, response.order)
        })

        updateOrdersOverviewCache(mondayItemId, response.order)
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      } catch (error) {
        setStatusPopoverError(
          error instanceof Error
            ? error.message
            : 'Could not update Monday stage status.',
        )
      } finally {
        setUpdatingStatusColumnKey(null)
      }
    },
    [
      applyProgressDetailsToOrder,
      canEditMondayStages,
      queryClient,
      statusPopoverOrder,
      updateOrdersOverviewCache,
    ],
  )

  // Prefetch job details on row hover so clicking the Order # / Status History
  // button shows the dialog instantly out of the React Query cache.
  const prefetchJobDetails = (order: OrdersOverviewOrder) => {
    const hasLookupKey = Boolean(
      String(order.mondayItemId ?? '').trim()
      || String(order.jobNumber ?? '').trim()
      || String(order.orderName ?? '').trim(),
    )

    if (!hasLookupKey) {
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

  const adminColumns = useMemo<GridColDef<OrdersOverviewOrder>[]>(() => [
    {
      field: 'orderNumber',
      headerName: 'Order #',
      minWidth: 190,
      renderCell: ({ row }) => {
        const canOpenDetails = row.hasMondayRecord || activeTab === 'design'

        return (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ width: 'fit-content' }}>
          {canOpenDetails ? (
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
              onClick={() => onOpenJobDialog(row, 'details')}
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
            sx={{ p: 0.05 }}
          >
            <ContentCopyRoundedIcon sx={{ fontSize: '0.19rem' }} />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Open order chat"
            title="Open order chat"
            onMouseEnter={() => prefetchJobDetails(row)}
            onClick={() => onOpenOrderChat(row)}
            sx={{ p: 0.2, color: 'primary.main' }}
          >
            <ChatBubbleOutlineRoundedIcon sx={{ fontSize: '1.18rem' }} />
          </IconButton>
          </Stack>
        )
      },
    },
    {
      field: 'orderName',
      headerName: 'Order Name',
      minWidth: 190,
      width: 220,
      sortable: false,
      renderCell: ({ row }) => (
        <Typography
          variant="body2"
          sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={resolveSourceLabel(row)}
        >
          {resolveDisplayOrderName(row)}
        </Typography>
      ),
    },
    {
      field: 'poNumber',
      headerName: 'PO Number',
      minWidth: 130,
      width: 140,
      sortable: false,
      renderCell: ({ row }) => (
        <Typography
          variant="body2"
          sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={row.poNumber ?? ''}
        >
          {row.poNumber || '—'}
        </Typography>
      ),
    },
    {
      field: 'mondayStatus',
      headerName: 'Monday Status',
      minWidth: 170,
      width: 190,
      sortable: false,
      renderCell: ({ row }) => (
        <Typography
          variant="body2"
          sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={row.mondayStatus ?? ''}
        >
          {row.mondayStatus || '—'}
        </Typography>
      ),
    },
    {
      field: 'description',
      headerName: 'Description',
      minWidth: 220,
      width: 260,
      sortable: false,
      renderCell: ({ row }) => {
        const content = String(row.description ?? '').trim()

        if (!content) {
          return (
            <Typography
              variant="body2"
              sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              —
            </Typography>
          )
        }

        if (!row.hasMondayRecord) {
          return (
            <Typography
              variant="body2"
              sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={content}
            >
              {content}
            </Typography>
          )
        }

        return (
          <Button
            size="small"
            variant="text"
            sx={{
              minWidth: 0,
              px: 0,
              maxWidth: '100%',
              textTransform: 'none',
              justifyContent: 'flex-start',
              fontWeight: 500,
              fontSize: '0.78rem',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: 'text.primary',
            }}
            title={content}
            onMouseEnter={() => prefetchJobDetails(row)}
            onClick={() => {
              onOpenJobDialog(row, 'details')
            }}
          >
            {content}
          </Button>
        )
      },
    },
    {
      field: 'warrantyIssueDescription',
      headerName: 'Warranty Issue',
      minWidth: 220,
      width: 280,
      sortable: false,
      renderCell: ({ row }) => {
        const content = String(row.warrantyIssueDescription ?? '').trim()

        if (!content) {
          return <Typography variant="body2" color="text.secondary">—</Typography>
        }

        return (
          <Typography
            variant="body2"
            sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={content}
          >
            {content}
          </Typography>
        )
      },
    },
    {
      field: 'warrantyIssueLeadTimeDate',
      headerName: 'Warranty Lead Time',
      minWidth: 150,
      width: 165,
      type: 'date',
      valueGetter: (_value, row) => {
        if (!row.warrantyIssueLeadTimeDate) {
          return null
        }

        const parsed = Date.parse(row.warrantyIssueLeadTimeDate)

        return Number.isFinite(parsed) ? new Date(parsed) : null
      },
      renderCell: ({ row }) => {
        const dateValue = String(row.warrantyIssueLeadTimeDate ?? '').trim()

        if (!dateValue) {
          return <Typography variant="body2" color="text.secondary">—</Typography>
        }

        return (
          <Typography variant="body2" fontWeight={700} color="warning.dark">
            {formatDate(dateValue)}
          </Typography>
        )
      },
    },
    {
      field: 'notes',
      headerName: 'Notes',
      minWidth: 220,
      width: 260,
      sortable: false,
      renderCell: ({ row }) => {
        const content = String(row.notes ?? '').trim()

        if (!content) {
          return (
            <Typography
              variant="body2"
              sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              —
            </Typography>
          )
        }

        if (!row.hasMondayRecord) {
          return (
            <Typography
              variant="body2"
              sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={content}
            >
              {content}
            </Typography>
          )
        }

        return (
          <Button
            size="small"
            variant="text"
            sx={{
              minWidth: 0,
              px: 0,
              maxWidth: '100%',
              textTransform: 'none',
              justifyContent: 'flex-start',
              fontWeight: 500,
              fontSize: '0.78rem',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: 'text.primary',
            }}
            title={content}
            onMouseEnter={() => prefetchJobDetails(row)}
            onClick={() => {
              onOpenJobDialog(row, 'details')
            }}
          >
            {content}
          </Button>
        )
      },
    },
    {
      field: 'shipTo',
      headerName: 'Ship To',
      minWidth: 180,
      width: 220,
      sortable: false,
      renderCell: ({ row }) => (
        <Typography
          variant="body2"
          sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={row.shipTo ?? ''}
        >
          {row.shipTo || '—'}
        </Typography>
      ),
    },
    {
      field: 'shipNotes',
      headerName: 'Ship Notes',
      minWidth: 220,
      width: 260,
      sortable: false,
      renderCell: ({ row }) => (
        <Typography
          variant="body2"
          sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={row.shipNotes ?? ''}
        >
          {row.shipNotes || '—'}
        </Typography>
      ),
    },
    {
      field: 'bol',
      headerName: 'BOL',
      minWidth: 130,
      width: 150,
      sortable: false,
      renderCell: ({ row }) => {
        const url = resolveBolUrl(row)
        const hasBolText = Boolean(String(row?.bol ?? '').trim())
        const hasOrderId = Boolean(String(row.mondayItemId ?? '').trim())
        const canOpenBol = hasOrderId && (Boolean(url) || hasBolText)

        if (!canOpenBol) {
          return (
            <Typography
              variant="body2"
              sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={row.bol ?? ''}
            >
              {row.bol || '—'}
            </Typography>
          )
        }

        return (
          <IconButton
            size="small"
            aria-label="Open BOL"
            title="Open BOL document"
            onClick={(event) => {
              if (event.detail === 0) {
                return
              }
              event.preventDefault()
              event.stopPropagation()
              onOpenBolDocument(row)
            }}
          >
            <LocalShippingRoundedIcon fontSize="inherit" />
          </IconButton>
        )
      },
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
        const canHoverPreview = Boolean(url && String(row.mondayItemId ?? '').trim())
        if (!url) {
          return <Typography variant="body2" color="text.secondary">—</Typography>
        }
        return (
          <IconButton
            size="small"
            aria-label="Drawing preview"
            title={canHoverPreview ? 'Hover for quick preview. Click to open full popup.' : 'Click to open drawing preview.'}
            onMouseEnter={(event) => {
              if (!canHoverPreview) {
                return
              }
              shopDrawingHandle.current?.openHover(event, row)
            }}
            onMouseLeave={() => {
              if (!canHoverPreview) {
                return
              }
              shopDrawingHandle.current?.leaveHoverTrigger()
            }}
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
      headerName: statusColumnHeader,
      minWidth: 170,
      sortable: false,
      renderCell: ({ row }) => {
        if (activeTab === 'warranty') {
          const leadTimeDate = String(row.warrantyIssueLeadTimeDate ?? '').trim()
          const warrantyLabel = row.warrantyIssueActive
            ? leadTimeDate
              ? `Due ${formatDate(leadTimeDate)}`
              : 'In progress'
            : 'Done'

          return (
            <Chip
              size="small"
              label={warrantyLabel}
              color={row.warrantyIssueActive ? 'warning' : 'success'}
              variant="filled"
            />
          )
        }

        const hasShippedDate = Boolean(row.shippedAt)
        const missingShipDate = row.isShipped && !hasShippedDate
        const inferredShippedDate = row.isShipped && row.shippedAtInferred === true
        const isWarningShippedDate = missingShipDate || inferredShippedDate
        const shippedDateLabel = hasShippedDate ? formatDate(row.shippedAt) : null
        const showStageChrome = activeTab !== 'design'
        const designStageProgressEntry = row.isShipped || activeTab !== 'design'
          ? null
          : resolveDesignStageProgressEntry(row.progressStatusDetails)
        const designStageStatusLabel = row.isShipped || activeTab !== 'design'
          ? null
          : designStageProgressEntry?.status || resolveDesignStageStatusLabel(row.progressStatusDetails)

        const newestTrackedRowStatusLabel = row.isShipped
          || activeTab === 'design'
          ? null
          : resolveNewestTrackedRowStatusLabel(row.progressStatusDetails)
        const resolvedRowStatusLabel = activeTab === 'design'
          ? designStageStatusLabel || row.rowStatus
          : newestTrackedRowStatusLabel || row.rowStatus

        const statusLabel = row.isShipped
          ? hasShippedDate
            ? shippedDateLabel
            : 'No Ship Date'
          : resolvedRowStatusLabel
        const rowStatusVisual = resolveRowStatusVisual(resolvedRowStatusLabel)
        const rowStatusPalette = resolveRowStatusPalette(rowStatusVisual.tone)
        const designStatusVisual = activeTab === 'design'
          ? resolveProgressStatusVisual(
            resolvedRowStatusLabel,
            designStageProgressEntry?.optionStyles ?? [],
          )
          : null
        const newestTrackedStuckStageLabel = row.isShipped
          || activeTab === 'design'
          ? null
          : resolveNewestTrackedStuckStageLabel(row.progressStatusDetails)
        const stuckStageLabel = newestTrackedStuckStageLabel
          || (rowStatusVisual.tone === 'stuck' ? rowStatusVisual.stageLabel : null)

        const tooltipTitle = row.isShipped && isWarningShippedDate
          ? shippedDateLabel
            ? `Ship Date is missing in Monday; fallback date is anchored to first shipped detection (${shippedDateLabel}).`
            : 'Ship Date is missing in Monday.'
          : null

        if (!row.isShipped) {
          return (
            <Box
              role={row.hasMondayRecord ? 'button' : undefined}
              tabIndex={row.hasMondayRecord ? 0 : -1}
              onClick={(event) => {
                if (!row.hasMondayRecord) {
                  return
                }
                handleOpenStatusPopover(event as unknown as React.MouseEvent<HTMLElement>, row)
              }}
              onKeyDown={(event) => {
                if (!row.hasMondayRecord) {
                  return
                }

                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  handleOpenStatusPopover(event as unknown as React.MouseEvent<HTMLElement>, row)
                }
              }}
              sx={{
                position: 'relative',
                width: '100%',
                minWidth: 132,
                minHeight: showStageChrome
                  ? (rowStatusVisual.isFinalReady ? 50 : 45)
                  : 34,
                pt: showStageChrome ? 0.9 : 0,
                pb: showStageChrome ? 0.1 : 0,
                px: showStageChrome ? 0 : 0.35,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: row.hasMondayRecord ? 'pointer' : 'default',
                ...(showStageChrome
                  ? {}
                  : {
                    borderRadius: 1,
                    border: `1px solid ${designStatusVisual?.borderColor || 'rgba(15, 23, 42, 0.18)'}`,
                    bgcolor: designStatusVisual?.solidBg || designStatusVisual?.panelBg || 'rgba(15, 23, 42, 0.08)',
                  }),
              }}
            >
              {showStageChrome ? (
                <Typography
                  variant="caption"
                  sx={{
                    position: 'absolute',
                    top: 0.02,
                    left: 6,
                    fontSize: '0.62rem',
                    fontWeight: 800,
                    color: rowStatusPalette.topText,
                    lineHeight: 1,
                    px: 0.35,
                    py: 0.05,
                    borderRadius: 0.7,
                    bgcolor: 'background.paper',
                  }}
                >
                  {rowStatusVisual.topLabel}
                </Typography>
              ) : null}

              {showStageChrome && stuckStageLabel ? (
                <Tooltip title={`${stuckStageLabel} stuck`}>
                  <WarningAmberRoundedIcon
                    sx={{
                      position: 'absolute',
                      top: 0.02,
                      right: 6,
                      color: 'error.main',
                      fontSize: '0.72rem',
                    }}
                  />
                </Tooltip>
              ) : null}

              <Typography
                component="span"
                variant="body2"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  px: showStageChrome ? 1.05 : 0.35,
                  py: showStageChrome ? 0.16 : 0.45,
                  width: showStageChrome ? 'auto' : '100%',
                  borderRadius: showStageChrome ? 999 : 0.8,
                  border: showStageChrome
                    ? `1px solid ${rowStatusPalette.stageBorder}`
                    : 'none',
                  bgcolor: showStageChrome
                    ? rowStatusPalette.stageBg
                    : 'transparent',
                  color: showStageChrome
                    ? rowStatusPalette.stageText
                    : (designStatusVisual?.textColor || '#ffffff'),
                  fontSize: rowStatusVisual.isFinalReady ? '0.96rem' : '0.84rem',
                  fontWeight: 900,
                  lineHeight: 1.08,
                }}
              >
                {rowStatusVisual.stageLabel}
              </Typography>
            </Box>
          )
        }

        return (
          <Tooltip title={tooltipTitle ?? ''} disableHoverListener={!tooltipTitle}>
            <Chip
              size="small"
              label={statusLabel}
              color={isWarningShippedDate ? 'warning' : 'success'}
              variant="filled"
              onClick={(event) => {
                if (!row.hasMondayRecord) {
                  return
                }
                handleOpenStatusPopover(event, row)
              }}
              clickable={row.hasMondayRecord}
            />
          </Tooltip>
        )
      },
    },
    {
      field: 'managerReadyPercent',
      headerName: 'Status History',
      minWidth: 170,
      type: 'number',
      valueGetter: (_value, row) => {
        const readyPercent = Number(row.managerReadyPercent)
        return Number.isFinite(readyPercent) ? readyPercent : null
      },
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
    {
      field: 'leadTimeDays',
      headerName: 'Lead Time',
      minWidth: 140,
      type: 'date',
      valueGetter: (_value, row) => resolveLeadTimeSortValue(row),
      filterOperators: leadTimeFilterOperators,
      renderCell: ({ row }) => {
        if (row.isShipped) {
          const shippedDate = row.shippedAt ? formatDate(row.shippedAt) : null
          const shippedLabel = shippedDate ? `Shipped (${shippedDate})` : 'Shipped'

          return (
            <Tooltip title={shippedDate ? `Shipped on ${shippedDate}` : 'Already shipped'}>
              <Typography variant="body2" fontWeight={700} sx={{ color: 'success.main', cursor: 'help' }}>
                {shippedLabel}
              </Typography>
            </Tooltip>
          )
        }

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
                  ? `Due in ${dayLabel} (next 8 to 14 days)`
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
        Number.isFinite(Number(row.amountOwed))
          ? formatCurrency(Number(row.amountOwed), 2)
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
      headerName: 'Paid',
      minWidth: 86,
      width: 92,
      sortable: true,
      sortComparator: (left, right) => comparePaidStatus(
        left as boolean | null | undefined,
        right as boolean | null | undefined,
      ),
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
      field: 'mondayLink',
      headerName: 'Monday',
      minWidth: 96,
      width: 104,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      align: 'center',
      headerAlign: 'center',
      renderCell: ({ row }) => {
        if (!row.mondayItemUrl) {
          return <Typography variant="body2" color="text.secondary">—</Typography>
        }

        return (
          <IconButton
            size="small"
            aria-label="Open Monday item"
            title="Open Monday item"
            href={row.mondayItemUrl}
            target="_blank"
            rel="noreferrer"
          >
            <OpenInNewRoundedIcon fontSize="small" />
          </IconButton>
        )
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [
    activeTab,
    statusColumnHeader,
    lastRefreshedAt,
    shopDrawingHandle,
    onOpenBolDocument,
    onOpenJobDialog,
    onOpenQuickBooksDialog,
    onCopyOrderNumber,
    onOpenOrderChat,
    onMissingMondayLink,
    handleOpenStatusPopover,
  ])

  const standardColumns = useMemo<GridColDef<OrdersOverviewOrder>[]>(() => {
    const standardColumnSpecs = activeTab === 'design'
      ? [
        { field: 'orderNumber', label: 'Order #' },
        { field: 'orderName', label: 'Name' },
        { field: 'rowStatus', label: 'Design' },
        { field: 'orderDate', label: 'PO Date' },
        { field: 'poNumber', label: 'PO Number' },
        { field: 'description', label: 'Description' },
        { field: 'shopDrawingUrl', label: 'Shop Drawings' },
      ] as const
      : activeTab === 'warranty'
        ? [
          { field: 'orderNumber', label: 'Order #' },
          { field: 'orderName', label: 'Order Name' },
          { field: 'warrantyIssueDescription', label: 'Issue' },
          { field: 'warrantyIssueLeadTimeDate', label: 'Lead Time' },
          { field: 'rowStatus', label: 'Warranty Status' },
          { field: 'orderDate', label: 'Order Date' },
          { field: 'mondayLink', label: 'Monday' },
        ] as const
      : [
        { field: 'orderNumber', label: 'Order' },
        { field: 'orderName', label: 'Order Name' },
        { field: 'poNumber', label: 'PO Number' },
        { field: 'shopDrawingUrl', label: 'Drawings' },
        { field: 'rowStatus', label: statusColumnHeader },
        { field: 'managerReadyPercent', label: 'Status History' },
        { field: 'leadTimeDays', label: 'Lead Time' },
        { field: 'orderDate', label: 'Order Date' },
        { field: 'paidInFull', label: 'Paid' },
        { field: 'mondayLink', label: 'Monday' },
      ] as const

    const adminColumnsByField = new Map(
      adminColumns.map((column) => [String(column.field), column]),
    )

    const orderedColumns: GridColDef<OrdersOverviewOrder>[] = []

    standardColumnSpecs.forEach((spec) => {
      const baseColumn = adminColumnsByField.get(spec.field)

      if (!baseColumn) {
        return
      }

      orderedColumns.push({
        ...baseColumn,
        headerName: spec.label,
      })
    })

    return orderedColumns
  }, [activeTab, adminColumns, statusColumnHeader])

  const adminColumnGroupingModel = useMemo<GridColumnGroupingModel>(
    () => [
      {
        groupId: 'orderInfo',
        headerName: 'Order Info',
        children: [
          { field: 'orderNumber' },
          { field: 'orderName' },
          { field: 'poNumber' },
          { field: 'shopDrawingUrl' },
          { field: 'rowStatus' },
          { field: 'managerReadyPercent' },
          { field: 'leadTimeDays' },
          { field: 'orderDate' },
        ],
      },
      {
        groupId: 'accounting',
        headerName: 'Accounting',
        children: [
          { field: 'invoiceNumber' },
          { field: 'billedAmount' },
          { field: 'billBalanceAmount' },
          { field: 'remainingToBill' },
          { field: 'poAmount' },
          { field: 'invoiceAmount' },
          { field: 'amountOwed' },
          { field: 'paidInFull' },
        ],
      },
      {
        groupId: 'reports',
        headerName: 'Reports',
        children: [
          { field: 'totalHours' },
          { field: 'totalLaborCost' },
          { field: 'totalProfit' },
        ],
      },
      {
        groupId: 'links',
        headerName: 'Links',
        children: [
          { field: 'mondayLink' },
        ],
      },
    ],
    [],
  )

  const visibleAdminColumns = useMemo(
    () => adminColumns.filter((column) => {
      const field = String(column.field)
      return field !== 'shipTo'
        && field !== 'shipNotes'
        && field !== 'bol'
        && field !== 'description'
        && field !== 'notes'
    }),
    [adminColumns],
  )

  const columns = viewMode === 'admin' ? visibleAdminColumns : standardColumns
  const columnGroupingModel = viewMode === 'admin' ? adminColumnGroupingModel : undefined
  const isStandardView = viewMode === 'standard'
  const statusPopoverOpen = Boolean(statusPopoverAnchorEl && statusPopoverOrder)

  const statusPopoverBreakdown = useMemo(() => {
    const details = Array.isArray(statusPopoverOrder?.progressStatusDetails)
      ? statusPopoverOrder.progressStatusDetails
      : []
    const byKey = new Map<
      string,
      {
        status: string | null
        columnId: string | null
        options: string[]
        optionStyles: Array<{
          label: string
          color: string | null
          border: string | null
          varName: string | null
        }>
      }
    >()

    details.forEach((entry) => {
      const status = String(entry?.status ?? '').trim() || null
      const columnId = String(entry?.columnId ?? '').trim() || null
      const options = normalizeProgressStatusOptions(entry?.options)
      const optionStyles = normalizeProgressStatusOptionStyles(entry?.optionStyles)

      if (status && !options.includes(status)) {
        options.unshift(status)
      }

      const entryKeys = [
        normalizeProgressStatusKey(entry?.key),
        normalizeProgressStatusKey(entry?.label),
      ]

      entryKeys.forEach((entryKey) => {
        if (!entryKey) {
          return
        }
        byKey.set(entryKey, {
          status,
          columnId,
          options,
          optionStyles,
        })
      })
    })

    const breakdown = mondayProgressBreakdownConfig.map((config) => ({
      ...config,
      status: byKey.get(config.key)?.status ?? null,
      columnId: byKey.get(config.key)?.columnId ?? null,
      options: byKey.get(config.key)?.options ?? [],
      optionStyles: byKey.get(config.key)?.optionStyles ?? [],
    }))

    if (activeTab !== 'design') {
      return breakdown
    }

    const designEntry = breakdown.find((entry) => entry.key === 'design') ?? null
    const hasUsableDesignEntry = Boolean(
      designEntry
      && (
        designEntry.columnId
        || designEntry.options.length > 0
        || String(designEntry.status ?? '').trim()
      ),
    )
    const fallbackEntry = breakdown.find((entry) => (
      entry.columnId
      || entry.options.length > 0
      || String(entry.status ?? '').trim()
    )) ?? null
    const selectedEntry = hasUsableDesignEntry ? designEntry : fallbackEntry

    if (!selectedEntry) {
      return []
    }

    return [{
      ...selectedEntry,
      label: 'Design',
      weight: 100,
    }]
  }, [activeTab, statusPopoverOrder])

  const isDesignStatusPopoverMode = activeTab === 'design'
  const statusPopoverStatusLabel = isDesignStatusPopoverMode
    ? String(statusPopoverBreakdown[0]?.status ?? '').trim() || statusPopoverOrder?.rowStatus || '—'
    : statusPopoverOrder?.rowStatus || '—'

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

  const selectedCount = useMemo(() => {
    if (rowSelectionModel.ids.size === 0) {
      return 0
    }

    return prioritizedRows.reduce((count, row) => {
      const isSelected = rowSelectionModel.type === 'include'
        ? rowSelectionModel.ids.has(row.id)
        : !rowSelectionModel.ids.has(row.id)

      return count + (isSelected ? 1 : 0)
    }, 0)
  }, [prioritizedRows, rowSelectionModel])

  const selectedLabel = selectedCount === 1
    ? 'one selected'
    : selectedCount === 2
      ? 'two selected'
      : `${selectedCount} selected`

  return (
    <Paper
      variant="outlined"
      sx={{
        height: 'calc(72vh + 98px)',
        minHeight: 698,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {selectedCount > 0 ? (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          sx={{ px: 1.2, py: 0.9, borderBottom: '1px solid rgba(15, 23, 42, 0.08)' }}
        >
          <Chip
            size="small"
            label={selectedLabel}
            variant="outlined"
            color="primary"
          />
        </Stack>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={prioritizedRows}
          columns={columns}
          columnGroupingModel={columnGroupingModel}
          columnGroupHeaderHeight={viewMode === 'admin' ? 30 : undefined}
          loading={isLoading}
          checkboxSelection
          disableRowSelectionOnClick
          disableRowSelectionExcludeModel
          rowSelectionModel={rowSelectionModel}
          onRowSelectionModelChange={(nextModel) => {
            setRowSelectionModel(nextModel)
          }}
          density={isStandardView ? 'standard' : 'compact'}
          rowHeight={isStandardView ? 52 : 38}
          columnHeaderHeight={isStandardView ? 52 : 54}
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
            fontSize: isStandardView ? '0.79rem' : '0.74rem',
            '& .MuiDataGrid-columnHeaders': {
              borderBottom: '1px solid rgba(15, 23, 42, 0.14)',
              backgroundColor: 'rgba(15, 23, 42, 0.04)',
            },
            '& .MuiDataGrid-cell': {
              alignItems: 'center',
              py: isStandardView ? 0.55 : 0,
            },
            '& .MuiDataGrid-columnHeader': { py: isStandardView ? 0.55 : 0.25 },
            '& .MuiDataGrid-columnSeparator': { color: 'rgba(15, 23, 42, 0.14)' },
            '& .MuiDataGrid-columnHeaderTitle': {
              fontWeight: 700,
              fontSize: isStandardView ? '0.8rem' : '0.74rem',
              letterSpacing: '0.01em',
              lineHeight: 1,
            },
            '& .MuiDataGrid-columnHeader--filledGroup .MuiDataGrid-columnHeaderTitle': {
              fontSize: isStandardView ? '0.7rem' : '0.66rem',
              fontWeight: 800,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            },
            '& .MuiDataGrid-cell .MuiButton-root': {
              minHeight: isStandardView ? 26 : 20,
              fontSize: isStandardView ? '0.74rem' : '0.7rem',
              px: isStandardView ? 0.7 : 0.45,
              py: isStandardView ? 0.2 : 0,
              lineHeight: 1,
            },
            '& .MuiDataGrid-cell .MuiChip-root': {
              height: isStandardView ? 21 : 17,
              fontSize: isStandardView ? '0.7rem' : '0.66rem',
            },
            '& .MuiDataGrid-cell .MuiIconButton-root': {
              padding: isStandardView ? 1.2 : 1,
            },
            '& .MuiDataGrid-cell .MuiSvgIcon-root': {
              fontSize: isStandardView ? '0.95rem' : '0.88rem',
            },
            '& .orders-row--hazard': { backgroundColor: 'rgba(237, 108, 2, 0.08)' },
            '& .orders-row--quickbooks-only': { backgroundColor: 'rgba(2, 136, 209, 0.06)' },
          }}
        />
      </Box>

      <Popover
        open={statusPopoverOpen}
        anchorEl={statusPopoverAnchorEl}
        onClose={handleCloseStatusPopover}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{
          sx: {
            mt: 0.5,
            p: 1.35,
            width: { xs: '92vw', md: 760 },
            maxWidth: '92vw',
            borderRadius: 2,
          },
        }}
      >
        <Stack spacing={1.15}>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
            <Typography variant="subtitle2" fontWeight={800}>
              {isDesignStatusPopoverMode ? 'Monday Design Status' : 'Monday Stage Breakdown'}
            </Typography>
            <Chip
              size="small"
              label={`Progress: ${typeof statusPopoverOrder?.progressPercent === 'number' ? `${statusPopoverOrder.progressPercent}%` : '—'}`}
              color="primary"
              variant="outlined"
            />
            <Chip
              size="small"
              label={`Status: ${statusPopoverStatusLabel}`}
              variant="outlined"
            />
          </Stack>

          {statusPopoverError ? <Alert severity="error">{statusPopoverError}</Alert> : null}

          {!canEditMondayStages ? (
            <Alert severity="info">Only managers and admins can update Monday stage statuses.</Alert>
          ) : null}

          {isStatusPopoverLoading ? (
            <Stack direction="row" spacing={0.8} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="caption" color="text.secondary">
                {isDesignStatusPopoverMode
                  ? 'Loading live Monday design status...'
                  : 'Loading live Monday stage values...'}
              </Typography>
            </Stack>
          ) : null}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: isDesignStatusPopoverMode
                ? 'minmax(0, 1fr)'
                : { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
              gap: 1,
            }}
          >
            {statusPopoverBreakdown.map((entry) => {
              const selectedStatus = String(entry.status ?? '').trim()
              const editableOptions = normalizeWebsiteProgressStatusOptions(entry.options)
              const normalizedSelectedStatus = normalizeProgressStatusKey(selectedStatus)
              const selectedStatusIsEditable = editableOptions.some((option) => (
                normalizeProgressStatusKey(option) === normalizedSelectedStatus
              ))
              const selectedValue = selectedStatusIsEditable ? selectedStatus : ''
              const optionStyles = normalizeProgressStatusOptionStyles(entry.optionStyles)
              const statusColumnId = String(entry.columnId ?? '').trim() || null
              const visual = resolveProgressStatusVisual(selectedStatus, optionStyles)
              const isUpdatingThisStage = updatingStatusColumnKey === entry.key
              const dropdownDisabled =
                !canEditMondayStages
                || isStatusPopoverLoading
                || !statusColumnId
                || editableOptions.length === 0
                || Boolean(updatingStatusColumnKey)

              return (
                <Paper
                  key={entry.key}
                  variant="outlined"
                  sx={{
                    px: 1,
                    py: 0.8,
                    borderRadius: 1.5,
                    bgcolor: visual.panelBg,
                    borderColor: visual.borderColor,
                    boxShadow: `inset 3px 0 0 ${visual.accentColor}`,
                  }}
                >
                  <Stack spacing={0.55}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="caption" fontWeight={800}>
                        {entry.label}
                      </Typography>
                      {!isDesignStatusPopoverMode ? (
                        <Typography variant="caption" color="text.secondary" fontWeight={700}>
                          {entry.weight}%
                        </Typography>
                      ) : null}
                    </Stack>
                    <FormControl size="small" fullWidth>
                      <Select
                        value={selectedValue}
                        displayEmpty
                        disabled={dropdownDisabled}
                        onChange={(event) => {
                          const nextStatus = String(event.target.value ?? '').trim()

                          if (!nextStatus) {
                            return
                          }

                          void handleUpdateStageStatus(
                            {
                              key: entry.key,
                              columnId: statusColumnId,
                              status: selectedStatus || null,
                              options: editableOptions,
                            },
                            nextStatus,
                          )
                        }}
                        renderValue={(value) => {
                          const normalizedValue = String(value ?? '').trim()

                          if (normalizedValue) {
                            return normalizedValue
                          }

                          if (selectedStatus) {
                            return selectedStatus
                          }

                          return 'No value'
                        }}
                        sx={{
                          minHeight: 33,
                          color: visual.textColor,
                          bgcolor: visual.selectBg,
                          '& .MuiSelect-icon': {
                            color: visual.textColor,
                          },
                          '& .MuiOutlinedInput-notchedOutline': {
                            borderColor: visual.borderColor,
                          },
                          '&:hover .MuiOutlinedInput-notchedOutline': {
                            borderColor: visual.accentColor,
                          },
                          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                            borderColor: visual.accentColor,
                          },
                        }}
                      >
                        <MenuItem value="" disabled>
                          {editableOptions.length > 0 ? 'Select status' : 'No options available'}
                        </MenuItem>
                        {selectedStatus && !selectedStatusIsEditable ? (
                          <MenuItem value="" disabled>{selectedStatus}</MenuItem>
                        ) : null}
                        {editableOptions.map((option) => {
                          const optionStyle = optionStyles.find(
                            (style) => style.label.toLowerCase() === option.toLowerCase(),
                          )
                          const optionAccent = optionStyle?.border || optionStyle?.color
                          const optionBg = optionStyle?.color
                            ? hexToRgba(optionStyle.color, 0.18)
                            : null
                          const optionHoverBg = optionStyle?.color
                            ? hexToRgba(optionStyle.color, 0.28)
                            : null
                          const optionTextColor = optionStyle?.color
                            ? resolveReadableTextColor(optionStyle.color)
                            : null

                          return (
                            <MenuItem
                              key={`${entry.key}-${option}`}
                              value={option}
                              sx={{
                                ...(optionAccent
                                  ? {
                                    borderLeft: `3px solid ${optionAccent}`,
                                  }
                                  : {}),
                                ...(optionBg
                                  ? {
                                    bgcolor: optionBg,
                                  }
                                  : {}),
                                ...(optionTextColor
                                  ? {
                                    color: optionTextColor,
                                  }
                                  : {}),
                                ...(optionHoverBg
                                  ? {
                                    '&:hover': {
                                      bgcolor: optionHoverBg,
                                    },
                                  }
                                  : {}),
                              }}
                            >
                              {option}
                            </MenuItem>
                          )
                        })}
                      </Select>
                    </FormControl>

                    {isUpdatingThisStage ? (
                      <Stack direction="row" spacing={0.6} alignItems="center">
                        <CircularProgress size={12} />
                        <Typography variant="caption" color="text.secondary">
                          Updating Monday...
                        </Typography>
                      </Stack>
                    ) : null}
                  </Stack>
                </Paper>
              )
            })}
          </Box>
        </Stack>
      </Popover>
    </Paper>
  )
}

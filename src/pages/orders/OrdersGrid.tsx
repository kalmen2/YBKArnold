import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded'
import UnarchiveRoundedIcon from '@mui/icons-material/UnarchiveRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  MenuItem,
  Menu,
  Paper,
  Popover,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  DataGrid,
  type GridColDef,
  type GridColumnGroupingModel,
  type GridFilterItem,
  type GridFilterModel,
  type GridPaginationModel,
  type GridRowSelectionModel,
  getGridDateOperators,
  useGridApiRef,
} from '@mui/x-data-grid'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchOrdersJobDetails,
  fetchOrdersMondayProgressDetails,
  ordersJobDetailsQueryKey,
  postOrdersOrderDetailsUpdate,
  type OrdersOverviewOrder,
  type OrdersOverviewResponse,
  type OrderDesignPart,
  postOrdersMondayProgressStatusUpdate,
  updateOrderDesignPart,
} from '../../features/orders/api'
import { formatCurrency, formatDate } from '../../lib/formatters'
import { QUERY_KEYS } from '../../lib/queryKeys'
import type { JobDetailsMode, JobDetailsTab } from './JobDetailsDialog'
import { type ShopDrawingPreviewHandle } from './ShopDrawingPreview'
import type { OrdersListTab } from './useOrdersOverview'
import { resolveBolUrl } from './bolUrl'
import { resolveShopDrawingUrl } from './shopDrawingUrl'
import {
  ORDER_PROGRESS_STAGES,
  ORDER_PROGRESS_STAGE_LABEL_BY_KEY,
  normalizeProgressStageKey,
  normalizeProgressStageStatus,
  type OrderProgressStatusKey,
} from '../../features/orders/stage-registry'
import { formatProgress, resolveOrderProjectIds } from './utils'

export type OrdersQuickBooksDrilldownMetric = 'purchaseOrders' | 'bills' | 'invoices' | 'payments'
export type OrdersViewMode = 'standard' | 'admin'
export type OrdersBoardExport = {
  sheetName: string
  rows: Record<string, string | number | boolean>[]
}

type OrdersPersonalView = {
  id: string
  name: string
}

type OrdersPersonalViewsStorage = {
  views?: OrdersPersonalView[]
  activeViewId?: string
}

const DEFAULT_PERSONAL_VIEW: OrdersPersonalView = { id: 'standard', name: 'Standard' }
const MAX_ADDITIONAL_PERSONAL_VIEWS = 3

function compareOrderNumbers(left: unknown, right: unknown) {
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

const mondayProgressBreakdownConfig = ORDER_PROGRESS_STAGES

type WebsiteProgressStatusKey = OrderProgressStatusKey

function hasLinkedMondayItem(order: Pick<OrdersOverviewOrder, 'mondayItemId'>) {
  return Boolean(String(order.mondayItemId ?? '').trim())
}

// Explains why an order's Monday link needs a person to look at it. Returns
// null while the link is healthy, or while the order simply has no Monday
// card yet — that is normal, not a problem to flag.
function describeMondayLinkIssue(
  order: Pick<OrdersOverviewOrder, 'mondayLinkStatus' | 'mondayLinkCandidates' | 'mondayItemId' | 'orderNumber' | 'isArchived'>,
): string | null {
  // Archived orders are parked on purpose (the on-hold tab). Their Monday
  // link is not something anyone needs to act on, so do not flag them.
  if (order.isArchived) {
    return null
  }

  if (order.mondayLinkStatus === 'duplicate') {
    const detail = (order.mondayLinkCandidates ?? [])
      .map((candidate) => [candidate.name, candidate.boardName].filter(Boolean).join(' · '))
      .filter(Boolean)
      .join(' / ')
    return `Order number ${order.orderNumber} matches more than one Monday card${detail ? `: ${detail}` : ''}. Monday updates are blocked until this is resolved.`
  }

  if (order.mondayLinkStatus === 'not_found' && hasLinkedMondayItem(order)) {
    return `This order has a stored Monday card, but order number ${order.orderNumber} no longer matches anything on Monday. Monday updates are blocked until this is resolved.`
  }

  return null
}

function SubitemsInlinePanel({
  order,
  onOpenOrder,
}: {
  order: OrdersOverviewOrder
  onOpenOrder: (order: OrdersOverviewOrder, mode: JobDetailsMode, initialTab?: JobDetailsTab) => void
}) {
  const queryClient = useQueryClient()
  const [subitems, setSubitems] = useState<OrderDesignPart[]>(Array.isArray(order.subitems) ? order.subitems : [])
  const [savingCell, setSavingCell] = useState('')
  const [saveError, setSaveError] = useState('')
  // Shop-worker responses intentionally hide the Monday board id, so use the
  // order's workflow stage as the reliable fallback when selecting the live
  // subitem-board labels.
  const isDesignSubitems = order.inDesign
    || String(order.mondayBoardId ?? '').trim() === '1064270065'
  const statusOptions = isDesignSubitems
    ? ['Working on it', 'Done', 'Stuck', 'Is Here']
    : ['Working on it', 'Is here', 'Stuck', 'Ordered', 'COM', 'To Be Determined', 'Make In House', 'Partial', 'Partial Receipt', 'By Other', 'In Cart', 'Canceled']

  useEffect(() => {
    setSubitems(Array.isArray(order.subitems) ? order.subitems : [])
  }, [order.subitems])

  const saveSubitemField = async (
    subitem: OrderDesignPart,
    field: 'status' | 'vendor' | 'dateOrdered' | 'dateReceived' | 'dueDate',
    value: string,
  ) => {
    const cellKey = `${subitem.id}:${field}`
    const previous = subitems
    setSaveError('')
    setSavingCell(cellKey)
    setSubitems((current) => current.map((part) => part.id === subitem.id ? { ...part, [field]: value || null } : part))
    try {
      const response = await updateOrderDesignPart(String(order.id), subitem.id, { [field]: value || null })
      setSubitems((current) => current.map((part) => part.id === subitem.id ? response.part : part))
      queryClient.setQueryData<OrdersOverviewResponse>(QUERY_KEYS.ordersOverview, (current) => current
        ? {
            ...current,
            orders: current.orders.map((row) => row.id === order.id
              ? { ...row, subitems: row.subitems.map((part) => part.id === subitem.id ? response.part : part) }
              : row),
          }
        : current)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.orderDesignParts(String(order.id)) })
    } catch (error) {
      setSubitems(previous)
      setSaveError(error instanceof Error ? error.message : 'Could not save the subitem change.')
    } finally {
      setSavingCell('')
    }
  }

  return (
    <Box sx={{ p: 1, bgcolor: '#f8fbff' }}>
      <Typography variant="caption" fontWeight={800} color="primary.main" sx={{ display: 'block', mb: 0.75 }}>
        Subitems for order {order.orderNumber}
      </Typography>
      {saveError ? <Alert severity="error" sx={{ mb: 1, py: 0 }}>{saveError}</Alert> : null}
      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 390, boxShadow: '0 4px 14px rgba(15, 23, 42, 0.08)' }}>
        <Table size="small" stickyHeader sx={{ minWidth: 850 }} aria-label={`Subitems for order ${order.orderNumber}`}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '38%', fontWeight: 800 }}>Subitem</TableCell>
              <TableCell sx={{ width: 150, fontWeight: 800 }}>Status</TableCell>
              <TableCell sx={{ width: 160, fontWeight: 800 }}>Vendor</TableCell>
              <TableCell sx={{ width: 135, fontWeight: 800 }}>PO Date</TableCell>
              <TableCell sx={{ width: 125, fontWeight: 800 }}>Date Received</TableCell>
              <TableCell sx={{ width: 125, fontWeight: 800 }}>Due Date</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {subitems.length ? subitems.map((subitem: OrderDesignPart) => (
              <TableRow key={subitem.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={700}>{subitem.itemName}</Typography>
                  {(subitem.quantity > 1 || subitem.dimensions || subitem.veneerDirection) ? (
                    <Typography variant="caption" color="text.secondary">
                      Qty {subitem.quantity}
                      {subitem.dimensions ? ` · ${subitem.dimensions}` : ''}
                      {subitem.veneerDirection && subitem.veneerDirection !== 'none'
                        ? ` · Veneer along ${subitem.veneerDirection}`
                        : ''}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Select
                    size="small"
                    displayEmpty
                    value={subitem.status || ''}
                    disabled={savingCell === `${subitem.id}:status`}
                    onChange={(event) => void saveSubitemField(subitem, 'status', String(event.target.value))}
                    renderValue={(value) => value
                      ? <Chip size="small" label={String(value)} sx={{ bgcolor: subitem.statusColor || 'rgba(15, 23, 42, 0.08)', fontWeight: 700, pointerEvents: 'none' }} />
                      : <Typography variant="caption" color="text.secondary">Set status</Typography>}
                    sx={{ minWidth: 132, '& .MuiSelect-select': { py: 0.35, pl: 0.75 } }}
                  >
                    <MenuItem value=""><em>No status</em></MenuItem>
                    {statusOptions.map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}
                  </Select>
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    value={subitem.vendor || ''}
                    placeholder="Add vendor"
                    disabled={savingCell === `${subitem.id}:vendor`}
                    onChange={(event) => {
                      const vendor = event.target.value
                      setSubitems((current) => current.map((part) => (
                        part.id === subitem.id ? { ...part, vendor } : part
                      )))
                    }}
                    onBlur={(event) => void saveSubitemField(subitem, 'vendor', event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.querySelector('input')?.blur()
                    }}
                    inputProps={{ 'aria-label': `Vendor for ${subitem.itemName}`, maxLength: 260 }}
                    sx={{ width: 155, '& input': { py: 0.8, px: 1, fontSize: '0.75rem' } }}
                  />
                </TableCell>
                {(['dateOrdered', 'dateReceived', 'dueDate'] as const).map((field) => (
                  <TableCell key={field}>
                    <TextField
                      type="date"
                      size="small"
                      value={subitem[field] || ''}
                      disabled={savingCell === `${subitem.id}:${field}`}
                      onChange={(event) => void saveSubitemField(subitem, field, event.target.value)}
                      inputProps={{ 'aria-label': `${field} for ${subitem.itemName}` }}
                      sx={{ width: 132, '& input': { py: 0.8, px: 1, fontSize: '0.75rem' } }}
                    />
                  </TableCell>
                ))}
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 2.5, color: 'text.secondary' }}>
                  No subitems have been added to this order.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
        <Button size="small" onClick={() => onOpenOrder(order, 'details', 'parts')}>
          Open order to add or edit subitems
        </Button>
      </Stack>
    </Box>
  )
}

type OrdersGridRow = OrdersOverviewOrder & {
  __subitemPanel?: boolean
  __parentOrder?: OrdersOverviewOrder
}

type TrackedProgressStageState = {
  key: (typeof mondayProgressBreakdownConfig)[number]['key']
  label: (typeof mondayProgressBreakdownConfig)[number]['label']
  index: number
  status: WebsiteProgressStatusKey
}

const mondayProgressStageLabelByKey = ORDER_PROGRESS_STAGE_LABEL_BY_KEY

const normalizeProgressStatusKey = normalizeProgressStageKey

const normalizeWebsiteProgressStatusKey = normalizeProgressStageStatus

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
      stageLabel: 'Open',
      isFinalReady: false,
    }
  }

  if (normalizedStatus === 'ready') {
    return {
      tone: 'finalReady' as RowStatusVisualTone,
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
      stageLabel: stageLabel || rawStatus,
      isFinalReady: false,
    }
  }

  if (
    normalizedStatus === 'stuck'
    || normalizedStatus === 'stock'
    || normalizedStatus.endsWith(' stuck')
    || normalizedStatus.endsWith(' stock')
  ) {
    const stuckSuffix = normalizedStatus.endsWith(' stock')
      ? ' stock'
      : normalizedStatus.endsWith(' stuck')
        ? ' stuck'
        : ''
    const stageLabel = stuckSuffix
      ? rawStatus.slice(0, rawStatus.length - stuckSuffix.length).trim()
      : rawStatus

    return {
      tone: 'stuck' as RowStatusVisualTone,
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
      stageLabel: stageLabel || rawStatus,
      isFinalReady: false,
    }
  }

  return {
    tone: 'neutral' as RowStatusVisualTone,
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
    : tone === 'finalReady' || tone === 'stageReady'
      ? greenPalette
      : defaultYellowPalette

  return stagePalette
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
  if (order.warrantyIssueActive) {
    return order.warrantyIssueLeadTimeDate || null
  }

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
  if (order.isShipped && !order.warrantyIssueActive) {
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

function formatPaidStatus(value: unknown) {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return ''
}

function comparePaidStatus(left: unknown, right: unknown) {
  const leftLabel = String(left ?? '').trim()
  const rightLabel = String(right ?? '').trim()
  const leftKnown = Boolean(leftLabel)
  const rightKnown = Boolean(rightLabel)

  if (!leftKnown && !rightKnown) {
    return 0
  }

  if (!leftKnown) {
    return 1
  }

  if (!rightKnown) {
    return -1
  }

  if (leftLabel === rightLabel) {
    return 0
  }

  return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: 'base' })
}

function filterItemIsActive(item: GridFilterItem | undefined) {
  if (!item?.field || !item.operator) return false
  if (item.operator === 'isEmpty' || item.operator === 'isNotEmpty') return true
  if (item.operator === 'isAnyOf') return Array.isArray(item.value) && item.value.length > 0
  return item.value !== undefined && item.value !== null && String(item.value).trim() !== ''
}

function rowValueMatchesFilter(value: unknown, item: GridFilterItem) {
  const operator = String(item.operator || 'contains')
  const valueIsEmpty = value === undefined || value === null || String(value).trim() === ''

  if (operator === 'isEmpty') return valueIsEmpty
  if (operator === 'isNotEmpty') return !valueIsEmpty

  const normalizedValue = String(value ?? '').trim().toLowerCase()
  const normalizedFilter = String(item.value ?? '').trim().toLowerCase()

  if (operator === 'contains') return normalizedValue.includes(normalizedFilter)
  if (operator === 'doesNotContain') return !normalizedValue.includes(normalizedFilter)
  if (operator === 'startsWith') return normalizedValue.startsWith(normalizedFilter)
  if (operator === 'endsWith') return normalizedValue.endsWith(normalizedFilter)
  if (operator === 'equals' || operator === '=' || operator === 'is') return normalizedValue === normalizedFilter
  if (operator === 'doesNotEqual' || operator === '!=' || operator === 'not') return normalizedValue !== normalizedFilter
  if (operator === 'isAnyOf') {
    return Array.isArray(item.value)
      && item.value.some((entry) => normalizedValue === String(entry ?? '').trim().toLowerCase())
  }

  const valueNumber = Number(value)
  const filterNumber = Number(item.value)
  if (Number.isFinite(valueNumber) && Number.isFinite(filterNumber)) {
    if (operator === '>') return valueNumber > filterNumber
    if (operator === '>=') return valueNumber >= filterNumber
    if (operator === '<') return valueNumber < filterNumber
    if (operator === '<=') return valueNumber <= filterNumber
  }

  const valueDate = Date.parse(String(value ?? ''))
  const filterDate = Date.parse(String(item.value ?? ''))
  if (Number.isFinite(valueDate) && Number.isFinite(filterDate)) {
    if (operator === 'after') return valueDate > filterDate
    if (operator === 'onOrAfter') return valueDate >= filterDate
    if (operator === 'before') return valueDate < filterDate
    if (operator === 'onOrBefore') return valueDate <= filterDate
  }

  return normalizedValue.includes(normalizedFilter)
}

function resolveDepositReceivedStatus(order: OrdersOverviewOrder) {
  const hasRecordedPaymentAmount = order.paymentAmount !== null && order.paymentAmount !== undefined
  const rawPaymentAmount = hasRecordedPaymentAmount ? Number(order.paymentAmount) : Number.NaN
  const paymentAmount = Number.isFinite(rawPaymentAmount) ? Math.max(0, rawPaymentAmount) : null
  const hasPayment = paymentAmount !== null && paymentAmount > 0.004

  if (hasPayment) {
    return {
      label: 'Yes',
      paymentAmount,
      source: 'quickbooks' as const,
    }
  }

  if (order.hasQuickBooksRecord) {
    return { label: 'No', paymentAmount: paymentAmount ?? 0, source: 'quickbooks' as const }
  }

  if (order.depositReceivedDate) {
    return { label: 'Yes', paymentAmount: null, source: 'monday' as const }
  }

  return { label: 'No', paymentAmount: paymentAmount ?? 0, source: 'none' as const }
}

type OrdersGridProps = {
  orders: OrdersOverviewOrder[]
  activeTab: OrdersListTab
  viewMode: OrdersViewMode
  canEditMondayStages: boolean
  canEditOrderInfo: boolean
  columnPreferenceKey: string
  canViewOrderValue: boolean
  canViewFullFinancials: boolean
  lastRefreshedAt: string | null
  isLoading: boolean
  shopDrawingHandle: React.MutableRefObject<ShopDrawingPreviewHandle | null>
  onOpenBolDocument: (order: OrdersOverviewOrder) => void
  onOpenDocumentPreview: (title: string, url: string) => void
  onOpenCutListDocument: (order: OrdersOverviewOrder) => void
  onOpenInvoiceDocument: (order: OrdersOverviewOrder) => void
  onOpenJobDialog: (order: OrdersOverviewOrder, mode: JobDetailsMode, initialTab?: JobDetailsTab) => void
  onOpenQuickBooksDialog: (
    order: OrdersOverviewOrder,
    metric: OrdersQuickBooksDrilldownMetric,
  ) => void
  onCopyOrderNumber: (orderNumber: string) => void
  onOpenOrderChat: (order: OrdersOverviewOrder) => void
  canDuplicateOrders: boolean
  onDuplicateOrder: (order: OrdersOverviewOrder) => void
  canDeleteOrders: boolean
  onDeleteOrder: (order: OrdersOverviewOrder) => void
  onArchiveOrder: (order: OrdersOverviewOrder, archived: boolean) => void
  onLinkOrder: (order: OrdersOverviewOrder) => void
  onMissingMondayLink: () => void
  onCurrentBoardExportChange: (board: OrdersBoardExport) => void
}

export function OrdersGrid({
  orders,
  activeTab,
  viewMode,
  canEditMondayStages,
  canEditOrderInfo,
  columnPreferenceKey,
  canViewOrderValue,
  canViewFullFinancials,
  lastRefreshedAt,
  isLoading,
  shopDrawingHandle,
  onOpenBolDocument,
  onOpenDocumentPreview,
  onOpenCutListDocument,
  onOpenInvoiceDocument,
  onOpenJobDialog,
  onOpenQuickBooksDialog,
  onCopyOrderNumber,
  onOpenOrderChat,
  canDuplicateOrders,
  onDuplicateOrder,
  canDeleteOrders,
  onDeleteOrder,
  onArchiveOrder,
  onLinkOrder,
  onMissingMondayLink,
  onCurrentBoardExportChange,
}: OrdersGridProps) {
  const queryClient = useQueryClient()
  const gridApiRef = useGridApiRef()
  const filterIdSequenceRef = useRef(0)
  const editorFilterIdRef = useRef<string | number | null>(null)
  const pendingAdditionalFilterIdRef = useRef<string | number | null>(null)
  const statusColumnHeader = activeTab === 'shipped'
    ? 'Ship Date'
    : activeTab === 'archive'
      ? 'Archived'
      : 'Job Status'
  const [rowSelectionModel, setRowSelectionModel] = useState<GridRowSelectionModel>({
    type: 'include',
    ids: new Set(),
  })
  const [filterModel, setFilterModel] = useState<GridFilterModel>({ items: [] })
  const [columnFilterItems, setColumnFilterItems] = useState<GridFilterItem[]>([])
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    pageSize: 50,
    page: 0,
  })
  const [statusPopoverAnchorEl, setStatusPopoverAnchorEl] = useState<HTMLElement | null>(null)
  const [statusPopoverOrder, setStatusPopoverOrder] = useState<OrdersOverviewOrder | null>(null)
  const [statusPopoverError, setStatusPopoverError] = useState<string | null>(null)
  const [isStatusPopoverLoading, setIsStatusPopoverLoading] = useState(false)
  const [updatingStatusColumnKey, setUpdatingStatusColumnKey] = useState<string | null>(null)
  const [actionsAnchorEl, setActionsAnchorEl] = useState<HTMLElement | null>(null)
  const [actionsOrder, setActionsOrder] = useState<OrdersOverviewOrder | null>(null)
  const [columnsMenuAnchorEl, setColumnsMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [showSubitemsInline, setShowSubitemsInline] = useState(false)
  const [expandedSubitemOrderIds, setExpandedSubitemOrderIds] = useState<Set<string>>(() => new Set())
  const [columnOrder, setColumnOrder] = useState<string[]>([])
  const [hiddenColumnFields, setHiddenColumnFields] = useState<Set<string>>(() => new Set())
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [personalViews, setPersonalViews] = useState<OrdersPersonalView[]>([DEFAULT_PERSONAL_VIEW])
  const [activePersonalViewId, setActivePersonalViewId] = useState(DEFAULT_PERSONAL_VIEW.id)
  const [personalViewsLoaded, setPersonalViewsLoaded] = useState(false)
  const [newViewDialogOpen, setNewViewDialogOpen] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [draggedColumnField, setDraggedColumnField] = useState<string | null>(null)
  const [loadedColumnStorageKey, setLoadedColumnStorageKey] = useState('')
  const [editingBenchOrderId, setEditingBenchOrderId] = useState('')
  const [benchDraft, setBenchDraft] = useState('')
  const [savingBenchOrderId, setSavingBenchOrderId] = useState('')
  const [benchEditError, setBenchEditError] = useState<string | null>(null)
  const [quickEditOrder, setQuickEditOrder] = useState<OrdersOverviewOrder | null>(null)
  const [quickEditProjectName, setQuickEditProjectName] = useState('')
  const [quickEditSalesRep, setQuickEditSalesRep] = useState('')
  const [quickEditPoNumber, setQuickEditPoNumber] = useState('')
  const [quickEditBench, setQuickEditBench] = useState('')
  const [quickEditSaving, setQuickEditSaving] = useState(false)
  const [quickEditError, setQuickEditError] = useState('')

  const handleOpenActionsMenu = useCallback((event: React.MouseEvent<HTMLElement>, order: OrdersOverviewOrder) => {
    event.preventDefault()
    event.stopPropagation()
    setActionsAnchorEl(event.currentTarget)
    setActionsOrder(order)
  }, [])

  const handleCloseActionsMenu = useCallback(() => {
    setActionsAnchorEl(null)
    setActionsOrder(null)
  }, [])

  const handleOpenQuickEdit = useCallback((order: OrdersOverviewOrder) => {
    setQuickEditOrder(order)
    setQuickEditProjectName(String(order.orderName ?? '').trim())
    setQuickEditSalesRep(String(order.salesRep ?? '').trim())
    setQuickEditPoNumber(String(order.poNumber ?? '').trim())
    setQuickEditBench(String(order.bench ?? '').trim())
    setQuickEditError('')
  }, [])

  const handleCancelQuickEdit = useCallback(() => {
    if (quickEditSaving) return
    setQuickEditOrder(null)
    setQuickEditError('')
  }, [quickEditSaving])

  const handleSaveQuickEdit = useCallback(async () => {
    if (!quickEditOrder || quickEditSaving) return
    const mondayItemId = String(quickEditOrder.mondayItemId ?? '').trim()
    const orderName = quickEditProjectName.trim()
    if (!mondayItemId || !orderName) {
      setQuickEditError('Project name is required.')
      return
    }
    setQuickEditSaving(true)
    setQuickEditError('')
    try {
      await postOrdersOrderDetailsUpdate({
        mondayItemId,
        orderName,
        salesRep: quickEditSalesRep.trim(),
        poNumber: quickEditPoNumber.trim(),
        bench: quickEditBench.trim(),
      })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
      setQuickEditOrder(null)
    } catch (error) {
      setQuickEditError(error instanceof Error ? error.message : 'Could not save order changes.')
    } finally {
      setQuickEditSaving(false)
    }
  }, [queryClient, quickEditBench, quickEditOrder, quickEditPoNumber, quickEditProjectName, quickEditSalesRep, quickEditSaving])

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

  const handleSaveBench = useCallback(async (order: OrdersOverviewOrder) => {
    const mondayItemId = String(order.mondayItemId ?? '').trim()
    const orderId = String(order.id ?? '').trim()

    if (!canEditOrderInfo || !mondayItemId || !orderId) {
      setBenchEditError('This order is not linked to Monday, so Bench cannot be updated.')
      return
    }

    setSavingBenchOrderId(orderId)
    setBenchEditError(null)

    try {
      await postOrdersOrderDetailsUpdate({
        mondayItemId,
        bench: benchDraft.trim(),
      })
      setEditingBenchOrderId('')
      setBenchDraft('')
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
    } catch (error) {
      setBenchEditError(
        error instanceof Error ? error.message : 'Could not update Bench.',
      )
    } finally {
      setSavingBenchOrderId('')
    }
  }, [benchDraft, canEditOrderInfo, queryClient])

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
      sortComparator: compareOrderNumbers,
      renderCell: ({ row }) => {
        const canOpenDetails = hasLinkedMondayItem(row) || activeTab === 'design' || activeTab === 'waiting_production'

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
          {describeMondayLinkIssue(row) ? (
            <Tooltip title={describeMondayLinkIssue(row)}>
              <Chip
                size="small"
                color="error"
                variant="outlined"
                label="Link"
                sx={{ height: 20, fontWeight: 800, fontSize: '0.62rem' }}
              />
            </Tooltip>
          ) : null}
          {row.warrantyIssueActive ? (
            <Chip
              size="small"
              color="warning"
              label="Warranty"
              sx={{ height: 22, fontWeight: 800 }}
            />
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
          {canEditOrderInfo && hasLinkedMondayItem(row) ? (
            String(quickEditOrder?.id ?? '') === String(row.id ?? '') ? (
              <>
                <IconButton
                  size="small"
                  color="primary"
                  aria-label={`Save ${row.orderNumber}`}
                  title="Save changes"
                  disabled={quickEditSaving || !quickEditProjectName.trim()}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void handleSaveQuickEdit()
                  }}
                  sx={{ p: 0.15 }}
                >
                  {quickEditSaving ? <CircularProgress size={15} /> : <SaveRoundedIcon sx={{ fontSize: '1rem' }} />}
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={`Cancel editing ${row.orderNumber}`}
                  title="Cancel"
                  disabled={quickEditSaving}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    handleCancelQuickEdit()
                  }}
                  sx={{ p: 0.15 }}
                >
                  <CloseRoundedIcon sx={{ fontSize: '1rem' }} />
                </IconButton>
              </>
            ) : (
              <IconButton
                size="small"
                aria-label={`Quick edit ${row.orderNumber}`}
                title="Edit this row"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  handleOpenQuickEdit(row)
                }}
                sx={{ p: 0.15, color: 'primary.main' }}
              >
                <EditRoundedIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
            )
          ) : null}
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
      headerName: 'Customer Name',
      minWidth: 190,
      width: 220,
      sortable: false,
      renderCell: ({ row }) => String(quickEditOrder?.id ?? '') === String(row.id ?? '') ? (
        <TextField
          size="small"
          fullWidth
          required
          value={quickEditProjectName}
          disabled={quickEditSaving}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setQuickEditProjectName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleSaveQuickEdit()
            if (event.key === 'Escape') handleCancelQuickEdit()
          }}
        />
      ) : (
        <Typography
          variant="body2"
          sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={resolveSourceLabel(row)}
        >
          {row.warrantyIssueActive
            ? `Warranty — ${resolveDisplayOrderName(row)}`
            : resolveDisplayOrderName(row)}
        </Typography>
      ),
    },
    {
      field: 'poNumber',
      headerName: 'PO Number',
      minWidth: 130,
      width: 140,
      sortable: false,
      renderCell: ({ row }) => String(quickEditOrder?.id ?? '') === String(row.id ?? '') ? (
        <TextField
          size="small"
          fullWidth
          value={quickEditPoNumber}
          disabled={quickEditSaving}
          placeholder="PO number"
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setQuickEditPoNumber(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleSaveQuickEdit()
            if (event.key === 'Escape') handleCancelQuickEdit()
          }}
        />
      ) : (
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
      headerName: 'Job Status',
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

        if (!hasLinkedMondayItem(row)) {
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
      headerName: 'Internal Note',
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

        if (!hasLinkedMondayItem(row)) {
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
      field: 'bench',
      headerName: 'Bench',
      minWidth: 150,
      width: 230,
      sortable: false,
      renderCell: ({ row }) => {
        const orderId = String(row.id ?? '').trim()
        const isQuickEditing = String(quickEditOrder?.id ?? '') === orderId
        const isEditing = editingBenchOrderId === orderId
        const isSaving = savingBenchOrderId === orderId

        if (isQuickEditing) {
          return (
            <TextField
              size="small"
              fullWidth
              value={quickEditBench}
              disabled={quickEditSaving}
              placeholder="Bench"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setQuickEditBench(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleSaveQuickEdit()
                if (event.key === 'Escape') handleCancelQuickEdit()
              }}
            />
          )
        }

        if (isEditing) {
          return (
            <Stack
              direction="row"
              spacing={0.25}
              alignItems="center"
              sx={{ width: '100%' }}
              onClick={(event) => event.stopPropagation()}
            >
              <TextField
                size="small"
                value={benchDraft}
                autoFocus
                fullWidth
                placeholder="Bench"
                disabled={isSaving}
                onChange={(event) => setBenchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleSaveBench(row)
                  } else if (event.key === 'Escape') {
                    setEditingBenchOrderId('')
                    setBenchDraft('')
                  }
                }}
              />
              <IconButton
                size="small"
                color="primary"
                disabled={isSaving}
                aria-label="Save Bench"
                onClick={() => void handleSaveBench(row)}
              >
                {isSaving ? <CircularProgress size={15} /> : <SaveRoundedIcon fontSize="small" />}
              </IconButton>
              <IconButton
                size="small"
                disabled={isSaving}
                aria-label="Cancel Bench edit"
                onClick={() => {
                  setEditingBenchOrderId('')
                  setBenchDraft('')
                }}
              >
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          )
        }

        return (
          <Stack direction="row" spacing={0.35} alignItems="center" sx={{ width: '100%', minWidth: 0 }}>
            <Typography variant="body2" title={row.bench ?? ''} noWrap sx={{ flex: 1 }}>
              {row.bench || '—'}
            </Typography>
            {canEditOrderInfo && hasLinkedMondayItem(row) ? (
              <Tooltip title="Edit Bench">
                <IconButton
                  size="small"
                  aria-label={`Edit Bench for ${row.orderNumber}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setBenchEditError(null)
                    setEditingBenchOrderId(orderId)
                    setBenchDraft(String(row.bench ?? ''))
                  }}
                >
                  <EditRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Stack>
        )
      },
    },
    {
      field: 'orderType',
      headerName: 'Order Type',
      minWidth: 130,
      sortable: false,
      valueGetter: (_value, row) => (
        row.warrantyIssueActive
          ? 'Warranty'
          : row.isShipped
            ? 'Shipped'
            : row.inDesign
              ? 'Design'
              : 'Production'
      ),
      renderCell: ({ row }) => (
        <Chip
          size="small"
          variant="outlined"
          label={
            row.warrantyIssueActive
              ? 'Warranty'
              : row.isShipped
                ? 'Shipped'
                : row.inDesign
                  ? 'Design'
                  : 'Production'
          }
        />
      ),
    },
    {
      field: 'salesRep',
      headerName: 'Sales Representative',
      minWidth: 170,
      width: 190,
      renderCell: ({ row }) => String(quickEditOrder?.id ?? '') === String(row.id ?? '') ? (
        <TextField
          size="small"
          fullWidth
          value={quickEditSalesRep}
          disabled={quickEditSaving}
          placeholder="Sales representative"
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setQuickEditSalesRep(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleSaveQuickEdit()
            if (event.key === 'Escape') handleCancelQuickEdit()
          }}
        />
      ) : (row.salesRep || '—'),
    },
    {
      field: 'depositReceived',
      headerName: 'Deposit Received',
      minWidth: 155,
      width: 170,
      valueGetter: (_value, row) => resolveDepositReceivedStatus(row).label,
      renderCell: ({ row }) => {
        const status = resolveDepositReceivedStatus(row)
        const tooltip = status.label === 'Yes'
          ? status.paymentAmount !== null
            ? `Details: ${formatCurrency(status.paymentAmount, 2)} paid`
            : 'Details: Marked received in Monday; QuickBooks payment amount is unavailable.'
          : ''

        return (
          <Tooltip title={tooltip}>
            <Chip
              size="small"
              label={status.label}
              color={status.label === 'No' ? 'warning' : 'success'}
              variant="outlined"
            />
          </Tooltip>
        )
      },
    },
    {
      field: 'depositTerms',
      headerName: 'Deposit Terms',
      minWidth: 150,
      sortable: false,
      valueGetter: (_value, row) => (
        row.depositRequired === false
          ? 'No deposit required'
          : Number.isFinite(Number(row.depositPercent))
            ? `${Number(row.depositPercent)}% required`
            : row.depositRequired === true
              ? 'Deposit required'
              : ''
      ),
      renderCell: ({ row }) => (
        row.depositRequired === false
          ? 'No deposit required'
          : Number.isFinite(Number(row.depositPercent))
            ? `${Number(row.depositPercent)}% required`
            : row.depositRequired === true
              ? 'Deposit required'
              : '—'
      ),
    },
    {
      field: 'orderValue',
      headerName: 'Order Value',
      minWidth: 130,
      type: 'number',
      renderCell: ({ row }) => Number.isFinite(Number(row.orderValue))
        ? formatCurrency(Number(row.orderValue), 2)
        : '—',
    },
    {
      field: 'freightValue',
      headerName: 'Freight Value',
      minWidth: 130,
      type: 'number',
      renderCell: ({ row }) => Number.isFinite(Number(row.freightValue))
        ? formatCurrency(Number(row.freightValue), 2)
        : '—',
    },
    {
      field: 'cutListDocument',
      headerName: 'Cut List',
      minWidth: 115,
      sortable: false,
      renderCell: ({ row }) => row.cutListCachedUrl || row.cutListUrl ? (
        <IconButton size="small" aria-label="Open cut list" title="Open cut list" onClick={() => onOpenCutListDocument(row)}>
          <PictureAsPdfRoundedIcon fontSize="inherit" />
        </IconButton>
      ) : <Typography variant="body2" color="text.secondary">—</Typography>,
    },
    {
      field: 'invoiceDocument',
      headerName: 'Invoice',
      minWidth: 110,
      sortable: false,
      renderCell: ({ row }) => row.hasInvoiceDocument ? (
        <IconButton size="small" aria-label="Open invoice" title="Open invoice" onClick={() => onOpenInvoiceDocument(row)}>
          <PictureAsPdfRoundedIcon fontSize="inherit" />
        </IconButton>
      ) : <Typography variant="body2" color="text.secondary">—</Typography>,
    },
    {
      field: 'orderConfirmationDocument',
      headerName: 'Order Confirmation',
      minWidth: 165,
      sortable: false,
      renderCell: ({ row }) => row.orderConfirmationUrl ? (
        <IconButton size="small" aria-label="Open order confirmation" title="Open order confirmation" onClick={() => onOpenDocumentPreview('Order confirmation', row.orderConfirmationUrl!)}>
          <PictureAsPdfRoundedIcon fontSize="inherit" />
        </IconButton>
      ) : <Typography variant="body2" color="text.secondary">—</Typography>,
    },
    {
      field: 'signedBolDocument',
      headerName: 'Driver Signed BOL',
      minWidth: 145,
      sortable: false,
      renderCell: ({ row }) => row.signedBolUrl ? (
        <IconButton size="small" aria-label="Open driver signed BOL" title="Open driver signed BOL" onClick={() => onOpenDocumentPreview('Driver signed BOL', row.signedBolUrl!)}>
          <PictureAsPdfRoundedIcon fontSize="inherit" />
        </IconButton>
      ) : <Typography variant="body2" color="text.secondary">—</Typography>,
    },
    {
      field: 'customerSignedBolDocument',
      headerName: 'Customer Signed BOL',
      minWidth: 160,
      sortable: false,
      renderCell: ({ row }) => row.customerSignedBolUrl ? (
        <IconButton size="small" aria-label="Open customer signed BOL" title="Open customer signed BOL" onClick={() => onOpenDocumentPreview('Customer signed BOL', row.customerSignedBolUrl!)}>
          <PictureAsPdfRoundedIcon fontSize="inherit" />
        </IconButton>
      ) : <Typography variant="body2" color="text.secondary">—</Typography>,
    },
    {
      field: 'inspectionDocument',
      headerName: 'BOL Inspection',
      minWidth: 135,
      sortable: false,
      renderCell: ({ row }) => row.inspectionSheetUrl ? (
        <IconButton size="small" aria-label="Open BOL inspection" title="Open BOL inspection" onClick={() => onOpenDocumentPreview('BOL inspection', row.inspectionSheetUrl!)}>
          <PictureAsPdfRoundedIcon fontSize="inherit" />
        </IconButton>
      ) : <Typography variant="body2" color="text.secondary">—</Typography>,
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
      minWidth: 185,
      sortable: false,
      renderHeader: () => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography component="span" variant="caption" fontWeight={800}>
            {statusColumnHeader}
          </Typography>
          {activeTab !== 'shipped' && activeTab !== 'archive' ? (
            <Tooltip
              title={
                <Stack spacing={0.35} sx={{ py: 0.25 }}>
                  <Typography variant="caption"><strong>Working on it</strong> — yellow</Typography>
                  <Typography variant="caption"><strong>Ready</strong> — green</Typography>
                  <Typography variant="caption"><strong>Stock</strong> — red</Typography>
                </Stack>
              }
            >
              <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            </Tooltip>
          ) : null}
        </Stack>
      ),
      renderCell: ({ row }) => {
        if (activeTab === 'archive') {
          return (
            <Chip
              size="small"
              label={row.archivedAt ? formatDate(row.archivedAt) : 'Archived'}
              color="default"
              variant="outlined"
            />
          )
        }

        if (row.warrantyIssueActive) {
          const leadTimeDate = String(row.warrantyIssueLeadTimeDate ?? '').trim()
          return (
            <Chip
              size="small"
              color="warning"
              variant="filled"
              label={leadTimeDate ? `Warranty • Due ${formatDate(leadTimeDate)}` : 'Warranty'}
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
        const tooltipTitle = row.isShipped && isWarningShippedDate
          ? shippedDateLabel
            ? `Ship Date is missing in Monday; fallback date is anchored to first shipped detection (${shippedDateLabel}).`
            : 'Ship Date is missing in Monday.'
          : null

        if (!row.isShipped) {
          const canOpenMondayStatus = hasLinkedMondayItem(row)

          return (
            <Box
              role={canOpenMondayStatus ? 'button' : undefined}
              tabIndex={canOpenMondayStatus ? 0 : -1}
              onClick={(event) => {
                if (!canOpenMondayStatus) {
                  return
                }
                handleOpenStatusPopover(event as unknown as React.MouseEvent<HTMLElement>, row)
              }}
              onKeyDown={(event) => {
                if (!canOpenMondayStatus) {
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
                minHeight: 34,
                px: 0.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: canOpenMondayStatus ? 'pointer' : 'default',
                ...(showStageChrome
                  ? {
                    borderRadius: 1,
                    border: `1px solid ${rowStatusPalette.stageBorder}`,
                    bgcolor: rowStatusPalette.stageBg,
                  }
                  : {
                    borderRadius: 1,
                    border: `1px solid ${designStatusVisual?.borderColor || 'rgba(15, 23, 42, 0.18)'}`,
                    bgcolor: designStatusVisual?.solidBg || designStatusVisual?.panelBg || 'rgba(15, 23, 42, 0.08)',
                  }),
              }}
            >
              <Typography
                component="span"
                variant="body2"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  px: 0.35,
                  py: 0.45,
                  width: '100%',
                  borderRadius: 0.8,
                  border: 'none',
                  bgcolor: 'transparent',
                  color: showStageChrome
                    ? rowStatusPalette.stageText
                    : (designStatusVisual?.textColor || '#ffffff'),
                  fontSize: rowStatusVisual.isFinalReady ? '1rem' : '0.92rem',
                  fontWeight: 900,
                  lineHeight: 1.08,
                }}
              >
                {rowStatusVisual.stageLabel}
              </Typography>
            </Box>
          )
        }

        const canOpenMondayStatus = hasLinkedMondayItem(row)

        return (
          <Tooltip title={tooltipTitle ?? ''} disableHoverListener={!tooltipTitle}>
            <Chip
              size="small"
              label={statusLabel}
              color={isWarningShippedDate ? 'warning' : 'success'}
              variant="filled"
              onClick={(event) => {
                if (!canOpenMondayStatus) {
                  return
                }
                handleOpenStatusPopover(event, row)
              }}
              clickable={canOpenMondayStatus}
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
        if (row.isShipped && !row.warrantyIssueActive) {
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
          return (
            <Typography variant="body2" color={row.warrantyIssueActive ? 'warning.dark' : 'text.secondary'}>
              {row.warrantyIssueActive ? 'Warranty lead time not set' : '—'}
            </Typography>
          )
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
      valueGetter: (_value, row) => formatPaidStatus(row.paidInFull),
      sortComparator: comparePaidStatus,
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
      headerName: 'Actions',
      minWidth: 96,
      width: 104,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      align: 'center',
      headerAlign: 'center',
      renderCell: ({ row }) => {
        return (
          <IconButton
            size="small"
            aria-label={`Actions for order ${row.orderNumber}`}
            title="Order actions"
            onClick={(event) => handleOpenActionsMenu(event, row)}
          >
            <MoreVertRoundedIcon fontSize="small" />
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
    canDeleteOrders,
    onDeleteOrder,
    onLinkOrder,
    onMissingMondayLink,
    handleOpenStatusPopover,
    handleOpenActionsMenu,
    canEditOrderInfo,
    quickEditOrder,
    quickEditProjectName,
    quickEditSalesRep,
    quickEditPoNumber,
    quickEditBench,
    quickEditSaving,
    handleOpenQuickEdit,
    handleCancelQuickEdit,
    handleSaveQuickEdit,
    editingBenchOrderId,
    savingBenchOrderId,
    benchDraft,
    handleSaveBench,
  ])

  const standardColumns = useMemo<GridColDef<OrdersOverviewOrder>[]>(() => {
    const standardColumnSpecs = activeTab === 'design'
      ? [
        { field: 'orderNumber', label: 'Order #' },
        { field: 'orderName', label: 'Customer Name' },
        { field: 'rowStatus', label: 'Design' },
        { field: 'orderDate', label: 'PO Date' },
        { field: 'poNumber', label: 'PO Number' },
        { field: 'description', label: 'Description' },
        { field: 'depositReceived', label: 'Deposit Received' },
        { field: 'shopDrawingUrl', label: 'Shop Drawings' },
        { field: 'mondayLink', label: 'Actions' },
      ] as const
      : activeTab === 'archive'
        ? [
          { field: 'orderNumber', label: 'Order #' },
          { field: 'orderName', label: 'Customer Name' },
          { field: 'rowStatus', label: 'Archived' },
          { field: 'orderDate', label: 'Order Date' },
          { field: 'mondayLink', label: 'Actions' },
        ] as const
      : [
        { field: 'orderNumber', label: 'Order' },
        { field: 'orderName', label: 'Customer Name' },
        { field: 'poNumber', label: 'PO Number' },
        { field: 'shopDrawingUrl', label: 'Drawings' },
        { field: 'rowStatus', label: statusColumnHeader },
        { field: 'managerReadyPercent', label: 'Status History' },
        { field: 'leadTimeDays', label: 'Lead Time' },
        { field: 'orderDate', label: 'Order Date' },
        { field: 'paidInFull', label: 'Paid' },
        { field: 'mondayLink', label: 'Actions' },
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

  const availableColumns = useMemo(() => {
    const standardFields = new Set(
      standardColumns.map((column) => String(column.field)),
    )
    const optionalFields = new Set([
      'description',
      'notes',
      'bench',
      'salesRep',
      'depositReceived',
      'orderValue',
      'freightValue',
      'cutListDocument',
      'invoiceDocument',
      'orderConfirmationDocument',
      'signedBolDocument',
      'customerSignedBolDocument',
      'inspectionDocument',
      'shipTo',
      'shipNotes',
      'bol',
      'totalHours',
    ])
    const adminOnlyFields = new Set([
      'invoiceNumber',
      'billedAmount',
      'billBalanceAmount',
      'remainingToBill',
      'poAmount',
      'invoiceAmount',
      'amountOwed',
      'totalLaborCost',
      'totalProfit',
    ])
    const orderValueFields = new Set([
      'orderValue',
      'freightValue',
      'salesRep',
      'depositReceived',
    ])
    const eligibleAdminColumns = adminColumns.filter((column) => {
      const field = String(column.field)
      if (!standardFields.has(field) && !optionalFields.has(field) && !adminOnlyFields.has(field)) {
        return false
      }
      if (adminOnlyFields.has(field) && !canViewFullFinancials) return false
      if (orderValueFields.has(field) && !canViewOrderValue) return false
      return true
    })
    const eligibleByField = new Map(
      eligibleAdminColumns.map((column) => [String(column.field), column]),
    )
    const preferredBase = viewMode === 'admin' ? eligibleAdminColumns : standardColumns
    const result: GridColDef<OrdersOverviewOrder>[] = []
    const seen = new Set<string>()

    ;[...preferredBase, ...eligibleAdminColumns].forEach((column) => {
      const field = String(column.field)
      const eligibleColumn = eligibleByField.get(field)
      if (!eligibleColumn || seen.has(field)) return
      seen.add(field)
      result.push(
        preferredBase.includes(column)
          ? column
          : eligibleColumn,
      )
    })

    return result
  }, [
    adminColumns,
    canViewFullFinancials,
    canViewOrderValue,
    standardColumns,
    viewMode,
  ])

  const personalViewsStorageKey = useMemo(
    () => `arnold:orders-views:v2:${columnPreferenceKey || 'anonymous'}:${activeTab}`,
    [activeTab, columnPreferenceKey],
  )

  const legacyPersonalViewsStorageKey = useMemo(
    () => `arnold:orders-views:v1:${columnPreferenceKey || 'anonymous'}`,
    [columnPreferenceKey],
  )

  const columnStorageKey = useMemo(
    () => `arnold:orders-view-layout:v2:${columnPreferenceKey || 'anonymous'}:${activeTab}:${activePersonalViewId}`,
    [activePersonalViewId, activeTab, columnPreferenceKey],
  )

  const legacyColumnStorageKey = useMemo(
    () => `arnold:orders-view-layout:v1:${columnPreferenceKey || 'anonymous'}:${activePersonalViewId}`,
    [activePersonalViewId, columnPreferenceKey],
  )

  useEffect(() => {
    let storedViews: OrdersPersonalView[] = [DEFAULT_PERSONAL_VIEW]
    let storedActiveViewId = DEFAULT_PERSONAL_VIEW.id

    try {
      // Before views were tab-specific, there was one shared set. Keep it on
      // the default Orders tab during this one-way migration; never copy it
      // into the other tabs.
      const raw = window.localStorage.getItem(personalViewsStorageKey)
        ?? (activeTab === 'orders'
          ? window.localStorage.getItem(legacyPersonalViewsStorageKey)
          : null)
      if (raw) {
        const parsed = JSON.parse(raw) as OrdersPersonalViewsStorage
        const parsedViews = Array.isArray(parsed.views)
          ? parsed.views
            .map((view) => ({
              id: String(view?.id ?? '').trim(),
              name: String(view?.name ?? '').trim(),
            }))
            .filter((view) => Boolean(view.id && view.name))
            .slice(0, MAX_ADDITIONAL_PERSONAL_VIEWS + 1)
          : []
        const customViews = parsedViews.filter((view) => view.id !== DEFAULT_PERSONAL_VIEW.id)
        storedViews = [DEFAULT_PERSONAL_VIEW, ...customViews]
        const requestedActiveViewId = String(parsed.activeViewId ?? '').trim()
        if (storedViews.some((view) => view.id === requestedActiveViewId)) {
          storedActiveViewId = requestedActiveViewId
        }
      }
    } catch {
      // Use the default view if the saved local preference is malformed.
    }

    setPersonalViews(storedViews)
    setActivePersonalViewId(storedActiveViewId)
    setPersonalViewsLoaded(true)
  }, [activeTab, legacyPersonalViewsStorageKey, personalViewsStorageKey])

  useEffect(() => {
    if (!personalViewsLoaded) return
    window.localStorage.setItem(personalViewsStorageKey, JSON.stringify({
      views: personalViews,
      activeViewId: activePersonalViewId,
    } satisfies OrdersPersonalViewsStorage))
  }, [activePersonalViewId, personalViews, personalViewsLoaded, personalViewsStorageKey])

  const defaultVisibleColumnFields = useMemo(
    () => standardColumns
      .map((column) => String(column.field))
      .filter((field) => availableColumns.some((column) => String(column.field) === field)),
    [availableColumns, standardColumns],
  )

  useEffect(() => {
    const availableFields = availableColumns.map((column) => String(column.field))
    let savedOrder: string[] = []
    let savedHidden: string[] = []
    let savedWidths: Record<string, number> = {}
    let hasSavedPreferences = false

    try {
      // Keep an existing shared layout on the default Orders tab only. Every
      // other tab starts with, and saves to, its own independent layout.
      const raw = window.localStorage.getItem(columnStorageKey)
        ?? (activeTab === 'orders'
          ? window.localStorage.getItem(legacyColumnStorageKey)
          : null)
      if (raw) {
        hasSavedPreferences = true
        const parsed = JSON.parse(raw) as { order?: unknown; hidden?: unknown; widths?: unknown; showSubitemsInline?: unknown }
        setShowSubitemsInline(parsed.showSubitemsInline === true)
        savedOrder = Array.isArray(parsed.order)
          ? parsed.order.map((field) => String(field)).filter((field) => availableFields.includes(field))
          : []
        savedHidden = Array.isArray(parsed.hidden)
          ? parsed.hidden.map((field) => String(field)).filter((field) => availableFields.includes(field))
          : []
        savedWidths = parsed.widths && typeof parsed.widths === 'object' && !Array.isArray(parsed.widths)
          ? Object.fromEntries(
            Object.entries(parsed.widths)
              .map(([field, width]) => [field, Number(width)] as const)
              .filter(([field, width]) => (
                availableFields.includes(field)
                && Number.isFinite(width)
                && width >= 50
              )),
          )
          : {}
      }
    } catch {
      // Ignore malformed local preferences and use the professional default.
    }

    setColumnOrder([
      ...savedOrder,
      ...availableFields.filter((field) => !savedOrder.includes(field)),
    ])
    setHiddenColumnFields(new Set(
      hasSavedPreferences
        ? savedHidden
        : availableFields.filter((field) => !defaultVisibleColumnFields.includes(field)),
    ))
    setColumnWidths(savedWidths)
    if (!hasSavedPreferences) setShowSubitemsInline(false)
    setLoadedColumnStorageKey(columnStorageKey)
  }, [activeTab, availableColumns, columnStorageKey, defaultVisibleColumnFields, legacyColumnStorageKey])

  useEffect(() => {
    if (columnOrder.length === 0 || loadedColumnStorageKey !== columnStorageKey) return
    window.localStorage.setItem(
      columnStorageKey,
      JSON.stringify({
        order: columnOrder,
        hidden: [...hiddenColumnFields],
        widths: columnWidths,
        showSubitemsInline,
      }),
    )
  }, [columnOrder, columnStorageKey, columnWidths, hiddenColumnFields, loadedColumnStorageKey, showSubitemsInline])

  useEffect(() => {
    setFilterModel({ items: [] })
    setColumnFilterItems([])
    setExpandedSubitemOrderIds(new Set())
    editorFilterIdRef.current = null
    pendingAdditionalFilterIdRef.current = null
    setPaginationModel((current) => ({ ...current, page: 0 }))
  }, [activeTab])

  const availableColumnByField = useMemo(
    () => new Map(availableColumns.map((column) => [String(column.field), column])),
    [availableColumns],
  )
  const columns = useMemo(
    () => {
      const orderedVisibleColumns = columnOrder
      .map((field) => availableColumnByField.get(field))
      .filter((column): column is GridColDef<OrdersOverviewOrder> => Boolean(column))
        .filter((column) => String(column.field) !== 'mondayLink')
        .filter((column) => !hiddenColumnFields.has(String(column.field)))
      const actionsColumn = availableColumnByField.get('mondayLink')
      const applySavedWidth = (column: GridColDef<OrdersOverviewOrder>) => {
        const savedWidth = columnWidths[String(column.field)]

        return Number.isFinite(savedWidth)
          ? { ...column, width: savedWidth }
          : column
      }

      return actionsColumn
        ? [...orderedVisibleColumns, actionsColumn].map(applySavedWidth)
        : orderedVisibleColumns.map(applySavedWidth)
    },
    [availableColumnByField, columnOrder, columnWidths, hiddenColumnFields],
  )
  const displayColumns = useMemo<GridColDef<OrdersGridRow>[]>(() => {
    const firstField = String(columns[0]?.field ?? '')
    const subitemPanelField = columns.some((column) => String(column.field) === 'orderNumber')
      ? 'orderNumber'
      : firstField

    return columns.map((column) => {
      const originalRenderCell = column.renderCell
      return {
        ...column,
        renderCell: (params) => {
          if (params.row.__subitemPanel) {
            if (String(column.field) !== subitemPanelField || !params.row.__parentOrder) return null
            const viewportWidth = gridApiRef.current?.getRootDimensions()?.viewportInnerSize.width ?? 1000
            const columnLeft = gridApiRef.current?.getColumnPosition(subitemPanelField) ?? 0
            return (
              <Box
                sx={{
                  position: 'absolute',
                  top: 4,
                  bottom: 4,
                  left: columnLeft,
                  width: Math.max(520, viewportWidth - columnLeft - 20),
                  bgcolor: '#f8fbff',
                  borderLeft: '4px solid',
                  borderColor: 'primary.light',
                  borderRadius: '8px 0 0 8px',
                  zIndex: 2,
                }}
              >
                <SubitemsInlinePanel order={params.row.__parentOrder} onOpenOrder={onOpenJobDialog} />
              </Box>
            )
          }
          const originalContent = originalRenderCell ? originalRenderCell(params) : params.formattedValue
          if (!showSubitemsInline || String(column.field) !== 'orderNumber') return originalContent

          const subitemRowKey = String(params.row.id)
          const subitemCount = Array.isArray(params.row.subitems) ? params.row.subitems.length : 0
          const subitemsExpanded = expandedSubitemOrderIds.has(subitemRowKey)
          return (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
              <Tooltip title={subitemsExpanded ? 'Hide subitems' : `Show ${subitemCount} subitem${subitemCount === 1 ? '' : 's'}`}>
                <IconButton
                  size="small"
                  aria-label={`${subitemsExpanded ? 'Hide' : 'Show'} subitems for order ${params.row.orderNumber}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setExpandedSubitemOrderIds((current) => {
                      const next = new Set(current)
                      if (next.has(subitemRowKey)) next.delete(subitemRowKey)
                      else next.add(subitemRowKey)
                      return next
                    })
                  }}
                  sx={{ p: 0.15, flex: '0 0 auto' }}
                >
                  <ExpandMoreRoundedIcon
                    fontSize="small"
                    sx={{ transform: subitemsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}
                  />
                </IconButton>
              </Tooltip>
              {originalContent}
            </Stack>
          )
        },
      }
    })
  }, [columns, expandedSubitemOrderIds, gridApiRef, onOpenJobDialog, showSubitemsInline])
  const columnGroupingModel = viewMode === 'admin' && columnOrder.length === 0
    ? adminColumnGroupingModel
    : undefined
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

  const filteredRows = useMemo(() => {
    if (columnFilterItems.length === 0) return prioritizedRows

    return prioritizedRows.filter((row) => columnFilterItems.every((item) => {
      const column = availableColumnByField.get(item.field)
      const rawValue = row[item.field as keyof OrdersOverviewOrder]
      let filterValue: unknown = rawValue

      if (typeof column?.valueGetter === 'function') {
        try {
          const valueGetter = column.valueGetter as unknown as (
            value: unknown,
            currentRow: OrdersOverviewOrder,
            currentColumn: GridColDef<OrdersOverviewOrder>,
            apiRef: null,
          ) => unknown
          filterValue = valueGetter(rawValue, row, column, null)
        } catch {
          filterValue = rawValue
        }
      }

      return rowValueMatchesFilter(filterValue, item)
    }))
  }, [availableColumnByField, columnFilterItems, prioritizedRows])

  useEffect(() => {
    // Use the same rows and ordered visible columns as the grid. Action-only
    // cells are deliberately left out because they have no spreadsheet value.
    const exportColumns = columns.filter((column) => String(column.field) !== 'mondayLink')
    const headerCounts = new Map<string, number>()
    const resolvedColumns = exportColumns.map((column) => {
      const baseHeader = String(column.headerName ?? column.field)
      const duplicateCount = (headerCounts.get(baseHeader) ?? 0) + 1
      headerCounts.set(baseHeader, duplicateCount)
      return {
        column,
        header: duplicateCount === 1 ? baseHeader : `${baseHeader} (${duplicateCount})`,
      }
    })

    const normalizeValue = (value: unknown): string | number | boolean => {
      if (value === null || value === undefined) return ''
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
      if (value instanceof Date) return value.toISOString()
      if (Array.isArray(value)) return value.map((item) => String(item ?? '')).filter(Boolean).join(', ')
      return String(value)
    }

    const resolveValue = (column: GridColDef<OrdersOverviewOrder>, row: OrdersOverviewOrder) => {
      const field = String(column.field)
      if (field === 'totalProfit') {
        const invoice = Number(row.invoiceAmount)
        const billed = Number(row.billedAmount)
        const labor = Number(row.totalLaborCost)
        return Number.isFinite(invoice) && Number.isFinite(billed) && Number.isFinite(labor)
          ? Number((invoice - billed - labor).toFixed(2))
          : ''
      }

      const rawValue = row[field as keyof OrdersOverviewOrder]
      if (typeof column.valueGetter !== 'function') return normalizeValue(rawValue)

      try {
        return normalizeValue((column.valueGetter as unknown as (
          value: unknown,
          currentRow: OrdersOverviewOrder,
          currentColumn: GridColDef<OrdersOverviewOrder>,
          apiRef: null,
        ) => unknown)(rawValue, row, column, null))
      } catch {
        return normalizeValue(rawValue)
      }
    }

    onCurrentBoardExportChange({
      sheetName: activeTab === 'all' ? 'All Orders' : activeTab.replace(/_/g, ' '),
      rows: filteredRows.map((row) => Object.fromEntries(
        resolvedColumns.map(({ column, header }) => [header, resolveValue(column, row)]),
      )),
    })
  }, [activeTab, columns, filteredRows, onCurrentBoardExportChange])

  const displayedRows = useMemo<OrdersGridRow[]>(() => {
    if (!showSubitemsInline || expandedSubitemOrderIds.size === 0) return filteredRows

    return filteredRows.flatMap((row) => {
      if (!expandedSubitemOrderIds.has(String(row.id))) return [row]
      return [
        row,
        {
          ...row,
          id: `${row.id}::subitems`,
          __subitemPanel: true,
          __parentOrder: row,
        },
      ]
    })
  }, [expandedSubitemOrderIds, filteredRows, showSubitemsInline])

  const orderValueColumnVisible = canViewOrderValue
    && columns.some((column) => String(column.field) === 'orderValue')
  const filteredOrderValueTotal = useMemo(
    () => filteredRows.reduce((total, row) => {
      const orderValue = Number(row.orderValue)
      return Number.isFinite(orderValue) ? total + orderValue : total
    }, 0),
    [filteredRows],
  )

  const handleFilterModelChange = (nextModel: GridFilterModel) => {
    const previousEditorItem = filterModel.items.find((item) => (
      item.id === editorFilterIdRef.current
    )) ?? filterModel.items[0]
    const nextEditorItem = nextModel.items.find((item) => (
      item.id === editorFilterIdRef.current
      || filterItemIsActive(item)
    )) ?? nextModel.items[0]

    setFilterModel(nextModel)
    setColumnFilterItems((current) => {
      if (!nextEditorItem) {
        // The grid sends an empty model while its filter panel changes columns.
        // Keep existing filters; filters are removed deliberately from their chip.
        return current
      }

      if (filterItemIsActive(nextEditorItem)) {
        const isSameEditorField = previousEditorItem?.field === nextEditorItem.field
        const filterId = pendingAdditionalFilterIdRef.current
          ?? (isSameEditorField ? editorFilterIdRef.current : null)
          ?? `filter-${++filterIdSequenceRef.current}`
        editorFilterIdRef.current = filterId
        pendingAdditionalFilterIdRef.current = null
        return [
          ...current.filter((item) => item.id !== filterId),
          { ...nextEditorItem, id: filterId },
        ]
      }

      return current
    })
    setPaginationModel((current) => (
      current.page === 0 ? current : { ...current, page: 0 }
    ))
  }

  const removeColumnFilter = (filterId: string | number) => {
    setColumnFilterItems((current) => current.filter((item) => item.id !== filterId))
    setFilterModel((current) => (
      editorFilterIdRef.current === filterId ? { ...current, items: [] } : current
    ))
    if (editorFilterIdRef.current === filterId) editorFilterIdRef.current = null
    if (pendingAdditionalFilterIdRef.current === filterId) pendingAdditionalFilterIdRef.current = null
    setPaginationModel((current) => (
      current.page === 0 ? current : { ...current, page: 0 }
    ))
  }

  const addFilterForColumn = (field: string) => {
    const column = availableColumnByField.get(field)
    const filterId = `filter-${++filterIdSequenceRef.current}`
    const operator = column?.filterOperators?.[0]?.value || 'contains'
    const draftFilter: GridFilterItem = { id: filterId, field, operator }

    editorFilterIdRef.current = filterId
    pendingAdditionalFilterIdRef.current = filterId
    setFilterModel({ items: [draftFilter] })
    window.setTimeout(() => gridApiRef.current?.showFilterPanel(field), 0)
  }

  const clearColumnFilters = () => {
    setColumnFilterItems([])
    setFilterModel({ items: [] })
    editorFilterIdRef.current = null
    pendingAdditionalFilterIdRef.current = null
    setPaginationModel((current) => (
      current.page === 0 ? current : { ...current, page: 0 }
    ))
  }

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

  const moveColumn = (sourceField: string, targetField: string) => {
    if (
      !sourceField
      || !targetField
      || sourceField === targetField
      || sourceField === 'mondayLink'
      || targetField === 'mondayLink'
    ) return
    setColumnOrder((current) => {
      const sourceIndex = current.indexOf(sourceField)
      const targetIndex = current.indexOf(targetField)
      if (sourceIndex < 0 || targetIndex < 0) return current
      const next = [...current]
      next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, sourceField)
      return next
    })
  }

  const toggleColumnVisibility = (field: string) => {
    setHiddenColumnFields((current) => {
      const next = new Set(current)
      if (next.has(field)) {
        next.delete(field)
      } else {
        next.add(field)
      }
      return next
    })
  }

  const resetColumns = () => {
    setColumnOrder(availableColumns.map((column) => String(column.field)))
    setHiddenColumnFields(new Set(
      availableColumns
        .map((column) => String(column.field))
        .filter((field) => !defaultVisibleColumnFields.includes(field)),
    ))
    setColumnWidths({})
    setShowSubitemsInline(false)
    setExpandedSubitemOrderIds(new Set())
  }

  const handleCreatePersonalView = () => {
    const name = newViewName.trim().slice(0, 40)
    if (!name || personalViews.length > MAX_ADDITIONAL_PERSONAL_VIEWS) return
    const id = `view-${Date.now()}`
    setPersonalViews((current) => [...current, { id, name }])
    setActivePersonalViewId(id)
    setNewViewName('')
    setNewViewDialogOpen(false)
  }

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

      {benchEditError ? (
        <Alert
          severity="error"
          onClose={() => setBenchEditError(null)}
          sx={{ borderRadius: 0 }}
        >
          {benchEditError}
        </Alert>
      ) : null}

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{
          minHeight: 42,
          px: 1,
          borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
          backgroundColor: '#fff',
        }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, overflowX: 'auto' }}>
          {columnFilterItems.map((item) => {
            const column = availableColumnByField.get(item.field)
            const filterValue = item.operator === 'isEmpty' || item.operator === 'isNotEmpty'
              ? item.operator
              : String(item.value ?? '')
            return (
              <Stack key={String(item.id ?? item.field)} direction="row" spacing={0.15} alignItems="center">
                <Chip
                  size="small"
                  variant="outlined"
                  color="primary"
                  label={`${column?.headerName || item.field} ${item.operator}: ${filterValue}`}
                  onDelete={() => removeColumnFilter(item.id ?? item.field)}
                />
                <Tooltip title={`Add another ${column?.headerName || item.field} filter`}>
                  <IconButton
                    size="small"
                    aria-label={`Add another ${column?.headerName || item.field} filter`}
                    onClick={() => addFilterForColumn(item.field)}
                    sx={{ p: 0.2 }}
                  >
                    <AddRoundedIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            )
          })}
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
          {columnFilterItems.length > 0 ? (
            <Button size="small" variant="text" onClick={clearColumnFilters}>
              Clear filters
            </Button>
          ) : null}
          <Tooltip title="Choose and reorder columns">
            <IconButton
              size="small"
              aria-label="Choose and reorder columns"
              onClick={(event) => setColumnsMenuAnchorEl(event.currentTarget)}
            >
              <MoreVertRoundedIcon />
            </IconButton>
          </Tooltip>
          <Select
            size="small"
            value={activePersonalViewId}
            onChange={(event) => setActivePersonalViewId(String(event.target.value))}
            inputProps={{ 'aria-label': 'Orders view' }}
            sx={{ minWidth: 128, height: 30, fontSize: '0.78rem', fontWeight: 700 }}
          >
            {personalViews.map((view) => (
              <MenuItem key={view.id} value={view.id}>{view.name}</MenuItem>
            ))}
          </Select>
          {personalViews.length <= MAX_ADDITIONAL_PERSONAL_VIEWS ? (
            <Button size="small" onClick={() => setNewViewDialogOpen(true)}>
              New view
            </Button>
          ) : null}
        </Stack>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          apiRef={gridApiRef}
          rows={displayedRows}
          columns={displayColumns}
          columnGroupingModel={columnGroupingModel}
          columnGroupHeaderHeight={viewMode === 'admin' ? 30 : undefined}
          loading={isLoading}
          checkboxSelection
          isRowSelectable={({ row }) => !row.__subitemPanel}
          disableRowSelectionOnClick
          disableRowSelectionExcludeModel
          rowSelectionModel={rowSelectionModel}
          onRowSelectionModelChange={(nextModel) => {
            setRowSelectionModel(nextModel)
          }}
          filterMode="server"
          filterModel={filterModel}
          onFilterModelChange={handleFilterModelChange}
          paginationMode="client"
          initialState={{
            sorting: {
              sortModel: [{ field: 'orderNumber', sort: 'asc' }],
            },
          }}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          onColumnWidthChange={(params) => {
            const field = String(params.colDef.field)
            const width = Math.round(Number(params.width))
            if (!field || !Number.isFinite(width) || width < 50) return
            setColumnWidths((current) => (
              current[field] === width
                ? current
                : { ...current, [field]: width }
            ))
          }}
          density={isStandardView ? 'standard' : 'compact'}
          rowHeight={isStandardView ? 52 : 38}
          getRowHeight={({ model }) => {
            if (!model.__subitemPanel) return null
            const count = model.__parentOrder?.subitems?.length ?? 0
            return Math.min(495, Math.max(170, 125 + Math.min(count, 7) * 48))
          }}
          columnHeaderHeight={isStandardView ? 52 : 54}
          pageSizeOptions={[25, 50, 100]}
          getRowClassName={({ row }) => {
            if (row.__subitemPanel) return 'orders-row--subitems-panel'
            if (describeMondayLinkIssue(row)) {
              return 'orders-row--link-review'
            }
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
            '& .orders-row--link-review': { backgroundColor: 'rgba(211, 47, 47, 0.10)' },
            '& .orders-row--quickbooks-only': { backgroundColor: 'rgba(2, 136, 209, 0.06)' },
            '& .orders-row--subitems-panel': {
              bgcolor: '#f8fbff',
              '& .MuiDataGrid-cell': { overflow: 'visible', p: 0, borderBottom: 0 },
              '& .MuiDataGrid-cellCheckbox': { visibility: 'hidden' },
            },
          }}
        />
      </Box>

      <Dialog
        open={newViewDialogOpen}
        onClose={() => setNewViewDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Create a view</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Each view saves its own columns, order, and column widths.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label="View name"
            value={newViewName}
            onChange={(event) => setNewViewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleCreatePersonalView()
            }}
            inputProps={{ maxLength: 40 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewViewDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreatePersonalView} disabled={!newViewName.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {quickEditError ? (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setQuickEditError('')}>
          {quickEditError}
        </Alert>
      ) : null}

      {orderValueColumnVisible ? (
        <Stack
          direction="row"
          justifyContent="flex-end"
          alignItems="center"
          spacing={1}
          sx={{ px: 2, py: 0.9, borderTop: '1px solid rgba(15, 23, 42, 0.1)', backgroundColor: '#fff' }}
        >
          <Typography variant="body2" color="text.secondary">
            {filteredRows.length} {filteredRows.length === 1 ? 'order' : 'orders'}
          </Typography>
          <Typography variant="body2" fontWeight={800}>
            Order Value total: {formatCurrency(filteredOrderValueTotal, 2)}
          </Typography>
        </Stack>
      ) : null}

      <Popover
        open={Boolean(columnsMenuAnchorEl)}
        anchorEl={columnsMenuAnchorEl}
        onClose={() => {
          setColumnsMenuAnchorEl(null)
          setDraggedColumnField(null)
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: 0.5,
            width: 330,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'min(680px, calc(100vh - 100px))',
            overflow: 'hidden',
          },
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 1.5, py: 1.15, borderBottom: '1px solid rgba(15, 23, 42, 0.1)' }}
        >
          <Box>
            <Typography variant="subtitle2" fontWeight={800}>
              Order columns
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Check columns and drag them into your preferred order.
            </Typography>
          </Box>
          <Tooltip title="Restore default columns and order">
            <IconButton size="small" onClick={resetColumns} aria-label="Reset order columns">
              <RestartAltRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        <Box sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid rgba(15, 23, 42, 0.1)' }}>
          <FormControlLabel
            control={(
              <Checkbox
                size="small"
                checked={showSubitemsInline}
                onChange={(event) => {
                  setShowSubitemsInline(event.target.checked)
                  if (!event.target.checked) setExpandedSubitemOrderIds(new Set())
                }}
              />
            )}
            label={(
              <Box>
                <Typography variant="body2" fontWeight={700}>Show subitems as row dropdowns</Typography>
                <Typography variant="caption" color="text.secondary">View-only; open the order to add or edit.</Typography>
              </Box>
            )}
            sx={{ m: 0, alignItems: 'flex-start' }}
          />
        </Box>

        <Box sx={{ overflowY: 'auto', maxHeight: 'min(590px, calc(100vh - 190px))', py: 0.5 }}>
          {columnOrder.map((field) => {
            const column = availableColumnByField.get(field)
            if (!column) return null
            const isActionsColumn = field === 'mondayLink'
            const isVisible = isActionsColumn || !hiddenColumnFields.has(field)

            return (
              <Stack
                key={field}
                direction="row"
                alignItems="center"
                draggable={!isActionsColumn}
                onDragStart={(event) => {
                  setDraggedColumnField(field)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', field)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const sourceField = draggedColumnField || event.dataTransfer.getData('text/plain')
                  moveColumn(sourceField, field)
                  setDraggedColumnField(null)
                }}
                onDragEnd={() => setDraggedColumnField(null)}
                sx={{
                  minHeight: 38,
                  px: 0.75,
                  mx: 0.5,
                  borderRadius: 1,
                  cursor: isActionsColumn ? 'default' : 'grab',
                  opacity: draggedColumnField === field ? 0.45 : 1,
                  '&:hover': { backgroundColor: 'rgba(15, 23, 42, 0.045)' },
                }}
              >
                <DragIndicatorRoundedIcon
                  fontSize="small"
                  sx={{ color: 'text.disabled', mr: 0.25 }}
                />
                <Checkbox
                  size="small"
                  checked={isVisible}
                  disabled={isActionsColumn}
                  onChange={() => toggleColumnVisibility(field)}
                  inputProps={{ 'aria-label': `Show ${column.headerName || field}` }}
                />
                <Typography
                  variant="body2"
                  onClick={() => {
                    if (!isActionsColumn) toggleColumnVisibility(field)
                  }}
                  sx={{
                    flex: 1,
                    cursor: isActionsColumn ? 'default' : 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {column.headerName || field}
                  {isActionsColumn ? ' (always last)' : ''}
                </Typography>
              </Stack>
            )
          })}
        </Box>
      </Popover>

      <Menu
        anchorEl={actionsAnchorEl}
        open={Boolean(actionsAnchorEl && actionsOrder)}
        onClose={handleCloseActionsMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          component="a"
          href={actionsOrder?.mondayItemUrl || undefined}
          target="_blank"
          rel="noreferrer"
          disabled={!actionsOrder?.mondayItemUrl}
          onClick={handleCloseActionsMenu}
        >
          <OpenInNewRoundedIcon fontSize="small" sx={{ mr: 1 }} />
          Open in Monday
        </MenuItem>
        <MenuItem
          disabled={!actionsOrder}
          onClick={() => {
            const order = actionsOrder
            handleCloseActionsMenu()
            if (order) onLinkOrder(order)
          }}
        >
          <LinkRoundedIcon fontSize="small" sx={{ mr: 1 }} />
          {actionsOrder?.parentOrderNumber ? 'Change linked order' : 'Link to another order'}
        </MenuItem>
        {canDuplicateOrders ? (
          <MenuItem
            disabled={!actionsOrder}
            onClick={() => {
              const order = actionsOrder
              handleCloseActionsMenu()
              if (order) onDuplicateOrder(order)
            }}
          >
            <ContentCopyRoundedIcon fontSize="small" sx={{ mr: 1 }} />
            Duplicate order
          </MenuItem>
        ) : null}
        <MenuItem
          disabled={!actionsOrder}
          onClick={() => {
            const order = actionsOrder
            handleCloseActionsMenu()
            if (order) onArchiveOrder(order, !order.isArchived)
          }}
        >
          {actionsOrder?.isArchived ? (
            <UnarchiveRoundedIcon fontSize="small" sx={{ mr: 1 }} />
          ) : (
            <ArchiveRoundedIcon fontSize="small" sx={{ mr: 1 }} />
          )}
          {actionsOrder?.isArchived ? 'Unarchive order' : 'Archive order'}
        </MenuItem>
        {canDeleteOrders ? (
          <MenuItem
            disabled={!actionsOrder}
            sx={{ color: 'error.main' }}
            onClick={() => {
              const order = actionsOrder
              handleCloseActionsMenu()
              if (order) onDeleteOrder(order)
            }}
          >
            <DeleteOutlineRoundedIcon fontSize="small" sx={{ mr: 1 }} />
            Delete order
          </MenuItem>
        ) : null}
      </Menu>

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

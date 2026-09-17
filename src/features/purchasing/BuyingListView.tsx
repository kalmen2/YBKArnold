// Everything the shop still has to buy, in one place.
//
// Monday could show the parts on one order. It could never answer "what do we
// need to buy this week", because that question spans every order at once.
// This does, and it treats a part on an order and a standalone shop purchase
// as the same kind of row, because to whoever is ordering they are.
//
// Built on the same DataGrid the orders page uses, so column filtering, sorting
// and pagination come for free and behave the way they do everywhere else.
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  DataGrid,
  type GridColDef,
  type GridRowSelectionModel,
} from '@mui/x-data-grid'
import { useMemo, useState } from 'react'
import type { BuyingLine, BuyingLineState, BuyingListResponse } from './api'

/**
 * Five tabs, in the order the work happens in.
 *
 * To buy and Not ordered were the same list under two names, so they are one.
 * Received and From stock are gone: nothing is owed on either, and lines taken
 * from stock never reach the page at all now. Missing dates is not a state but
 * a problem — a line nobody can plan around, in any of the other tabs.
 */
type BuyingTab = 'to_buy' | 'overdue_order' | 'ordered' | 'overdue_arrival' | 'missing_dates'

const STATE_TABS: { value: BuyingTab, label: string }[] = [
  { value: 'to_buy', label: 'To buy' },
  { value: 'overdue_order', label: 'Late to order' },
  { value: 'ordered', label: 'On order' },
  { value: 'overdue_arrival', label: 'Late to arrive' },
  { value: 'missing_dates', label: 'Missing dates' },
]

const STATE_LABELS: Record<BuyingLineState, string> = {
  not_ordered: 'To buy',
  overdue_order: 'Late to order',
  ordered: 'On order',
  overdue_arrival: 'Late to arrive',
  received: 'Received',
}

const STATE_COLORS: Record<BuyingLineState, 'default' | 'warning' | 'error' | 'info' | 'success'> = {
  not_ordered: 'default',
  overdue_order: 'error',
  ordered: 'info',
  overdue_arrival: 'error',
  received: 'success',
}

/** The two states that mean somebody still has to place an order. */
const TO_BUY_STATES: BuyingLineState[] = ['overdue_order', 'not_ordered']

function formatDate(value: string | null) {
  if (!value) {
    return ''
  }

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function DateCell({ value, days }: { value: string | null, days: number | null }) {
  if (!value) {
    return <Typography variant="body2" color="text.disabled">—</Typography>
  }

  const isLate = typeof days === 'number' && days < 0

  return (
    <Box sx={{ lineHeight: 1.3, py: 0.5 }}>
      <Typography variant="body2" color={isLate ? 'error.main' : undefined} noWrap>
        {formatDate(value)}
      </Typography>
      {typeof days === 'number' ? (
        <Typography variant="caption" color={isLate ? 'error.main' : 'text.disabled'} noWrap>
          {days < 0 ? `${Math.abs(days)}d late` : days === 0 ? 'today' : `in ${days}d`}
        </Typography>
      ) : null}
    </Box>
  )
}

export function BuyingListView({
  data,
  isLoading,
  isRefreshing,
  errorMessage,
  canCreatePurchaseOrders,
  onRefresh,
  onAddItem,
  onCreatePurchaseOrders,
  onOpenLine,
}: {
  data: BuyingListResponse | undefined
  isLoading: boolean
  isRefreshing: boolean
  errorMessage: string | null
  canCreatePurchaseOrders: boolean
  onRefresh: () => void
  onAddItem: () => void
  onCreatePurchaseOrders: (lines: BuyingLine[]) => void
  /** Opens the order this line sits on, with its other parts. */
  onOpenLine: (line: BuyingLine) => void
}) {
  const [tab, setTab] = useState<BuyingTab>('to_buy')
  const [selection, setSelection] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() })

  const lines = useMemo(() => data?.lines ?? [], [data])

  const tabCounts = useMemo(() => {
    const counts = data?.counts ?? {}
    const toBuy = TO_BUY_STATES.reduce((total, state) => total + (counts[state] ?? 0), 0)

    return { ...counts, to_buy: toBuy } as Record<string, number>
  }, [data])

  const rows = useMemo(() => lines.filter((line) => {
    if (tab === 'to_buy') {
      return TO_BUY_STATES.includes(line.state)
    }

    // Not a state of its own: a line with no dates shows here as well as in
    // whichever tab its state puts it.
    if (tab === 'missing_dates') {
      return line.missingDates
    }

    return line.state === tab
  }), [lines, tab])

  const selectedLines = useMemo(
    () => rows.filter((line) => selection.ids.has(line.lineId)),
    [rows, selection],
  )

  const selectedWithoutVendor = selectedLines.filter((line) => !line.vendor).length

  const columns = useMemo<GridColDef<BuyingLine>[]>(() => [
    {
      field: 'itemName',
      headerName: 'Item',
      flex: 1.6,
      minWidth: 240,
      renderCell: ({ row }) => (
        <Box sx={{ lineHeight: 1.3, py: 0.5, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{row.itemName}</Typography>
          {row.dimensions || row.description ? (
            <Typography variant="caption" color="text.disabled" noWrap sx={{ display: 'block' }}>
              {[row.dimensions, row.description].filter(Boolean).join(' · ')}
            </Typography>
          ) : null}
        </Box>
      ),
    },
    {
      field: 'projectNumber',
      headerName: 'Project',
      width: 130,
      valueGetter: (_value, row) => row.projectNumber ?? '',
      renderCell: ({ row }) => (
        row.projectNumber
          ? <Typography variant="body2" noWrap>{row.projectNumber}</Typography>
          : <Chip size="small" variant="outlined" label="Shop" />
      ),
    },
    { field: 'quantity', headerName: 'Qty', width: 84, type: 'number' },
    {
      field: 'vendor',
      headerName: 'Vendor',
      width: 180,
      valueGetter: (_value, row) => row.vendor ?? '',
      renderCell: ({ row }) => (
        <Typography variant="body2" color={row.vendor ? 'text.secondary' : 'error.main'} noWrap>
          {row.vendor || 'No vendor'}
        </Typography>
      ),
    },
    {
      field: 'orderByDate',
      headerName: 'Order by',
      width: 140,
      valueGetter: (_value, row) => row.orderByDate ?? '',
      renderCell: ({ row }) => <DateCell value={row.orderByDate} days={row.daysUntilOrderBy} />,
    },
    {
      field: 'dueDate',
      headerName: 'Needed by',
      width: 140,
      valueGetter: (_value, row) => row.dueDate ?? '',
      renderCell: ({ row }) => <DateCell value={row.dueDate} days={row.daysUntilDue} />,
    },
    {
      field: 'state',
      headerName: 'State',
      width: 140,
      valueGetter: (_value, row) => STATE_LABELS[row.state],
      renderCell: ({ row }) => (
        <Chip
          size="small"
          variant="outlined"
          color={STATE_COLORS[row.state]}
          label={STATE_LABELS[row.state]}
        />
      ),
    },
    {
      field: 'open',
      headerName: '',
      width: 60,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => (
        row.orderKey ? (
          <Tooltip title="See this order and its other parts">
            <IconButton size="small" onClick={() => onOpenLine(row)}>
              <LaunchRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        ) : null
      ),
    },
  ], [onOpenLine])

  return (
    <Card>
      <Tabs
        value={tab}
        onChange={(_event, next: BuyingTab) => {
          setTab(next)
          setSelection({ type: 'include', ids: new Set() })
        }}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ px: 2.5, borderBottom: 1, borderColor: 'divider' }}
      >
        {STATE_TABS.map((entry) => (
          <Tab
            key={entry.value}
            value={entry.value}
            label={(
              <Stack direction="row" spacing={1} alignItems="center">
                <span>{entry.label}</span>
                <Chip
                  size="small"
                  label={tabCounts[entry.value] ?? 0}
                  color={tab === entry.value ? 'primary' : 'default'}
                  variant={tab === entry.value ? 'filled' : 'outlined'}
                  sx={{ height: 22, minWidth: 30 }}
                />
              </Stack>
            )}
          />
        ))}
      </Tabs>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2.5, py: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          {tab === 'missing_dates'
            ? 'No order-by or needed-by date, so nothing can be chased on these.'
            : 'Filter and sort any column from its header.'}
          {data && data.excludedCount > 0
            ? ` ${data.excludedCount} hidden as cancelled, made in house, supplied by others, or from stock.`
            : ''}
          {data && data.mondayPlaceholderCount > 0
            ? ` ${data.mondayPlaceholderCount} blank row${data.mondayPlaceholderCount === 1 ? '' : 's'} Monday created on its own, skipped.`
            : ''}
        </Typography>

        <Button startIcon={<AddRoundedIcon />} onClick={onAddItem}>Add item</Button>

        <Tooltip title={isRefreshing ? 'Refreshing…' : 'Refresh'}>
          <span>
            <IconButton size="small" onClick={onRefresh} disabled={isRefreshing}>
              {isRefreshing
                ? <CircularProgress size={17} color="inherit" />
                : <RefreshRoundedIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {errorMessage ? <Alert severity="error" sx={{ mx: 2.5, mb: 2 }}>{errorMessage}</Alert> : null}

      {selectedLines.length > 0 ? (
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          sx={{ px: 2.5, py: 1.5, bgcolor: 'grey.100', borderTop: 1, borderColor: 'divider' }}
        >
          <Typography variant="subtitle2">{`${selectedLines.length} selected`}</Typography>

          {selectedWithoutVendor > 0 ? (
            <Typography variant="body2" color="error.main">
              {`${selectedWithoutVendor} of them has no vendor yet.`}
            </Typography>
          ) : null}

          <Box sx={{ flexGrow: 1 }} />

          <Button color="inherit" onClick={() => setSelection({ type: 'include', ids: new Set() })}>
            Clear
          </Button>
          <Button
            variant="contained"
            startIcon={<ShoppingCartRoundedIcon />}
            disabled={!canCreatePurchaseOrders || selectedWithoutVendor > 0}
            onClick={() => onCreatePurchaseOrders(selectedLines)}
            sx={{ bgcolor: 'grey.800', boxShadow: 'none', '&:hover': { bgcolor: 'grey.900', boxShadow: 'none' } }}
          >
            Create purchase orders
          </Button>
        </Stack>
      ) : null}

      <Box sx={{ height: '62vh' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(row) => row.lineId}
          loading={isLoading}
          checkboxSelection
          disableRowSelectionOnClick
          rowSelectionModel={selection}
          onRowSelectionModelChange={setSelection}
          // Only lines that still need buying can become a purchase order.
          isRowSelectable={({ row }) => TO_BUY_STATES.includes(row.state)}
          getRowHeight={() => 54}
          density="compact"
          pageSizeOptions={[25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 50, page: 0 } } }}
          hideFooterSelectedRowCount
        />
      </Box>
    </Card>
  )
}

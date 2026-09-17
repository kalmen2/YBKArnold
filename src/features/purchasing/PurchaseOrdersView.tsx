// Every purchase order raised, and the file the vendor was sent.
//
// Creating ten orders used to hand back a toast and nothing else: press Escape
// and you had no record of what had just been raised. They live here instead,
// read live from QuickBooks, so the numbers and the documents are always the
// ones the vendor actually has.
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Alert,
  Box,
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
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useMemo, useState } from 'react'
import { formatCurrency } from '../../lib/formatters'
import type { PurchaseOrderRecord, PurchaseOrdersResponse } from './api'

function formatDate(value: string | null) {
  if (!value) {
    return ''
  }

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function PurchaseOrdersView({
  data,
  isLoading,
  isRefreshing,
  errorMessage,
  highlightedIds,
  onRefresh,
  onOpenPdf,
}: {
  data: PurchaseOrdersResponse | undefined
  isLoading: boolean
  isRefreshing: boolean
  errorMessage: string | null
  /** Orders raised in this session, so they are findable straight after. */
  highlightedIds: string[]
  onRefresh: () => void
  onOpenPdf: (purchaseOrder: PurchaseOrderRecord) => void
}) {
  // Closed orders never reach here; the server drops them, because a closed
  // order has nothing left to do with it either way it got closed.
  const [tab, setTab] = useState<'open' | 'new'>('open')

  const allOrders = useMemo(() => data?.purchaseOrders ?? [], [data])

  const tabCounts = useMemo(() => ({
    open: allOrders.length,
    new: highlightedIds.length,
  }), [allOrders, highlightedIds])

  const rows = useMemo(() => (tab === 'new'
    ? allOrders.filter((order) => highlightedIds.includes(order.id))
    : allOrders), [allOrders, highlightedIds, tab])

  const columns = useMemo<GridColDef<PurchaseOrderRecord>[]>(() => [
    {
      field: 'docNumber',
      headerName: 'PO number',
      width: 140,
      valueGetter: (_value, row) => row.docNumber ?? row.id,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {row.docNumber || row.id}
          </Typography>
          {highlightedIds.includes(row.id) ? (
            <Chip size="small" color="primary" label="New" sx={{ height: 20 }} />
          ) : null}
        </Stack>
      ),
    },
    {
      field: 'vendorName',
      headerName: 'Vendor',
      flex: 1,
      minWidth: 200,
      valueGetter: (_value, row) => row.vendorName ?? '',
    },
    {
      field: 'txnDate',
      headerName: 'Date',
      width: 140,
      valueGetter: (_value, row) => row.txnDate ?? '',
      renderCell: ({ row }) => <Typography variant="body2">{formatDate(row.txnDate)}</Typography>,
    },
    { field: 'lineCount', headerName: 'Lines', width: 84, type: 'number' },
    {
      field: 'totalAmount',
      headerName: 'Total',
      width: 130,
      type: 'number',
      renderCell: ({ row }) => (
        <Typography variant="body2">{formatCurrency(row.totalAmount, 2)}</Typography>
      ),
    },
    {
      field: 'pdf',
      headerName: 'File',
      width: 90,
      sortable: false,
      filterable: false,
      renderCell: ({ row }) => (
        <Tooltip title="Open the QuickBooks PDF">
          <IconButton size="small" onClick={() => onOpenPdf(row)}>
            <DescriptionOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ], [highlightedIds, onOpenPdf])

  return (
    <Card>
      <Tabs
        value={tab}
        onChange={(_event, next: 'open' | 'new') => setTab(next)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ px: 2.5, borderBottom: 1, borderColor: 'divider' }}
      >
        {([
          { value: 'open', label: 'Open' },
          { value: 'new', label: 'Raised just now' },
        ] as const).map((entry) => (
          <Tab
            key={entry.value}
            value={entry.value}
            label={(
              <Stack direction="row" spacing={1} alignItems="center">
                <span>{entry.label}</span>
                <Chip
                  size="small"
                  label={tabCounts[entry.value]}
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
          Read live from QuickBooks. Closed orders are not shown. Filter and sort any column from its header.
        </Typography>

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

      {data?.truncated ? (
        <Alert severity="info" sx={{ mx: 2.5, mb: 2 }}>
          QuickBooks returned more purchase orders than one read can hold, so the oldest are not shown.
        </Alert>
      ) : null}

      <Box sx={{ height: '68vh' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          loading={isLoading}
          disableRowSelectionOnClick
          density="compact"
          pageSizeOptions={[25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 50, page: 0 } },
            sorting: { sortModel: [{ field: 'txnDate', sort: 'desc' }] },
          }}
          getRowClassName={({ row }) => (highlightedIds.includes(row.id) ? 'po-row--new' : '')}
          sx={{ '& .po-row--new': { bgcolor: 'action.hover' } }}
        />
      </Box>
    </Card>
  )
}

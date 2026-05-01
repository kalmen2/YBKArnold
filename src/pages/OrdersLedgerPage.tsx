import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  InputAdornment,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { fetchOrdersLedgerOverview, type OrdersLedgerOrder, type OrdersLedgerStatus } from '../features/orders-ledger/api'
import { useDebounceValue } from '../hooks/useDebounceValue'
import { formatCurrency, formatDateTime } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type StatusFilter = 'all' | OrdersLedgerStatus

function formatStatus(status: OrdersLedgerStatus) {
  return status === 'shipped' ? 'Shipped' : 'Not Shipped'
}

function resolveOrderNumber(order: OrdersLedgerOrder) {
  return String(order.orderNumber ?? '').trim() || String(order.mondayItemIds?.[0] ?? '').trim() || '—'
}

export default function OrdersLedgerPage() {
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState('')
  const [showShipped, setShowShipped] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const debouncedSearch = useDebounceValue(searchInput, 300)
  const statusFilter: StatusFilter = showShipped ? 'all' : 'not_shipped'

  const overviewQuery = useQuery({
    queryKey: QUERY_KEYS.ordersLedgerOverview(debouncedSearch, statusFilter),
    queryFn: () =>
      fetchOrdersLedgerOverview({
        search: debouncedSearch,
        status: statusFilter,
        refresh: false,
        limit: 1200,
      }),
    staleTime: 60_000,
  })

  const counts = overviewQuery.data?.counts ?? {
    total: 0,
    shipped: 0,
    notShipped: 0,
    visible: 0,
  }

  const orders = useMemo(
    () => (Array.isArray(overviewQuery.data?.orders) ? overviewQuery.data.orders : []),
    [overviewQuery.data?.orders],
  )
  const refreshWarning = String(overviewQuery.data?.refreshWarning ?? '').trim() || null

  const handleRefresh = useCallback(() => {
    setErrorMessage(null)
    setSuccessMessage(null)

    void (async () => {
      try {
        const refreshed = await queryClient.fetchQuery({
          queryKey: QUERY_KEYS.ordersLedgerOverview(debouncedSearch, statusFilter),
          queryFn: () =>
            fetchOrdersLedgerOverview({
              search: debouncedSearch,
              status: statusFilter,
              refresh: true,
              limit: 1200,
            }),
          staleTime: 0,
        })

        const changed = Number(refreshed?.refreshSummary?.statusChangedCount ?? 0)
        const warning = String(refreshed?.refreshWarning ?? '').trim()
        setSuccessMessage(
          warning
            ? 'Refresh completed using stored orders data.'
            : changed > 0
              ? `Refresh complete. ${changed} order status change(s) detected.`
              : 'Refresh complete.',
        )
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Could not refresh orders right now.',
        )
      }
    })()
  }, [debouncedSearch, queryClient, statusFilter])

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Orders
          </Typography>
          <Typography color="text.secondary">
            Permanent orders ledger. Orders are never deleted and status comes from Monday boards.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            Last fetch: {formatDateTime(overviewQuery.data?.generatedAt)}
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<RefreshRoundedIcon />}
          onClick={handleRefresh}
          disabled={overviewQuery.isFetching}
        >
          {overviewQuery.isFetching ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <TextField
            fullWidth
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value)
            }}
            placeholder="Search by order number, order name, or Monday item id"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />

          <FormControlLabel
            control={(
              <Switch
                checked={showShipped}
                onChange={(event) => {
                  setShowShipped(event.target.checked)
                }}
              />
            )}
            label="Show shipped orders"
          />
        </Stack>
      </Paper>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label={`Visible: ${counts.visible}`} color="primary" variant="outlined" />
        <Chip label={`Not shipped: ${counts.notShipped}`} color="warning" variant="outlined" />
        <Chip label={`Shipped: ${counts.shipped}`} color="success" variant="outlined" />
        <Chip label={`Total: ${counts.total}`} color="default" variant="outlined" />
      </Stack>

      {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      {refreshWarning ? <Alert severity="warning">{refreshWarning}</Alert> : null}
      {overviewQuery.error instanceof Error ? (
        <Alert severity="error">{overviewQuery.error.message}</Alert>
      ) : null}

      <Paper variant="outlined">
        {overviewQuery.isLoading ? (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 6 }}>
            <CircularProgress size={28} />
            <Typography color="text.secondary">Loading orders...</Typography>
          </Stack>
        ) : (
          <TableContainer sx={{ maxHeight: '72vh' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Order #</TableCell>
                  <TableCell>Order Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Monday Status</TableCell>
                  <TableCell align="right">PO Amount</TableCell>
                  <TableCell>Invoice #</TableCell>
                  <TableCell align="right">Progress %</TableCell>
                  <TableCell>Source Board</TableCell>
                  <TableCell>Last Seen</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      <Typography color="text.secondary" sx={{ py: 2 }}>
                        No orders found.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order) => {
                    const statusColor = order.status === 'shipped' ? 'success' : 'warning'
                    const sourceBoardName = String(order.latestSourceBoardName ?? '').trim() || 'Unknown'

                    return (
                      <TableRow key={order.orderKey} hover>
                        <TableCell sx={{ fontWeight: 700 }}>{resolveOrderNumber(order)}</TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {order.orderName || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            color={statusColor}
                            label={formatStatus(order.status)}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>{order.mondayStatusLabel || '—'}</TableCell>
                        <TableCell align="right">
                          {Number.isFinite(Number(order.poAmount))
                            ? formatCurrency(Number(order.poAmount))
                            : '—'}
                        </TableCell>
                        <TableCell>{order.invoiceNumber || '—'}</TableCell>
                        <TableCell align="right">
                          {Number.isFinite(Number(order.progressPercent))
                            ? `${Number(order.progressPercent).toFixed(1)}%`
                            : '—'}
                        </TableCell>
                        <TableCell>{sourceBoardName}</TableCell>
                        <TableCell>{formatDateTime(order.lastSeenAt)}</TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Stack>
  )
}

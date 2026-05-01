import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useDebounceValue } from '../hooks/useDebounceValue'
import { formatCurrency, formatDate } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'
import {
  fetchPurchasingItemDetail,
  fetchPurchasingItems,
  type PurchasingItemSummary,
} from '../features/purchasing/api'

function fmtShipDays(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value} d`
}

function fmtQty(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value - Math.round(value)) < 0.001) return String(Math.round(value))
  return value.toFixed(2)
}

export default function PurchasingPage() {
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounceValue(searchInput, 300)
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const itemsQuery = useQuery({
    queryKey: QUERY_KEYS.purchasingItems(debouncedSearch),
    queryFn: () => fetchPurchasingItems({ search: debouncedSearch, limit: 200 }),
    staleTime: 60_000,
  })

  const detailQuery = useQuery({
    queryKey: selectedItemKey ? QUERY_KEYS.purchasingItemDetail(selectedItemKey) : ['purchasing', 'item', 'none'],
    queryFn: () => fetchPurchasingItemDetail(selectedItemKey as string),
    enabled: Boolean(selectedItemKey),
    staleTime: 60_000,
  })

  const items = itemsQuery.data?.items ?? []

  const totals = useMemo(() => {
    const totalSpent = items.reduce((sum, it) => sum + (Number(it.totalSpent) || 0), 0)
    const totalQty = items.reduce((sum, it) => sum + (Number(it.totalQty) || 0), 0)
    return { totalSpent, totalQty }
  }, [items])

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ['purchasing'] })
  }

  function openItem(item: PurchasingItemSummary) {
    setSelectedItemKey(item.itemKey)
  }

  function closeItem() {
    setSelectedItemKey(null)
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <ShoppingCartRoundedIcon color="primary" sx={{ fontSize: 32 }} />
          <Box>
            <Typography variant="h5" fontWeight={700}>Purchasing</Typography>
            <Typography variant="body2" color="text.secondary">
              Search any item to see vendor history, totals, and shipping speeds.
            </Typography>
          </Box>
        </Stack>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={handleRefresh} disabled={itemsQuery.isFetching}>
              <RefreshRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Paper sx={{ p: 2, mb: 2 }} elevation={0} variant="outlined">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <TextField
            fullWidth
            placeholder="Search by item code, description, or vendor name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Stack direction="row" spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">Items</Typography>
              <Typography variant="h6" fontWeight={700}>{itemsQuery.data?.count ?? 0}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Total spend (page)</Typography>
              <Typography variant="h6" fontWeight={700}>{formatCurrency(totals.totalSpent)}</Typography>
            </Box>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {itemsQuery.isLoading ? (
          <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>
        ) : itemsQuery.isError ? (
          <Box sx={{ p: 4 }}>
            <Typography color="error">Failed to load items.</Typography>
          </Box>
        ) : items.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No items match your search.</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Total Spent</TableCell>
                  <TableCell align="right">Total Qty</TableCell>
                  <TableCell align="right">Vendors</TableCell>
                  <TableCell align="right">Last Purchase</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.itemKey}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => openItem(item)}
                  >
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.itemRaw}</TableCell>
                    <TableCell sx={{ maxWidth: 360 }}>
                      <Typography variant="body2" noWrap title={item.descriptions?.[0] ?? ''}>
                        {item.descriptions?.[0] ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{formatCurrency(item.totalSpent)}</TableCell>
                    <TableCell align="right">{fmtQty(item.totalQty)}</TableCell>
                    <TableCell align="right">{item.vendorCount}</TableCell>
                    <TableCell align="right">{formatDate(item.lastPurchaseDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Dialog open={Boolean(selectedItemKey)} onClose={closeItem} maxWidth="lg" fullWidth>
        <DialogTitle>
          {detailQuery.data?.item ? (
            <Stack direction="row" alignItems="baseline" spacing={1.5} flexWrap="wrap">
              <Typography variant="h6" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
                {detailQuery.data.item.itemRaw}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {detailQuery.data.item.descriptions?.[0] ?? ''}
              </Typography>
            </Stack>
          ) : (
            'Loading…'
          )}
        </DialogTitle>
        <DialogContent dividers>
          {detailQuery.isLoading ? (
            <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>
          ) : detailQuery.isError || !detailQuery.data ? (
            <Typography color="error">Failed to load item details.</Typography>
          ) : (
            <Stack spacing={3}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap">
                <Stat label="Total Spent" value={formatCurrency(detailQuery.data.summary.totalSpent)} />
                <Stat label="Total Qty" value={fmtQty(detailQuery.data.summary.totalQty)} />
                <Stat label="Vendors" value={String(detailQuery.data.summary.vendorCount)} />
                <Stat label="Transactions" value={String(detailQuery.data.summary.transactionCount)} />
                <Stat label="Fastest Ship" value={fmtShipDays(detailQuery.data.summary.fastestShipDays)} />
                <Stat label="Slowest Ship" value={fmtShipDays(detailQuery.data.summary.slowestShipDays)} />
                <Stat label="Avg Ship" value={fmtShipDays(detailQuery.data.summary.averageShipDays)} />
              </Stack>

              <Box>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>By vendor</Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Vendor</TableCell>
                        <TableCell align="right">Spent</TableCell>
                        <TableCell align="right">Qty</TableCell>
                        <TableCell align="right">Tx</TableCell>
                        <TableCell align="right">First</TableCell>
                        <TableCell align="right">Last</TableCell>
                        <TableCell align="right">Fast</TableCell>
                        <TableCell align="right">Slow</TableCell>
                        <TableCell align="right">Avg</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailQuery.data.vendors.map((v) => (
                        <TableRow key={v.vendorKey} hover>
                          <TableCell>{v.vendorRaw}</TableCell>
                          <TableCell align="right">{formatCurrency(v.totalSpent)}</TableCell>
                          <TableCell align="right">{fmtQty(v.totalQty)}</TableCell>
                          <TableCell align="right">{v.transactionCount}</TableCell>
                          <TableCell align="right">{formatDate(v.firstPurchaseDate)}</TableCell>
                          <TableCell align="right">{formatDate(v.lastPurchaseDate)}</TableCell>
                          <TableCell align="right">{fmtShipDays(v.fastestShipDays)}</TableCell>
                          <TableCell align="right">{fmtShipDays(v.slowestShipDays)}</TableCell>
                          <TableCell align="right">{fmtShipDays(v.averageShipDays)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>

              <Box>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Transactions</Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 480 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>PO #</TableCell>
                        <TableCell>Vendor</TableCell>
                        <TableCell align="right">Qty</TableCell>
                        <TableCell align="right">Cost</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell align="right">Ship Date</TableCell>
                        <TableCell align="right">Deliv Date</TableCell>
                        <TableCell align="right">Days</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailQuery.data.transactions.map((tx) => (
                        <TableRow key={tx.id} hover>
                          <TableCell>{formatDate(tx.date)}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={tx.type}
                              color={tx.type === 'Purchase Order' ? 'info' : tx.type === 'Item Receipt' ? 'success' : 'default'}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>{tx.poNumber ?? '—'}</TableCell>
                          <TableCell>{tx.vendorRaw ?? '—'}</TableCell>
                          <TableCell align="right">{fmtQty(tx.qty)}</TableCell>
                          <TableCell align="right">{formatCurrency(tx.unitCost, 2)}</TableCell>
                          <TableCell align="right">{formatCurrency(tx.amount, 2)}</TableCell>
                          <TableCell align="right">{formatDate(tx.shipDate)}</TableCell>
                          <TableCell align="right">{formatDate(tx.delivDate)}</TableCell>
                          <TableCell align="right">{fmtShipDays(tx.shipDays)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>

              <Divider />
              <Stack direction="row" justifyContent="flex-end">
                <Button onClick={closeItem}>Close</Button>
              </Stack>
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 140 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" fontWeight={700}>{value}</Typography>
    </Paper>
  )
}

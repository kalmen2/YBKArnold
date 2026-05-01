import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Pagination,
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
import { useEffect, useState } from 'react'
import { useDebounceValue } from '../hooks/useDebounceValue'
import { formatCurrency, formatDate } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'
import {
  fetchPurchasingItemDetail,
  fetchPurchasingItems,
  type PurchasingItemSummary,
} from '../features/purchasing/api'

const PAGE_SIZE = 100

function fmtShipDays(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value} d`
}

function fmtQty(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value - Math.round(value)) < 0.001) return String(Math.round(value))
  return value.toFixed(2)
}

function fmtPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return formatCurrency(value, value < 1 ? 4 : 2)
}

export default function PurchasingPage() {
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounceValue(searchInput, 300)
  const [page, setPage] = useState(1)
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null)
  const [expandedVendorKey, setExpandedVendorKey] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Reset to page 1 whenever the search changes
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  // Collapse vendor expansion when switching items
  useEffect(() => {
    setExpandedVendorKey(null)
  }, [selectedItemKey])

  const itemsQuery = useQuery({
    queryKey: QUERY_KEYS.purchasingItems(debouncedSearch, page, PAGE_SIZE),
    queryFn: () => fetchPurchasingItems({ search: debouncedSearch, page, pageSize: PAGE_SIZE }),
    staleTime: 60_000,
  })

  const detailQuery = useQuery({
    queryKey: selectedItemKey
      ? QUERY_KEYS.purchasingItemDetail(selectedItemKey)
      : ['purchasing', 'item', 'none'],
    queryFn: () => fetchPurchasingItemDetail(selectedItemKey as string),
    enabled: Boolean(selectedItemKey),
    staleTime: 60_000,
  })

  const items = itemsQuery.data?.items ?? []
  const totalCount = itemsQuery.data?.totalCount ?? 0
  const totalPages = itemsQuery.data?.totalPages ?? 1

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ['purchasing'] })
  }

  function selectItem(item: PurchasingItemSummary) {
    setSelectedItemKey(item.itemKey)
  }

  function toggleVendor(vendorKey: string) {
    setExpandedVendorKey((curr) => (curr === vendorKey ? null : vendorKey))
  }

  return (
    <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <ShoppingCartRoundedIcon color="primary" sx={{ fontSize: 32 }} />
          <Box>
            <Typography variant="h5" fontWeight={700}>Purchasing</Typography>
            <Typography variant="body2" color="text.secondary">
              Search any item, click it to see vendor breakdown, click a vendor for full transactions.
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

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: 'minmax(320px, 380px) 1fr' },
          alignItems: 'flex-start',
        }}
      >
        {/* LEFT — items list */}
        <Paper variant="outlined" sx={{ overflow: 'hidden', position: { md: 'sticky' }, top: { md: 12 } }}>
          <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Search item, description, vendor…"
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
            <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {itemsQuery.isLoading
                  ? 'Loading…'
                  : `${totalCount.toLocaleString()} item${totalCount === 1 ? '' : 's'}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Page {page} / {totalPages}
              </Typography>
            </Stack>
          </Box>

          <Box sx={{ maxHeight: { md: 'calc(100vh - 280px)' }, overflow: 'auto' }}>
            {itemsQuery.isLoading ? (
              <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={24} />
              </Box>
            ) : itemsQuery.isError ? (
              <Box sx={{ p: 3 }}>
                <Typography color="error" variant="body2">Failed to load items.</Typography>
              </Box>
            ) : items.length === 0 ? (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography color="text.secondary" variant="body2">No items match.</Typography>
              </Box>
            ) : (
              items.map((item) => {
                const selected = item.itemKey === selectedItemKey
                return (
                  <Box
                    key={item.itemKey}
                    onClick={() => selectItem(item)}
                    sx={{
                      px: 1.5,
                      py: 1,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      cursor: 'pointer',
                      bgcolor: selected ? 'action.selected' : 'transparent',
                      borderLeft: selected ? '3px solid' : '3px solid transparent',
                      borderLeftColor: selected ? 'primary.main' : 'transparent',
                      '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                    }}
                  >
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: 12,
                        wordBreak: 'break-all',
                        lineHeight: 1.25,
                      }}
                    >
                      {item.itemRaw}
                    </Typography>
                    {item.descriptions?.[0] && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          mt: 0.25,
                        }}
                      >
                        {item.descriptions[0]}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} alignItems="center">
                      <Typography variant="caption" fontWeight={600}>
                        {formatCurrency(item.totalSpent)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        · {item.vendorCount} vendor{item.vendorCount === 1 ? '' : 's'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        · {formatDate(item.lastPurchaseDate)}
                      </Typography>
                    </Stack>
                  </Box>
                )
              })
            )}
          </Box>

          {totalPages > 1 && (
            <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'center' }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, p) => setPage(p)}
                size="small"
                siblingCount={0}
                boundaryCount={1}
              />
            </Box>
          )}
        </Paper>

        {/* RIGHT — details panel */}
        <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, minHeight: 400 }}>
          {!selectedItemKey ? (
            <Box sx={{ p: 6, textAlign: 'center' }}>
              <ShoppingCartRoundedIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body1" color="text.secondary">
                Select an item from the list to see vendor pricing and history.
              </Typography>
            </Box>
          ) : detailQuery.isLoading ? (
            <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress />
            </Box>
          ) : detailQuery.isError || !detailQuery.data ? (
            <Typography color="error">Failed to load item details.</Typography>
          ) : (
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="h6" fontWeight={700} sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {detailQuery.data.item.itemRaw}
                </Typography>
                {detailQuery.data.item.descriptions?.[0] && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {detailQuery.data.item.descriptions[0]}
                  </Typography>
                )}
              </Box>

              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <Stat label="Total Spent" value={formatCurrency(detailQuery.data.summary.totalSpent)} />
                <Stat label="Total Qty" value={fmtQty(detailQuery.data.summary.totalQty)} />
                <Stat label="Vendors" value={String(detailQuery.data.summary.vendorCount)} />
                <Stat label="Lowest $" value={fmtPrice(detailQuery.data.summary.lowestPrice)} />
                <Stat label="Avg $" value={fmtPrice(detailQuery.data.summary.averagePrice)} />
                <Stat label="Highest $" value={fmtPrice(detailQuery.data.summary.highestPrice)} />
                <Stat label="Fast Ship" value={fmtShipDays(detailQuery.data.summary.fastestShipDays)} />
                <Stat label="Avg Ship" value={fmtShipDays(detailQuery.data.summary.averageShipDays)} />
                <Stat label="Slow Ship" value={fmtShipDays(detailQuery.data.summary.slowestShipDays)} />
              </Stack>

              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  By vendor — click a row for full transaction history
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 28 }} />
                        <TableCell>Vendor</TableCell>
                        <TableCell align="right">Spent</TableCell>
                        <TableCell align="right">Qty</TableCell>
                        <TableCell align="right">Lowest $</TableCell>
                        <TableCell align="right">Avg $</TableCell>
                        <TableCell align="right">Highest $</TableCell>
                        <TableCell align="right">Fast</TableCell>
                        <TableCell align="right">Avg Ship</TableCell>
                        <TableCell align="right">Slow</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailQuery.data.vendors.map((v) => {
                        const isOpen = expandedVendorKey === v.vendorKey
                        const vendorTx = detailQuery.data.transactions.filter((tx) => tx.vendorKey === v.vendorKey)
                        return (
                          <VendorRowGroup
                            key={v.vendorKey}
                            vendor={v}
                            isOpen={isOpen}
                            onToggle={() => toggleVendor(v.vendorKey)}
                            transactions={vendorTx}
                          />
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Stack>
          )}
        </Paper>
      </Box>
    </Box>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper variant="outlined" sx={{ px: 1.5, py: 1, minWidth: 110 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="subtitle1" fontWeight={700}>{value}</Typography>
    </Paper>
  )
}

type VendorRowGroupProps = {
  vendor: import('../features/purchasing/api').PurchasingVendorBreakdown
  isOpen: boolean
  onToggle: () => void
  transactions: import('../features/purchasing/api').PurchasingTransaction[]
}

function VendorRowGroup({ vendor, isOpen, onToggle, transactions }: VendorRowGroupProps) {
  return (
    <>
      <TableRow
        hover
        onClick={onToggle}
        sx={{ cursor: 'pointer', bgcolor: isOpen ? 'action.selected' : undefined }}
      >
        <TableCell>
          <ChevronRightRoundedIcon
            fontSize="small"
            sx={{
              transition: 'transform 150ms',
              transform: isOpen ? 'rotate(90deg)' : 'none',
              color: 'text.secondary',
            }}
          />
        </TableCell>
        <TableCell>{vendor.vendorRaw}</TableCell>
        <TableCell align="right">{formatCurrency(vendor.totalSpent)}</TableCell>
        <TableCell align="right">{fmtQty(vendor.totalQty)}</TableCell>
        <TableCell align="right">{fmtPrice(vendor.lowestPrice)}</TableCell>
        <TableCell align="right">{fmtPrice(vendor.averagePrice)}</TableCell>
        <TableCell align="right">{fmtPrice(vendor.highestPrice)}</TableCell>
        <TableCell align="right">{fmtShipDays(vendor.fastestShipDays)}</TableCell>
        <TableCell align="right">{fmtShipDays(vendor.averageShipDays)}</TableCell>
        <TableCell align="right">{fmtShipDays(vendor.slowestShipDays)}</TableCell>
      </TableRow>
      {isOpen && (
        <TableRow>
          <TableCell colSpan={10} sx={{ bgcolor: 'background.default', py: 1 }}>
            {transactions.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                No transactions on file for this vendor.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>PO #</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell align="right">Cost</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell align="right">Ship Date</TableCell>
                      <TableCell align="right">Deliv Date</TableCell>
                      <TableCell align="right">Days</TableCell>
                      <TableCell>Memo</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id} hover>
                        <TableCell>{formatDate(tx.date)}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={tx.type}
                            color={
                              tx.type === 'Purchase Order'
                                ? 'info'
                                : tx.type === 'Item Receipt'
                                ? 'success'
                                : 'default'
                            }
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>{tx.poNumber ?? '—'}</TableCell>
                        <TableCell align="right">{fmtQty(tx.qty)}</TableCell>
                        <TableCell align="right">{fmtPrice(tx.unitCost)}</TableCell>
                        <TableCell align="right">{formatCurrency(tx.amount, 2)}</TableCell>
                        <TableCell align="right">{formatDate(tx.shipDate)}</TableCell>
                        <TableCell align="right">{formatDate(tx.delivDate)}</TableCell>
                        <TableCell align="right">{fmtShipDays(tx.shipDays)}</TableCell>
                        <TableCell sx={{ maxWidth: 240 }}>
                          <Typography variant="caption" color="text.secondary" noWrap title={tx.memo ?? ''}>
                            {tx.memo ?? '—'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// One order's parts, on their own.
//
// Reached from a line on the buying list, so the question being asked is
// narrow: what else is on this order, and is this line the only thing holding
// it up. The order page answers that too, but among tabs, documents, progress
// and financials. This is the one table, nothing else.
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { useQuery } from '@tanstack/react-query'
import { QUERY_KEYS } from '../../lib/queryKeys'
import { fetchOrderDesignParts, type OrderDesignPart } from '../orders/api'
import { isPlaceholderItemName } from './placeholderItemName'

function formatDate(value: string | null) {
  if (!value) {
    return '—'
  }

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ItemName({ part }: { part: OrderDesignPart }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2">{part.itemName}</Typography>
      {part.dimensions || part.description ? (
        <Typography variant="caption" color="text.disabled" noWrap sx={{ display: 'block' }}>
          {[part.dimensions, part.description].filter(Boolean).join(' · ')}
        </Typography>
      ) : null}
    </Box>
  )
}

export function OrderSubitemsDialog({
  open,
  orderKey,
  orderNumber,
  highlightPartId,
  onOpenOrder,
  onClose,
}: {
  open: boolean
  orderKey: string
  orderNumber: string | null
  /** The line that was clicked, so it can be picked out of the list. */
  highlightPartId: string | null
  onOpenOrder: () => void
  onClose: () => void
}) {
  const partsQuery = useQuery({
    queryKey: QUERY_KEYS.orderDesignParts(orderKey),
    queryFn: () => fetchOrderDesignParts(orderKey),
    enabled: open && Boolean(orderKey),
  })

  const allParts = partsQuery.data?.parts ?? []
  const parts = allParts.filter((part) => !isPlaceholderItemName(part.itemName))
  const skippedCount = allParts.length - parts.length

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {orderNumber || 'Order'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {partsQuery.isFetching && allParts.length === 0
                ? 'Loading parts…'
                : `${parts.length} part${parts.length === 1 ? '' : 's'} on this order${
                  skippedCount > 0
                    ? `, ${skippedCount} blank Monday row${skippedCount === 1 ? '' : 's'} skipped`
                    : ''
                }`}
            </Typography>
          </Box>

          <Button
            size="small"
            endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 17 }} />}
            onClick={onOpenOrder}
          >
            Open the order
          </Button>

          <IconButton onClick={onClose}><CloseRoundedIcon /></IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        {partsQuery.isError ? (
          <Alert severity="error" sx={{ m: 2.5 }}>
            Could not load the parts for this order.
          </Alert>
        ) : partsQuery.isPending ? (
          <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
        ) : parts.length === 0 ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <Typography variant="body2" color="text.secondary">No parts on this order yet.</Typography>
          </Stack>
        ) : (
          <TableContainer sx={{ maxHeight: '60vh' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 700, whiteSpace: 'nowrap' } }}>
                  <TableCell>Item</TableCell>
                  <TableCell sx={{ width: 70 }} align="right">Qty</TableCell>
                  <TableCell sx={{ width: 150 }}>Vendor</TableCell>
                  <TableCell sx={{ width: 110 }}>Order by</TableCell>
                  <TableCell sx={{ width: 110 }}>Needed by</TableCell>
                  <TableCell sx={{ width: 140 }}>Status</TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {parts.map((part) => (
                  <TableRow
                    key={part.id}
                    // The line that was clicked stays picked out, so a long
                    // list does not lose it.
                    selected={part.id === highlightPartId}
                  >
                    <TableCell><ItemName part={part} /></TableCell>
                    <TableCell align="right">{part.quantity}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {part.source === 'stock' ? 'From stock' : part.vendor || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {formatDate(part.orderByDate)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {formatDate(part.dueDate)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {part.status ? (
                        <Chip
                          size="small"
                          label={part.status}
                          sx={{ bgcolor: part.statusColor || undefined, fontWeight: 700 }}
                        />
                      ) : (
                        <Typography variant="body2" color="text.disabled">—</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
    </Dialog>
  )
}

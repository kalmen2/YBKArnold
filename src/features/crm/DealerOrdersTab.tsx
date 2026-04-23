import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import {
  Alert,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { formatDate, formatStatusLabel } from '../../lib/formatters'
import type { CrmOrder } from './api'

type Props = {
  isLoading: boolean
  error: string | null
  orders: CrmOrder[]
}

export function DealerOrdersTab({ isLoading, error, orders }: Props) {
  return (
    <Stack spacing={1.25}>
      {error ? <Alert severity="warning">{error}</Alert> : null}

      {isLoading ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={18} />
          <Typography color="text.secondary">Loading orders...</Typography>
        </Stack>
      ) : orders.length === 0 ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 3 }}>
          <LocalShippingRoundedIcon color="disabled" fontSize="small" />
          <Typography color="text.secondary" variant="body2">
            No orders linked to this account yet.
          </Typography>
        </Stack>
      ) : (
        <TableContainer
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            maxHeight: { xs: 320, xl: 560 },
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Order</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Due</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Progress</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Stack spacing={0.2}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <LocalShippingRoundedIcon fontSize="inherit" color="action" />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {order.orderNumber || order.title}
                        </Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        Updated {formatDate(order.updatedAt)}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>{formatStatusLabel(order.status)}</TableCell>
                  <TableCell>{formatDate(order.dueDate)}</TableCell>
                  <TableCell align="right">{Math.round(order.progressPercent)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  )
}

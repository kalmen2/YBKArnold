import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
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
import { formatCurrency, formatDate, formatStatusLabel } from '../../lib/formatters'
import type { CrmQuote } from './api'

type Props = {
  isLoading: boolean
  error: string | null
  quotes: CrmQuote[]
}

export function DealerQuotesTab({ isLoading, error, quotes }: Props) {
  return (
    <Stack spacing={1.25}>
      {error ? <Alert severity="warning">{error}</Alert> : null}

      {isLoading ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={18} />
          <Typography color="text.secondary">Loading quotes...</Typography>
        </Stack>
      ) : quotes.length === 0 ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 3 }}>
          <LocalOfferRoundedIcon color="disabled" fontSize="small" />
          <Typography color="text.secondary" variant="body2">
            No quotes linked to this account yet.
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
                <TableCell sx={{ fontWeight: 700 }}>Quote</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Amount</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Updated</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {quotes.map((quote) => (
                <TableRow key={quote.id}>
                  <TableCell>
                    <Stack spacing={0.2}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {quote.quoteNumber || quote.title}
                      </Typography>
                      {quote.quoteNumber && quote.title ? (
                        <Typography variant="caption" color="text.secondary">
                          {quote.title}
                        </Typography>
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell>{formatStatusLabel(quote.status)}</TableCell>
                  <TableCell align="right">{formatCurrency(quote.totalAmount, 2)}</TableCell>
                  <TableCell>{formatDate(quote.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  )
}

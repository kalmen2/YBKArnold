// The opportunities list, the alternative to the card board.
//
// Modelled on Minimal's invoice list. One pairing is kept from it — the account
// carries the project underneath, since a project name means nothing without
// the account it belongs to. Everything you sort or scan by keeps its own
// column, because a quote number buried under a company name is unfindable.
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
import {
  Avatar,
  Box,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useMemo, useState } from 'react'
import type { CrmQuote } from './api'

type SortField = 'quoteNumber' | 'dealerName' | 'salesRep' | 'opportunityDate' | 'totalAmount'

// Dealer takes whatever is left. Everything else is held to what it needs, so
// the table fits a 13-inch laptop without a horizontal scrollbar.
// Account takes whatever is left; the rest are held to what they need.
// Sized against the real data rather than by eye. The longest quote numbers in
// use run to 15 characters (26_AKF 155.5_R0) with one at 21, and sales reps to
// 18 (Heather Huddleston). Cell padding is trimmed below so these widths are
// nearly all usable text.
const COLUMNS: { field: SortField, label: string, align?: 'right', width?: number }[] = [
  { field: 'quoteNumber', label: 'Quote', width: 205 },
  { field: 'dealerName', label: 'Account' },
  { field: 'opportunityDate', label: 'Date', width: 118 },
  { field: 'salesRep', label: 'Sales rep', width: 150 },
  { field: 'totalAmount', label: 'Amount', align: 'right', width: 108 },
]

// MUI's small cell spends 32px of every column on side padding. Ten a side
// gives each column back 12px of text without widening the table.
const CELL_SX = { px: 1.25 } as const

function sortValue(quote: CrmQuote, field: SortField) {
  if (field === 'totalAmount') {
    return Number(quote.totalAmount ?? 0)
  }

  if (field === 'opportunityDate') {
    return String(quote.opportunityDate ?? '')
  }

  return String(quote[field] ?? '').toLowerCase()
}

export function OpportunityListView({
  quotes,
  resolveDealerName,
  resolveDealerPicture,
  formatDate,
  formatMoney,
  canManage,
  busyQuoteId,
  onOpenDetails,
  onOpenChat,
  onPrintQuote,
  onDeleteQuote,
}: {
  quotes: CrmQuote[]
  resolveDealerName: (quote: CrmQuote) => string
  /** Many accounts carry a logo; the initial is only the fallback. */
  resolveDealerPicture: (quote: CrmQuote) => string | null
  formatDate: (value: string | null | undefined) => string
  formatMoney: (value: number) => string
  canManage: boolean
  busyQuoteId: string | null
  onOpenDetails: (quote: CrmQuote) => void
  onOpenChat: (quote: CrmQuote) => void
  onPrintQuote: (quote: CrmQuote) => void
  onDeleteQuote: (quote: CrmQuote) => void
}) {
  const [sortField, setSortField] = useState<SortField>('opportunityDate')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [menuState, setMenuState] = useState<{ el: HTMLElement, quote: CrmQuote } | null>(null)

  const sortedQuotes = useMemo(() => {
    const rows = [...quotes]

    rows.sort((left, right) => {
      const a = sortValue(left, sortField)
      const b = sortValue(right, sortField)
      const result = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b))

      return sortDirection === 'asc' ? result : -result
    })

    return rows
  }, [quotes, sortDirection, sortField])

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortField(field)
    setSortDirection(field === 'totalAmount' || field === 'opportunityDate' ? 'desc' : 'asc')
  }

  if (quotes.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 6, borderRadius: '12px', textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No opportunities in this stage.
        </Typography>
      </Paper>
    )
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: '12px', overflow: 'hidden' }}>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 810, tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, whiteSpace: 'nowrap' } }}>
              {COLUMNS.map((column) => (
                <TableCell
                  key={column.field}
                  align={column.align}
                  sx={{ ...CELL_SX, width: column.width }}
                >
                  <TableSortLabel
                    active={sortField === column.field}
                    direction={sortField === column.field ? sortDirection : 'asc'}
                    onClick={() => toggleSort(column.field)}
                  >
                    {column.label}
                  </TableSortLabel>
                </TableCell>
              ))}
              <TableCell align="right" sx={{ width: 56 }} />
            </TableRow>
          </TableHead>

          <TableBody>
            {sortedQuotes.map((quote) => {
              const dealerName = resolveDealerName(quote)

              return (
                <TableRow
                  key={quote.id}
                  hover
                  onClick={() => onOpenDetails(quote)}
                  sx={{
                    cursor: 'pointer',
                    opacity: busyQuoteId === quote.id ? 0.5 : 1,
                    '&:last-of-type td': { borderBottom: 0 },
                  }}
                >
                  {/* Truncated values still answer on hover, so an unusually
                      long entry stays readable without a wider column. */}
                  <TableCell sx={CELL_SX}>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 700 }}
                      noWrap
                      title={String(quote.quoteNumber ?? '').trim()}
                    >
                      {String(quote.quoteNumber ?? '').trim() || '—'}
                    </Typography>
                  </TableCell>

                  <TableCell sx={CELL_SX}>
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                      <Avatar
                        src={resolveDealerPicture(quote) ?? undefined}
                        alt={dealerName}
                        sx={{
                          width: 36,
                          height: 36,
                          fontSize: 15,
                          fontWeight: 700,
                          flexShrink: 0,
                          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14),
                          color: 'primary.main',
                        }}
                      >
                        {dealerName.trim().charAt(0).toUpperCase() || 'A'}
                      </Avatar>

                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap>{dealerName}</Typography>
                        <Typography variant="caption" color="text.disabled" noWrap sx={{ display: 'block' }}>
                          {String(quote.title ?? '').trim() || 'No project name'}
                        </Typography>
                      </Box>
                    </Stack>
                  </TableCell>

                  <TableCell sx={CELL_SX}>
                    <Typography variant="body2" noWrap>
                      {formatDate(quote.opportunityDate)}
                    </Typography>
                  </TableCell>

                  <TableCell sx={CELL_SX}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      noWrap
                      title={String(quote.salesRep ?? '').trim()}
                    >
                      {String(quote.salesRep ?? '').trim() || '—'}
                    </Typography>
                  </TableCell>

                  <TableCell align="right" sx={CELL_SX}>
                    <Typography variant="body2">{formatMoney(Number(quote.totalAmount || 0))}</Typography>
                  </TableCell>

                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation()
                        setMenuState({ el: event.currentTarget, quote })
                      }}
                    >
                      <MoreVertRoundedIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu
        anchorEl={menuState?.el ?? null}
        open={Boolean(menuState)}
        onClose={() => setMenuState(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            const quote = menuState?.quote
            setMenuState(null)
            if (quote) onOpenChat(quote)
          }}
        >
          <ListItemIcon><ChatBubbleOutlineRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Quote chat</ListItemText>
        </MenuItem>

        <MenuItem
          onClick={() => {
            const quote = menuState?.quote
            setMenuState(null)
            if (quote) onPrintQuote(quote)
          }}
        >
          <ListItemIcon><PrintRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Print quote</ListItemText>
        </MenuItem>

        {canManage ? (
          <MenuItem
            onClick={() => {
              const quote = menuState?.quote
              setMenuState(null)
              if (quote) onDeleteQuote(quote)
            }}
          >
            <ListItemIcon><DeleteOutlineRoundedIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText sx={{ color: 'error.main' }}>Delete quote</ListItemText>
          </MenuItem>
        ) : null}
      </Menu>

      <Box sx={{ px: 2, py: 1.25, borderTop: (theme) => `1px solid ${theme.palette.divider}` }}>
        <Typography variant="caption" color="text.secondary">
          {`${sortedQuotes.length} ${sortedQuotes.length === 1 ? 'opportunity' : 'opportunities'}`}
        </Typography>
      </Box>
    </Paper>
  )
}

import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type MouseEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  createCrmQuoteChatMessage,
  fetchCrmQuoteChats,
  fetchCrmQuotes,
  updateCrmQuote,
  type CrmQuote,
  type CrmQuoteChatMessage,
} from '../features/crm/api'
import { StatusAlerts } from '../components/StatusAlerts'
import { useDebounceValue } from '../hooks/useDebounceValue'
import { formatCurrency, formatDate, formatStatusLabel } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type QuoteLifecycleView = 'all' | 'open' | 'converted' | 'declined' | 'cancelled'

const lifecycleOrder: QuoteLifecycleView[] = ['all', 'open', 'converted', 'declined', 'cancelled']

function normalizeText(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function isCancelledQuote(quote: CrmQuote) {
  const status = normalizeText(quote.status)
  return status === 'cancelled' || status === 'canceled'
}

function isConvertedQuote(quote: CrmQuote) {
  const status = normalizeText(quote.status)
  const stage = normalizeText(quote.opportunityStage)

  return status === 'accepted' || stage === 'order_placement'
}

function isOpenQuote(quote: CrmQuote) {
  return !isCancelledQuote(quote) && !isConvertedQuote(quote) && normalizeText(quote.status) !== 'rejected'
}

function resolveLifecycleLabel(lifecycle: QuoteLifecycleView) {
  if (lifecycle === 'open') {
    return 'Open'
  }

  if (lifecycle === 'converted') {
    return 'Converted'
  }

  if (lifecycle === 'declined') {
    return 'Declined'
  }

  if (lifecycle === 'cancelled') {
    return 'Canceled'
  }

  return 'All'
}

function formatQuoteChatTimestamp(value: string | null | undefined) {
  const parsed = new Date(String(value || '').trim())

  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown time'
  }

  return parsed.toLocaleString()
}

function resolveQuoteChatAuthorLabel(message: CrmQuoteChatMessage) {
  return String(
    message.createdByName
    || message.createdByEmail
    || message.createdByUid
    || 'Unknown sender',
  ).trim()
}

function resolveStatusChipColor(status: string) {
  const normalized = normalizeText(status)

  if (normalized === 'accepted') {
    return 'success'
  }

  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'rejected') {
    return 'error'
  }

  if (normalized === 'sent') {
    return 'info'
  }

  return 'default'
}

export default function SalesQuotesPage() {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState('')
  const [salesRepFilter, setSalesRepFilter] = useState('')
  const [dealerStateFilter, setDealerStateFilter] = useState('')
  const [projectTypeFilter, setProjectTypeFilter] = useState('')
  const [lifecycleView, setLifecycleView] = useState<QuoteLifecycleView>('all')
  const [actionAnchorEl, setActionAnchorEl] = useState<HTMLElement | null>(null)
  const [actionQuoteId, setActionQuoteId] = useState<string | null>(null)
  const [isMovingBackQuoteId, setIsMovingBackQuoteId] = useState<string | null>(null)
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null)
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null)
  const [selectedQuote, setSelectedQuote] = useState<CrmQuote | null>(null)
  const [quoteChatDraft, setQuoteChatDraft] = useState('')
  const [isSendingQuoteChat, setIsSendingQuoteChat] = useState(false)

  const debouncedSearch = useDebounceValue(searchInput, 250)
  const canManage = Boolean(appUser?.uid)
  const selectedQuoteId = selectedQuote?.id ?? ''
  const lifecycleQueryValue = lifecycleView === 'declined' ? 'rejected' : lifecycleView

  const quotesQuery = useQuery({
    queryKey: QUERY_KEYS.crmQuotes({
      limit: 1500,
      status: 'all',
      dealerSourceId: '',
      quoteNumber: '',
      search: debouncedSearch,
      salesRep: salesRepFilter,
      dealerState: dealerStateFilter,
      projectType: projectTypeFilter,
      lifecycle: lifecycleQueryValue,
    }),
    queryFn: () => fetchCrmQuotes({
      limit: 1500,
      status: 'all',
      search: debouncedSearch || undefined,
      salesRep: salesRepFilter || undefined,
      dealerState: dealerStateFilter || undefined,
      projectType: projectTypeFilter || undefined,
      lifecycle: lifecycleQueryValue,
    }),
    staleTime: 60 * 1000,
  })

  const countsQuery = useQuery({
    queryKey: QUERY_KEYS.crmQuotes({
      limit: 1500,
      status: 'all',
      dealerSourceId: '',
      quoteNumber: '',
      search: '',
      salesRep: '',
      dealerState: '',
      projectType: '',
      lifecycle: 'all',
    }),
    queryFn: () => fetchCrmQuotes({
      limit: 1500,
      status: 'all',
      lifecycle: 'all',
    }),
    staleTime: 5 * 60 * 1000,
  })

  const selectedQuoteChatsQuery = useQuery({
    queryKey: QUERY_KEYS.crmQuoteChats(selectedQuoteId),
    queryFn: () => fetchCrmQuoteChats(selectedQuoteId, {
      limit: 250,
      offset: 0,
    }),
    enabled: Boolean(selectedQuoteId),
    staleTime: 20 * 1000,
  })

  const rows = useMemo(
    () => (Array.isArray(quotesQuery.data?.quotes) ? quotesQuery.data?.quotes : []),
    [quotesQuery.data?.quotes],
  )

  const selectedActionQuote = useMemo(
    () => rows.find((quote) => quote.id === actionQuoteId) || null,
    [actionQuoteId, rows],
  )

  const isActionMenuOpen = Boolean(actionAnchorEl)
  const canMoveBackSelectedQuote = Boolean(
    selectedActionQuote
    && ['declined', 'rejected', 'cancelled', 'canceled'].includes(normalizeText(selectedActionQuote.status)),
  )

  const quoteUniverse = useMemo(
    () => (Array.isArray(countsQuery.data?.quotes) ? countsQuery.data?.quotes : []),
    [countsQuery.data?.quotes],
  )

  const selectedQuoteFromData = useMemo(() => {
    if (!selectedQuote) {
      return null
    }

    return quoteUniverse.find((entry) => entry.id === selectedQuote.id)
      || rows.find((entry) => entry.id === selectedQuote.id)
      || selectedQuote
  }, [quoteUniverse, rows, selectedQuote])

  const selectedQuoteChatMessages = useMemo(
    () => (Array.isArray(selectedQuoteChatsQuery.data?.messages)
      ? selectedQuoteChatsQuery.data.messages
      : []),
    [selectedQuoteChatsQuery.data?.messages],
  )

  const selectedQuoteChatErrorMessage = selectedQuoteChatsQuery.error instanceof Error
    ? selectedQuoteChatsQuery.error.message
    : null

  const salesRepOptions = useMemo(() => {
    return [...new Set(
      quoteUniverse
        .map((quote) => String(quote.salesRep ?? '').trim())
        .filter(Boolean),
    )].sort((left, right) => left.localeCompare(right))
  }, [quoteUniverse])

  const dealerStateOptions = useMemo(() => {
    return [...new Set(
      quoteUniverse
        .map((quote) => String(quote.dealerState ?? '').trim().toUpperCase())
        .filter(Boolean),
    )].sort((left, right) => left.localeCompare(right))
  }, [quoteUniverse])

  const projectTypeOptions = useMemo(() => {
    return [...new Set(
      quoteUniverse
        .map((quote) => String(quote.projectType ?? '').trim())
        .filter(Boolean),
    )].sort((left, right) => left.localeCompare(right))
  }, [quoteUniverse])

  const lifecycleCounts = useMemo(() => {
    let open = 0
    let converted = 0
    let declined = 0
    let cancelled = 0

    for (const quote of quoteUniverse) {
      if (isCancelledQuote(quote)) {
        cancelled += 1
      } else if (isConvertedQuote(quote)) {
        converted += 1
      } else if (normalizeText(quote.status) === 'rejected') {
        declined += 1
      } else if (isOpenQuote(quote)) {
        open += 1
      }
    }

    return {
      all: quoteUniverse.length,
      open,
      converted,
      declined,
      cancelled,
    }
  }, [quoteUniverse])

  const totalVisibleAmount = useMemo(
    () => rows.reduce((sum, quote) => sum + Number(quote.totalAmount || 0), 0),
    [rows],
  )

  const isLoading = quotesQuery.isLoading
  const isRefreshing = quotesQuery.isFetching && !quotesQuery.isLoading
  const queryErrorMessage = quotesQuery.error instanceof Error
    ? quotesQuery.error.message
    : (countsQuery.error instanceof Error ? countsQuery.error.message : null)

  const handleOpenQuoteActionMenu = (event: MouseEvent<HTMLButtonElement>, quoteId: string) => {
    event.stopPropagation()
    setActionErrorMessage(null)
    setActionSuccessMessage(null)
    setActionQuoteId(quoteId)
    setActionAnchorEl(event.currentTarget)
  }

  const handleCloseQuoteActionMenu = () => {
    setActionAnchorEl(null)
    setActionQuoteId(null)
  }

  const handleOpenQuoteDetails = (quote: CrmQuote) => {
    setActionErrorMessage(null)
    setActionSuccessMessage(null)
    setSelectedQuote(quote)
    setQuoteChatDraft('')
  }

  const handleCloseQuoteDetails = () => {
    if (isSendingQuoteChat) {
      return
    }

    setSelectedQuote(null)
    setQuoteChatDraft('')
  }

  const handleSendQuoteChat = async () => {
    const nextMessage = quoteChatDraft.trim()

    if (!selectedQuoteId || !nextMessage) {
      return
    }

    if (!canManage) {
      setActionErrorMessage('You do not have permission to post quote chat messages.')
      return
    }

    setActionErrorMessage(null)
    setActionSuccessMessage(null)
    setIsSendingQuoteChat(true)

    try {
      await createCrmQuoteChatMessage(selectedQuoteId, nextMessage)
      setQuoteChatDraft('')
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuoteChats(selectedQuoteId) })
      setActionSuccessMessage('Quote chat message sent.')
    } catch (error) {
      setActionErrorMessage(error instanceof Error ? error.message : 'Failed to send quote chat message.')
    } finally {
      setIsSendingQuoteChat(false)
    }
  }

  const handleMoveBackQuote = async () => {
    if (!selectedActionQuote || !canMoveBackSelectedQuote) {
      return
    }

    const quoteLabel = selectedActionQuote.quoteNumber || selectedActionQuote.title || selectedActionQuote.id
    const confirmed = window.confirm(`Move ${quoteLabel} back to active quote?`)

    if (!confirmed) {
      return
    }

    setActionErrorMessage(null)
    setActionSuccessMessage(null)
    setIsMovingBackQuoteId(selectedActionQuote.id)

    try {
      await updateCrmQuote(selectedActionQuote.id, {
        status: 'draft',
        opportunityStage: 'concept',
      })

      await queryClient.invalidateQueries({ queryKey: ['crm', 'quotes'] })
      setActionSuccessMessage('Quote moved back to active pipeline.')
      handleCloseQuoteActionMenu()
    } catch (error) {
      setActionErrorMessage(error instanceof Error ? error.message : 'Failed to move quote back.')
    } finally {
      setIsMovingBackQuoteId(null)
    }
  }

  const columns = useMemo<GridColDef<CrmQuote>[]>(() => [
    {
      field: 'quoteNumber',
      headerName: 'Quote',
      minWidth: 150,
      flex: 0.9,
      sortable: true,
      valueGetter: (_value, row) => row.quoteNumber || row.id.slice(0, 8).toUpperCase(),
      renderCell: (params) => (
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {String(params.value || '-')}
        </Typography>
      ),
    },
    {
      field: 'title',
      headerName: 'Project',
      minWidth: 220,
      flex: 1.4,
      valueGetter: (_value, row) => row.title || '-',
    },
    {
      field: 'dealerName',
      headerName: 'Dealer',
      minWidth: 180,
      flex: 1.15,
      valueGetter: (_value, row) => row.dealerName || row.companyName || '-',
    },
    {
      field: 'salesRep',
      headerName: 'Sales Rep',
      minWidth: 160,
      flex: 1,
      valueGetter: (_value, row) => row.salesRep || '-',
    },
    {
      field: 'dealerState',
      headerName: 'State',
      minWidth: 100,
      flex: 0.65,
      valueGetter: (_value, row) => row.dealerState || '-',
    },
    {
      field: 'projectType',
      headerName: 'Type',
      minWidth: 145,
      flex: 0.85,
      valueGetter: (_value, row) => row.projectType || '-',
    },
    {
      field: 'opportunityStage',
      headerName: 'Stage',
      minWidth: 160,
      flex: 0.95,
      valueGetter: (_value, row) => row.opportunityStage ? formatStatusLabel(row.opportunityStage) : '-',
    },
    {
      field: 'status',
      headerName: 'Status',
      minWidth: 140,
      flex: 0.9,
      valueGetter: (_value, row) => formatStatusLabel(String(row.status || 'unknown')),
      renderCell: (params) => (
        <Chip
          size="small"
          label={String(params.value || 'Unknown')}
          color={resolveStatusChipColor(String(params.row.status || ''))}
          variant="outlined"
          sx={{ height: 21 }}
        />
      ),
    },
    {
      field: 'totalAmount',
      headerName: 'Amount',
      minWidth: 130,
      flex: 0.8,
      align: 'right',
      headerAlign: 'right',
      valueGetter: (_value, row) => Number(row.totalAmount || 0),
      renderCell: (params) => formatCurrency(Number(params.value || 0), 2),
    },
    {
      field: 'updatedAt',
      headerName: 'Updated',
      minWidth: 130,
      flex: 0.85,
      valueGetter: (_value, row) => formatDate(row.updatedAt),
    },
    {
      field: 'actions',
      headerName: '',
      minWidth: 64,
      width: 64,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      align: 'center',
      headerAlign: 'center',
      resizable: false,
      renderCell: (params) => (
        <IconButton
          size="small"
          disabled={isMovingBackQuoteId === params.row.id}
          onClick={(event) => {
            handleOpenQuoteActionMenu(event, params.row.id)
          }}
        >
          <MoreVertRoundedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      ),
    },
  ], [isMovingBackQuoteId])

  return (
    <Stack spacing={1.5}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1.25, md: 1.5 },
          borderRadius: 1.75,
          borderColor: (theme) => alpha(theme.palette.primary.main, 0.25),
          background: (theme) => `linear-gradient(125deg, ${alpha(theme.palette.info.main, 0.12)} 0%, ${alpha(theme.palette.primary.main, 0.08)} 48%, ${alpha(theme.palette.background.paper, 0.98)} 100%)`,
        }}
      >
        <Stack spacing={1}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', md: 'center' }}
          >
            <Stack spacing={0.25}>
              <Stack direction="row" spacing={0.8} alignItems="center">
                <LocalOfferRoundedIcon color="primary" />
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Sales Quotes
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Central quote view with lifecycle, rep, state, and project-type intelligence.
              </Typography>
            </Stack>

            <Stack direction="row" spacing={0.75} alignItems="center">
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<RefreshRoundedIcon fontSize="small" />}
                disabled={isRefreshing}
                onClick={() => {
                  void quotesQuery.refetch()
                }}
              >
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </Button>
            </Stack>
          </Stack>

          <Stack direction="row" flexWrap="wrap" gap={0.75}>
            {lifecycleOrder.map((lifecycle) => {
              const count = lifecycleCounts[lifecycle]
              const isActive = lifecycleView === lifecycle

              return (
                <Chip
                  key={lifecycle}
                  clickable
                  color={isActive ? 'primary' : 'default'}
                  variant={isActive ? 'filled' : 'outlined'}
                  label={`${resolveLifecycleLabel(lifecycle)} (${count})`}
                  onClick={() => {
                    setLifecycleView(lifecycle)
                  }}
                />
              )
            })}
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                md: '2fr 1fr 1fr 1fr',
              },
              gap: 0.8,
            }}
          >
            <TextField
              size="small"
              placeholder="Search quote #, project, dealer, contact, or rep"
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value)
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              select
              size="small"
              label="Sales rep"
              value={salesRepFilter}
              onChange={(event) => {
                setSalesRepFilter(event.target.value)
              }}
            >
              <MenuItem value="">All reps</MenuItem>
              {salesRepOptions.map((option) => (
                <MenuItem key={`rep-${option}`} value={option}>{option}</MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="State"
              value={dealerStateFilter}
              onChange={(event) => {
                setDealerStateFilter(event.target.value)
              }}
            >
              <MenuItem value="">All states</MenuItem>
              {dealerStateOptions.map((option) => (
                <MenuItem key={`state-${option}`} value={option}>{option}</MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="Project type"
              value={projectTypeFilter}
              onChange={(event) => {
                setProjectTypeFilter(event.target.value)
              }}
            >
              <MenuItem value="">All types</MenuItem>
              {projectTypeOptions.map((option) => (
                <MenuItem key={`project-type-${option}`} value={option}>{option}</MenuItem>
              ))}
            </TextField>
          </Box>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.1, borderRadius: 1.5 }}>
        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" sx={{ mb: 0.8 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {rows.length} matching quote{rows.length === 1 ? '' : 's'}
          </Typography>
          <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 700 }}>
            Visible value {formatCurrency(totalVisibleAmount, 2)}
          </Typography>
        </Stack>

        <StatusAlerts
          errorMessage={actionErrorMessage || queryErrorMessage}
          successMessage={actionSuccessMessage}
        />

        {!isLoading && rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
            No quotes matched this filter set.
          </Typography>
        ) : (
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              height: '70vh',
              overflow: 'hidden',
              '& .MuiDataGrid-columnHeaders': {
                borderBottomColor: 'divider',
              },
              '& .MuiDataGrid-cell': {
                alignItems: 'center',
              },
            }}
          >
            <DataGrid
              rows={rows}
              columns={columns}
              loading={isLoading}
              disableRowSelectionOnClick
              onRowClick={(params) => {
                handleOpenQuoteDetails(params.row)
              }}
              pageSizeOptions={[25, 50, 100]}
              initialState={{
                pagination: {
                  paginationModel: {
                    pageSize: 50,
                    page: 0,
                  },
                },
              }}
              density="compact"
              hideFooterSelectedRowCount
            />
          </Box>
        )}
      </Paper>

      <Menu
        anchorEl={actionAnchorEl}
        open={isActionMenuOpen}
        onClose={handleCloseQuoteActionMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          disabled={!canMoveBackSelectedQuote || Boolean(isMovingBackQuoteId)}
          onClick={() => {
            void handleMoveBackQuote()
          }}
        >
          Move back
        </MenuItem>
      </Menu>

      <Dialog
        open={Boolean(selectedQuoteFromData)}
        onClose={handleCloseQuoteDetails}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Quote Details & Chat</DialogTitle>
        <DialogContent dividers>
          {selectedQuoteFromData ? (
            <Stack spacing={1.1} sx={{ mt: 0.2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  label="Quote"
                  value={selectedQuoteFromData.quoteNumber || selectedQuoteFromData.id.slice(0, 8).toUpperCase()}
                  InputProps={{ readOnly: true }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Status"
                  value={formatStatusLabel(String(selectedQuoteFromData.status || 'unknown'))}
                  InputProps={{ readOnly: true }}
                  sx={{ flex: 1 }}
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  label="Project"
                  value={String(selectedQuoteFromData.title || '-')}
                  InputProps={{ readOnly: true }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Dealer"
                  value={String(selectedQuoteFromData.dealerName || selectedQuoteFromData.companyName || '-')}
                  InputProps={{ readOnly: true }}
                  sx={{ flex: 1 }}
                />
              </Stack>

              <Stack spacing={0.75}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Quote Chat
                </Typography>

                <Paper
                  variant="outlined"
                  sx={{
                    p: 1,
                    borderRadius: 1,
                    borderColor: alpha('#0f4c81', 0.22),
                    backgroundColor: '#ffffff',
                    maxHeight: 280,
                    overflowY: 'auto',
                  }}
                >
                  {selectedQuoteChatsQuery.isLoading ? (
                    <Typography variant="caption" color="text.secondary">
                      Loading chat...
                    </Typography>
                  ) : selectedQuoteChatMessages.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      No messages yet.
                    </Typography>
                  ) : (
                    <Stack spacing={0.75}>
                      {selectedQuoteChatMessages.map((message) => (
                        <Box
                          key={message.id}
                          sx={{
                            px: 0.8,
                            py: 0.65,
                            borderRadius: 0.9,
                            border: `1px solid ${alpha('#0f4c81', 0.16)}`,
                            backgroundColor: alpha('#0f4c81', 0.03),
                          }}
                        >
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.2 }}>
                            {resolveQuoteChatAuthorLabel(message)} • {formatQuoteChatTimestamp(message.createdAt)}
                          </Typography>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                            {String(message.message || '').trim()}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Paper>

                {selectedQuoteChatErrorMessage ? (
                  <Typography variant="caption" color="error">
                    {selectedQuoteChatErrorMessage}
                  </Typography>
                ) : null}

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} alignItems={{ xs: 'stretch', sm: 'flex-end' }}>
                  <TextField
                    label="New message"
                    value={quoteChatDraft}
                    onChange={(event) => {
                      setQuoteChatDraft(event.target.value)
                    }}
                    disabled={!canManage || isSendingQuoteChat}
                    multiline
                    minRows={2}
                    placeholder="Add a message that stays with this quote"
                    sx={{ flex: 1 }}
                  />
                  <Button
                    variant="contained"
                    disabled={
                      !canManage
                      || isSendingQuoteChat
                      || quoteChatDraft.trim().length === 0
                    }
                    onClick={() => {
                      void handleSendQuoteChat()
                    }}
                  >
                    {isSendingQuoteChat ? 'Sending...' : 'Send'}
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseQuoteDetails} disabled={isSendingQuoteChat}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

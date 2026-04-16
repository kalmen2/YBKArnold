import ContactsRoundedIcon from '@mui/icons-material/ContactsRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  fetchCrmDealerDetail,
  fetchCrmDealers,
  type CrmDealer,
  type CrmDealerDetailResponse,
} from '../features/crm/api'

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Unknown'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function displayContactName(contact: CrmDealerDetailResponse['contacts'][number]) {
  if (contact.name) {
    return contact.name
  }

  const nameFromParts = [contact.firstName, contact.lastName]
    .filter((entry) => Boolean(entry && entry.trim()))
    .join(' ')

  return nameFromParts || 'Unnamed contact'
}

export default function CrmDealersPage() {
  const { appUser, getIdToken } = useAuth()
  const [searchParams] = useSearchParams()

  const [dealers, setDealers] = useState<CrmDealer[]>([])
  const [dealersTotal, setDealersTotal] = useState(0)
  const [selectedDealerId, setSelectedDealerId] = useState('')
  const [dealerDetail, setDealerDetail] = useState<CrmDealerDetailResponse | null>(null)

  const [isLoadingDealers, setIsLoadingDealers] = useState(true)
  const [isRefreshingDealers, setIsRefreshingDealers] = useState(false)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [dealerPage, setDealerPage] = useState(0)
  const [dealerRowsPerPage, setDealerRowsPerPage] = useState(25)
  const [dealerSearchInput, setDealerSearchInput] = useState('')
  const [dealerSearch, setDealerSearch] = useState('')
  const [ownerEmailFilter, setOwnerEmailFilter] = useState('')
  const [includeArchivedDealers, setIncludeArchivedDealers] = useState(false)
  const [hasEmailFilter, setHasEmailFilter] = useState<'all' | 'with' | 'without'>('all')

  const [contactSearchInput, setContactSearchInput] = useState('')
  const [contactSearch, setContactSearch] = useState('')
  const [includeArchivedContacts, setIncludeArchivedContacts] = useState(false)
  const [contactPage, setContactPage] = useState(0)
  const [contactRowsPerPage, setContactRowsPerPage] = useState(25)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDealerSearch(dealerSearchInput.trim())
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [dealerSearchInput])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setContactSearch(contactSearchInput.trim())
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [contactSearchInput])

  const hasEmailFilterValue = useMemo(() => {
    if (hasEmailFilter === 'with') {
      return true
    }

    if (hasEmailFilter === 'without') {
      return false
    }

    return null
  }, [hasEmailFilter])

  const requestedDealerId = useMemo(() => {
    return searchParams.get('dealerSourceId')?.trim() ?? ''
  }, [searchParams])

  useEffect(() => {
    if (requestedDealerId && requestedDealerId !== selectedDealerId) {
      setSelectedDealerId(requestedDealerId)
      setContactPage(0)
    }
  }, [requestedDealerId, selectedDealerId])

  useEffect(() => {
    setDealerPage(0)
  }, [dealerSearch, hasEmailFilter, includeArchivedDealers, ownerEmailFilter])

  const loadDealers = useCallback(async (refreshRequested = false) => {
    setErrorMessage(null)

    if (refreshRequested) {
      setIsRefreshingDealers(true)
    } else {
      setIsLoadingDealers(true)
    }

    try {
      const idToken = await getIdToken()
      const response = await fetchCrmDealers(idToken, {
        limit: dealerRowsPerPage,
        offset: dealerPage * dealerRowsPerPage,
        includeArchived: includeArchivedDealers,
        search: dealerSearch || undefined,
        ownerEmail: ownerEmailFilter.trim() || undefined,
        hasEmail: hasEmailFilterValue,
      })

      const nextDealers = Array.isArray(response.dealers) ? response.dealers : []

      setDealers(nextDealers)
      setDealersTotal(Number(response.total ?? nextDealers.length))

      if (!selectedDealerId && nextDealers.length > 0) {
        setSelectedDealerId(nextDealers[0].sourceId)
      }
    } catch (error) {
      setDealers([])
      setDealersTotal(0)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load dealers.')
    } finally {
      setIsLoadingDealers(false)
      setIsRefreshingDealers(false)
    }
  }, [
    dealerPage,
    dealerRowsPerPage,
    dealerSearch,
    getIdToken,
    hasEmailFilterValue,
    includeArchivedDealers,
    ownerEmailFilter,
    selectedDealerId,
  ])

  const loadDealerDetail = useCallback(async () => {
    if (!selectedDealerId) {
      setDealerDetail(null)
      return
    }

    setErrorMessage(null)
    setIsLoadingDetail(true)

    try {
      const idToken = await getIdToken()
      const response = await fetchCrmDealerDetail(idToken, selectedDealerId, {
        includeArchivedContacts,
        contactSearch: contactSearch || undefined,
        contactOffset: contactPage * contactRowsPerPage,
        contactLimit: contactRowsPerPage,
      })

      setDealerDetail(response)
    } catch (error) {
      setDealerDetail(null)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load dealer details.')
    } finally {
      setIsLoadingDetail(false)
    }
  }, [
    contactPage,
    contactRowsPerPage,
    contactSearch,
    getIdToken,
    includeArchivedContacts,
    selectedDealerId,
  ])

  useEffect(() => {
    void loadDealers(false)
  }, [loadDealers])

  useEffect(() => {
    void loadDealerDetail()
  }, [loadDealerDetail])

  const selectedDealer = dealerDetail?.dealer ?? null
  const contactsPageLink = selectedDealerId
    ? `/admin/crm/contacts?dealerSourceId=${encodeURIComponent(selectedDealerId)}`
    : '/admin/crm/contacts'

  if (!appUser?.isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
        >
          <Stack spacing={0.5}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Dealers
            </Typography>
            <Typography color="text.secondary">
              Click any dealer to inspect profile details and all linked contacts.
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to={contactsPageLink} variant="outlined" startIcon={<ContactsRoundedIcon />}>
              Open Contacts Page
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={isLoadingDealers || isRefreshingDealers}
              onClick={() => {
                void loadDealers(true)
                void loadDealerDetail()
              }}
            >
              {isRefreshingDealers ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            xl: 'minmax(0, 1.05fr) minmax(0, 1.25fr)',
          },
          gap: 2,
        }}
      >
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Dealer Directory
            </Typography>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  md: 'repeat(2, minmax(0, 1fr))',
                },
                gap: 1,
              }}
            >
              <TextField
                size="small"
                label="Search dealer"
                value={dealerSearchInput}
                onChange={(event) => {
                  setDealerSearchInput(event.target.value)
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
                size="small"
                label="Owner email"
                value={ownerEmailFilter}
                onChange={(event) => {
                  setOwnerEmailFilter(event.target.value)
                }}
              />

              <FormControl size="small">
                <InputLabel id="dealer-email-filter">Email</InputLabel>
                <Select
                  labelId="dealer-email-filter"
                  value={hasEmailFilter}
                  label="Email"
                  onChange={(event) => {
                    setHasEmailFilter(event.target.value as 'all' | 'with' | 'without')
                  }}
                >
                  <MenuItem value="all">All dealers</MenuItem>
                  <MenuItem value="with">With email</MenuItem>
                  <MenuItem value="without">Without email</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small">
                <InputLabel id="dealer-archive-filter">Archived</InputLabel>
                <Select
                  labelId="dealer-archive-filter"
                  value={includeArchivedDealers ? 'all' : 'active'}
                  label="Archived"
                  onChange={(event) => {
                    setIncludeArchivedDealers(event.target.value === 'all')
                  }}
                >
                  <MenuItem value="active">Active only</MenuItem>
                  <MenuItem value="all">Include archived</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {isLoadingDealers ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 6 }}>
                <CircularProgress size={18} />
                <Typography color="text.secondary">Loading dealers...</Typography>
              </Stack>
            ) : (
              <>
                <TableContainer
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    maxHeight: { xs: 340, md: 540 },
                  }}
                >
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Dealer</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Owner</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Location</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Contacts</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {dealers.map((dealer) => {
                        const isSelected = selectedDealerId === dealer.sourceId

                        return (
                          <TableRow
                            key={dealer.sourceId}
                            hover
                            selected={isSelected}
                            onClick={() => {
                              setSelectedDealerId(dealer.sourceId)
                              setContactPage(0)
                            }}
                            sx={{ cursor: 'pointer' }}
                          >
                            <TableCell>
                              <Stack spacing={0.2}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {dealer.name || dealer.sourceId}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {dealer.sourceId}
                                </Typography>
                                {dealer.isArchived ? (
                                  <Chip size="small" color="warning" variant="outlined" label="Archived" sx={{ width: 'fit-content' }} />
                                ) : null}
                              </Stack>
                            </TableCell>
                            <TableCell>{dealer.ownerEmail || 'Unknown'}</TableCell>
                            <TableCell>{dealer.email || 'No email'}</TableCell>
                            <TableCell>{[dealer.city, dealer.state].filter(Boolean).join(', ') || 'Unknown'}</TableCell>
                            <TableCell>{dealer.contactCountSource ?? '-'}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>

                <TablePagination
                  component="div"
                  count={dealersTotal}
                  page={dealerPage}
                  onPageChange={(_event, nextPage) => {
                    setDealerPage(nextPage)
                  }}
                  rowsPerPage={dealerRowsPerPage}
                  onRowsPerPageChange={(event) => {
                    setDealerRowsPerPage(Number(event.target.value))
                    setDealerPage(0)
                  }}
                  rowsPerPageOptions={[10, 25, 50, 100]}
                />
              </>
            )}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          {!selectedDealerId ? (
            <Stack spacing={1} sx={{ py: 8 }} alignItems="center" justifyContent="center">
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Select a dealer
              </Typography>
              <Typography color="text.secondary">
                Choose a row on the left to inspect dealer profile and contacts.
              </Typography>
            </Stack>
          ) : isLoadingDetail && !dealerDetail ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 6 }}>
              <CircularProgress size={18} />
              <Typography color="text.secondary">Loading dealer details...</Typography>
            </Stack>
          ) : selectedDealer ? (
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
              >
                <Stack spacing={0.3}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {selectedDealer.name || selectedDealer.sourceId}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedDealer.sourceId}
                  </Typography>
                </Stack>

                <Stack direction="row" spacing={1}>
                  {selectedDealer.isArchived ? <Chip size="small" label="Archived" color="warning" variant="outlined" /> : null}
                  <Chip size="small" label={`Last import: ${formatDateTime(selectedDealer.lastImportedAt)}`} />
                </Stack>
              </Stack>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'repeat(2, minmax(0, 1fr))',
                  },
                  gap: 1,
                }}
              >
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="caption" color="text.secondary">Owner</Typography>
                  <Typography variant="body2">{selectedDealer.ownerEmail || selectedDealer.owner || 'Unknown'}</Typography>
                </Paper>
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="caption" color="text.secondary">Email</Typography>
                  <Typography variant="body2">{selectedDealer.email || selectedDealer.email2 || 'No email'}</Typography>
                </Paper>
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="caption" color="text.secondary">Phone</Typography>
                  <Typography variant="body2">{selectedDealer.phone || selectedDealer.phone2 || 'No phone'}</Typography>
                </Paper>
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="caption" color="text.secondary">Location</Typography>
                  <Typography variant="body2">
                    {[selectedDealer.city, selectedDealer.state, selectedDealer.country].filter(Boolean).join(', ') || 'Unknown'}
                  </Typography>
                </Paper>
              </Box>

              <Typography variant="h6" sx={{ fontWeight: 700, pt: 1 }}>
                Linked Contacts
              </Typography>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: '2fr 1fr',
                  },
                  gap: 1,
                }}
              >
                <TextField
                  size="small"
                  label="Search contacts"
                  value={contactSearchInput}
                  onChange={(event) => {
                    setContactSearchInput(event.target.value)
                    setContactPage(0)
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchRoundedIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />

                <FormControl size="small">
                  <InputLabel id="dealer-contact-archive-filter">Archived contacts</InputLabel>
                  <Select
                    labelId="dealer-contact-archive-filter"
                    value={includeArchivedContacts ? 'all' : 'active'}
                    label="Archived contacts"
                    onChange={(event) => {
                      setIncludeArchivedContacts(event.target.value === 'all')
                      setContactPage(0)
                    }}
                  >
                    <MenuItem value="active">Active only</MenuItem>
                    <MenuItem value="all">Include archived</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <TableContainer
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  maxHeight: { xs: 320, md: 420 },
                }}
              >
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Contact</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Sales Unit</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Phones</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>State</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Origin</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(dealerDetail?.contacts ?? []).map((contact) => (
                      <TableRow key={contact.sourceId}>
                        <TableCell>
                          <Stack spacing={0.2}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {displayContactName(contact)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {contact.sourceId}
                            </Typography>
                            {contact.isArchived ? (
                              <Chip size="small" variant="outlined" color="warning" label="Archived" sx={{ width: 'fit-content' }} />
                            ) : null}
                          </Stack>
                        </TableCell>
                        <TableCell>{contact.primaryEmail || contact.secondaryEmail || 'No email'}</TableCell>
                        <TableCell>{contact.salesUnit || '-'}</TableCell>
                        <TableCell>{[contact.phone, contact.phone2, contact.phoneAlt].filter(Boolean).join(' / ') || '-'}</TableCell>
                        <TableCell>{contact.state || '-'}</TableCell>
                        <TableCell>{contact.contactOrigin || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <TablePagination
                component="div"
                count={dealerDetail?.contactsTotal ?? 0}
                page={contactPage}
                onPageChange={(_event, nextPage) => {
                  setContactPage(nextPage)
                }}
                rowsPerPage={contactRowsPerPage}
                onRowsPerPageChange={(event) => {
                  setContactRowsPerPage(Number(event.target.value))
                  setContactPage(0)
                }}
                rowsPerPageOptions={[10, 25, 50, 100]}
              />
            </Stack>
          ) : (
            <Stack spacing={1} sx={{ py: 8 }} alignItems="center" justifyContent="center">
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Dealer not found
              </Typography>
              <Typography color="text.secondary">
                The selected dealer could not be loaded. Refresh and try again.
              </Typography>
            </Stack>
          )}
        </Paper>
      </Box>
    </Stack>
  )
}

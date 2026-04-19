import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Alert,
  Avatar,
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
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  fetchCrmContacts,
  fetchCrmDealers,
  type CrmContact,
  type CrmDealer,
} from '../features/crm/api'

function displayContactName(contact: CrmContact) {
  if (contact.name) {
    return contact.name
  }

  const combined = [contact.firstName, contact.lastName]
    .filter((entry) => Boolean(entry && entry.trim()))
    .join(' ')

  return combined || 'Unnamed contact'
}

export default function CrmContactsPage() {
  const { getIdToken } = useAuth()
  const [searchParams] = useSearchParams()

  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [totalContacts, setTotalContacts] = useState(0)
  const [dealers, setDealers] = useState<CrmDealer[]>([])

  const [isLoadingContacts, setIsLoadingContacts] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoadingDealers, setIsLoadingDealers] = useState(true)

  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(50)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [dealerSourceId, setDealerSourceId] = useState('')
  const [salesUnit, setSalesUnit] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [contactOrigin, setContactOrigin] = useState<'all' | 'linked' | 'unlinked'>('all')
  const [hasEmailFilter, setHasEmailFilter] = useState<'all' | 'with' | 'without'>('all')
  const [includeArchived, setIncludeArchived] = useState(false)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearch(searchInput.trim())
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [searchInput])

  useEffect(() => {
    const dealerFromQuery = searchParams.get('dealerSourceId')?.trim() ?? ''

    if (dealerFromQuery && dealerFromQuery !== dealerSourceId) {
      setDealerSourceId(dealerFromQuery)
      setPage(0)
    }
  }, [dealerSourceId, searchParams])

  useEffect(() => {
    setPage(0)
  }, [
    contactOrigin,
    countryFilter,
    dealerSourceId,
    hasEmailFilter,
    includeArchived,
    salesUnit,
    search,
    stateFilter,
  ])

  const hasEmailFilterValue = useMemo(() => {
    if (hasEmailFilter === 'with') {
      return true
    }

    if (hasEmailFilter === 'without') {
      return false
    }

    return null
  }, [hasEmailFilter])

  const loadDealers = useCallback(async () => {
    setIsLoadingDealers(true)

    try {
      const idToken = await getIdToken()
      const response = await fetchCrmDealers(idToken, {
        includeArchived: true,
        limit: 2500,
      })

      setDealers(Array.isArray(response.dealers) ? response.dealers : [])
    } catch (error) {
      setDealers([])
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load dealers filter options.')
    } finally {
      setIsLoadingDealers(false)
    }
  }, [getIdToken])

  const loadContacts = useCallback(async (refreshRequested = false) => {
    setErrorMessage(null)

    if (refreshRequested) {
      setIsRefreshing(true)
    } else {
      setIsLoadingContacts(true)
    }

    try {
      const idToken = await getIdToken()
      const response = await fetchCrmContacts(idToken, {
        limit: rowsPerPage,
        offset: page * rowsPerPage,
        includeArchived,
        search: search || undefined,
        dealerSourceId: dealerSourceId || undefined,
        salesUnit: salesUnit.trim() || undefined,
        state: stateFilter.trim() || undefined,
        country: countryFilter.trim() || undefined,
        contactOrigin: contactOrigin === 'all' ? undefined : contactOrigin,
        hasEmail: hasEmailFilterValue,
      })

      setContacts(Array.isArray(response.contacts) ? response.contacts : [])
      setTotalContacts(Number(response.total ?? 0))
    } catch (error) {
      setContacts([])
      setTotalContacts(0)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load contacts.')
    } finally {
      setIsLoadingContacts(false)
      setIsRefreshing(false)
    }
  }, [
    contactOrigin,
    countryFilter,
    dealerSourceId,
    getIdToken,
    hasEmailFilterValue,
    includeArchived,
    page,
    rowsPerPage,
    salesUnit,
    search,
    stateFilter,
  ])

  useEffect(() => {
    void loadDealers()
  }, [loadDealers])

  useEffect(() => {
    void loadContacts(false)
  }, [loadContacts])

  const dealersPageLink = dealerSourceId
    ? `/admin/crm/dealers?dealerSourceId=${encodeURIComponent(dealerSourceId)}`
    : '/admin/crm/dealers'

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
              Contacts
            </Typography>
            <Typography color="text.secondary">
              Filter all CRM contacts by dealer, location, origin, and communication readiness.
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to={dealersPageLink} variant="outlined" startIcon={<BusinessRoundedIcon />}>
              Open Accounts Page
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={isLoadingContacts || isRefreshing}
              onClick={() => {
                void loadContacts(true)
              }}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.25}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Filters
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                md: 'repeat(3, minmax(0, 1fr))',
                xl: 'repeat(4, minmax(0, 1fr))',
              },
              gap: 1,
            }}
          >
            <TextField
              size="small"
              label="Search contacts"
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

            <FormControl size="small" disabled={isLoadingDealers}>
              <InputLabel id="contacts-dealer-filter">Dealer</InputLabel>
              <Select
                labelId="contacts-dealer-filter"
                label="Dealer"
                value={dealerSourceId}
                onChange={(event) => {
                  setDealerSourceId(event.target.value)
                }}
              >
                <MenuItem value="">All dealers</MenuItem>
                {dealers.map((dealer) => (
                  <MenuItem key={dealer.sourceId} value={dealer.sourceId}>
                    {dealer.name || dealer.sourceId}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              size="small"
              label="Sales unit"
              value={salesUnit}
              onChange={(event) => {
                setSalesUnit(event.target.value)
              }}
            />

            <TextField
              size="small"
              label="State"
              value={stateFilter}
              onChange={(event) => {
                setStateFilter(event.target.value)
              }}
            />

            <TextField
              size="small"
              label="Country"
              value={countryFilter}
              onChange={(event) => {
                setCountryFilter(event.target.value)
              }}
            />

            <FormControl size="small">
              <InputLabel id="contacts-email-filter">Email</InputLabel>
              <Select
                labelId="contacts-email-filter"
                label="Email"
                value={hasEmailFilter}
                onChange={(event) => {
                  setHasEmailFilter(event.target.value as 'all' | 'with' | 'without')
                }}
              >
                <MenuItem value="all">All contacts</MenuItem>
                <MenuItem value="with">With email</MenuItem>
                <MenuItem value="without">Without email</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small">
              <InputLabel id="contacts-origin-filter">Origin</InputLabel>
              <Select
                labelId="contacts-origin-filter"
                label="Origin"
                value={contactOrigin}
                onChange={(event) => {
                  setContactOrigin(event.target.value as 'all' | 'linked' | 'unlinked')
                }}
              >
                <MenuItem value="all">All origins</MenuItem>
                <MenuItem value="linked">Linked</MenuItem>
                <MenuItem value="unlinked">Unlinked</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small">
              <InputLabel id="contacts-archive-filter">Archived</InputLabel>
              <Select
                labelId="contacts-archive-filter"
                label="Archived"
                value={includeArchived ? 'all' : 'active'}
                onChange={(event) => {
                  setIncludeArchived(event.target.value === 'all')
                }}
              >
                <MenuItem value="active">Active only</MenuItem>
                <MenuItem value="all">Include archived</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Button
            variant="text"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => {
              setSearchInput('')
              setSearch('')
              setDealerSourceId('')
              setSalesUnit('')
              setStateFilter('')
              setCountryFilter('')
              setContactOrigin('all')
              setHasEmailFilter('all')
              setIncludeArchived(false)
              setPage(0)
            }}
          >
            Clear filters
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        {isLoadingContacts ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 8 }}>
            <CircularProgress size={18} />
            <Typography color="text.secondary">Loading contacts...</Typography>
          </Stack>
        ) : (
          <>
            <TableContainer
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                maxHeight: { xs: 380, md: 600 },
              }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, width: 72 }}>Img</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Contact</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Dealer</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Emails</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Sales Unit</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Phone</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Location</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Origin</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {contacts.map((contact) => {
                    const contactName = displayContactName(contact)

                    return (
                    <TableRow key={contact.sourceId}>
                      <TableCell>
                        <Avatar
                          src={contact.photoUrl || undefined}
                          alt={contactName}
                          sx={{ width: 34, height: 34, mx: 'auto', fontSize: 13 }}
                          imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                        >
                          {contactName.charAt(0).toUpperCase()}
                        </Avatar>
                      </TableCell>

                      <TableCell>
                        <Stack spacing={0.2}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {contactName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {contact.sourceId}
                          </Typography>
                          {contact.isArchived ? (
                            <Chip size="small" label="Archived" color="warning" variant="outlined" sx={{ width: 'fit-content' }} />
                          ) : null}
                        </Stack>
                      </TableCell>

                      <TableCell>
                        {contact.accountSourceId ? (
                          <Stack spacing={0.25}>
                            <Button
                              size="small"
                              component={RouterLink}
                              to={`/admin/crm/dealers?dealerSourceId=${encodeURIComponent(contact.accountSourceId)}`}
                              sx={{ justifyContent: 'flex-start', px: 0, minWidth: 0 }}
                            >
                              {contact.accountName || contact.accountSourceId}
                            </Button>
                            <Typography variant="caption" color="text.secondary">
                              {contact.accountSourceId}
                            </Typography>
                          </Stack>
                        ) : (
                          'Unlinked'
                        )}
                      </TableCell>

                      <TableCell>
                        {[contact.primaryEmail, contact.secondaryEmail, contact.email3, contact.email4]
                          .filter(Boolean)
                          .join(' / ') || 'No email'}
                      </TableCell>

                      <TableCell>{contact.salesUnit || '-'}</TableCell>

                      <TableCell>
                        {[contact.phone, contact.phone2, contact.phoneAlt].filter(Boolean).join(' / ') || '-'}
                      </TableCell>

                      <TableCell>{[contact.city, contact.state, contact.country].filter(Boolean).join(', ') || '-'}</TableCell>

                      <TableCell>{contact.contactOrigin || '-'}</TableCell>
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>

            <TablePagination
              component="div"
              count={totalContacts}
              page={page}
              onPageChange={(_event, nextPage) => {
                setPage(nextPage)
              }}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(Number(event.target.value))
                setPage(0)
              }}
              rowsPerPageOptions={[25, 50, 100, 200]}
            />
          </>
        )}
      </Paper>
    </Stack>
  )
}

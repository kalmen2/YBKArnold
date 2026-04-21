import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Avatar,
  Button,
  Chip,
  InputAdornment,
  Paper,
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
import { alpha } from '@mui/material/styles'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import { useDebounceValue } from '../hooks/useDebounceValue'
import {
  fetchCrmContacts,
  type CrmContact,
} from '../features/crm/api'
import { QUERY_KEYS } from '../lib/queryKeys'

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
  const [searchParams, setSearchParams] = useSearchParams()

  const queryClient = useQueryClient()
  const [rowsPerPage, setRowsPerPage] = useState(50)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounceValue(searchInput)
  const dealerSourceId = searchParams.get('dealerSourceId')?.trim() ?? ''

  const [pagesByFilter, setPagesByFilter] = useState<Record<string, number>>({})
  const paginationFilterKey = `${dealerSourceId}::${search}`
  const page = pagesByFilter[paginationFilterKey] ?? 0

  const contactsQuery = useQuery({
    queryKey: QUERY_KEYS.crmContacts({ limit: rowsPerPage, offset: page * rowsPerPage, search, dealerSourceId }),
    queryFn: () => fetchCrmContacts({
      limit: rowsPerPage,
      offset: page * rowsPerPage,
      search: search || undefined,
      dealerSourceId: dealerSourceId || undefined,
    }),
    staleTime: 3 * 60 * 1000,
    placeholderData: (prev) => prev,
  })

  const contacts: CrmContact[] = Array.isArray(contactsQuery.data?.contacts) ? contactsQuery.data.contacts : []
  const totalContacts = Number(contactsQuery.data?.total ?? 0)
  const isLoadingContacts = contactsQuery.isLoading
  const isRefreshing = contactsQuery.isFetching && !contactsQuery.isLoading
  const errorMessage = contactsQuery.error instanceof Error ? contactsQuery.error.message : null

  const dealersPageLink = dealerSourceId
    ? `/sales?tab=dealers&dealerSourceId=${encodeURIComponent(dealerSourceId)}`
    : '/sales?tab=dealers'

  return (
    <Stack spacing={2.5}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, md: 2.5 },
          borderColor: (theme) => alpha(theme.palette.primary.main, 0.28),
          background: (theme) => `linear-gradient(125deg, ${alpha(theme.palette.primary.main, 0.15)} 0%, ${alpha(theme.palette.info.main, 0.08)} 42%, ${alpha(theme.palette.background.paper, 0.98)} 100%)`,
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
        >
          <Stack spacing={1} sx={{ width: { xs: '100%', md: 'min(560px, 100%)' } }}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Contacts
            </Typography>
   

            <TextField
              size="small"
              label="Search contacts"
              placeholder="Contact, account, email, phone, location"
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

            {dealerSourceId ? (
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip
                  size="small"
                  color="info"
                  variant="outlined"
                  label={`Scoped to account: ${dealerSourceId}`}
                />
                <Button
                  size="small"
                  onClick={() => {
                    setSearchParams((current) => {
                      const next = new URLSearchParams(current)
                      next.delete('dealerSourceId')
                      return next
                    })
                  }}
                >
                  Show all contacts
                </Button>
              </Stack>
            ) : null}
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
                void queryClient.invalidateQueries({ queryKey: ['crm', 'contacts'] })
              }}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <StatusAlerts errorMessage={errorMessage} />

      <Paper variant="outlined" sx={{ p: 2 }}>
        {isLoadingContacts ? (
          <LoadingPanel loading={isLoadingContacts} message="Loading contacts..." contained={false} size={18} />
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
                          alt={contactName}
                          sx={{ width: 34, height: 34, mx: 'auto', fontSize: 13 }}
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
                              to={`/sales?tab=dealers&dealerSourceId=${encodeURIComponent(contact.accountSourceId)}`}
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
                setPagesByFilter((current) => ({
                  ...current,
                  [paginationFilterKey]: nextPage,
                }))
              }}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(Number(event.target.value))
                setPagesByFilter((current) => ({
                  ...current,
                  [paginationFilterKey]: 0,
                }))
              }}
              rowsPerPageOptions={[25, 50, 100, 200]}
            />
          </>
        )}
      </Paper>
    </Stack>
  )
}

import ContactsRoundedIcon from '@mui/icons-material/ContactsRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FacebookRoundedIcon from '@mui/icons-material/FacebookRounded'
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded'
import LinkedInIcon from '@mui/icons-material/LinkedIn'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import PinterestIcon from '@mui/icons-material/Pinterest'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import TwitterIcon from '@mui/icons-material/Twitter'
import YouTubeIcon from '@mui/icons-material/YouTube'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Collapse,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Tab,
  Tabs,
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
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import {
  fetchCrmDealerDetail,
  fetchCrmDealers,
  fetchCrmOrders,
  type CrmDealer,
  type CrmDealerDetailResponse,
  type CrmOrder,
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

function formatDate(value: string | null | undefined) {
  if (!value) {
    return '-'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

function formatStatus(value: string | null | undefined) {
  if (!value) {
    return '-'
  }

  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function toExternalUrl(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return ''
  }

  const withProtocol = /^https?:\/\//i.test(normalized)
    ? normalized
    : `https://${normalized}`

  try {
    const parsed = new URL(withProtocol)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return ''
    }

    parsed.hash = ''

    return parsed.toString()
  } catch {
    return ''
  }
}

function formatSocialLabel(value: string) {
  const normalized = String(value)
    .trim()
    .replace(/[_-]+/g, ' ')

  if (!normalized) {
    return 'Link'
  }

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function resolveSocialVisual(platform: string, href: string) {
  const source = `${platform} ${href}`.toLowerCase()

  if (source.includes('facebook')) {
    return {
      icon: <FacebookRoundedIcon sx={{ fontSize: 16 }} />,
      foreground: '#1877f2',
      background: '#eaf2ff',
      hoverBackground: '#dbe9ff',
    }
  }

  if (source.includes('linkedin')) {
    return {
      icon: <LinkedInIcon sx={{ fontSize: 16 }} />,
      foreground: '#0a66c2',
      background: '#e8f2ff',
      hoverBackground: '#dbe9ff',
    }
  }

  if (source.includes('twitter') || source.includes('x.com')) {
    return {
      icon: <TwitterIcon sx={{ fontSize: 16 }} />,
      foreground: '#1d9bf0',
      background: '#eaf6ff',
      hoverBackground: '#daf0ff',
    }
  }

  if (source.includes('youtube') || source.includes('youtu.be')) {
    return {
      icon: <YouTubeIcon sx={{ fontSize: 16 }} />,
      foreground: '#ff0033',
      background: '#ffeaf0',
      hoverBackground: '#ffdbe6',
    }
  }

  if (source.includes('pinterest')) {
    return {
      icon: <PinterestIcon sx={{ fontSize: 16 }} />,
      foreground: '#bd081c',
      background: '#ffebed',
      hoverBackground: '#ffe0e4',
    }
  }

  return {
    icon: <LanguageRoundedIcon sx={{ fontSize: 16 }} />,
    foreground: '#0f4c81',
    background: '#eaf2fb',
    hoverBackground: '#ddeafb',
  }
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

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ px: 1, py: 0.7 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={0.6}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            minWidth: { sm: 104 },
            fontWeight: 600,
            letterSpacing: '0.01em',
            lineHeight: 1.1,
          }}
        >
          {label}
        </Typography>
        <Box sx={{ fontSize: 13, lineHeight: 1.3 }}>{value}</Box>
      </Stack>
    </Paper>
  )
}

export default function CrmDealersPage() {
  const { getIdToken } = useAuth()
  const [searchParams] = useSearchParams()

  const [dealers, setDealers] = useState<CrmDealer[]>([])
  const [dealersTotal, setDealersTotal] = useState(0)
  const [selectedDealerId, setSelectedDealerId] = useState('')
  const [dealerDetail, setDealerDetail] = useState<CrmDealerDetailResponse | null>(null)

  const [dealerOrders, setDealerOrders] = useState<CrmOrder[]>([])
  const [detailsTab, setDetailsTab] = useState<'contacts' | 'orders'>('contacts')
  const [isAccountInfoExpanded, setIsAccountInfoExpanded] = useState(true)

  const [isLoadingDealers, setIsLoadingDealers] = useState(true)
  const [isRefreshingDealers, setIsRefreshingDealers] = useState(false)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [isLoadingSalesData, setIsLoadingSalesData] = useState(false)

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [salesDataError, setSalesDataError] = useState<string | null>(null)

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
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load accounts.')
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
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load account details.')
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

  const loadDealerSalesData = useCallback(async () => {
    if (!selectedDealerId) {
      setDealerOrders([])
      setSalesDataError(null)
      return
    }

    setSalesDataError(null)
    setIsLoadingSalesData(true)

    try {
      const idToken = await getIdToken()
      const ordersPayload = await fetchCrmOrders(idToken, {
        dealerSourceId: selectedDealerId,
        limit: 150,
      })

      setDealerOrders(Array.isArray(ordersPayload.orders) ? ordersPayload.orders : [])
    } catch (error) {
      setDealerOrders([])
      setSalesDataError(error instanceof Error ? error.message : 'Failed to load orders.')
    } finally {
      setIsLoadingSalesData(false)
    }
  }, [getIdToken, selectedDealerId])

  useEffect(() => {
    void loadDealers(false)
  }, [loadDealers])

  useEffect(() => {
    void loadDealerDetail()
  }, [loadDealerDetail])

  useEffect(() => {
    void loadDealerSalesData()
  }, [loadDealerSalesData])

  const selectedDealer = dealerDetail?.dealer ?? null
  const selectedDealerSocialLinks = useMemo(() => {
    const socialLinks = selectedDealer?.socialMediaLinks ?? {}

    return Object.entries(socialLinks)
      .map(([platform, url]) => {
        const href = toExternalUrl(url)

        if (!href) {
          return null
        }

        return {
          id: `${platform}:${href}`,
          platform,
          label: formatSocialLabel(platform),
          href,
        }
      })
      .filter((entry): entry is { id: string; platform: string; label: string; href: string } => Boolean(entry))
      .sort((left, right) => left.label.localeCompare(right.label))
  }, [selectedDealer?.socialMediaLinks])

  const selectedDealerWebsiteUrl = toExternalUrl(selectedDealer?.website)
  const contactsPageLink = selectedDealerId
    ? `/admin/crm/contacts?dealerSourceId=${encodeURIComponent(selectedDealerId)}`
    : '/admin/crm/contacts'

  const orderRows = useMemo(() => {
    return [...dealerOrders]
      .sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      )
  }, [dealerOrders])

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
          <Stack spacing={0.5}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Accounts
            </Typography>
            <Typography color="text.secondary">
              Select an account from the left to open full profile information, contacts, and orders.
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to={contactsPageLink} variant="outlined" startIcon={<ContactsRoundedIcon />}>
              Contacts
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={isLoadingDealers || isRefreshingDealers}
              onClick={() => {
                void loadDealers(true)
                void loadDealerDetail()
                void loadDealerSalesData()
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
            xl: 'minmax(280px, 320px) minmax(0, 1fr)',
          },
          gap: 2,
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderColor: (theme) => alpha(theme.palette.primary.main, 0.22),
            background: (theme) => `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.06)} 0%, ${theme.palette.background.paper} 36%)`,
          }}
        >
          <Stack spacing={1.25}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Account Names
            </Typography>

            <TextField
              size="small"
              label="Search account"
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

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 1,
              }}
            >
              <FormControl size="small">
                <InputLabel id="accounts-email-filter">Email</InputLabel>
                <Select
                  labelId="accounts-email-filter"
                  value={hasEmailFilter}
                  label="Email"
                  onChange={(event) => {
                    setHasEmailFilter(event.target.value as 'all' | 'with' | 'without')
                  }}
                >
                  <MenuItem value="all">All</MenuItem>
                  <MenuItem value="with">With email</MenuItem>
                  <MenuItem value="without">No email</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small">
                <InputLabel id="accounts-archive-filter">Archived</InputLabel>
                <Select
                  labelId="accounts-archive-filter"
                  value={includeArchivedDealers ? 'all' : 'active'}
                  label="Archived"
                  onChange={(event) => {
                    setIncludeArchivedDealers(event.target.value === 'all')
                  }}
                >
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="all">Include</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <Divider />

            {isLoadingDealers ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 4 }}>
                <CircularProgress size={18} />
                <Typography color="text.secondary">Loading accounts...</Typography>
              </Stack>
            ) : dealers.length === 0 ? (
              <Typography color="text.secondary">No accounts found for this filter.</Typography>
            ) : (
              <Paper
                variant="outlined"
                sx={{
                  maxHeight: { xs: 320, xl: 640 },
                  overflow: 'auto',
                }}
              >
                <List disablePadding>
                  {dealers.map((dealer, index) => {
                    const isSelected = selectedDealerId === dealer.sourceId
                    const accountName = dealer.name || dealer.sourceId
                    const accountInitial = accountName.charAt(0).toUpperCase()
                    const accountLocation = [dealer.city, dealer.state].filter(Boolean).join(', ') || 'No location'

                    return (
                      <ListItemButton
                        key={dealer.sourceId}
                        selected={isSelected}
                        onClick={() => {
                          setSelectedDealerId(dealer.sourceId)
                          setContactPage(0)
                        }}
                        sx={{
                          py: 1,
                          px: 1,
                          gap: 1,
                          borderBottom: index < dealers.length - 1 ? '1px solid' : 'none',
                          borderColor: 'divider',
                          '&.Mui-selected': {
                            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14),
                            borderLeft: '3px solid',
                            borderColor: 'primary.main',
                          },
                          '&.Mui-selected:hover': {
                            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.2),
                          },
                        }}
                      >
                        <Avatar
                          src={dealer.pictureUrl || undefined}
                          alt={accountName}
                          sx={{ width: 32, height: 32, fontSize: 12, fontWeight: 700 }}
                          imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                        >
                          {accountInitial}
                        </Avatar>

                        <ListItemText
                          primary={accountName}
                          secondary={accountLocation}
                          primaryTypographyProps={{
                            fontSize: 14,
                            fontWeight: isSelected ? 700 : 500,
                          }}
                          secondaryTypographyProps={{
                            fontSize: 12,
                            color: 'text.secondary',
                          }}
                        />
                      </ListItemButton>
                    )
                  })}
                </List>
              </Paper>
            )}

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
              rowsPerPageOptions={[25, 50, 100]}
            />
          </Stack>
        </Paper>

        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderColor: (theme) => alpha(theme.palette.primary.main, 0.22),
          }}
        >
          {!selectedDealerId ? (
            <Stack spacing={1} sx={{ py: 8 }} alignItems="center" justifyContent="center">
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Select an account
              </Typography>
              <Typography color="text.secondary">
                Choose an account name from the left list.
              </Typography>
            </Stack>
          ) : isLoadingDetail && !dealerDetail ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 6 }}>
              <CircularProgress size={18} />
              <Typography color="text.secondary">Loading account details...</Typography>
            </Stack>
          ) : selectedDealer ? (
            <Stack spacing={1.1}>
              <Paper
                variant="outlined"
                sx={{
                  p: 1,
                  borderColor: (theme) => alpha(theme.palette.primary.main, 0.24),
                  background: (theme) => `linear-gradient(120deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.background.paper, 0.9)} 80%)`,
                }}
              >
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                >
                  <Stack direction="row" spacing={1.25} alignItems="center">
                    <Avatar
                      src={selectedDealer.pictureUrl || undefined}
                      alt={selectedDealer.name || selectedDealer.sourceId}
                      sx={{ width: 44, height: 44, fontSize: 16 }}
                      imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                    >
                      {(selectedDealer.name || selectedDealer.sourceId).charAt(0).toUpperCase()}
                    </Avatar>

                    <Stack spacing={0.3}>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {selectedDealer.name || selectedDealer.sourceId}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        ID: {selectedDealer.sourceId}
                      </Typography>
                    </Stack>
                  </Stack>

                  <Stack
                    direction="row"
                    spacing={0.75}
                    alignItems="center"
                    sx={{
                      width: { xs: '100%', md: 'auto' },
                      justifyContent: { xs: 'space-between', md: 'flex-end' },
                    }}
                  >
                    <Stack direction="row" spacing={0.75}>
                      {selectedDealer.isArchived ? (
                        <Chip size="small" label="Archived" color="warning" variant="outlined" />
                      ) : null}
                      <Chip size="small" label={`Contacts: ${dealerDetail?.contactsTotal ?? 0}`} variant="outlined" />
                    </Stack>

                    <Tooltip
                      title={isAccountInfoExpanded ? 'Collapse account info' : 'Expand account info'}
                      arrow
                    >
                      <IconButton
                        size="small"
                        onClick={() => {
                          setIsAccountInfoExpanded((current) => !current)
                        }}
                        aria-label={isAccountInfoExpanded ? 'Collapse account info' : 'Expand account info'}
                        sx={{
                          border: '1px solid',
                          borderColor: 'divider',
                          bgcolor: 'background.paper',
                          transition: 'transform 0.2s ease',
                          transform: isAccountInfoExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                      >
                        <ExpandMoreRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
              </Paper>

              <Collapse in={isAccountInfoExpanded} timeout="auto" unmountOnExit>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '1fr',
                      md: 'repeat(2, minmax(0, 1fr))',
                    },
                    gap: 0.7,
                  }}
                >
                  <DetailField label="Owner" value={selectedDealer.ownerEmail || selectedDealer.owner || 'Unknown'} />
                  <DetailField label="Primary email" value={selectedDealer.email || selectedDealer.email2 || 'No email'} />
                  <DetailField label="Primary phone" value={selectedDealer.phone || selectedDealer.phone2 || 'No phone'} />
                  <DetailField
                    label="Website"
                    value={selectedDealerWebsiteUrl ? (
                      <a href={selectedDealerWebsiteUrl} target="_blank" rel="noreferrer">{selectedDealer.website}</a>
                    ) : 'No website'}
                  />
                  <DetailField
                    label="Social links"
                    value={selectedDealerSocialLinks.length > 0 ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {selectedDealerSocialLinks.map((entry) => {
                          const visual = resolveSocialVisual(entry.platform, entry.href)

                          return (
                            <Tooltip key={entry.id} title={entry.label} arrow>
                              <IconButton
                                component="a"
                                href={entry.href}
                                target="_blank"
                                rel="noreferrer"
                                size="small"
                                aria-label={entry.label}
                                sx={{
                                  width: 24,
                                  height: 24,
                                  border: '1px solid',
                                  borderColor: 'divider',
                                  bgcolor: visual.background,
                                  color: visual.foreground,
                                  transition: 'all 0.18s ease',
                                  '&:hover': {
                                    bgcolor: visual.hoverBackground,
                                    transform: 'translateY(-1px)',
                                  },
                                }}
                              >
                                {visual.icon}
                              </IconButton>
                            </Tooltip>
                          )
                        })}
                      </Box>
                    ) : (selectedDealer.socialMedia || 'No social links')}
                  />
                  <DetailField
                    label="Location"
                    value={[
                      selectedDealer.address,
                      selectedDealer.city,
                      selectedDealer.state,
                      selectedDealer.zip,
                      selectedDealer.country,
                    ].filter(Boolean).join(', ') || 'Unknown'}
                  />
                  <DetailField
                    label="Classification"
                    value={[
                      selectedDealer.industry,
                      selectedDealer.accountType,
                      selectedDealer.accountClass,
                    ].filter(Boolean).join(' / ') || 'Unknown'}
                  />
                  <DetailField label="Created" value={formatDateTime(selectedDealer.createdDateSource)} />
                  <DetailField label="Last import" value={formatDateTime(selectedDealer.lastImportedAt)} />
                </Box>
              </Collapse>

              <Divider />

              <Tabs
                value={detailsTab}
                onChange={(_event, nextValue: 'contacts' | 'orders') => {
                  setDetailsTab(nextValue)
                }}
                variant="scrollable"
                allowScrollButtonsMobile
                sx={{ mt: -0.5 }}
              >
                <Tab value="contacts" label={`Contacts (${dealerDetail?.contactsTotal ?? 0})`} />
                <Tab value="orders" label={`Orders (${dealerOrders.length})`} />
              </Tabs>

              {detailsTab === 'contacts' ? (
                <>
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
                      <InputLabel id="account-contact-archive-filter">Archived contacts</InputLabel>
                      <Select
                        labelId="account-contact-archive-filter"
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
                      maxHeight: { xs: 320, xl: 520 },
                    }}
                  >
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700, width: 72 }}>Img</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Contact</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Phone</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Location</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(dealerDetail?.contacts ?? []).map((contact) => {
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
                                  {contact.isArchived ? (
                                    <Chip
                                      size="small"
                                      variant="outlined"
                                      color="warning"
                                      label="Archived"
                                      sx={{ width: 'fit-content' }}
                                    />
                                  ) : null}
                                </Stack>
                              </TableCell>
                              <TableCell>{contact.primaryEmail || contact.secondaryEmail || '-'}</TableCell>
                              <TableCell>{[contact.phone, contact.phone2, contact.phoneAlt].filter(Boolean).join(' / ') || '-'}</TableCell>
                              <TableCell>{[contact.city, contact.state, contact.country].filter(Boolean).join(', ') || '-'}</TableCell>
                            </TableRow>
                          )
                        })}
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
                </>
              ) : (
                <Stack spacing={1.25}>
                  {salesDataError ? <Alert severity="warning">{salesDataError}</Alert> : null}

                  {isLoadingSalesData ? (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
                      <CircularProgress size={18} />
                      <Typography color="text.secondary">Loading orders...</Typography>
                    </Stack>
                  ) : orderRows.length === 0 ? (
                    <Typography color="text.secondary" variant="body2">
                      No orders linked to this account yet.
                    </Typography>
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
                          {orderRows.map((order) => (
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
                              <TableCell>{formatStatus(order.status)}</TableCell>
                              <TableCell>{formatDate(order.dueDate)}</TableCell>
                              <TableCell align="right">{Math.round(order.progressPercent)}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Stack>
              )}
            </Stack>
          ) : (
            <Stack spacing={1} sx={{ py: 8 }} alignItems="center" justifyContent="center">
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Account not found
              </Typography>
              <Typography color="text.secondary">
                The selected account could not be loaded. Refresh and try again.
              </Typography>
            </Stack>
          )}
        </Paper>
      </Box>
    </Stack>
  )
}
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  fetchCrmDealers,
  type CrmDealer,
} from '../features/crm/api'
import { useDebounceValue } from '../hooks/useDebounceValue'
import { formatDateTime } from '../lib/formatters'

type EngagementBucket = 'yes' | 'engagement' | 'none'

const engagementDealersLimit = 2500

function resolveEngagementBucket(status: 'ready' | 'not_ready' | null | undefined): EngagementBucket {
  if (status === 'ready') {
    return 'yes'
  }

  if (status === 'not_ready') {
    return 'engagement'
  }

  return 'none'
}

function formatOptional(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()
  return normalized || '-'
}

function formatAccountTypeLabel(dealer: CrmDealer) {
  const rawType = String(dealer.accountType || dealer.accountClass || '').trim().toLowerCase()

  if (rawType === 'designer') {
    return 'Designer'
  }

  if (rawType === 'dealer') {
    return 'Dealer'
  }

  return '-'
}

export default function SalesEngagementPage() {
  const [bucket, setBucket] = useState<EngagementBucket>('yes')
  const [searchInput, setSearchInput] = useState('')
  const [expandedDealerSourceId, setExpandedDealerSourceId] = useState<string | false>(false)
  const search = useDebounceValue(searchInput)

  const dealersQuery = useQuery({
    queryKey: ['crm', 'engagement-dealers', search],
    queryFn: () => fetchCrmDealers({
      limit: engagementDealersLimit,
      offset: 0,
      search: search || undefined,
    }),
    staleTime: 60 * 1000,
  })

  const allDealers = dealersQuery.data?.dealers ?? []
  const totalAccounts = typeof dealersQuery.data?.total === 'number'
    ? dealersQuery.data.total
    : allDealers.length

  const counts = useMemo(() => {
    const bucketCounts: Record<EngagementBucket, number> = {
      yes: 0,
      engagement: 0,
      none: 0,
    }

    allDealers.forEach((dealer) => {
      bucketCounts[resolveEngagementBucket(dealer.engagementReadinessStatus)] += 1
    })

    return bucketCounts
  }, [allDealers])

  const filteredDealers = useMemo(() => {
    return allDealers
      .filter((dealer) => resolveEngagementBucket(dealer.engagementReadinessStatus) === bucket)
      .sort((left, right) => {
        const leftName = String(left.name || left.sourceId).toLowerCase()
        const rightName = String(right.name || right.sourceId).toLowerCase()
        return leftName.localeCompare(rightName)
      })
  }, [allDealers, bucket])

  const errorMessage = dealersQuery.error instanceof Error
    ? dealersQuery.error.message
    : null

  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Stack spacing={1}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'center' }}
          >
            <Stack direction="row" spacing={0.8} alignItems="center">
              <FactCheckRoundedIcon color="primary" fontSize="small" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Engagement Review (Accounts)
              </Typography>
            </Stack>

            <TextField
              size="small"
              label="Search Accounts"
              placeholder="Account name, id, owner, state"
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value)
              }}
              sx={{ width: { xs: '100%', md: 360 } }}
            />
          </Stack>

          <Tabs
            value={bucket}
            onChange={(_event, nextValue: EngagementBucket) => {
              setBucket(nextValue)
              setExpandedDealerSourceId(false)
            }}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ minHeight: 34 }}
          >
            <Tab value="yes" label={`Yes (${counts.yes})`} sx={{ minHeight: 34, textTransform: 'none' }} />
            <Tab value="engagement" label={`No (${counts.engagement})`} sx={{ minHeight: 34, textTransform: 'none' }} />
            <Tab value="none" label={`None (${counts.none})`} sx={{ minHeight: 34, textTransform: 'none' }} />
          </Tabs>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7}>
            <Chip size="small" variant="outlined" label={`Total accounts: ${totalAccounts}`} />
            <Chip size="small" variant="outlined" label={`Showing: ${filteredDealers.length}`} />
          </Stack>

          {totalAccounts > allDealers.length ? (
            <Typography variant="caption" color="warning.main">
              Showing first {allDealers.length} accounts. Narrow search to review the rest.
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      <StatusAlerts errorMessage={errorMessage} />
      <LoadingPanel loading={dealersQuery.isLoading} message="Loading account engagement..." contained />

      {!dealersQuery.isLoading ? (
        <Paper variant="outlined" sx={{ p: 1.25 }}>
          <Stack spacing={1}>
            {filteredDealers.length === 0 ? (
              <Typography color="text.secondary">No accounts found in this bucket.</Typography>
            ) : (
              filteredDealers.map((dealer) => {
                const accountName = formatOptional(dealer.name) !== '-'
                  ? formatOptional(dealer.name)
                  : dealer.sourceId
                const accountTypeLabel = formatAccountTypeLabel(dealer)
                const accountState = formatOptional(dealer.state)
                const accountNote = formatOptional(dealer.engagementReadinessNote)
                const accountEmail = formatOptional(dealer.email || dealer.ownerEmail)
                const accountPictureUrl = String(dealer.pictureUrl ?? '').trim() || undefined
                const accountLocation = [dealer.city, dealer.state, dealer.country]
                  .filter(Boolean)
                  .join(', ')
                const contextCount = dealer.contactCountSource ?? 0

                if (bucket === 'none') {
                  return (
                    <Paper
                      key={dealer.sourceId}
                      variant="outlined"
                      sx={{
                        px: 1.25,
                        py: 0.85,
                        borderColor: 'divider',
                      }}
                    >
                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={1}
                        alignItems={{ xs: 'flex-start', md: 'center' }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                          <Avatar
                            src={accountPictureUrl}
                            alt={accountName}
                            sx={{ width: 34, height: 34, fontSize: 13, fontWeight: 700 }}
                            imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                          >
                            {accountName.charAt(0).toUpperCase() || '?'}
                          </Avatar>

                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {accountName}
                            </Typography>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                              Email: {accountEmail}
                            </Typography>
                          </Box>
                        </Stack>

                        <Stack direction="row" spacing={0.7} alignItems="center" sx={{ width: { xs: '100%', md: 'auto' } }}>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`Context: ${contextCount}`}
                            sx={{ flexShrink: 0 }}
                          />
                          <Button
                            size="small"
                            variant="outlined"
                            component={RouterLink}
                            startIcon={<OpenInNewRoundedIcon fontSize="small" />}
                            to={`/sales?tab=dealers&dealerSourceId=${encodeURIComponent(dealer.sourceId)}`}
                          >
                            Open account
                          </Button>
                        </Stack>
                      </Stack>
                    </Paper>
                  )
                }

                return (
                  <Accordion
                    key={dealer.sourceId}
                    expanded={expandedDealerSourceId === dealer.sourceId}
                    onChange={(_event, expanded) => {
                      setExpandedDealerSourceId(expanded ? dealer.sourceId : false)
                    }}
                    disableGutters
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      '&:before': {
                        display: 'none',
                      },
                    }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreRoundedIcon />}
                      sx={{
                        px: 1.25,
                        py: 0.45,
                        '& .MuiAccordionSummary-content': {
                          my: 0.25,
                        },
                      }}
                    >
                      <Box
                        sx={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 1,
                        }}
                      >
                        <Avatar
                          src={accountPictureUrl}
                          alt={accountName}
                          sx={{ width: 34, height: 34, fontSize: 13, fontWeight: 700, mt: 0.05 }}
                          imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                        >
                          {accountName.charAt(0).toUpperCase() || '?'}
                        </Avatar>

                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Box
                            sx={{
                              display: 'grid',
                              gridTemplateColumns: {
                                xs: '1fr',
                                md: 'minmax(0, 1.25fr) minmax(0, 0.85fr) minmax(0, 0.7fr)',
                              },
                              gap: 0.55,
                            }}
                          >
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {accountName}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Email: {accountEmail}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Type: {accountTypeLabel}
                            </Typography>
                          </Box>

                          <Box
                            sx={{
                              display: 'grid',
                              gridTemplateColumns: {
                                xs: '1fr',
                                md: 'minmax(0, 0.7fr) minmax(0, 2fr)',
                              },
                              gap: 0.55,
                              mt: 0.2,
                            }}
                          >
                            <Typography variant="body2" color="text.secondary">
                              State: {accountState}
                            </Typography>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Note: {accountNote}
                            </Typography>
                          </Box>
                        </Box>
                      </Box>
                    </AccordionSummary>

                    <AccordionDetails sx={{ pt: 0, px: 1.25, pb: 1.1 }}>
                      <Stack spacing={0.85}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {bucket === 'yes' ? 'Ready context' : 'Not ready context'}
                        </Typography>
                        <Paper variant="outlined" sx={{ p: 1, bgcolor: 'background.default' }}>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {accountNote}
                          </Typography>
                        </Paper>

                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: {
                              xs: '1fr',
                              md: 'repeat(2, minmax(0, 1fr))',
                            },
                            gap: 0.6,
                          }}
                        >
                          <Typography variant="caption" color="text.secondary">ID: {dealer.sourceId}</Typography>
                          <Typography variant="caption" color="text.secondary">Location: {accountLocation || '-'}</Typography>
                          <Typography variant="caption" color="text.secondary">Primary email: {formatOptional(dealer.email)}</Typography>
                          <Typography variant="caption" color="text.secondary">Owner email: {formatOptional(dealer.ownerEmail)}</Typography>
                          <Typography variant="caption" color="text.secondary">Contacts: {contextCount}</Typography>
                          <Typography variant="caption" color="text.secondary">Updated: {formatDateTime(dealer.lastImportedAt)}</Typography>
                        </Box>

                        <Box>
                          <Button
                            size="small"
                            variant="outlined"
                            component={RouterLink}
                            startIcon={<OpenInNewRoundedIcon fontSize="small" />}
                            to={`/sales?tab=dealers&dealerSourceId=${encodeURIComponent(dealer.sourceId)}`}
                          >
                            Open account
                          </Button>
                        </Box>
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                )
              })
            )}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  )
}

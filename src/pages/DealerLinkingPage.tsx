// Dealer linking backfill — a temporary admin tool.
//
// Orders only got a dealer link when they came from a CRM quote. Everything
// that arrived through Monday carries the dealer as free text instead. This
// page groups those orders by that text, ranks CRM accounts against each group,
// and links a whole group in one click.
//
// Delete this file, its tab in ConfigPage.tsx, src/features/dealerLinking/,
// and functions/src/routes/dealer-linking-routes.mjs once the backfill is done.
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  applyDealerLinking,
  fetchDealerLinking,
  type DealerLinkingAccount,
  type DealerLinkingGroup,
  type DealerLinkingSnapshot,
} from '../features/dealerLinking/api'
import { QUERY_KEYS } from '../lib/queryKeys'

type FilterMode = 'all' | 'needs_choice' | 'confident' | 'no_match'

const FILTER_LABELS: Array<{ value: FilterMode, label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'confident', label: 'Near-certain' },
  { value: 'needs_choice', label: 'Needs a choice' },
  { value: 'no_match', label: 'No match found' },
]

function describeAccount(account: DealerLinkingAccount | null) {
  if (!account) {
    return ''
  }

  const place = [account.city, account.state].filter(Boolean).join(', ')
  return place ? `${account.name} — ${place}` : account.name
}

function confidenceTone(score: number): 'success' | 'warning' | 'default' {
  if (score >= 95) return 'success'
  if (score >= 70) return 'warning'
  return 'default'
}

function confidenceLabel(score: number) {
  if (score >= 95) return 'Near-certain'
  if (score >= 85) return 'Strong'
  if (score >= 70) return 'Likely'
  if (score > 0) return 'Weak'
  return 'No match'
}

export default function DealerLinkingPage() {
  const queryClient = useQueryClient()
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [searchText, setSearchText] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [chosenAccounts, setChosenAccounts] = useState<Record<string, DealerLinkingAccount | null>>({})
  const [stateNarrowing, setStateNarrowing] = useState<Record<string, string | null>>({})
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error', message: string } | null>(null)
  const [busyGroupKey, setBusyGroupKey] = useState<string | null>(null)

  const snapshotQuery = useQuery<DealerLinkingSnapshot>({
    queryKey: QUERY_KEYS.dealerLinking,
    queryFn: fetchDealerLinking,
    staleTime: 30 * 1000,
  })

  const applyMutation = useMutation({
    mutationFn: applyDealerLinking,
    onSettled: () => {
      setBusyGroupKey(null)
    },
    onSuccess: (result) => {
      setFeedback({
        tone: 'success',
        message: result.action === 'link'
          ? `Linked ${result.modifiedCount} order${result.modifiedCount === 1 ? '' : 's'} to ${result.dealerName}.`
          : `Set aside ${result.modifiedCount} order${result.modifiedCount === 1 ? '' : 's'}.`,
      })
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dealerLinking })
    },
    onError: (error: unknown) => {
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'That did not save.' })
    },
  })

  const snapshot = snapshotQuery.data
  const accounts = snapshot?.accounts ?? []

  const visibleGroups = useMemo(() => {
    const groups = snapshot?.groups ?? []
    const needle = searchText.trim().toLowerCase()

    return groups.filter((group) => {
      if (needle && !group.label.toLowerCase().includes(needle)
        && !group.orders.some((order) => order.orderNumber.toLowerCase().includes(needle))) {
        return false
      }

      if (filterMode === 'confident') return group.confidence >= 95
      if (filterMode === 'needs_choice') return group.confidence > 0 && group.confidence < 95
      if (filterMode === 'no_match') return group.confidence === 0

      return true
    })
  }, [snapshot, searchText, filterMode])

  function selectedOrdersFor(group: DealerLinkingGroup) {
    const narrowedState = stateNarrowing[group.key] ?? null
    return narrowedState
      ? group.orders.filter((order) => order.shipToState === narrowedState)
      : group.orders
  }

  function chosenAccountFor(group: DealerLinkingGroup): DealerLinkingAccount | null {
    if (group.key in chosenAccounts) {
      return chosenAccounts[group.key]
    }

    // Pre-select only when the name match is strong enough to be a real answer.
    const top = group.candidates[0]
    return top && top.score >= 95 ? top : null
  }

  const summary = snapshot?.summary
  const totalToLink = (summary?.linkedOrders ?? 0) + (summary?.unlinkedOrders ?? 0) + (summary?.skippedOrders ?? 0)
  const settled = (summary?.linkedOrders ?? 0) + (summary?.skippedOrders ?? 0)
  const progressPercent = totalToLink > 0 ? Math.round((settled / totalToLink) * 100) : 0

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between">
          <Box>
            <Typography variant="h6" fontWeight={800}>Dealer Linking</Typography>
            <Typography variant="body2" color="text.secondary">
              Orders that came in through Monday never got a dealer account attached. Confirm the dealer once
              and every order in the group is linked.
            </Typography>
          </Box>
          <Stack alignItems={{ xs: 'flex-start', md: 'flex-end' }} sx={{ minWidth: 220 }}>
            <Typography variant="h5" fontWeight={800}>{settled.toLocaleString()} / {totalToLink.toLocaleString()}</Typography>
            <Typography variant="caption" color="text.secondary">
              orders resolved · {(summary?.groupCount ?? 0).toLocaleString()} groups left
            </Typography>
          </Stack>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={progressPercent}
          sx={{ mt: 2, height: 8, borderRadius: 4 }}
        />
      </Paper>

      {feedback ? (
        <Alert severity={feedback.tone} onClose={() => setFeedback(null)}>{feedback.message}</Alert>
      ) : null}

      {snapshotQuery.error ? (
        <Alert severity="error">
          {snapshotQuery.error instanceof Error ? snapshotQuery.error.message : 'Could not load the linking list.'}
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={filterMode}
            onChange={(_event, next) => { if (next) setFilterMode(next as FilterMode) }}
          >
            {FILTER_LABELS.map((item) => (
              <ToggleButton key={item.value} value={item.value} sx={{ textTransform: 'none', px: 1.5 }}>
                {item.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <TextField
            size="small"
            placeholder="Search a dealer name or order number"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            sx={{ flex: 1, minWidth: 240 }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {visibleGroups.length.toLocaleString()} shown
          </Typography>
        </Stack>
      </Paper>

      {snapshotQuery.isLoading ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary">Loading orders...</Typography>
        </Paper>
      ) : null}

      {!snapshotQuery.isLoading && visibleGroups.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <CheckCircleRoundedIcon color="success" sx={{ fontSize: 40 }} />
          <Typography variant="h6" fontWeight={700} sx={{ mt: 1 }}>Nothing left here</Typography>
          <Typography variant="body2" color="text.secondary">
            Every order in this filter has a dealer.
          </Typography>
        </Paper>
      ) : null}

      <Stack spacing={1.25}>
        {visibleGroups.map((group) => {
          const chosen = chosenAccountFor(group)
          const narrowedState = stateNarrowing[group.key] ?? null
          const selectedOrders = selectedOrdersFor(group)
          const isExpanded = expandedKey === group.key
          const isBusy = busyGroupKey === group.key

          return (
            <Paper key={group.key} variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ lg: 'flex-start' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="subtitle1" fontWeight={800} sx={{ wordBreak: 'break-word' }}>
                      {group.label}
                    </Typography>
                    <Chip size="small" label={`${group.orderCount} order${group.orderCount === 1 ? '' : 's'}`} />
                    <Chip
                      size="small"
                      variant="outlined"
                      color={confidenceTone(group.confidence)}
                      label={confidenceLabel(group.confidence)}
                    />
                    {group.quickBooksCodes.map((code) => (
                      <Chip key={code} size="small" variant="outlined" label={code} sx={{ fontFamily: 'monospace' }} />
                    ))}
                  </Stack>

                  {group.states.length > 0 ? (
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      <Typography variant="caption" color="text.secondary">Ships to</Typography>
                      {group.states.map((state) => {
                        const count = group.orders.filter((order) => order.shipToState === state).length
                        return (
                          <Tooltip key={state} title={`Link only the ${count} order${count === 1 ? '' : 's'} shipping to ${state}`}>
                            <Chip
                              size="small"
                              label={`${state} ${count}`}
                              color={narrowedState === state ? 'primary' : 'default'}
                              variant={narrowedState === state ? 'filled' : 'outlined'}
                              onClick={() => setStateNarrowing((prev) => ({
                                ...prev,
                                [group.key]: prev[group.key] === state ? null : state,
                              }))}
                              sx={{ height: 22, fontSize: '0.7rem' }}
                            />
                          </Tooltip>
                        )
                      })}
                    </Stack>
                  ) : null}

                  <Button
                    size="small"
                    onClick={() => setExpandedKey(isExpanded ? null : group.key)}
                    endIcon={<ExpandMoreRoundedIcon sx={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />}
                    sx={{ mt: 0.75, textTransform: 'none' }}
                  >
                    {isExpanded ? 'Hide orders' : 'Show orders'}
                  </Button>
                </Box>

                <Stack spacing={1} sx={{ width: { xs: '100%', lg: 420 } }}>
                  <Autocomplete
                    size="small"
                    options={accounts}
                    value={chosen}
                    onChange={(_event, next) => setChosenAccounts((prev) => ({ ...prev, [group.key]: next }))}
                    getOptionLabel={describeAccount}
                    isOptionEqualToValue={(option, value) => option.sourceId === value.sourceId}
                    renderInput={(params) => <TextField {...params} label="CRM dealer" placeholder="Search all dealers" />}
                  />

                  {group.candidates.length > 0 ? (
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      {group.candidates.slice(0, 4).map((candidate) => (
                        <Chip
                          key={candidate.sourceId}
                          size="small"
                          variant={chosen?.sourceId === candidate.sourceId ? 'filled' : 'outlined'}
                          color={chosen?.sourceId === candidate.sourceId ? 'primary' : confidenceTone(candidate.score)}
                          label={`${describeAccount(candidate)} · ${candidate.score}`}
                          onClick={() => setChosenAccounts((prev) => ({ ...prev, [group.key]: candidate }))}
                          sx={{ height: 24, fontSize: '0.7rem', maxWidth: '100%' }}
                        />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      No CRM dealer resembles this name. Search above, or set it aside if it is not a dealer.
                    </Typography>
                  )}

                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<LinkRoundedIcon />}
                      disabled={!chosen || isBusy || selectedOrders.length === 0}
                      onClick={() => {
                        setBusyGroupKey(group.key)
                        applyMutation.mutate({
                          action: 'link',
                          dealerSourceId: chosen?.sourceId ?? '',
                          orderKeys: selectedOrders.map((order) => order.orderKey),
                        })
                      }}
                      sx={{ textTransform: 'none', flex: 1 }}
                    >
                      Link {selectedOrders.length}
                      {narrowedState ? ` of ${group.orderCount}` : ''}
                    </Button>
                    <Tooltip title="Not a dealer — hide these orders from this list">
                      <span>
                        <Button
                          variant="outlined"
                          size="small"
                          color="inherit"
                          startIcon={<BlockRoundedIcon />}
                          disabled={isBusy || selectedOrders.length === 0}
                          onClick={() => {
                            setBusyGroupKey(group.key)
                            applyMutation.mutate({
                              action: 'skip',
                              orderKeys: selectedOrders.map((order) => order.orderKey),
                            })
                          }}
                          sx={{ textTransform: 'none' }}
                        >
                          Not a dealer
                        </Button>
                      </span>
                    </Tooltip>
                  </Stack>
                </Stack>
              </Stack>

              <Collapse in={isExpanded} unmountOnExit>
                <Divider sx={{ my: 1.5 }} />
                <Stack spacing={0.5}>
                  {group.orders.map((order) => (
                    <Stack
                      key={order.orderKey}
                      direction="row"
                      spacing={1.5}
                      alignItems="center"
                      sx={{
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        opacity: narrowedState && order.shipToState !== narrowedState ? 0.35 : 1,
                        bgcolor: 'action.hover',
                      }}
                    >
                      <Typography variant="body2" fontWeight={700} sx={{ minWidth: 90, fontFamily: 'monospace' }}>
                        {order.orderNumber || '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 34 }}>
                        {order.shipToState ?? '—'}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {order.shipTo || order.orderName || '—'}
                      </Typography>
                      {order.isPriorOwner ? (
                        <Chip size="small" label="History" sx={{ height: 18, fontSize: '0.62rem' }} />
                      ) : null}
                    </Stack>
                  ))}
                </Stack>
              </Collapse>
            </Paper>
          )
        })}
      </Stack>
    </Stack>
  )
}

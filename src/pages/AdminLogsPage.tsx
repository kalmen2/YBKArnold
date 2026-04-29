import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import ManageHistoryRoundedIcon from '@mui/icons-material/ManageHistoryRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { Fragment, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  fetchAuthLogs,
  fetchSystemLogs,
  type AdminSystemRunLog,
  type AdminUserSignInLog,
} from '../features/auth/api'
import { QUERY_KEYS } from '../lib/queryKeys'
import { formatDateTimeWithSeconds } from '../lib/formatters'

type SignInDetail = {
  signedInAt: string | null
  clientPlatform: 'web' | 'app' | null
  ipAddress: string | null
  localIpAddress: string | null
  userAgent: string | null
}

type UserLogRow = {
  uid: string
  email: string
  displayName: string | null
  lastLoginAt: string | null
  lastActivityAt: string | null
  signIns: SignInDetail[]
}

type LogsTabValue = 'signins' | 'system'

type SystemRunLogRow = {
  id: string | null
  jobName: string
  trigger: string
  startedAt: string | null
  completedAt: string | null
  status: string
  message: string | null
  errorMessage: string | null
  summary: Record<string, unknown> | null
}

const logsLimit = 300
const signInsLimit = 20
const systemLogsLimit = 200

function summarizeDeviceFromUserAgent(userAgent: string | null | undefined) {
  const normalizedUserAgent = String(userAgent ?? '').trim().toLowerCase()

  if (!normalizedUserAgent) {
    return 'Unknown device'
  }

  let browser = 'Unknown browser'

  if (normalizedUserAgent.includes('edg/')) {
    browser = 'Edge'
  } else if (normalizedUserAgent.includes('chrome/')) {
    browser = 'Chrome'
  } else if (normalizedUserAgent.includes('safari/') && !normalizedUserAgent.includes('chrome/')) {
    browser = 'Safari'
  } else if (normalizedUserAgent.includes('firefox/')) {
    browser = 'Firefox'
  }

  let os = 'Unknown OS'

  if (normalizedUserAgent.includes('windows')) {
    os = 'Windows'
  } else if (normalizedUserAgent.includes('mac os') || normalizedUserAgent.includes('macintosh')) {
    os = 'macOS'
  } else if (normalizedUserAgent.includes('android')) {
    os = 'Android'
  } else if (normalizedUserAgent.includes('iphone') || normalizedUserAgent.includes('ipad') || normalizedUserAgent.includes('ios')) {
    os = 'iOS'
  } else if (normalizedUserAgent.includes('linux')) {
    os = 'Linux'
  }

  return `${browser} on ${os}`
}

function toTimestamp(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? ''))

  return Number.isFinite(timestamp) ? timestamp : null
}

function toRows(logs: AdminUserSignInLog[]) {
  const rows: UserLogRow[] = []

  for (const entry of logs) {
    if (!entry?.user?.uid) {
      continue
    }

    const signIns = (Array.isArray(entry.signIns) ? entry.signIns : [])
      .map((signIn) => ({
        signedInAt: signIn?.signedInAt ?? null,
        clientPlatform: signIn?.clientPlatform ?? null,
        ipAddress: signIn?.ipAddress ?? null,
        localIpAddress: signIn?.localIpAddress ?? null,
        userAgent: signIn?.userAgent ?? null,
      }))
      .filter((signIn) => {
        return Boolean(signIn.signedInAt || signIn.ipAddress || signIn.localIpAddress || signIn.userAgent)
      })
      .sort((left, right) => {
        const leftTimestamp = toTimestamp(left.signedInAt)
        const rightTimestamp = toTimestamp(right.signedInAt)

        if (leftTimestamp !== null && rightTimestamp !== null) {
          return rightTimestamp - leftTimestamp
        }

        if (rightTimestamp !== null) {
          return 1
        }

        if (leftTimestamp !== null) {
          return -1
        }

        return 0
      })

    rows.push({
      uid: entry.user.uid,
      email: entry.user.email,
      displayName: entry.user.displayName,
      lastLoginAt: signIns[0]?.signedInAt ?? entry.lastLoginAt ?? null,
      lastActivityAt: entry.lastActivityAt ?? null,
      signIns,
    })
  }

  rows.sort((left, right) => {
    const leftTs = toTimestamp(left.lastLoginAt)
    const rightTs = toTimestamp(right.lastLoginAt)

    if (leftTs !== null && rightTs !== null) {
      return rightTs - leftTs
    }

    if (rightTs !== null) {
      return 1
    }

    if (leftTs !== null) {
      return -1
    }

    return left.email.localeCompare(right.email)
  })

  return rows
}

function toSystemRunRows(logs: AdminSystemRunLog[]) {
  const rows: SystemRunLogRow[] = (Array.isArray(logs) ? logs : []).map((entry) => ({
    id: entry?.id ?? null,
    jobName: String(entry?.jobName ?? '').trim() || 'unknown',
    trigger: String(entry?.trigger ?? '').trim() || 'scheduled',
    startedAt: entry?.startedAt ?? null,
    completedAt: entry?.completedAt ?? null,
    status: String(entry?.status ?? '').trim() || 'unknown',
    message: entry?.message ?? null,
    errorMessage: entry?.errorMessage ?? null,
    summary: entry?.summary ?? null,
  }))

  rows.sort((left, right) => {
    const leftTs = toTimestamp(left.startedAt) ?? toTimestamp(left.completedAt)
    const rightTs = toTimestamp(right.startedAt) ?? toTimestamp(right.completedAt)

    if (leftTs !== null && rightTs !== null) {
      return rightTs - leftTs
    }

    if (rightTs !== null) {
      return 1
    }

    if (leftTs !== null) {
      return -1
    }

    return 0
  })

  return rows
}

function systemStatusChipColor(status: string): 'default' | 'success' | 'warning' | 'error' {
  const normalizedStatus = String(status ?? '').trim().toLowerCase()

  if (normalizedStatus === 'success') {
    return 'success'
  }

  if (normalizedStatus === 'completed_with_issues') {
    return 'warning'
  }

  if (normalizedStatus === 'failed') {
    return 'error'
  }

  return 'default'
}

function formatSystemStatusLabel(status: string) {
  const normalizedStatus = String(status ?? '').trim().toLowerCase()

  if (normalizedStatus === 'completed_with_issues') {
    return 'Completed with issues'
  }

  if (normalizedStatus === 'failed') {
    return 'Failed'
  }

  if (normalizedStatus === 'success') {
    return 'Success'
  }

  return normalizedStatus || 'Unknown'
}

function summarizeSystemRunDetails(summary: Record<string, unknown> | null) {
  if (!summary || typeof summary !== 'object') {
    return '-'
  }

  const summaryRecord = summary as Record<string, unknown>
  const monday = summaryRecord.monday as Record<string, unknown> | undefined
  const shippedTransitions = summaryRecord.shippedTransitions as Record<string, unknown> | undefined
  const details: string[] = []

  const mondayOrders = Number(monday?.orders)

  if (Number.isFinite(mondayOrders)) {
    details.push(`Orders: ${mondayOrders}`)
  }

  const movedToShipped = Number(shippedTransitions?.movedOrderCount)

  if (Number.isFinite(movedToShipped)) {
    details.push(`Moved to shipped: ${movedToShipped}`)
  }

  return details.length > 0 ? details.join(' | ') : '-'
}

export default function AdminLogsPage() {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<LogsTabValue>('signins')
  const [searchText, setSearchText] = useState('')
  const [expandedUserIds, setExpandedUserIds] = useState<string[]>([])

  const logsQuery = useQuery({
    queryKey: QUERY_KEYS.authSignInLogs(logsLimit, signInsLimit),
    queryFn: () => fetchAuthLogs(logsLimit, signInsLimit),
    staleTime: 2 * 60 * 1000,
  })

  const systemLogsQuery = useQuery({
    queryKey: QUERY_KEYS.authSystemRunLogs(systemLogsLimit),
    queryFn: () => fetchSystemLogs(systemLogsLimit),
    staleTime: 30 * 1000,
  })

  const signInRows = useMemo(() => {
    const allRows = toRows(logsQuery.data?.users ?? [])
    const normalizedSearch = searchText.trim().toLowerCase()

    if (!normalizedSearch) {
      return allRows
    }

    return allRows.filter((row) => {
      const matchesBasicInfo = [
        row.email,
        row.displayName,
        row.lastLoginAt,
        row.lastActivityAt,
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .some((value) => value.includes(normalizedSearch))

      if (matchesBasicInfo) {
        return true
      }

      return row.signIns.some((signIn) => {
        const deviceSummary = summarizeDeviceFromUserAgent(signIn.userAgent)

        return [
          signIn.signedInAt,
          signIn.clientPlatform,
          signIn.ipAddress,
          signIn.localIpAddress,
          deviceSummary,
        ]
          .map((value) => String(value ?? '').toLowerCase())
          .some((value) => value.includes(normalizedSearch))
      })
    })
  }, [logsQuery.data?.users, searchText])

  const systemRows = useMemo(() => {
    const allRows = toSystemRunRows(systemLogsQuery.data?.logs ?? [])
    const normalizedSearch = searchText.trim().toLowerCase()

    if (!normalizedSearch) {
      return allRows
    }

    return allRows.filter((row) => {
      return [
        row.jobName,
        row.trigger,
        row.status,
        row.message,
        row.errorMessage,
        row.startedAt,
        row.completedAt,
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .some((value) => value.includes(normalizedSearch))
    })
  }, [searchText, systemLogsQuery.data?.logs])

  const activeQueryIsLoading = activeTab === 'signins' ? logsQuery.isLoading : systemLogsQuery.isLoading
  const activeQueryIsFetching = activeTab === 'signins' ? logsQuery.isFetching : systemLogsQuery.isFetching
  const activeErrorMessage =
    activeTab === 'signins'
      ? logsQuery.error instanceof Error
        ? logsQuery.error.message
        : null
      : systemLogsQuery.error instanceof Error
        ? systemLogsQuery.error.message
        : null

  function handleRefreshActiveTab() {
    if (activeTab === 'signins') {
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.authSignInLogs(logsLimit, signInsLimit),
      })
      return
    }

    void queryClient.invalidateQueries({
      queryKey: QUERY_KEYS.authSystemRunLogs(systemLogsLimit),
    })
  }

  function toggleRowExpanded(uid: string) {
    setExpandedUserIds((currentExpandedUserIds) => {
      if (currentExpandedUserIds.includes(uid)) {
        return currentExpandedUserIds.filter((currentUid) => currentUid !== uid)
      }

      return [...currentExpandedUserIds, uid]
    })
  }

  if (!appUser?.isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <ManageHistoryRoundedIcon color="primary" />
            <Typography variant="h4" fontWeight={700}>
              Admin Logs
            </Typography>
          </Stack>
          <Typography color="text.secondary">
            {activeTab === 'signins'
              ? 'Sign-in records: login IP, local IP, and device.'
              : 'System run records: scheduled refresh success and issues.'}
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<RefreshRoundedIcon />}
          disabled={activeQueryIsFetching}
          onClick={handleRefreshActiveTab}
        >
          {activeQueryIsFetching ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ px: 1 }}>
        <Tabs
          value={activeTab}
          onChange={(_event, nextValue: LogsTabValue) => {
            setActiveTab(nextValue)
            setSearchText('')
          }}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab value="signins" label="Sign-In Logs" />
          <Tab value="system" label="System Logs" />
        </Tabs>
      </Paper>

      <StatusAlerts errorMessage={activeErrorMessage} />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', md: 'center' }}>
          <TextField
            size="small"
            fullWidth
            label={activeTab === 'signins' ? 'Search by user or sign-in details' : 'Search by system log details'}
            value={searchText}
            onChange={(event) => {
              setSearchText(event.target.value)
            }}
          />
          <Chip
            label={activeTab === 'signins' ? `Users: ${signInRows.length}` : `Runs: ${systemRows.length}`}
            size="small"
            variant="outlined"
            sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}
          />
        </Stack>
      </Paper>

      <LoadingPanel
        loading={activeQueryIsLoading}
        message={activeTab === 'signins' ? 'Loading sign-in logs...' : 'Loading system logs...'}
        padding={4}
      />

      {!activeQueryIsLoading ? (
        activeTab === 'signins' ? (
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 680 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 56 }} />
                  <TableCell>User</TableCell>
                  <TableCell>Last Sign-In</TableCell>
                  <TableCell>Last Activity</TableCell>
                  <TableCell>Sign-Ins</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {signInRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography color="text.secondary">
                        No sign-in records found.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  signInRows.map((row) => {
                    const isExpanded = expandedUserIds.includes(row.uid)

                    return (
                      <Fragment key={row.uid}>
                        <TableRow
                          hover
                          sx={{ cursor: 'pointer' }}
                          onClick={() => {
                            toggleRowExpanded(row.uid)
                          }}
                        >
                          <TableCell>
                            <IconButton
                              size="small"
                              aria-label={isExpanded ? 'Hide details' : 'Show details'}
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleRowExpanded(row.uid)
                              }}
                            >
                              {isExpanded ? <KeyboardArrowUpRoundedIcon /> : <KeyboardArrowDownRoundedIcon />}
                            </IconButton>
                          </TableCell>
                          <TableCell>
                            <Stack spacing={0.35}>
                              <Typography variant="body2" fontWeight={600}>
                                {row.displayName || row.email}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {row.email}
                              </Typography>
                            </Stack>
                          </TableCell>
                          <TableCell>{formatDateTimeWithSeconds(row.lastLoginAt)}</TableCell>
                          <TableCell>{formatDateTimeWithSeconds(row.lastActivityAt)}</TableCell>
                          <TableCell>
                            <Chip
                              label={`${row.signIns.length} recorded`}
                              size="small"
                              variant="outlined"
                              color={row.signIns.length > 0 ? 'primary' : 'default'}
                            />
                          </TableCell>
                        </TableRow>

                        <TableRow key={`${row.uid}-details`}>
                          <TableCell colSpan={5} sx={{ py: 0, borderBottom: 0 }}>
                            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                              <Box sx={{ py: 1.5, px: 1.5 }}>
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                  Sign-in details
                                </Typography>

                                {row.signIns.length === 0 ? (
                                  <Typography variant="body2" color="text.secondary">
                                    No sign-in details for this user yet.
                                  </Typography>
                                ) : (
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>Signed In</TableCell>
                                        <TableCell>Platform</TableCell>
                                        <TableCell>Login IP</TableCell>
                                        <TableCell>Local IP</TableCell>
                                        <TableCell>Device</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {row.signIns.map((signIn, index) => (
                                        <TableRow key={`${row.uid}-${signIn.signedInAt ?? 'unknown'}-${index}`}>
                                          <TableCell>{formatDateTimeWithSeconds(signIn.signedInAt)}</TableCell>
                                          <TableCell>
                                            <Chip
                                              label={
                                                signIn.clientPlatform === 'app'
                                                  ? 'App'
                                                  : signIn.clientPlatform === 'web'
                                                    ? 'Web'
                                                    : 'Unknown'
                                              }
                                              size="small"
                                              color={
                                                signIn.clientPlatform === 'app'
                                                  ? 'secondary'
                                                  : signIn.clientPlatform === 'web'
                                                    ? 'primary'
                                                    : 'default'
                                              }
                                              variant="outlined"
                                            />
                                          </TableCell>
                                          <TableCell>{String(signIn.ipAddress ?? '').trim() || '-'}</TableCell>
                                          <TableCell>{String(signIn.localIpAddress ?? '').trim() || '-'}</TableCell>
                                          <TableCell>{summarizeDeviceFromUserAgent(signIn.userAgent)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                )}
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 680 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Started</TableCell>
                  <TableCell>Completed</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Job</TableCell>
                  <TableCell>Result</TableCell>
                  <TableCell>Error</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {systemRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography color="text.secondary">
                        No system logs found yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  systemRows.map((row, index) => (
                    <TableRow hover key={`${row.id ?? 'system-log'}-${row.startedAt ?? 'unknown'}-${index}`}>
                      <TableCell>{formatDateTimeWithSeconds(row.startedAt)}</TableCell>
                      <TableCell>{formatDateTimeWithSeconds(row.completedAt)}</TableCell>
                      <TableCell>
                        <Chip
                          label={formatSystemStatusLabel(row.status)}
                          size="small"
                          color={systemStatusChipColor(row.status)}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.35}>
                          <Typography variant="body2" fontWeight={600}>
                            {row.jobName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Trigger: {row.trigger}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.35}>
                          <Typography variant="body2">
                            {String(row.message ?? '').trim() || '-'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {summarizeSystemRunDetails(row.summary)}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color={row.errorMessage ? 'error.main' : 'text.secondary'}>
                          {String(row.errorMessage ?? '').trim() || '-'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )
      ) : null}
    </Stack>
  )
}

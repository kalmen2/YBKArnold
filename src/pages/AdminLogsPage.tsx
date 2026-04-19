import ManageHistoryRoundedIcon from '@mui/icons-material/ManageHistoryRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Box,
  Button,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { apiRequest } from '../features/api-client'
import type { AppAuthUser } from '../auth/types'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import { useDataLoader } from '../hooks/useDataLoader'
import {
  approvalColor,
  approvalLabel,
  formatDateTimeWithSeconds,
  formatLoginHours,
  roleColor,
  roleLabel,
} from '../lib/formatters'

type ActivityEventType = 'api_request' | 'ui_event'

type ActivityEvent = {
  id: string
  uid: string
  email: string | null
  type: ActivityEventType
  action: string
  target: string | null
  path: string | null
  method: string | null
  statusCode: number | null
  ipAddress: string | null
  userAgent: string | null
  metadata: unknown
  requestStartedAt: string | null
  createdAt: string
}

type UserLogSummary = {
  user: AppAuthUser
  totalEvents: number
  lastActivityAt: string | null
  lastIpAddress: string | null
  lastUserAgent: string | null
  lastAction: string | null
}

type ListLogUsersResponse = {
  users: UserLogSummary[]
}

type UserInfoResponse = {
  user: AppAuthUser
  summary: {
    totalEvents: number
    lastActivityAt: string | null
    lastIpAddress: string | null
    lastUserAgent: string | null
  }
  latestEvent: ActivityEvent | null
  latestLoginEvent: ActivityEvent | null
}

type UserEventsResponse = {
  events: ActivityEvent[]
}

const routeLabels: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/timesheet': 'Work Sheet',
  '/support': 'Support',
  '/pictures': 'Pictures',
  '/admin/users': 'Admin Users',
  '/admin/alerts': 'Admin Notifications',
  '/admin/logs': 'Admin Logs',
}

function summarizeDevice(userAgent: string | null | undefined) {
  const ua = String(userAgent ?? '').trim()

  if (!ua) {
    return 'Unknown device'
  }

  const normalized = ua.toLowerCase()

  let os = 'Unknown OS'

  if (normalized.includes('windows')) {
    os = 'Windows'
  } else if (normalized.includes('mac os') || normalized.includes('macintosh')) {
    os = 'macOS'
  } else if (normalized.includes('android')) {
    os = 'Android'
  } else if (normalized.includes('iphone') || normalized.includes('ipad') || normalized.includes('ios')) {
    os = 'iOS'
  } else if (normalized.includes('linux')) {
    os = 'Linux'
  }

  let browser = 'Unknown browser'

  if (normalized.includes('edg/')) {
    browser = 'Edge'
  } else if (normalized.includes('chrome/')) {
    browser = 'Chrome'
  } else if (normalized.includes('safari/') && !normalized.includes('chrome/')) {
    browser = 'Safari'
  } else if (normalized.includes('firefox/')) {
    browser = 'Firefox'
  }

  return `${browser} on ${os}`
}

function normalizePath(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return null
  }

  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    try {
      return new URL(normalized).pathname
    } catch {
      return normalized
    }
  }

  return normalized
}

function routeLabel(path: string | null | undefined) {
  const normalizedPath = normalizePath(path)

  if (!normalizedPath) {
    return 'App'
  }

  const exactLabel = routeLabels[normalizedPath]

  if (exactLabel) {
    return exactLabel
  }

  const routePrefixMatch = Object.entries(routeLabels).find(([prefix]) =>
    normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  )

  if (routePrefixMatch) {
    return routePrefixMatch[1]
  }

  return normalizedPath
}

function toSentence(value: string) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return 'No details.'
  }

  if (/[.!?]$/.test(normalized)) {
    return normalized
  }

  return `${normalized}.`
}

function describeActivityEvent(event: ActivityEvent) {
  if (event.type === 'ui_event') {
    if (event.action === 'route_view') {
      return toSentence(`Opened ${routeLabel(event.target ?? event.path)} page`)
    }

    if (event.action === 'open_order_photos') {
      return toSentence(`Opened pictures for ${event.target || 'an order'}`)
    }

    if (event.action === 'close_order_photos') {
      return toSentence(`Closed pictures for ${event.target || 'an order'}`)
    }

    if (event.action === 'download_order_photo') {
      return toSentence(`Downloaded one picture from ${event.target || 'an order'}`)
    }

    if (event.action === 'download_all_order_photos') {
      return toSentence(`Downloaded all pictures from ${event.target || 'an order'}`)
    }

    if (event.action === 'delete_order_photo') {
      return toSentence(`Deleted a picture from ${event.target || 'an order'}`)
    }

    if (event.action === 'click') {
      const target = String(event.target ?? '').trim()

      if (target.startsWith('/')) {
        return toSentence(`Clicked ${routeLabel(target)} in navigation`)
      }

      if (target) {
        return toSentence(`Clicked "${target}" on ${routeLabel(event.path)} page`)
      }

      return toSentence(`Clicked on ${routeLabel(event.path)} page`)
    }

    return toSentence(`Did ${event.action.replace(/_/g, ' ')} on ${routeLabel(event.path)} page`)
  }

  const actionParts = String(event.action ?? '').trim().split(/\s+/)
  const method = String(event.method ?? actionParts[0] ?? 'GET').toUpperCase()
  const apiPath = normalizePath(event.path) ?? normalizePath(actionParts[1])

  if (apiPath === '/api/auth/me') {
    return 'Checked user access and approval.'
  }

  if (apiPath === '/api/auth/users') {
    return 'Loaded Admin Users list.'
  }

  if (apiPath?.startsWith('/api/auth/logs/users')) {
    return 'Viewed Admin Logs data.'
  }

  if (apiPath === '/api/orders/photos-index') {
    return 'Loaded pictures list.'
  }

  if (method === 'DELETE' && apiPath?.startsWith('/api/orders/') && apiPath.endsWith('/photos')) {
    const orderId = apiPath.split('/')[3]

    return toSentence(`Deleted a picture from order #${orderId || 'unknown'}`)
  }

  if (apiPath) {
    return toSentence(`${method} request to ${apiPath}`)
  }

  return toSentence(`${method} request`)
}

export default function AdminLogsPage() {
  const { appUser } = useAuth()
  const [userSummaries, setUserSummaries] = useState<UserLogSummary[]>([])
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [tabValue, setTabValue] = useState<'info' | 'logs'>('info')
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | ActivityEventType>('all')
  const [isLoadingPanel, setIsLoadingPanel] = useState(false)
  const [selectedUserInfo, setSelectedUserInfo] = useState<UserInfoResponse | null>(null)
  const [selectedUserEvents, setSelectedUserEvents] = useState<ActivityEvent[]>([])


  const {
    isLoading: isLoadingUsers,
    isRefreshing,
    errorMessage,
    load: loadUsers,
    setErrorMessage,
  } = useDataLoader({
    fetcher: useCallback(async () => {
      const payload = await apiRequest<ListLogUsersResponse>('/api/auth/logs/users?limit=300')
      return Array.isArray(payload.users) ? payload.users : []
    }, []),
    onSuccess: useCallback((nextUsers: UserLogSummary[]) => {
      setUserSummaries(nextUsers)
      setSelectedUid((currentSelectedUid) => {
        if (currentSelectedUid && nextUsers.some((row) => row.user.uid === currentSelectedUid)) {
          return currentSelectedUid
        }
        return nextUsers[0]?.user.uid ?? null
      })
    }, []),
    onError: useCallback(() => {
      setUserSummaries([])
      setSelectedUid(null)
    }, []),
    fallbackErrorMessage: 'Failed to load logs users.',
  })

  const loadUserPanel = useCallback(
    async (targetUid: string) => {
      setErrorMessage(null)
      setIsLoadingPanel(true)

      try {
        const typeQuery = eventTypeFilter === 'all' ? '' : `&type=${eventTypeFilter}`
        const [userInfoPayload, userEventsPayload] = await Promise.all([
          apiRequest<UserInfoResponse>(`/api/auth/logs/users/${targetUid}/info`),
          apiRequest<UserEventsResponse>(`/api/auth/logs/users/${targetUid}/events?limit=300${typeQuery}`),
        ])

        setSelectedUserInfo(userInfoPayload)
        setSelectedUserEvents(Array.isArray(userEventsPayload.events) ? userEventsPayload.events : [])
      } catch (error) {
        setSelectedUserInfo(null)
        setSelectedUserEvents([])
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load selected user logs.')
      } finally {
        setIsLoadingPanel(false)
      }
    },
    [eventTypeFilter],
  )

  useEffect(() => {
    if (!selectedUid) {
      setSelectedUserInfo(null)
      setSelectedUserEvents([])
      return
    }

    void loadUserPanel(selectedUid)
  }, [selectedUid, loadUserPanel])

  const selectedSummary = useMemo(
    () => userSummaries.find((entry) => entry.user.uid === selectedUid) ?? null,
    [selectedUid, userSummaries],
  )
  const lastLoginTime = selectedUserInfo?.latestLoginEvent?.createdAt
    ?? selectedUserInfo?.user?.lastLoginAt
    ?? selectedUserInfo?.summary.lastActivityAt
    ?? null
  const lastLoginIp = selectedUserInfo?.latestLoginEvent?.ipAddress
    ?? selectedUserInfo?.summary.lastIpAddress
    ?? selectedSummary?.lastIpAddress
    ?? null
  const lastLoginUserAgent = selectedUserInfo?.latestLoginEvent?.userAgent
    ?? selectedUserInfo?.summary.lastUserAgent
    ?? selectedSummary?.lastUserAgent
    ?? null

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
            Audit user activity, login device details, and action history.
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<RefreshRoundedIcon />}
          disabled={isRefreshing}
          onClick={() => {
            void loadUsers(true)
          }}
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </Stack>

      <StatusAlerts errorMessage={errorMessage} />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '320px minmax(0, 1fr)' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        <Paper variant="outlined" sx={{ maxHeight: 620, overflow: 'auto' }}>
          {isLoadingUsers ? (
            <LoadingPanel loading={isLoadingUsers} message="Loading users..." contained={false} size={18} />
          ) : userSummaries.length === 0 ? (
            <Typography sx={{ p: 2 }} color="text.secondary">
              No users available for logs.
            </Typography>
          ) : (
            <List dense disablePadding>
              {userSummaries.map((entry) => (
                <ListItemButton
                  key={entry.user.uid}
                  selected={entry.user.uid === selectedUid}
                  onClick={() => {
                    setSelectedUid(entry.user.uid)
                  }}
                  sx={{
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    alignItems: 'flex-start',
                  }}
                >
                  <ListItemText
                    primary={entry.user.displayName || entry.user.email}
                    secondary={(
                      <Stack spacing={0.35} sx={{ mt: 0.35 }}>
                        <Typography variant="caption" color="text.secondary">
                          {entry.user.email}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Last activity: {formatDateTimeWithSeconds(entry.lastActivityAt || entry.user.lastLoginAt)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Events: {entry.totalEvents}
                        </Typography>
                      </Stack>
                    )}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ minHeight: 420 }}>
          {!selectedUid ? (
            <Typography sx={{ p: 2 }} color="text.secondary">
              Select a user to view info and logs.
            </Typography>
          ) : (
            <Stack spacing={2} sx={{ p: 2 }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1.5}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', md: 'center' }}
              >
                <Box>
                  <Typography variant="h6" fontWeight={700}>
                    {selectedSummary?.user.displayName || selectedSummary?.user.email || 'User'}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    {selectedSummary?.user.email}
                  </Typography>
                </Box>

                <Stack direction="row" spacing={1}>
                  <Chip
                    size="small"
                    label={roleLabel(selectedSummary?.user.role ?? 'standard')}
                    color={roleColor(selectedSummary?.user.role ?? 'standard')
                    }
                  />
                  <Chip
                    size="small"
                    label={selectedSummary?.user ? approvalLabel(selectedSummary.user) : 'Pending'}
                    color={selectedSummary?.user ? approvalColor(selectedSummary.user) : 'warning'}
                    variant="outlined"
                  />
                </Stack>
              </Stack>

              <Tabs
                value={tabValue}
                onChange={(_event, value: 'info' | 'logs') => setTabValue(value)}
                variant="fullWidth"
              >
                <Tab value="info" label="Info" />
                <Tab value="logs" label="Logs" />
              </Tabs>

              {tabValue === 'logs' ? (
                <TextField
                  select
                  size="small"
                  label="Log Type"
                  value={eventTypeFilter}
                  onChange={(event) => {
                    const nextType = event.target.value as 'all' | ActivityEventType
                    setEventTypeFilter(nextType)
                  }}
                  sx={{ maxWidth: 220 }}
                >
                  <MenuItem value="all">All events</MenuItem>
                  <MenuItem value="api_request">API requests</MenuItem>
                  <MenuItem value="ui_event">UI activity</MenuItem>
                </TextField>
              ) : null}

              <LoadingPanel loading={isLoadingPanel} message="Loading panel..." contained={false} size={18} />

              {!isLoadingPanel && tabValue === 'info' ? (
                <Stack spacing={1.5}>
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Stack spacing={0.75}>
                      <Typography variant="subtitle2">Login Access Hours</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatLoginHours(selectedUserInfo?.user)}
                      </Typography>
                    </Stack>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Stack spacing={0.75}>
                      <Typography variant="subtitle2">Last Login</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Time: {formatDateTimeWithSeconds(lastLoginTime)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        IP: {lastLoginIp || 'Unknown'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Device: {summarizeDevice(lastLoginUserAgent)}
                      </Typography>
                    </Stack>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Stack spacing={0.75}>
                      <Typography variant="subtitle2">Latest Activity Summary</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Total events: {selectedUserInfo?.summary.totalEvents ?? 0}
                      </Typography>
                      {(selectedUserInfo?.summary.totalEvents ?? 0) === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No events recorded yet. New activity is logged automatically from this update onward.
                        </Typography>
                      ) : null}
                      <Typography variant="body2" color="text.secondary">
                        Last activity: {formatDateTimeWithSeconds(selectedUserInfo?.summary.lastActivityAt)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Last IP: {selectedUserInfo?.summary.lastIpAddress || 'Unknown'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                        Last user-agent: {selectedUserInfo?.summary.lastUserAgent || 'Unknown'}
                      </Typography>
                    </Stack>
                  </Paper>
                </Stack>
              ) : null}

              {!isLoadingPanel && tabValue === 'logs' ? (
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 460 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>When</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>What Happened</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>IP</TableCell>
                        <TableCell>Device</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedUserEvents.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <Typography color="text.secondary">No events for selected filter.</Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        selectedUserEvents.map((event) => (
                          <TableRow key={event.id} hover>
                            <TableCell>{formatDateTimeWithSeconds(event.createdAt)}</TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={event.type === 'ui_event' ? 'UI' : 'API'}
                                variant="outlined"
                                color={event.type === 'ui_event' ? 'default' : 'primary'}
                              />
                            </TableCell>
                            <TableCell sx={{ minWidth: 260 }}>{describeActivityEvent(event)}</TableCell>
                            <TableCell>{event.statusCode ?? '-'}</TableCell>
                            <TableCell>{event.ipAddress || '-'}</TableCell>
                            <TableCell>{summarizeDevice(event.userAgent)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : null}
            </Stack>
          )}
        </Paper>
      </Box>
    </Stack>
  )
}

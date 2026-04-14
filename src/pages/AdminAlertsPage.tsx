import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { AppAuthUser } from '../auth/types'

type ListUsersResponse = {
  users: AppAuthUser[]
}

type AdminAlertRecord = {
  id: string
  title: string
  message: string
  isUpdate?: boolean
  targetMode: 'all' | 'selected'
  targetUserCount: number
  pushTokenCount: number
  pushAcceptedCount: number
  pushErrorCount: number
  createdAt: string | null
  createdByEmail: string | null
}

type ListAdminAlertsResponse = {
  alerts: AdminAlertRecord[]
}

type SendAdminAlertResponse = {
  ok: boolean
  alert: AdminAlertRecord
  summary: {
    targetUsers: number
    pushTokens: number
    accepted: number
    failed: number
  }
}

type DeleteAdminAlertResponse = {
  ok: boolean
  alertId: string
  deletedReadCount: number
}

function formatDateTime(value: string | null) {
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

function formatRecipientLabel(user: AppAuthUser) {
  const name = String(user.displayName ?? '').trim() || user.email
  return `${name} (${user.email})`
}

export default function AdminAlertsPage() {
  const { appUser, getIdToken } = useAuth()
  const [users, setUsers] = useState<AppAuthUser[]>([])
  const [recentAlerts, setRecentAlerts] = useState<AdminAlertRecord[]>([])
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [isUpdateAlert, setIsUpdateAlert] = useState(false)
  const [sendToAllUsers, setSendToAllUsers] = useState(true)
  const [selectedRecipientUids, setSelectedRecipientUids] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [deletingAlertIds, setDeletingAlertIds] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const requestWithAuth = useCallback(
    async <T,>(path: string, options: RequestInit = {}) => {
      const idToken = await getIdToken()
      const response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          'x-client-platform': 'web',
          ...(options.headers ?? {}),
        },
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Request failed.')
      }

      return payload as T
    },
    [getIdToken],
  )

  const eligibleUsers = useMemo(() => {
    return users.filter((user) => user.isApproved && user.hasAppAccess)
  }, [users])

  const selectedEligibleCount = useMemo(() => {
    const selectedSet = new Set(selectedRecipientUids)

    return eligibleUsers.filter((user) => selectedSet.has(user.uid)).length
  }, [eligibleUsers, selectedRecipientUids])

  const loadPageData = useCallback(async (refreshRequested = false) => {
    setErrorMessage(null)

    if (refreshRequested) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    try {
      const [usersPayload, alertsPayload] = await Promise.all([
        requestWithAuth<ListUsersResponse>('/api/auth/users'),
        requestWithAuth<ListAdminAlertsResponse>('/api/admin/alerts?limit=80'),
      ])

      const nextUsers = Array.isArray(usersPayload.users) ? usersPayload.users : []
      const nextAlerts = Array.isArray(alertsPayload.alerts) ? alertsPayload.alerts : []

      setUsers(nextUsers)
      setRecentAlerts(nextAlerts)
      setSelectedRecipientUids((current) => {
        const allowedIds = new Set(nextUsers.map((user) => user.uid))
        return current.filter((uid) => allowedIds.has(uid))
      })
    } catch (error) {
      setUsers([])
      setRecentAlerts([])
      setErrorMessage(error instanceof Error ? error.message : 'Could not load notifications page.')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [requestWithAuth])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadPageData(false)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadPageData])

  const toggleRecipient = useCallback((uid: string) => {
    setSelectedRecipientUids((current) => {
      return current.includes(uid)
        ? current.filter((entry) => entry !== uid)
        : [...current, uid]
    })
  }, [])

  const handleSendAlert = useCallback(async () => {
    const normalizedTitle = title.trim()
    const normalizedMessage = message.trim()
    const messageToSend =
      normalizedMessage
      || (isUpdateAlert ? 'A new app update is available. Open Settings -> App Updates.' : '')

    if (!normalizedTitle) {
      setErrorMessage('Title is required.')
      return
    }

    if (!normalizedMessage && !isUpdateAlert) {
      setErrorMessage('Message is required.')
      return
    }

    if (!sendToAllUsers && selectedRecipientUids.length === 0) {
      setErrorMessage('Select at least one user or choose send to all users.')
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setIsSending(true)

    try {
      const payload = await requestWithAuth<SendAdminAlertResponse>('/api/admin/alerts/send', {
        method: 'POST',
        body: JSON.stringify({
          title: normalizedTitle,
          message: messageToSend,
          isUpdate: isUpdateAlert,
          targetMode: sendToAllUsers ? 'all' : 'selected',
          userUids: sendToAllUsers ? [] : selectedRecipientUids,
        }),
      })

      setRecentAlerts((current) => [payload.alert, ...current].slice(0, 100))
      setTitle('')
      setMessage('')
      setIsUpdateAlert(false)
      setActionMessage(
        isUpdateAlert
          ? `Update notification sent. Target users: ${payload.summary.targetUsers}. Accepted pushes: ${payload.summary.accepted}.`
          : `Notification sent. Target users: ${payload.summary.targetUsers}. Accepted pushes: ${payload.summary.accepted}.`,
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not send notification.')
    } finally {
      setIsSending(false)
    }
  }, [isUpdateAlert, message, requestWithAuth, selectedRecipientUids, sendToAllUsers, title])

  const handleDeleteAlert = useCallback(async (alertItem: AdminAlertRecord) => {
    const normalizedAlertId = String(alertItem.id ?? '').trim()

    if (!normalizedAlertId) {
      return
    }

    const confirmed = window.confirm(
      `Delete notification "${alertItem.title}"? This removes it from users' notification feeds.`,
    )

    if (!confirmed) {
      return
    }

    setErrorMessage(null)
    setActionMessage(null)
    setDeletingAlertIds((current) => (current.includes(normalizedAlertId) ? current : [...current, normalizedAlertId]))

    try {
      await requestWithAuth<DeleteAdminAlertResponse>(`/api/admin/alerts/${encodeURIComponent(normalizedAlertId)}`, {
        method: 'DELETE',
      })

      setRecentAlerts((current) => current.filter((entry) => entry.id !== normalizedAlertId))
      setActionMessage('Notification deleted successfully.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not delete notification.')
    } finally {
      setDeletingAlertIds((current) => current.filter((id) => id !== normalizedAlertId))
    }
  }, [requestWithAuth])

  if (!appUser?.isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.25}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
          >
            <Stack direction="row" spacing={1.2} alignItems="center">
              <NotificationsActiveRoundedIcon color="primary" />
              <Box>
                <Typography variant="h5" fontWeight={700}>
                  Admin Notifications
                </Typography>
                <Typography color="text.secondary">
                  Send push notifications to all app users or selected users.
                </Typography>
              </Box>
            </Stack>

            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={isRefreshing || isLoading}
              onClick={() => {
                void loadPageData(true)
              }}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>

          {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
          {actionMessage ? <Alert severity="success">{actionMessage}</Alert> : null}

          {isLoading ? (
            <Stack direction="row" spacing={1.2} alignItems="center">
              <CircularProgress size={18} />
              <Typography color="text.secondary">Loading notifications tools...</Typography>
            </Stack>
          ) : (
            <>
              <TextField
                label="Notification Title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                fullWidth
                inputProps={{ maxLength: 120 }}
              />

              <TextField
                label="Notification Message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                fullWidth
                multiline
                minRows={3}
                inputProps={{ maxLength: 600 }}
              />

              <FormControlLabel
                control={(
                  <Checkbox
                    checked={isUpdateAlert}
                    onChange={(event) => setIsUpdateAlert(event.target.checked)}
                  />
                )}
                label="This is an app update notification (opens Settings -> App Updates on tap)"
              />

              <FormControlLabel
                control={(
                  <Checkbox
                    checked={sendToAllUsers}
                    onChange={(event) => setSendToAllUsers(event.target.checked)}
                  />
                )}
                label="Send to all approved app users"
              />

              {!sendToAllUsers ? (
                <Paper variant="outlined" sx={{ borderRadius: 2, maxHeight: 280, overflow: 'auto' }}>
                  <List dense disablePadding>
                    {eligibleUsers.map((user) => {
                      const isChecked = selectedRecipientUids.includes(user.uid)

                      return (
                        <ListItemButton
                          key={user.uid}
                          onClick={() => {
                            toggleRecipient(user.uid)
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            <Checkbox edge="start" checked={isChecked} tabIndex={-1} disableRipple />
                          </ListItemIcon>
                          <ListItemText
                            primary={formatRecipientLabel(user)}
                            secondary={
                              user.lastLoginAt
                                ? `Last login: ${formatDateTime(user.lastLoginAt)}`
                                : 'No login recorded yet'
                            }
                          />
                        </ListItemButton>
                      )
                    })}
                  </List>
                </Paper>
              ) : null}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={sendToAllUsers ? `${eligibleUsers.length} recipients` : `${selectedEligibleCount} selected`}
                />
                <Button
                  variant="contained"
                  startIcon={<SendRoundedIcon />}
                  onClick={() => {
                    void handleSendAlert()
                  }}
                  disabled={isSending || isLoading}
                >
                  {isSending ? 'Sending...' : 'Send Notification'}
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack spacing={1.5}>
          <Typography variant="h6" fontWeight={700}>
            Recent Notifications
          </Typography>

          {recentAlerts.length === 0 ? (
            <Typography color="text.secondary">No notifications sent yet.</Typography>
          ) : (
            <Stack spacing={1.2}>
              {recentAlerts.map((alertItem, index) => (
                <Box key={alertItem.id}>
                  {index > 0 ? <Divider sx={{ mb: 1.2 }} /> : null}
                  <Stack spacing={0.8}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      justifyContent="space-between"
                      alignItems={{ xs: 'flex-start', sm: 'center' }}
                    >
                      <Typography fontWeight={700}>{alertItem.title}</Typography>
                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                        {alertItem.isUpdate ? (
                          <Chip size="small" color="secondary" label="Update" />
                        ) : null}
                        <Chip
                          size="small"
                          variant="outlined"
                          color={alertItem.targetMode === 'all' ? 'primary' : 'default'}
                          label={alertItem.targetMode === 'all' ? 'All users' : 'Selected users'}
                        />
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          startIcon={<DeleteOutlineRoundedIcon />}
                          disabled={deletingAlertIds.includes(alertItem.id)}
                          onClick={() => {
                            void handleDeleteAlert(alertItem)
                          }}
                        >
                          {deletingAlertIds.includes(alertItem.id) ? 'Deleting...' : 'Delete'}
                        </Button>
                      </Stack>
                    </Stack>
                    <Typography color="text.secondary">{alertItem.message}</Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={`Users: ${alertItem.targetUserCount}`} />
                      <Chip size="small" label={`Tokens: ${alertItem.pushTokenCount}`} />
                      <Chip size="small" color="success" label={`Accepted: ${alertItem.pushAcceptedCount}`} />
                      <Chip size="small" color={alertItem.pushErrorCount > 0 ? 'warning' : 'default'} label={`Failed: ${alertItem.pushErrorCount}`} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {formatDateTime(alertItem.createdAt)}
                      {alertItem.createdByEmail ? ` • ${alertItem.createdByEmail}` : ''}
                    </Typography>
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>
    </Stack>
  )
}

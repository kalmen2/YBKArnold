import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import ReportProblemRoundedIcon from '@mui/icons-material/ReportProblemRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Box,
  Button,
  Checkbox,
  Chip,
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { apiRequest } from '../features/api-client'
import { fetchAdminBootstrap } from '../features/auth/api'
import { fetchMyAlerts, markMyAlertRead, markMyAlertUnread, type AppAlert } from '../features/alerts/api'
import type { AppAuthUser } from '../auth/types'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  fetchTimesheetBootstrap,
  type TimesheetWebsiteIssueDuplicateMondayLink,
  type TimesheetWebsiteIssueHazard,
  type TimesheetWebsiteIssueMissingShopDrawing,
  type TimesheetWebsiteIssueUnmappedJob,
} from '../features/timesheet/api'
import { formatDateTime } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

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

type UnifiedIssueRow = {
  id: string
  source: string
  issueType: string
  reference: string
  details: string
}

function formatRecipientLabel(user: AppAuthUser) {
  const name = String(user.displayName ?? '').trim() || user.email
  return `${name} (${user.email})`
}

export default function AdminAlertsPage() {
  const { appUser } = useAuth()
  const [users, setUsers] = useState<AppAuthUser[]>([])
  const [recentAlerts, setRecentAlerts] = useState<AdminAlertRecord[]>([])
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [isUpdateAlert, setIsUpdateAlert] = useState(false)
  const [sendToAllUsers, setSendToAllUsers] = useState(true)
  const [selectedRecipientUids, setSelectedRecipientUids] = useState<string[]>([])
  const [isSending, setIsSending] = useState(false)
  const [deletingAlertIds, setDeletingAlertIds] = useState<string[]>([])
  const [markingAlertIds, setMarkingAlertIds] = useState<string[]>([])
  const [actionMessage, setActionMessage] = useState<string | null>(null)


  const queryClient = useQueryClient()
  const myAlertsLimit = 80

  const myAlertsQuery = useQuery({
    queryKey: QUERY_KEYS.alertsMy(myAlertsLimit),
    queryFn: () => fetchMyAlerts(myAlertsLimit),
    enabled: Boolean(appUser?.isApproved),
    staleTime: 60 * 1000,
  })

  const bootstrapQuery = useQuery({
    queryKey: QUERY_KEYS.adminBootstrap,
    queryFn: () => fetchAdminBootstrap(80),
    enabled: Boolean(appUser?.isAdmin),
    staleTime: 2 * 60 * 1000,
  })

  const issuesQuery = useQuery({
    queryKey: QUERY_KEYS.adminIssues,
    queryFn: () => fetchTimesheetBootstrap(),
    enabled: Boolean(appUser?.isAdmin),
    staleTime: 2 * 60 * 1000,
  })

  const isAdmin = appUser?.isAdmin === true
  const isLoading = isAdmin ? bootstrapQuery.isLoading : myAlertsQuery.isLoading
  const isRefreshing = isAdmin
    ? (bootstrapQuery.isFetching && !bootstrapQuery.isLoading)
    : (myAlertsQuery.isFetching && !myAlertsQuery.isLoading)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) {
      return
    }

    const data = bootstrapQuery.data
    if (!data) return
    const nextUsers = Array.isArray(data.users) ? data.users : []
    const nextAlerts = Array.isArray(data.alerts) ? (data.alerts as AdminAlertRecord[]) : []
    setUsers(nextUsers)
    setRecentAlerts(nextAlerts)
    setSelectedRecipientUids((current) => {
      const allowedIds = new Set(nextUsers.map((user) => user.uid))
      return current.filter((uid) => allowedIds.has(uid))
    })
  }, [bootstrapQuery.data, isAdmin])

  useEffect(() => {
    if (bootstrapQuery.error instanceof Error) {
      setErrorMessage(bootstrapQuery.error.message)
    }
  }, [bootstrapQuery.error])

  useEffect(() => {
    if (myAlertsQuery.error instanceof Error) {
      setErrorMessage(myAlertsQuery.error.message)
    }
  }, [myAlertsQuery.error])

  useEffect(() => {
    if (issuesQuery.error instanceof Error) {
      setErrorMessage(issuesQuery.error.message)
    }
  }, [issuesQuery.error])

  const myAlerts = myAlertsQuery.data?.alerts ?? []
  const unreadCount = myAlertsQuery.data?.unreadCount ?? 0

  const eligibleUsers = useMemo(() => {
    return users.filter((user) => user.isApproved && user.hasAppAccess)
  }, [users])

  const selectedEligibleCount = useMemo(() => {
    const selectedSet = new Set(selectedRecipientUids)

    return eligibleUsers.filter((user) => selectedSet.has(user.uid)).length
  }, [eligibleUsers, selectedRecipientUids])

  const toggleRecipient = useCallback((uid: string) => {
    setSelectedRecipientUids((current) => {
      return current.includes(uid)
        ? current.filter((entry) => entry !== uid)
        : [...current, uid]
    })
  }, [])

  const handleMarkAlertRead = useCallback(async (alertItem: AppAlert) => {
    const alertId = String(alertItem.id ?? '').trim()

    if (!alertId || alertItem.isRead) {
      return
    }

    setMarkingAlertIds((current) => (current.includes(alertId) ? current : [...current, alertId]))

    try {
      await markMyAlertRead(alertId)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.alertsMy(myAlertsLimit) })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not mark notification as read.')
    } finally {
      setMarkingAlertIds((current) => current.filter((id) => id !== alertId))
    }
  }, [queryClient])

  const handleMarkAlertUnread = useCallback(async (alertItem: AppAlert) => {
    const alertId = String(alertItem.id ?? '').trim()

    if (!alertId || !alertItem.isRead) {
      return
    }

    setMarkingAlertIds((current) => (current.includes(alertId) ? current : [...current, alertId]))

    try {
      await markMyAlertUnread(alertId)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.alertsMy(myAlertsLimit) })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not mark notification as unread.')
    } finally {
      setMarkingAlertIds((current) => current.filter((id) => id !== alertId))
    }
  }, [queryClient])

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
      const payload = await apiRequest<SendAdminAlertResponse>('/api/admin/alerts/send', {
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
  }, [isUpdateAlert, message, selectedRecipientUids, sendToAllUsers, title, setErrorMessage])

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
      await apiRequest<DeleteAdminAlertResponse>(`/api/admin/alerts/${encodeURIComponent(normalizedAlertId)}`, {
        method: 'DELETE',
      })

      setRecentAlerts((current) => current.filter((entry) => entry.id !== normalizedAlertId))
      setActionMessage('Notification deleted successfully.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not delete notification.')
    } finally {
      setDeletingAlertIds((current) => current.filter((id) => id !== normalizedAlertId))
    }
  }, [setErrorMessage])

  const websiteIssues = issuesQuery.data?.websiteIssues ?? null
  const issueCounts = useMemo(() => {
    const counts = websiteIssues?.counts

    if (!counts) {
      return {
        total: 0,
        hazard: 0,
        duplicateMondayLinks: 0,
        unmappedTimesheetJobs: 0,
        missingShopDrawings: 0,
      }
    }

    return {
      total: Number(counts.total ?? 0),
      hazard: Number(counts.hazard ?? 0),
      duplicateMondayLinks: Number(counts.duplicateMondayLinks ?? 0),
      unmappedTimesheetJobs: Number(counts.unmappedTimesheetJobs ?? 0),
      missingShopDrawings: Number(counts.missingShopDrawings ?? 0),
    }
  }, [websiteIssues])

  const issueRows = useMemo<UnifiedIssueRow[]>(() => {
    const rows: UnifiedIssueRow[] = []
    const hazards = Array.isArray(websiteIssues?.hazards)
      ? websiteIssues.hazards
      : []
    const missingShopDrawings = Array.isArray(websiteIssues?.missingShopDrawings)
      ? websiteIssues.missingShopDrawings
      : []
    const unmappedTimesheetJobs = Array.isArray(websiteIssues?.unmappedTimesheetJobs)
      ? websiteIssues.unmappedTimesheetJobs
      : []
    const duplicateMondayLinks = Array.isArray(websiteIssues?.duplicateMondayLinks)
      ? websiteIssues.duplicateMondayLinks
      : []

    hazards.forEach((row: TimesheetWebsiteIssueHazard, index) => {
      rows.push({
        id: `hazard:${row.orderNumber || '-'}:${index}`,
        source: 'Timesheet / Orders Integrity',
        issueType: 'Hazard Row',
        reference: row.orderNumber || row.orderName || '-',
        details: String(row.hazardReason ?? '').trim() || 'Hazard flagged in unified data',
      })
    })

    missingShopDrawings.forEach((row: TimesheetWebsiteIssueMissingShopDrawing, index) => {
      rows.push({
        id: `missing-drawing:${row.orderNumber || '-'}:${index}`,
        source: 'Timesheet / Orders Integrity',
        issueType: 'Missing Shop Drawing',
        reference: row.orderNumber || row.orderName || row.mondayItemId || '-',
        details: row.mondayItemId
          ? `Monday item ${row.mondayItemId} has no drawing.`
          : 'No shop drawing linked.',
      })
    })

    unmappedTimesheetJobs.forEach((row: TimesheetWebsiteIssueUnmappedJob) => {
      rows.push({
        id: `unmapped:${row.jobName}`,
        source: 'Timesheet / Orders Integrity',
        issueType: 'Unmapped Timesheet Job',
        reference: row.jobName,
        details: `Entries: ${row.entryCount}, Ready % rows: ${row.progressCount}`,
      })
    })

    duplicateMondayLinks.forEach((row: TimesheetWebsiteIssueDuplicateMondayLink) => {
      rows.push({
        id: `dup-link:${row.mondayItemId}`,
        source: 'Timesheet / Orders Integrity',
        issueType: 'Duplicate Monday Link',
        reference: row.mondayItemId,
        details: row.orderNumbers.length > 0
          ? `Linked order numbers: ${row.orderNumbers.join(', ')}`
          : `Duplicate link count: ${row.count}`,
      })
    })

    return rows
  }, [websiteIssues])

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
                  Notifications
                </Typography>
                <Typography color="text.secondary">
                  {isAdmin
                    ? 'Your alerts feed plus admin send controls and issue monitoring.'
                    : 'Your personal notification feed.'}
                </Typography>
              </Box>
            </Stack>

            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={isRefreshing || isLoading}
              onClick={() => {
                if (isAdmin) {
                  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminBootstrap })
                  void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminIssues })
                }
                void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.alertsMy(myAlertsLimit) })
              }}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>

          <StatusAlerts errorMessage={errorMessage} successMessage={actionMessage} />

          {myAlertsQuery.isLoading ? (
            <LoadingPanel loading message="Loading your notifications..." contained={false} size={18} />
          ) : myAlerts.length === 0 ? (
            <Typography color="text.secondary">You have no notifications yet.</Typography>
          ) : (
            <Stack spacing={1.2}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip size="small" color={unreadCount > 0 ? 'error' : 'default'} label={`Unread: ${unreadCount}`} />
                <Chip size="small" variant="outlined" label={`Total: ${myAlerts.length}`} />
              </Stack>

              <Stack spacing={1.2}>
                {myAlerts.map((alertItem, index) => {
                  const isMarking = markingAlertIds.includes(alertItem.id)

                  return (
                    <Box key={alertItem.id}>
                      {index > 0 ? <Divider sx={{ mb: 1.2 }} /> : null}
                      <Stack spacing={0.8}>
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={1}
                          justifyContent="space-between"
                          alignItems={{ xs: 'flex-start', sm: 'center' }}
                        >
                          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography fontWeight={700}>{alertItem.title}</Typography>
                            {!alertItem.isRead ? <Chip size="small" color="error" label="Unread" /> : null}
                            {alertItem.isUpdate ? <Chip size="small" color="secondary" label="Update" /> : null}
                          </Stack>

                          <Button
                            size="small"
                            variant="outlined"
                            disabled={isMarking}
                            onClick={() => {
                              void (alertItem.isRead
                                ? handleMarkAlertUnread(alertItem)
                                : handleMarkAlertRead(alertItem))
                            }}
                          >
                            {isMarking
                              ? 'Saving...'
                              : alertItem.isRead
                                ? 'Mark Unread'
                                : 'Mark Read'}
                          </Button>
                        </Stack>

                        <Typography color="text.secondary">{alertItem.message}</Typography>

                        <Typography variant="caption" color="text.secondary">
                          {formatDateTime(alertItem.createdAt)}
                          {alertItem.createdByEmail ? ` • ${alertItem.createdByEmail}` : ''}
                        </Typography>
                      </Stack>
                    </Box>
                  )
                })}
              </Stack>
            </Stack>
          )}

          {isAdmin ? <Divider /> : null}

          {isAdmin ? (
            <Typography variant="h6" fontWeight={700}>
              Send Notification
            </Typography>
          ) : null}

          {isLoading ? (
            <LoadingPanel loading={isLoading} message="Loading notifications..." contained={false} size={18} />
          ) : isAdmin ? (
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
          ) : null}
        </Stack>
      </Paper>

      {isAdmin ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack spacing={1.5}>
            <Typography variant="h6" fontWeight={700}>
              Sent Notifications
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
      ) : null}

      {isAdmin ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.2} alignItems="center">
              <ReportProblemRoundedIcon color="primary" />
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Issues
                </Typography>
                <Typography color="text.secondary">
                  Issue stream merged into Notifications for admin review.
                </Typography>
              </Box>
            </Stack>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip color="error" label={`Total ${issueCounts.total}`} />
              <Chip label={`Hazards ${issueCounts.hazard}`} />
              <Chip label={`Missing drawings ${issueCounts.missingShopDrawings}`} />
              <Chip label={`Unmapped jobs ${issueCounts.unmappedTimesheetJobs}`} />
              <Chip label={`Duplicate links ${issueCounts.duplicateMondayLinks}`} />
            </Stack>

            {issuesQuery.isLoading ? (
              <LoadingPanel loading message="Loading issues..." contained={false} size={18} />
            ) : issueRows.length === 0 ? (
              <Typography color="text.secondary">No issues right now.</Typography>
            ) : (
              <Stack spacing={1.2}>
                {issueRows.map((row, index) => (
                  <Box key={row.id}>
                    {index > 0 ? <Divider sx={{ mb: 1.2 }} /> : null}
                    <Stack spacing={0.45}>
                      <Typography fontWeight={700}>{row.issueType}</Typography>
                      <Typography variant="body2" color="text.secondary">{row.reference}</Typography>
                      <Typography variant="body2" color="text.secondary">{row.details}</Typography>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  )
}

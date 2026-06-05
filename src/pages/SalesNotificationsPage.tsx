import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { fetchMyAlerts, markMyAlertRead, markMyAlertUnread } from '../features/alerts/api'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import { formatDateTime } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type NotificationsTab = 'unread' | 'read'

export default function SalesNotificationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const alertsLimit = 80
  const [selectedTab, setSelectedTab] = useState<NotificationsTab>('unread')
  const [markingAlertIds, setMarkingAlertIds] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const alertsQuery = useQuery({
    queryKey: QUERY_KEYS.alertsMy(alertsLimit),
    queryFn: () => fetchMyAlerts(alertsLimit),
    staleTime: 60 * 1000,
  })

  const alerts = alertsQuery.data?.alerts ?? []
  const unreadCount = alertsQuery.data?.unreadCount ?? 0
  const isRefreshing = alertsQuery.isFetching && !alertsQuery.isLoading

  const unreadAlerts = useMemo(
    () => alerts.filter((entry) => !entry.isRead),
    [alerts],
  )
  const readAlerts = useMemo(
    () => alerts.filter((entry) => entry.isRead),
    [alerts],
  )
  const filteredAlerts = selectedTab === 'unread' ? unreadAlerts : readAlerts

  const emptyStateMessage = useMemo(() => {
    if (alertsQuery.isLoading) {
      return ''
    }

    if (selectedTab === 'unread') {
      return 'No unread notifications.'
    }

    return 'No read notifications yet.'
  }, [alertsQuery.isLoading, selectedTab])

  const resolveAlertLink = (alertId: string) => {
    const targetAlert = alerts.find((entry) => entry.id === alertId)

    if (!targetAlert) {
      return null
    }

    const source = String(targetAlert.metadata?.source ?? '').trim().toLowerCase()
    const dealerSourceId = String(targetAlert.metadata?.dealerSourceId ?? '').trim()

    if (source !== 'crm_chat_mention' || !dealerSourceId) {
      return null
    }

    const searchParams = new URLSearchParams({
      tab: 'engagement',
      dealerSourceId,
      quickViewTab: 'chat',
    })
    const chatMessageId = String(targetAlert.metadata?.chatMessageId ?? '').trim()

    if (chatMessageId) {
      searchParams.set('chatMessageId', chatMessageId)
    }

    return `/sales?${searchParams.toString()}`
  }

  const handleMarkAlertRead = async (alertId: string) => {
    const normalizedAlertId = String(alertId ?? '').trim()

    if (!normalizedAlertId) {
      return
    }

    setMarkingAlertIds((current) => (
      current.includes(normalizedAlertId)
        ? current
        : [...current, normalizedAlertId]
    ))

    try {
      await markMyAlertRead(normalizedAlertId)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.alertsMy(alertsLimit) })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not mark notification as read.')
    } finally {
      setMarkingAlertIds((current) => current.filter((id) => id !== normalizedAlertId))
    }
  }

  const handleMarkAlertUnread = async (alertId: string) => {
    const normalizedAlertId = String(alertId ?? '').trim()

    if (!normalizedAlertId) {
      return
    }

    setMarkingAlertIds((current) => (
      current.includes(normalizedAlertId)
        ? current
        : [...current, normalizedAlertId]
    ))

    try {
      await markMyAlertUnread(normalizedAlertId)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.alertsMy(alertsLimit) })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not mark notification as unread.')
    } finally {
      setMarkingAlertIds((current) => current.filter((id) => id !== normalizedAlertId))
    }
  }

  return (
    <Stack spacing={1.75}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.25}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <NotificationsActiveRoundedIcon color="primary" />
            <Typography variant="h6" fontWeight={700}>Notifications</Typography>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" color={unreadCount > 0 ? 'error' : 'default'} label={`Unread: ${unreadCount}`} />
            <Chip size="small" variant="outlined" label={`Total: ${alerts.length}`} />
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={alertsQuery.isLoading || isRefreshing}
              onClick={() => {
                setErrorMessage(null)
                void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.alertsMy(alertsLimit) })
              }}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>
        </Stack>

        <Tabs
          value={selectedTab}
          variant="scrollable"
          scrollButtons="auto"
          onChange={(_event, nextValue) => {
            setSelectedTab(nextValue as NotificationsTab)
          }}
          sx={{ mt: 1.25 }}
        >
          <Tab
            value="unread"
            label={`Unread (${unreadAlerts.length})`}
            sx={{ '&.Mui-selected': { color: 'error.main' } }}
          />
          <Tab
            value="read"
            label={`Read (${readAlerts.length})`}
          />
        </Tabs>

        <StatusAlerts errorMessage={errorMessage || (alertsQuery.error instanceof Error ? alertsQuery.error.message : null)} />

        {alertsQuery.isLoading ? (
          <LoadingPanel loading message="Loading notifications..." contained={false} size={18} />
        ) : filteredAlerts.length === 0 ? (
          <Typography color="text.secondary">{emptyStateMessage}</Typography>
        ) : (
          <Stack spacing={1.25}>
            <Stack spacing={1.1}>
              {filteredAlerts.map((alertItem, index) => {
                const isMarking = markingAlertIds.includes(alertItem.id)
                const alertLink = resolveAlertLink(alertItem.id)

                return (
                  <Box key={alertItem.id}>
                    {index > 0 ? <Divider sx={{ mb: 1.1 }} /> : null}

                    <Stack
                      spacing={0.8}
                      sx={{
                        p: 0.85,
                        borderRadius: 1,
                        cursor: alertLink ? 'pointer' : 'default',
                        '&:hover': alertLink
                          ? {
                            backgroundColor: 'action.hover',
                          }
                          : undefined,
                      }}
                      onClick={() => {
                        if (!alertLink) {
                          return
                        }

                        if (!alertItem.isRead) {
                          void handleMarkAlertRead(alertItem.id)
                        }

                        navigate(alertLink)
                      }}
                    >
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1}
                        justifyContent="space-between"
                        alignItems={{ xs: 'flex-start', sm: 'center' }}
                      >
                        <Stack direction="row" spacing={0.7} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography fontWeight={700}>{alertItem.title}</Typography>
                          {!alertItem.isRead ? <Chip size="small" color="error" label="Unread" /> : null}
                          {alertItem.isUpdate ? <Chip size="small" color="secondary" label="Update" /> : null}
                        </Stack>

                        <Button
                          size="small"
                          variant="outlined"
                          disabled={isMarking}
                          onClick={(event) => {
                            event.stopPropagation()
                            void (alertItem.isRead
                              ? handleMarkAlertUnread(alertItem.id)
                              : handleMarkAlertRead(alertItem.id))
                          }}
                        >
                          {isMarking ? 'Saving...' : alertItem.isRead ? 'Mark Unread' : 'Mark Read'}
                        </Button>
                      </Stack>

                      <Typography color="text.secondary">{alertItem.message}</Typography>

                      <Typography variant="caption" color="text.secondary">
                        {formatDateTime(alertItem.createdAt)}
                        {alertItem.createdByEmail ? ` • ${alertItem.createdByEmail}` : ''}
                        {alertLink ? ' • Open in chat' : ''}
                      </Typography>
                    </Stack>
                  </Box>
                )
              })}
            </Stack>
          </Stack>
        )}
      </Paper>
    </Stack>
  )
}
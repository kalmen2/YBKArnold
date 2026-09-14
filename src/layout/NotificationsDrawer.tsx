// Notifications drawer, following the Minimal template's layout: a right-hand
// drawer with counted tabs, mark-all-as-read in the header, and View all at the
// foot. The template's own version renders mock data with local state only —
// this one is wired to the real alerts API, so reading one persists.
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded'
import SystemUpdateAltRoundedIcon from '@mui/icons-material/SystemUpdateAltRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import {
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  ListItemButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppAlert } from '../features/alerts/api'

type NotificationsTab = 'all' | 'unread' | 'read'

/** Relative time — "5 min ago" reads faster than a timestamp in a list. */
function formatTimeAgo(value: string | null) {
  const parsed = value ? new Date(value) : null

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return ''
  }

  const seconds = Math.round((Date.now() - parsed.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`

  return parsed.toLocaleDateString()
}

function resolveAlertIcon(alert: AppAlert) {
  const source = String(alert.metadata?.source ?? '').trim().toLowerCase()

  if (source.startsWith('app_chat') || source.includes('mention')) {
    return <ChatBubbleOutlineRoundedIcon fontSize="small" />
  }

  if (source.includes('task')) {
    return <TaskAltRoundedIcon fontSize="small" />
  }

  if (alert.isUpdate) {
    return <SystemUpdateAltRoundedIcon fontSize="small" />
  }

  return <Inventory2OutlinedIcon fontSize="small" />
}

/** Where a notification takes you when you click it. */
function resolveAlertRoute(alert: AppAlert) {
  const source = String(alert.metadata?.source ?? '').trim().toLowerCase()

  return source.startsWith('app_chat') || source.includes('mention') ? '/chat' : '/notifications'
}

export function NotificationsDrawer({
  alerts,
  unreadCount,
  isMarkingAllRead,
  markingAlertId,
  onMarkAllRead,
  onMarkRead,
  browserNotificationPermission,
  onRequestBrowserNotifications,
}: {
  alerts: AppAlert[]
  unreadCount: number
  isMarkingAllRead: boolean
  markingAlertId: string | null
  onMarkAllRead: () => void
  onMarkRead: (alert: AppAlert) => void
  browserNotificationPermission: NotificationPermission
  onRequestBrowserNotifications: () => void
}) {
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  // Opens on Unread: the reason you clicked the bell is the thing you have not
  // seen yet, not the full history.
  const [currentTab, setCurrentTab] = useState<NotificationsTab>('unread')

  const readCount = alerts.length - alerts.filter((alert) => !alert.isRead).length
  const visibleAlerts = useMemo(() => {
    if (currentTab === 'unread') return alerts.filter((alert) => !alert.isRead)
    if (currentTab === 'read') return alerts.filter((alert) => alert.isRead)
    return alerts
  }, [alerts, currentTab])

  const tabs: { value: NotificationsTab, label: string, count: number }[] = [
    { value: 'all', label: 'All', count: alerts.length },
    { value: 'unread', label: 'Unread', count: unreadCount },
    { value: 'read', label: 'Read', count: readCount },
  ]

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton color="inherit" onClick={() => setIsOpen(true)} aria-label="Notifications">
          <Badge
            color="error"
            badgeContent={unreadCount > 99 ? '99+' : unreadCount}
            invisible={unreadCount <= 0}
          >
            <NotificationsRoundedIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Drawer
        open={isOpen}
        anchor="right"
        onClose={() => setIsOpen(false)}
        slotProps={{
          backdrop: { invisible: true },
          paper: { sx: { width: 1, maxWidth: 420 } },
        }}
      >
        <Stack direction="row" alignItems="center" sx={{ py: 2, pr: 1, pl: 2.5, minHeight: 68 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Notifications</Typography>

          {unreadCount > 0 ? (
            <Tooltip title="Mark all as read">
              <span>
                <IconButton color="primary" disabled={isMarkingAllRead} onClick={onMarkAllRead}>
                  {isMarkingAllRead
                    ? <CircularProgress size={18} color="inherit" />
                    : <DoneAllRoundedIcon />}
                </IconButton>
              </span>
            </Tooltip>
          ) : null}

          <IconButton onClick={() => setIsOpen(false)} aria-label="Close notifications">
            <CloseRoundedIcon />
          </IconButton>
        </Stack>

        <Tabs
          variant="fullWidth"
          value={currentTab}
          onChange={(_event, value) => setCurrentTab(value as NotificationsTab)}
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.value}
              value={tab.value}
              label={tab.label}
              iconPosition="end"
              icon={(
                <Chip
                  size="small"
                  label={tab.count}
                  color={tab.value === 'unread' && tab.count > 0 ? 'error' : 'default'}
                  variant={tab.value === currentTab ? 'filled' : 'outlined'}
                  sx={{ height: 20, minWidth: 26, fontSize: '0.7rem', fontWeight: 700 }}
                />
              )}
              sx={{ minHeight: 48, textTransform: 'none', gap: 0.75 }}
            />
          ))}
        </Tabs>

        <Divider />

        {browserNotificationPermission !== 'granted' ? (
          <Box sx={{ px: 2, pt: 1.5 }}>
            <Button
              fullWidth
              size="small"
              variant="outlined"
              disabled={browserNotificationPermission === 'denied'}
              onClick={onRequestBrowserNotifications}
            >
              {browserNotificationPermission === 'denied'
                ? 'Desktop notifications blocked in browser'
                : 'Enable desktop notifications'}
            </Button>
          </Box>
        ) : null}

        <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
          {visibleAlerts.length === 0 ? (
            <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ py: 8, px: 3 }}>
              <NotificationsRoundedIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
              <Typography variant="body2" color="text.secondary" textAlign="center">
                {currentTab === 'unread' ? 'Nothing unread. All caught up.' : 'No notifications yet.'}
              </Typography>
            </Stack>
          ) : (
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {visibleAlerts.map((alert) => (
                <Box component="li" key={alert.id}>
                  <ListItemButton
                    disabled={markingAlertId === alert.id}
                    onClick={() => {
                      if (!alert.isRead) {
                        onMarkRead(alert)
                      }

                      setIsOpen(false)
                      navigate(resolveAlertRoute(alert))
                    }}
                    sx={{
                      alignItems: 'flex-start',
                      gap: 1.5,
                      px: 2.5,
                      py: 1.5,
                      borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                      bgcolor: (theme) => (alert.isRead
                        ? 'transparent'
                        : alpha(theme.palette.primary.main, 0.06)),
                    }}
                  >
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        flexShrink: 0,
                        display: 'flex',
                        borderRadius: '50%',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'text.secondary',
                        bgcolor: 'action.hover',
                      }}
                    >
                      {resolveAlertIcon(alert)}
                    </Box>

                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: alert.isRead ? 500 : 700, wordBreak: 'break-word' }}
                      >
                        {alert.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', wordBreak: 'break-word' }}
                      >
                        {alert.message}
                      </Typography>
                      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.4 }}>
                        {formatTimeAgo(alert.createdAt)}
                      </Typography>
                    </Box>

                    {!alert.isRead ? (
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          mt: 0.75,
                          flexShrink: 0,
                          borderRadius: '50%',
                          bgcolor: 'error.main',
                        }}
                      />
                    ) : null}
                  </ListItemButton>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        <Divider />

        <Box sx={{ p: 1 }}>
          <Button
            fullWidth
            size="large"
            onClick={() => {
              setIsOpen(false)
              navigate('/notifications')
            }}
          >
            View all
          </Button>
        </Box>
      </Drawer>
    </>
  )
}

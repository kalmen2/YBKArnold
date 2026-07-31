import KeyboardDoubleArrowLeftRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowLeftRounded'
import KeyboardDoubleArrowRightRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowRightRounded'
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import {
  Avatar,
  AppBar,
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { fetchMyAlerts, markMyAlertRead } from '../features/alerts/api'
import { formatDateTime } from '../lib/formatters'
import { useAppProcesses } from '../lib/appProcesses'
import { QUERY_KEYS } from '../lib/queryKeys'
import { navItems } from '../navigation/navItems'
import Sidebar from './Sidebar'

const EXPANDED_DRAWER_WIDTH = 248
const COLLAPSED_DRAWER_WIDTH = 76

export default function AppLayout() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const location = useLocation()
  const navigate = useNavigate()
  const { appUser, signOutFromApp, logActivity } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [isPurchasingPoMode, setIsPurchasingPoMode] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [profileMenuAnchorEl, setProfileMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [alertsMenuAnchorEl, setAlertsMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [processesMenuAnchorEl, setProcessesMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [markingAlertId, setMarkingAlertId] = useState<string | null>(null)
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false)
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<NotificationPermission>(
    () => (typeof Notification === 'undefined' ? 'denied' : Notification.permission),
  )
  const notificationSeenIdsRef = useRef<Set<string> | null>(null)
  const alertsLimit = 30
  const queryClient = useQueryClient()
  const activeProcesses = useAppProcesses()

  const isSupportRoute =
    location.pathname === '/support' || location.pathname.startsWith('/support/')
  const isPurchasingRoute =
    location.pathname === '/purchasing' || location.pathname.startsWith('/purchasing/')
  const forceCollapsed = !isMobile && (isSupportRoute || (isPurchasingRoute && isPurchasingPoMode))
  const effectiveCollapsed = forceCollapsed || collapsed

  const drawerWidth = effectiveCollapsed ? COLLAPSED_DRAWER_WIDTH : EXPANDED_DRAWER_WIDTH

  const alertsQuery = useQuery({
    queryKey: QUERY_KEYS.alertsMy(alertsLimit),
    queryFn: () => fetchMyAlerts(alertsLimit),
    enabled: Boolean(appUser?.isApproved),
    staleTime: 8 * 1000,
    refetchInterval: 10 * 1000,
  })

  const handleSidebarToggle = () => {
    if (isMobile) {
      setMobileOpen((prev) => !prev)
      return
    }

    if (forceCollapsed) {
      return
    }

    setCollapsed((prev) => !prev)
  }

  const closeMobileSidebar = () => {
    setMobileOpen(false)
  }

  useEffect(() => {
    void logActivity({
      action: 'route_view',
      target: location.pathname,
      path: location.pathname,
    })
  }, [location.pathname, logActivity])

  useEffect(() => {
    const handlePurchasingPoMode = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail
      setIsPurchasingPoMode(detail?.open === true)
    }

    window.addEventListener('purchasing:po-mode', handlePurchasingPoMode as EventListener)

    return () => {
      window.removeEventListener('purchasing:po-mode', handlePurchasingPoMode as EventListener)
    }
  }, [])

  useEffect(() => {
    if (!isPurchasingRoute && isPurchasingPoMode) {
      setIsPurchasingPoMode(false)
    }
  }, [isPurchasingPoMode, isPurchasingRoute])

  useEffect(() => {
    if (!appUser?.isSalesRep) {
      return
    }

    const isSalesRoute = location.pathname === '/sales' || location.pathname.startsWith('/sales/')
    const isSalesRepNotificationsRoute =
      location.pathname === '/notifications'
      || location.pathname.startsWith('/notifications/')
    const isSalesRepChatRoute =
      location.pathname === '/chat'
      || location.pathname.startsWith('/chat/')

    if (!isSalesRoute && !isSalesRepNotificationsRoute && !isSalesRepChatRoute) {
      navigate('/sales?tab=dealers', { replace: true })
    }
  }, [appUser?.isSalesRep, location.pathname, navigate])

  const headerTitle = useMemo(() => {
    const normalizedPath = (location.pathname || '/').replace(/\/+$/, '') || '/'

    const matchedItem = [...navItems]
      .sort((left, right) => right.path.length - left.path.length)
      .find((item) => normalizedPath === item.path || normalizedPath.startsWith(`${item.path}/`))

    if (matchedItem) {
      return matchedItem.label
    }

    if (normalizedPath === '/') {
      return 'Dashboard'
    }

    const lastSegment = normalizedPath.split('/').filter(Boolean).pop() ?? 'Dashboard'
    return lastSegment
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())
  }, [location.pathname])

  const alerts = alertsQuery.data?.alerts ?? []
  const unreadCount = alertsQuery.data?.unreadCount ?? 0
  const unreadAlerts = useMemo(
    () => alerts.filter((alert) => !alert.isRead),
    [alerts],
  )

  const requestBrowserNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      setBrowserNotificationPermission('denied')
      return
    }

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      setBrowserNotificationPermission(permission)
      return
    }

    setBrowserNotificationPermission(Notification.permission)
  }

  useEffect(() => {
    if (!appUser?.isApproved || typeof Notification === 'undefined' || Notification.permission !== 'default') {
      return
    }

    const requestOnFirstInteraction = () => {
      void requestBrowserNotificationPermission()
    }

    window.addEventListener('pointerdown', requestOnFirstInteraction, { once: true })
    return () => window.removeEventListener('pointerdown', requestOnFirstInteraction)
  }, [appUser?.isApproved])

  useEffect(() => {
    if (!appUser?.uid || !alertsQuery.data) {
      return
    }

    const storageKey = `arnold:web-notification-seen:${appUser.uid}`
    const seenIds = notificationSeenIdsRef.current ?? new Set<string>()

    if (!notificationSeenIdsRef.current) {
      try {
        const storedIds = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
        if (Array.isArray(storedIds)) {
          storedIds.forEach((id) => {
            const normalizedId = String(id ?? '').trim()
            if (normalizedId) seenIds.add(normalizedId)
          })
        }
      } catch {
        // Ignore malformed browser storage.
      }
      notificationSeenIdsRef.current = seenIds
    }

    const newMentionAlerts = alerts.filter((alert) => {
      const source = String(alert.metadata?.source ?? '').trim().toLowerCase()
      return !seenIds.has(alert.id) && source.includes('mention')
    })

    alerts.forEach((alert) => seenIds.add(alert.id))

    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...seenIds].slice(-300)))
    } catch {
      // Browser storage is optional.
    }

    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return
    }

    newMentionAlerts.forEach((alert) => {
      const browserAlert = new Notification(alert.title, {
        body: alert.message,
        icon: '/favicon.png',
        badge: '/favicon.png',
        tag: `mention-${alert.id}`,
      })
      browserAlert.onclick = () => {
        window.focus()
        navigate('/notifications')
        browserAlert.close()
      }
    })
  }, [alerts, alertsQuery.data, appUser?.uid, navigate])

  const handleProfileMenuClose = () => {
    setProfileMenuAnchorEl(null)
  }

  const handleAlertsMenuClose = () => {
    setAlertsMenuAnchorEl(null)
  }

  const handleSignOut = () => {
    setIsSigningOut(true)
    handleProfileMenuClose()

    void signOutFromApp().finally(() => {
      setIsSigningOut(false)
    })
  }

  const handleMarkAlertRead = async (alertId: string) => {
    setMarkingAlertId(alertId)

    try {
      await markMyAlertRead(alertId)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.alertsMy(alertsLimit) })
    } catch {
      // Non-blocking in header UI.
    } finally {
      setMarkingAlertId((current) => (current === alertId ? null : current))
    }
  }

  const handleMarkAllRead = async () => {
    if (isMarkingAllRead) {
      return
    }

    if (unreadAlerts.length === 0) {
      return
    }

    setIsMarkingAllRead(true)

    try {
      await Promise.all(unreadAlerts.map((alert) => markMyAlertRead(alert.id)))
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.alertsMy(alertsLimit) })
    } catch {
      // Non-blocking in header UI.
    } finally {
      setIsMarkingAllRead(false)
      setMarkingAlertId(null)
    }
  }

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        bgcolor: 'transparent',
        position: 'relative',
        isolation: 'isolate',
        '&::before': {
          content: '""',
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          background: [
            `radial-gradient(780px circle at 8% -8%, ${alpha(theme.palette.primary.light, 0.24)} 0%, transparent 56%)`,
            `radial-gradient(600px circle at 95% 0%, ${alpha(theme.palette.secondary.light, 0.2)} 0%, transparent 50%)`,
          ].join(', '),
        },
      }}
    >
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: alpha(theme.palette.primary.main, 0.14),
          bgcolor: alpha(theme.palette.background.paper, 0.82),
          backdropFilter: 'blur(14px)',
          boxShadow: `0 10px 30px ${alpha(theme.palette.primary.dark, 0.08)}`,
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          zIndex: theme.zIndex.drawer + 1,
          transition: (theme) =>
            theme.transitions.create(['width', 'margin'], {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.shorter,
            }),
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton
            size="small"
            edge="start"
            color="inherit"
            onClick={handleSidebarToggle}
            aria-label="Toggle sidebar"
          >
            {isMobile ? (
              <MenuRoundedIcon fontSize="small" />
            ) : effectiveCollapsed ? (
              <KeyboardDoubleArrowRightRoundedIcon fontSize="small" />
            ) : (
              <KeyboardDoubleArrowLeftRoundedIcon fontSize="small" />
            )}
          </IconButton>

          <Box
            component="img"
            src="/arnold-quote-mark.png"
            alt="Arnold Contract"
            sx={{ width: 34, height: 34, objectFit: 'contain', display: { xs: 'none', sm: 'block' } }}
          />

          <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.dark' }}>
            {headerTitle}
          </Typography>

          <Box sx={{ flexGrow: 1 }} />

          <Stack direction="row" spacing={0.25} alignItems="center">
            {activeProcesses.length > 0 ? (
              <Button
                size="small"
                variant="outlined"
                color="primary"
                startIcon={<CircularProgress size={14} thickness={5} />}
                onClick={(event) => setProcessesMenuAnchorEl(event.currentTarget)}
                sx={{
                  mr: 0.5,
                  minWidth: 0,
                  px: { xs: 1, sm: 1.25 },
                  borderRadius: 999,
                  textTransform: 'none',
                  fontWeight: 750,
                  whiteSpace: 'nowrap',
                }}
              >
                {activeProcesses.length} {activeProcesses.length === 1 ? 'process' : 'processes'} running
              </Button>
            ) : null}

            <IconButton
              size="small"
              color="inherit"
              aria-label="Open notifications"
              onClick={(event) => {
                setAlertsMenuAnchorEl(event.currentTarget)
                void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.alertsMy(alertsLimit) })
                if (browserNotificationPermission === 'default') {
                  void requestBrowserNotificationPermission()
                }
              }}
            >
              <Badge
                color="error"
                badgeContent={unreadCount > 99 ? '99+' : unreadCount}
                invisible={unreadCount <= 0}
              >
                <NotificationsRoundedIcon fontSize="small" />
              </Badge>
            </IconButton>

            <IconButton
              size="small"
              color="inherit"
              aria-label="Open account menu"
              onClick={(event) => {
                setProfileMenuAnchorEl(event.currentTarget)
              }}
            >
              <Avatar
                src={appUser?.photoURL ?? undefined}
                alt={appUser?.displayName ?? appUser?.email ?? 'User'}
                sx={{ width: 30, height: 30 }}
              >
                {(appUser?.displayName ?? appUser?.email ?? '?')
                  .charAt(0)
                  .toUpperCase()}
              </Avatar>
            </IconButton>
          </Stack>

          <Menu
            anchorEl={processesMenuAnchorEl}
            open={Boolean(processesMenuAnchorEl) && activeProcesses.length > 0}
            onClose={() => setProcessesMenuAnchorEl(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{ sx: { mt: 0.75, width: 380, maxWidth: 'calc(100vw - 24px)', maxHeight: 430 } }}
          >
            <Box sx={{ px: 2, py: 1.4 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: 1.5,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                    color: 'primary.main',
                  }}
                >
                  <SyncRoundedIcon fontSize="small" />
                </Box>
                <Box>
                  <Typography variant="subtitle2" fontWeight={800}>
                    Background processes
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    You can keep working while these finish.
                  </Typography>
                </Box>
              </Stack>
            </Box>
            <Divider />
            {activeProcesses.map((process) => (
              <MenuItem
                key={process.id}
                disableRipple
                sx={{ py: 1.15, alignItems: 'flex-start', cursor: 'default' }}
              >
                <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ width: '100%', minWidth: 0 }}>
                  <CircularProgress size={19} thickness={5} sx={{ mt: 0.3, flexShrink: 0 }} />
                  <Stack spacing={0.2} sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={750}>
                      {process.label}
                    </Typography>
                    {process.detail ? (
                      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                        {process.detail}
                      </Typography>
                    ) : null}
                    <Typography variant="caption" color="text.secondary">
                      Started {formatDateTime(process.startedAt)}
                    </Typography>
                  </Stack>
                </Stack>
              </MenuItem>
            ))}
          </Menu>

          <Menu
            anchorEl={alertsMenuAnchorEl}
            open={Boolean(alertsMenuAnchorEl)}
            onClose={handleAlertsMenuClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{ sx: { mt: 0.75, width: 360, maxHeight: 420 } }}
          >
            <Box sx={{ px: 2, py: 1.25 }}>
              <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="subtitle2" fontWeight={700}>
                    Notifications
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {unreadCount > 0
                      ? `${unreadCount} unread`
                      : 'All caught up'}
                  </Typography>
                </Box>

                <Button
                  size="small"
                  variant="text"
                  startIcon={isMarkingAllRead ? <CircularProgress color="inherit" size={14} /> : <DoneAllRoundedIcon fontSize="small" />}
                  onClick={() => {
                    void handleMarkAllRead()
                  }}
                  disabled={unreadCount <= 0 || isMarkingAllRead}
                >
                  Mark all read
                </Button>
              </Stack>
              {browserNotificationPermission !== 'granted' ? (
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ mt: 1 }}
                  onClick={() => void requestBrowserNotificationPermission()}
                  disabled={browserNotificationPermission === 'denied'}
                >
                  {browserNotificationPermission === 'denied'
                    ? 'Desktop notifications blocked in browser'
                    : 'Enable desktop notifications'}
                </Button>
              ) : null}
            </Box>

            <Divider />

            {unreadAlerts.length === 0 ? (
              <MenuItem disabled>
                <Typography variant="body2" color="text.secondary">
                  No unread notifications.
                </Typography>
              </MenuItem>
            ) : (
              unreadAlerts.map((alert) => (
                <MenuItem
                  key={alert.id}
                  sx={{ alignItems: 'flex-start', whiteSpace: 'normal', py: 1.1 }}
                >
                  <Stack direction="row" spacing={1} sx={{ width: '100%', minWidth: 0 }} alignItems="flex-start">
                    <Stack spacing={0.4} sx={{ maxWidth: '100%', flexGrow: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        {!alert.isRead ? (
                          <Box
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              bgcolor: 'error.main',
                              flexShrink: 0,
                            }}
                          />
                        ) : null}

                        <Typography variant="body2" fontWeight={alert.isRead ? 500 : 700} noWrap>
                          {alert.title}
                        </Typography>
                      </Stack>

                      <Typography variant="caption" color="text.secondary">
                        {alert.message}
                      </Typography>

                      <Typography variant="caption" color="text.secondary">
                        {formatDateTime(alert.createdAt)}
                      </Typography>
                    </Stack>

                    {alert.isRead ? (
                      <IconButton size="small" disabled aria-label="Read">
                        <TaskAltRoundedIcon fontSize="small" />
                      </IconButton>
                    ) : (
                      <IconButton
                        size="small"
                        aria-label="Mark as read"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleMarkAlertRead(alert.id)
                        }}
                        disabled={markingAlertId === alert.id || isMarkingAllRead}
                      >
                        {markingAlertId === alert.id ? (
                          <CircularProgress size={16} />
                        ) : (
                          <TaskAltRoundedIcon fontSize="small" />
                        )}
                      </IconButton>
                    )}
                  </Stack>
                </MenuItem>
              ))
            )}
          </Menu>

          <Menu
            anchorEl={profileMenuAnchorEl}
            open={Boolean(profileMenuAnchorEl)}
            onClose={handleProfileMenuClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{ sx: { mt: 0.75, minWidth: 180 } }}
          >
            <MenuItem
              onClick={handleSignOut}
              disabled={isSigningOut}
              data-log-action="Sign out"
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <LogoutRoundedIcon fontSize="small" />
                <Typography variant="body2">
                  {isSigningOut ? 'Signing out...' : 'Log out'}
                </Typography>
              </Stack>
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Sidebar
        collapsed={effectiveCollapsed}
        mobileOpen={mobileOpen}
        isMobile={isMobile}
        onMobileClose={closeMobileSidebar}
        expandedWidth={EXPANDED_DRAWER_WIDTH}
        collapsedWidth={COLLAPSED_DRAWER_WIDTH}
      />

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 }, position: 'relative', zIndex: 1 }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  )
}

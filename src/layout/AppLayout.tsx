import KeyboardDoubleArrowLeftRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowLeftRounded'
import KeyboardDoubleArrowRightRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowRightRounded'
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded'
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
import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { fetchMyAlerts, markMyAlertRead } from '../features/alerts/api'
import { formatDateTime } from '../lib/formatters'
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
  const [markingAlertId, setMarkingAlertId] = useState<string | null>(null)
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false)
  const alertsLimit = 30
  const queryClient = useQueryClient()

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
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
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
    const isConfigRoute = location.pathname === '/config' || location.pathname.startsWith('/config/')
    const isSalesRepNotificationsRoute =
      location.pathname === '/notifications'
      || location.pathname.startsWith('/notifications/')

    if (!isSalesRoute && !isConfigRoute && !isSalesRepNotificationsRoute) {
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

    const unreadAlerts = alerts.filter((alert) => !alert.isRead)

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

          <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.dark' }}>
            {headerTitle}
          </Typography>

          <Box sx={{ flexGrow: 1 }} />

          <Stack direction="row" spacing={0.25} alignItems="center">
            <IconButton
              size="small"
              color="inherit"
              aria-label="Open notifications"
              onClick={(event) => {
                setAlertsMenuAnchorEl(event.currentTarget)
                void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.alertsMy(alertsLimit) })
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
            </Box>

            <Divider />

            {alerts.length === 0 ? (
              <MenuItem disabled>
                <Typography variant="body2" color="text.secondary">
                  No notifications yet.
                </Typography>
              </MenuItem>
            ) : (
              alerts.map((alert) => (
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
import KeyboardDoubleArrowLeftRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowLeftRounded'
import KeyboardDoubleArrowRightRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowRightRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import {
  Avatar,
  AppBar,
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import Sidebar from './Sidebar'

const EXPANDED_DRAWER_WIDTH = 248
const COLLAPSED_DRAWER_WIDTH = 76

export default function AppLayout() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const location = useLocation()
  const { appUser, signOutFromApp, logActivity } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  const drawerWidth = collapsed ? COLLAPSED_DRAWER_WIDTH : EXPANDED_DRAWER_WIDTH

  const handleSidebarToggle = () => {
    if (isMobile) {
      setMobileOpen((prev) => !prev)
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

  const appUserRoleLabel = appUser?.role === 'admin'
    ? 'Admin'
    : appUser?.role === 'manager'
      ? 'Manager'
      : 'Standard'
  const appUserRoleColor: 'default' | 'primary' | 'secondary' = appUser?.role === 'admin'
    ? 'secondary'
    : appUser?.role === 'manager'
      ? 'primary'
      : 'default'

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
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
            ) : collapsed ? (
              <KeyboardDoubleArrowRightRoundedIcon fontSize="small" />
            ) : (
              <KeyboardDoubleArrowLeftRoundedIcon fontSize="small" />
            )}
          </IconButton>

          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Integrations Hub
          </Typography>

          <Box sx={{ flexGrow: 1 }} />

          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              color={appUserRoleColor}
              label={appUserRoleLabel}
              variant="outlined"
            />

            <Avatar
              src={appUser?.photoURL ?? undefined}
              alt={appUser?.displayName ?? appUser?.email ?? 'User'}
              sx={{ width: 28, height: 28 }}
            >
              {(appUser?.displayName ?? appUser?.email ?? '?')
                .charAt(0)
                .toUpperCase()}
            </Avatar>

            {!isMobile ? (
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 220 }} noWrap>
                {appUser?.displayName ?? appUser?.email ?? 'Signed in'}
              </Typography>
            ) : null}

            <Button
              size="small"
              color="inherit"
              startIcon={<LogoutRoundedIcon />}
              data-log-action="Sign out"
              disabled={isSigningOut}
              onClick={() => {
                setIsSigningOut(true)

                void signOutFromApp().finally(() => {
                  setIsSigningOut(false)
                })
              }}
            >
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        isMobile={isMobile}
        onMobileClose={closeMobileSidebar}
        expandedWidth={EXPANDED_DRAWER_WIDTH}
        collapsedWidth={COLLAPSED_DRAWER_WIDTH}
      />

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  )
}
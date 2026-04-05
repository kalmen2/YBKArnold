import KeyboardDoubleArrowLeftRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowLeftRounded'
import KeyboardDoubleArrowRightRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowRightRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import {
  AppBar,
  Box,
  IconButton,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

const EXPANDED_DRAWER_WIDTH = 248
const COLLAPSED_DRAWER_WIDTH = 76

export default function AppLayout() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

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
            {/* Integrations Hub */}
          </Typography>
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
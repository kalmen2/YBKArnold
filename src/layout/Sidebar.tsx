import {
  Box,
  Collapse,
  Divider,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { navItems, type NavItem } from '../navigation/navItems'

type SidebarProps = {
  collapsed: boolean
  mobileOpen: boolean
  isMobile: boolean
  onMobileClose: () => void
  expandedWidth: number
  collapsedWidth: number
}

type SidebarContentProps = {
  showText: boolean
  onNavigate?: () => void
}

function SidebarContent({ showText, onNavigate }: SidebarContentProps) {
  const theme = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const { appUser } = useAuth()

  const canAccessNavItem = (item: NavItem) => {
    if (appUser?.isSalesRep) {
      return item.path === '/sales' || item.path === '/notifications' || item.path === '/chat'
    }

    if (item.adminOnly && !appUser?.isAdmin) {
      return false
    }

    if (item.managerOnly && !appUser?.isManager) {
      return false
    }

    if (item.managerOrAdminOnly && !appUser?.isManager && !appUser?.isAdmin) {
      return false
    }

    return true
  }

  const visibleNavItems = navItems.filter(canAccessNavItem)
  const regularNavItems = visibleNavItems.filter(
    (item) => !item.adminOnly && !item.adminSection && !item.testingSection,
  )
  const adminNavItems = visibleNavItems.filter(
    (item) => !item.testingSection && (item.adminOnly || item.adminSection),
  )
  const testingNavItems = visibleNavItems.filter(
    (item) => item.testingSection,
  )

  const isPathActive = (path: string) => {
    const [targetPathname, targetSearch = ''] = path.split('?')
    const pathnameMatches = location.pathname === targetPathname
      || location.pathname.startsWith(`${targetPathname}/`)
    if (!pathnameMatches) return false

    const targetParams = new URLSearchParams(targetSearch)
    const targetTab = targetParams.get('tab')
    const currentTab = new URLSearchParams(location.search).get('tab')
    if (targetTab) return currentTab === targetTab
    if (targetPathname === '/admin/settings') {
      return !['email', 'ai-config', 'ai-council', 'sms-bridge'].includes(currentTab || '')
    }
    return true
  }

  const isAdminRouteActive = adminNavItems.some((item) => isPathActive(item.path))
  const isTestingRouteActive = testingNavItems.some((item) => isPathActive(item.path))

  const [adminExpanded, setAdminExpanded] = useState(isAdminRouteActive)
  const [testingExpanded, setTestingExpanded] = useState(isTestingRouteActive)
  const adminGroupExpanded = adminExpanded || isAdminRouteActive
  const testingGroupExpanded = testingExpanded || isTestingRouteActive

  const renderItem = (
    path: string,
    label: string,
    Icon: (typeof navItems)[number]['icon'],
    nested = false,
    badge?: string,
  ) => {
    const isSelected = isPathActive(path)

    return (
      <ListItem key={path} disablePadding sx={{ mb: 0.5 }}>
        <ListItemButton
          selected={isSelected}
          onClick={() => {
            navigate(path)
            onNavigate?.()
          }}
          sx={{
            minHeight: 44,
            borderRadius: 2,
            justifyContent: showText ? 'flex-start' : 'center',
            px: showText ? 1.5 : 1.25,
            pl: showText && nested ? 3 : undefined,
            border: '1px solid transparent',
            color: isSelected ? 'primary.dark' : 'text.primary',
            transition: theme.transitions.create(
              ['background-color', 'transform', 'border-color', 'box-shadow'],
              { duration: theme.transitions.duration.shorter },
            ),
            '&:hover': {
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              borderColor: alpha(theme.palette.primary.main, 0.2),
              transform: showText ? 'translateX(2px)' : 'none',
            },
            '&.Mui-selected': {
              bgcolor: alpha(theme.palette.primary.main, 0.16),
              borderColor: alpha(theme.palette.primary.main, 0.32),
              boxShadow: `0 10px 20px ${alpha(theme.palette.primary.main, 0.15)}`,
            },
            '&.Mui-selected:hover': {
              bgcolor: alpha(theme.palette.primary.main, 0.2),
            },
          }}
        >
          <ListItemIcon
            sx={{
              minWidth: 0,
              justifyContent: 'center',
              mr: showText ? 1.5 : 0,
              color: isSelected ? 'primary.main' : 'text.secondary',
            }}
          >
            <Icon fontSize="small" />
          </ListItemIcon>

          <ListItemText
            disableTypography
            primary={(
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Typography component="span" sx={{ fontSize: 14, fontWeight: 500 }}>
                  {label}
                </Typography>
                {badge ? (
                  <Box
                    component="span"
                    sx={{
                      px: 0.65,
                      py: 0.1,
                      borderRadius: 5,
                      bgcolor: alpha(theme.palette.warning.main, 0.14),
                      color: 'warning.dark',
                      fontSize: 9,
                      fontWeight: 800,
                      lineHeight: 1.5,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {badge}
                  </Box>
                ) : null}
              </Stack>
            )}
            sx={{
              display: showText ? 'block' : 'none',
            }}
          />
        </ListItemButton>
      </ListItem>
    )
  }

  const renderGroup = (
    label: string,
    Icon: NavItem['icon'],
    items: NavItem[],
    expanded: boolean,
    onToggle: () => void,
    active: boolean,
  ) => {
    if (items.length === 0) {
      return null
    }

    return (
      <>
        <ListItem disablePadding sx={{ mb: 0.5 }}>
          <ListItemButton
            selected={active}
            onClick={onToggle}
            sx={{
              minHeight: 44,
              borderRadius: 2,
              px: 1.5,
              border: '1px solid transparent',
              color: active ? 'secondary.dark' : 'text.primary',
              bgcolor: active ? alpha(theme.palette.secondary.main, 0.14) : 'transparent',
              '&:hover': {
                bgcolor: alpha(theme.palette.secondary.main, 0.1),
                borderColor: alpha(theme.palette.secondary.main, 0.24),
              },
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: 0,
                justifyContent: 'center',
                mr: 1.5,
                color: active ? 'secondary.main' : 'text.secondary',
              }}
            >
              <Icon fontSize="small" />
            </ListItemIcon>

            <ListItemText
              primary={label}
              sx={{
                '& .MuiListItemText-primary': {
                  fontSize: 14,
                  fontWeight: 600,
                },
              }}
            />

            {expanded ? (
              <KeyboardArrowDownRoundedIcon fontSize="small" />
            ) : (
              <KeyboardArrowRightRoundedIcon fontSize="small" />
            )}
          </ListItemButton>
        </ListItem>

        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <List disablePadding>
            {items.map((item) => renderItem(item.path, item.label, item.icon, true, item.badge))}
          </List>
        </Collapse>
      </>
    )
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 0.95)} 0%, ${alpha(theme.palette.primary.light, 0.08)} 100%)`,
      }}
    >
      <Toolbar sx={{ px: showText ? 2 : 1, py: 0.75, justifyContent: showText ? 'flex-start' : 'center', gap: 1 }}>
        <Box
          component="img"
          src="/arnold-quote-mark.png"
          alt="Arnold Contract"
          sx={{ width: 38, height: 38, objectFit: 'contain', flexShrink: 0 }}
        />
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 700,
            whiteSpace: 'nowrap',
            opacity: showText ? 1 : 0,
            transition: 'opacity 160ms ease',
            color: 'primary.dark',
            letterSpacing: '0.03em',
          }}
        >
          Arnold Contract
        </Typography>
      </Toolbar>

      <Divider />

      <List sx={{ px: 1, py: 1.5 }}>
        {!showText
          ? visibleNavItems.map((item) => renderItem(item.path, item.label, item.icon, false, item.badge))
          : null}

        {showText
          ? regularNavItems.map((item) => renderItem(item.path, item.label, item.icon, false, item.badge))
          : null}

        {showText
          ? renderGroup(
            'Admin',
            AdminPanelSettingsRoundedIcon,
            adminNavItems,
            adminGroupExpanded,
            () => {
              setAdminExpanded((current) => !current)
            },
            isAdminRouteActive,
          )
          : null}

        {showText
          ? renderGroup(
            'Testing',
            ScienceRoundedIcon,
            testingNavItems,
            testingGroupExpanded,
            () => {
              setTestingExpanded((current) => !current)
            },
            isTestingRouteActive,
          )
          : null}
      </List>
    </Box>
  )
}

export default function Sidebar({
  collapsed,
  mobileOpen,
  isMobile,
  onMobileClose,
  expandedWidth,
  collapsedWidth,
}: SidebarProps) {
  const theme = useTheme()
  const desktopWidth = collapsed ? collapsedWidth : expandedWidth

  return (
    <>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: expandedWidth,
            boxSizing: 'border-box',
            borderRight: 1,
            borderColor: alpha(theme.palette.primary.main, 0.16),
            bgcolor: alpha(theme.palette.background.paper, 0.88),
            backdropFilter: 'blur(12px)',
          },
        }}
      >
        <SidebarContent showText onNavigate={onMobileClose} />
      </Drawer>

      <Drawer
        variant="permanent"
        open
        sx={{
          display: { xs: 'none', md: 'block' },
          width: desktopWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: desktopWidth,
            boxSizing: 'border-box',
            overflowX: 'hidden',
            borderRight: 1,
            borderColor: alpha(theme.palette.primary.main, 0.16),
            bgcolor: alpha(theme.palette.background.paper, 0.9),
            backdropFilter: 'blur(12px)',
            transition: (theme) =>
              theme.transitions.create('width', {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.shorter,
              }),
          },
        }}
      >
        <SidebarContent showText={!collapsed && !isMobile} />
      </Drawer>
    </>
  )
}

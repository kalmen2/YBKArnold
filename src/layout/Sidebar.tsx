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
  Toolbar,
  Typography,
} from '@mui/material'
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
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
  const location = useLocation()
  const navigate = useNavigate()
  const { appUser } = useAuth()

  const canAccessNavItem = (item: NavItem) => {
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
    (item) => !item.adminOnly && !item.adminSection,
  )
  const adminNavItems = visibleNavItems.filter(
    (item) => item.adminOnly || item.adminSection,
  )

  const supportPaths = new Set(['/support', '/pictures'])

  const supportNavItems = regularNavItems.filter((item) => supportPaths.has(item.path))
  const primaryNavItems = regularNavItems.filter((item) => !supportPaths.has(item.path))

  const isPathActive = (path: string) => (
    location.pathname === path
    || location.pathname.startsWith(`${path}/`)
  )

  const isSupportRouteActive = supportNavItems.some((item) => isPathActive(item.path))
  const isAdminRouteActive = adminNavItems.some((item) => isPathActive(item.path))

  const [supportExpanded, setSupportExpanded] = useState(isSupportRouteActive)
  const [adminExpanded, setAdminExpanded] = useState(isAdminRouteActive)
  const supportGroupExpanded = supportExpanded || isSupportRouteActive
  const adminGroupExpanded = adminExpanded || isAdminRouteActive

  const renderItem = (path: string, label: string, Icon: (typeof navItems)[number]['icon'], nested = false) => {
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
            borderRadius: 1.5,
            justifyContent: showText ? 'flex-start' : 'center',
            px: showText ? 1.5 : 1.25,
            pl: showText && nested ? 3 : undefined,
          }}
        >
          <ListItemIcon
            sx={{
              minWidth: 0,
              justifyContent: 'center',
              mr: showText ? 1.5 : 0,
            }}
          >
            <Icon fontSize="small" />
          </ListItemIcon>

          <ListItemText
            primary={label}
            sx={{
              display: showText ? 'block' : 'none',
              '& .MuiListItemText-primary': {
                fontSize: 14,
                fontWeight: 500,
              },
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
              borderRadius: 1.5,
              px: 1.5,
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: 0,
                justifyContent: 'center',
                mr: 1.5,
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
            {items.map((item) => renderItem(item.path, item.label, item.icon, true))}
          </List>
        </Collapse>
      </>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ px: 2 }}>
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 700,
            whiteSpace: 'nowrap',
            opacity: showText ? 1 : 0,
            transition: 'opacity 160ms ease',
          }}
        >
          YBK Arnold
        </Typography>
      </Toolbar>

      <Divider />

      <List sx={{ px: 1, py: 1.5 }}>
        {!showText
          ? visibleNavItems.map((item) => renderItem(item.path, item.label, item.icon))
          : null}

        {showText
          ? primaryNavItems.map((item) => renderItem(item.path, item.label, item.icon))
          : null}

        {showText
          ? renderGroup(
            'Support',
            SupportAgentRoundedIcon,
            supportNavItems,
            supportGroupExpanded,
            () => {
              setSupportExpanded((current) => !current)
            },
            isSupportRouteActive,
          )
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
            borderColor: 'divider',
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
            borderColor: 'divider',
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
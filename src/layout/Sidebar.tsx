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
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { navItems } from '../navigation/navItems'

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
  const regularNavItems = navItems.filter((item) => !item.adminOnly)
  const adminNavItems = navItems.filter((item) => item.adminOnly && appUser?.isAdmin)
  const [adminExpanded, setAdminExpanded] = useState(location.pathname.startsWith('/admin/'))

  useEffect(() => {
    if (location.pathname.startsWith('/admin/')) {
      setAdminExpanded(true)
    }
  }, [location.pathname])

  const renderItem = (path: string, label: string, Icon: (typeof navItems)[number]['icon'], nested = false) => {
    const isSelected =
      location.pathname === path
      || location.pathname.startsWith(`${path}/`)

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

  const flatNavItems = navItems.filter((item) => !item.adminOnly || appUser?.isAdmin)

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
          ? flatNavItems.map((item) => renderItem(item.path, item.label, item.icon))
          : null}

        {showText
          ? regularNavItems.map((item) => renderItem(item.path, item.label, item.icon))
          : null}

        {showText && adminNavItems.length > 0 ? (
          <>
            <ListItem disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                onClick={() => {
                  setAdminExpanded((current) => !current)
                }}
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
                  {adminExpanded ? (
                    <KeyboardArrowDownRoundedIcon fontSize="small" />
                  ) : (
                    <KeyboardArrowRightRoundedIcon fontSize="small" />
                  )}
                </ListItemIcon>

                <ListItemText
                  primary="Admin"
                  sx={{
                    '& .MuiListItemText-primary': {
                      fontSize: 14,
                      fontWeight: 600,
                    },
                  }}
                />
              </ListItemButton>
            </ListItem>

            <Collapse in={adminExpanded} timeout="auto" unmountOnExit>
              <List disablePadding>
                {adminNavItems.map((item) => renderItem(item.path, item.label, item.icon, true))}
              </List>
            </Collapse>
          </>
        ) : null}
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
import {
  Box,
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
  const visibleNavItems = navItems.filter(
    (item) => !item.adminOnly || appUser?.isAdmin,
  )

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
        {visibleNavItems.map((item) => {
          const isSelected =
            location.pathname === item.path ||
            location.pathname.startsWith(`${item.path}/`)
          const Icon = item.icon

          return (
            <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                selected={isSelected}
                onClick={() => {
                  navigate(item.path)
                  onNavigate?.()
                }}
                sx={{
                  minHeight: 44,
                  borderRadius: 1.5,
                  justifyContent: showText ? 'flex-start' : 'center',
                  px: showText ? 1.5 : 1.25,
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
                  primary={item.label}
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
        })}
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
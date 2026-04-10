import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import type { ElementType } from 'react'

export type NavItem = {
  label: string
  path: string
  icon: ElementType
  adminOnly?: boolean
}

export const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: DashboardRoundedIcon,
  },
  {
    label: 'Work Sheet',
    path: '/timesheet',
    icon: TableChartRoundedIcon,
  },
  {
    label: 'Support',
    path: '/support',
    icon: SupportAgentRoundedIcon,
  },
  {
    label: 'Pictures',
    path: '/pictures',
    icon: PhotoLibraryRoundedIcon,
  },
  {
    label: 'Settings',
    path: '/settings',
    icon: SettingsRoundedIcon,
  },
  {
    label: 'Admin Users',
    path: '/admin/users',
    icon: AdminPanelSettingsRoundedIcon,
    adminOnly: true,
  },
]
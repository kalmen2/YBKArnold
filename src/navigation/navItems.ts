import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import type { ElementType } from 'react'

export type NavItem = {
  label: string
  path: string
  icon: ElementType
}

export const navItems: NavItem[] = [
  {
    label: 'Work Sheet',
    path: '/timesheet',
    icon: TableChartRoundedIcon,
  },
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: DashboardRoundedIcon,
  },
  {
    label: 'Settings',
    path: '/settings',
    icon: SettingsRoundedIcon,
  },
]
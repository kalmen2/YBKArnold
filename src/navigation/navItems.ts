import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import type { ElementType } from 'react'

export type NavItem = {
  label: string
  path: string
  icon: ElementType
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
    label: 'Settings',
    path: '/settings',
    icon: SettingsRoundedIcon,
  },
]
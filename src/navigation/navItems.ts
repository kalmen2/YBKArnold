import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import ContactsRoundedIcon from '@mui/icons-material/ContactsRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import GroupRoundedIcon from '@mui/icons-material/GroupRounded'
import ManageHistoryRoundedIcon from '@mui/icons-material/ManageHistoryRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import StoreRoundedIcon from '@mui/icons-material/StoreRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import type { ElementType } from 'react'

export type NavItem = {
  label: string
  path: string
  icon: ElementType
  adminOnly?: boolean
  managerOnly?: boolean
  managerOrAdminOnly?: boolean
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
    label: 'Workers',
    path: '/workers',
    icon: GroupRoundedIcon,
  },
  {
    label: 'QuickBooks',
    path: '/quickbooks',
    icon: AccountBalanceRoundedIcon,
    managerOrAdminOnly: true,
  },
  {
    label: 'Reports',
    path: '/reports',
    icon: TrendingUpRoundedIcon,
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
    label: 'Users',
    path: '/admin/users',
    icon: AdminPanelSettingsRoundedIcon,
    adminOnly: true,
  },
  {
    label: 'Notifications',
    path: '/admin/alerts',
    icon: NotificationsActiveRoundedIcon,
    adminOnly: true,
  },
  {
    label: 'Logs',
    path: '/admin/logs',
    icon: ManageHistoryRoundedIcon,
    adminOnly: true,
  },
  {
    label: 'CRM Control',
    path: '/admin/crm',
    icon: BusinessRoundedIcon,
    adminOnly: true,
  },
  {
    label: 'Contacts',
    path: '/admin/crm/contacts',
    icon: ContactsRoundedIcon,
  },
  {
    label: 'Dealers',
    path: '/admin/crm/dealers',
    icon: StoreRoundedIcon,
  },
]
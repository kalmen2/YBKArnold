import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import ManageHistoryRoundedIcon from '@mui/icons-material/ManageHistoryRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import ReportProblemRoundedIcon from '@mui/icons-material/ReportProblemRounded'
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded'
import StoreRoundedIcon from '@mui/icons-material/StoreRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import type { ElementType } from 'react'

export type NavItem = {
  label: string
  path: string
  icon: ElementType
  adminOnly?: boolean
  adminSection?: boolean
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
    label: 'QuickBooks',
    path: '/quickbooks',
    icon: AccountBalanceRoundedIcon,
    adminSection: true,
    managerOrAdminOnly: true,
  },
  {
    label: 'Reports',
    path: '/reports',
    icon: TrendingUpRoundedIcon,
  },
  {
    label: 'Orders',
    path: '/orders',
    icon: Inventory2RoundedIcon,
  },
  {
    label: 'Templates',
    path: '/templates',
    icon: DescriptionRoundedIcon,
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
    label: 'Issues',
    path: '/admin/issues',
    icon: ReportProblemRoundedIcon,
    adminOnly: true,
  },
  {
    label: 'Logs',
    path: '/admin/logs',
    icon: ManageHistoryRoundedIcon,
    adminOnly: true,
  },
  {
    label: 'Sales Review',
    path: '/admin/sales-review',
    icon: FactCheckRoundedIcon,
    adminOnly: true,
  },
  {
    label: 'CRM Control',
    path: '/admin/crm',
    icon: BusinessRoundedIcon,
    adminOnly: true,
  },
  {
    label: 'AI Config',
    path: '/admin/ai-config',
    icon: SmartToyRoundedIcon,
    adminOnly: true,
  },
  {
    label: 'Sales',
    path: '/sales',
    icon: StoreRoundedIcon,
  },
  {
    label: 'Purchasing',
    path: '/purchasing',
    icon: ShoppingCartRoundedIcon,
  },
]
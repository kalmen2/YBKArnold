import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import ApiRoundedIcon from '@mui/icons-material/ApiRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import StoreRoundedIcon from '@mui/icons-material/StoreRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import PaidRoundedIcon from '@mui/icons-material/PaidRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
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
    label: 'Reports',
    path: '/reports',
    icon: TrendingUpRoundedIcon,
    adminSection: true,
    adminOnly: true,
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
    label: 'Visitors',
    path: '/visitors',
    icon: FactCheckRoundedIcon,
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
    label: 'Notifications',
    path: '/admin/alerts',
    icon: NotificationsActiveRoundedIcon,
  },
  {
    label: 'API',
    path: '/admin/api',
    icon: ApiRoundedIcon,
    adminOnly: true,
    adminSection: true,
  },
  {
    label: 'Admin Settings',
    path: '/admin/settings',
    icon: AdminPanelSettingsRoundedIcon,
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
  {
    label: 'Operating Costs',
    path: '/admin/operating-costs',
    icon: PaidRoundedIcon,
    adminOnly: true,
  },
]
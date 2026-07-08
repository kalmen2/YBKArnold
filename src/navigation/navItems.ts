import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import ApiRoundedIcon from '@mui/icons-material/ApiRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import ForumRoundedIcon from '@mui/icons-material/ForumRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import MarkEmailUnreadRoundedIcon from '@mui/icons-material/MarkEmailUnreadRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import StoreRoundedIcon from '@mui/icons-material/StoreRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import PaidRoundedIcon from '@mui/icons-material/PaidRounded'
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
    label: 'Orders',
    path: '/orders',
    icon: Inventory2RoundedIcon,
  },
  {
    label: 'Worksheet',
    path: '/timesheet',
    icon: TableChartRoundedIcon,
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
    label: 'Config',
    path: '/config',
    icon: SettingsRoundedIcon,
  },
  {
    label: 'Notifications',
    path: '/notifications',
    icon: NotificationsActiveRoundedIcon,
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
    label: 'Admin Settings',
    path: '/admin/settings',
    icon: AdminPanelSettingsRoundedIcon,
    adminOnly: true,
  },
  {
    label: 'AI Council',
    path: '/admin/settings?tab=ai-council',
    icon: ForumRoundedIcon,
    adminOnly: true,
    adminSection: true,
  },
  {
    label: 'Admin Email',
    path: '/admin/email',
    icon: MarkEmailUnreadRoundedIcon,
    adminOnly: true,
    adminSection: true,
  },
  {
    label: 'Reports',
    path: '/reports',
    icon: TrendingUpRoundedIcon,
    adminSection: true,
    adminOnly: true,
  },
  {
    label: 'API',
    path: '/admin/api',
    icon: ApiRoundedIcon,
    adminOnly: true,
    adminSection: true,
  },
  {
    label: 'Operating Costs',
    path: '/admin/operating-costs',
    icon: PaidRoundedIcon,
    adminOnly: true,
  },
]

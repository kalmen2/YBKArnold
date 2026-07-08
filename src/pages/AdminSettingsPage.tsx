import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import AlternateEmailRoundedIcon from '@mui/icons-material/AlternateEmailRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import ForumRoundedIcon from '@mui/icons-material/ForumRounded'
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import ManageHistoryRoundedIcon from '@mui/icons-material/ManageHistoryRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import SmsRoundedIcon from '@mui/icons-material/SmsRounded'
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded'
import SupervisedUserCircleRoundedIcon from '@mui/icons-material/SupervisedUserCircleRounded'
import { Box, Paper, Stack, Tab, Tabs, Typography } from '@mui/material'
import { Suspense, lazy, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const AdminUsersPage = lazy(() => import('./AdminUsersPage'))
const AdminLogsPage = lazy(() => import('./AdminLogsPage'))
const AdminAlertsPage = lazy(() => import('./AdminAlertsPage'))
const AdminVisitorsPage = lazy(() => import('./AdminVisitorsPage'))
const AdminEmailSettingsPage = lazy(() => import('./AdminEmailSettingsPage'))
const AdminSmsBridgePage = lazy(() => import('./AdminSmsBridgePage'))
const AdminSalesReviewPage = lazy(() => import('./AdminSalesReviewPage'))
const AiConfigPage = lazy(() => import('./AiConfigPage'))
const AdminAiCouncilPage = lazy(() => import('./AdminAiCouncilPage'))

type AdminSettingsTab =
  | 'users'
  | 'logs'
  | 'notifications'
  | 'visitors'
  | 'email'
  | 'ai-config'
  | 'ai-council'
  | 'sms-bridge'
  | 'sales-review'

const adminSettingsTabs: Array<{
  value: AdminSettingsTab
  label: string
  icon: typeof SupervisedUserCircleRoundedIcon
}> = [
  {
    value: 'users',
    label: 'Users',
    icon: SupervisedUserCircleRoundedIcon,
  },
  {
    value: 'logs',
    label: 'Logs',
    icon: ManageHistoryRoundedIcon,
  },
  {
    value: 'notifications',
    label: 'Notifications',
    icon: NotificationsActiveRoundedIcon,
  },
  {
    value: 'visitors',
    label: 'Visitors',
    icon: PeopleAltRoundedIcon,
  },
  {
    value: 'email',
    label: 'Email',
    icon: AlternateEmailRoundedIcon,
  },
  {
    value: 'ai-config',
    label: 'AI Config',
    icon: SmartToyRoundedIcon,
  },
  {
    value: 'ai-council',
    label: 'AI Council',
    icon: ForumRoundedIcon,
  },
  {
    value: 'sms-bridge',
    label: 'SMS Bridge',
    icon: SmsRoundedIcon,
  },
  {
    value: 'sales-review',
    label: 'Sales Review',
    icon: FactCheckRoundedIcon,
  },
]

function getTabFromQuery(rawTab: string | null): AdminSettingsTab {
  if (
    rawTab === 'users'
    || rawTab === 'logs'
    || rawTab === 'notifications'
    || rawTab === 'visitors'
    || rawTab === 'email'
    || rawTab === 'ai-config'
    || rawTab === 'ai-council'
    || rawTab === 'sms-bridge'
    || rawTab === 'sales-review'
  ) {
    return rawTab
  }

  return 'users'
}

function renderAdminSettingsTab(selectedTab: AdminSettingsTab) {
  if (selectedTab === 'users') {
    return <AdminUsersPage />
  }

  if (selectedTab === 'logs') {
    return <AdminLogsPage />
  }

  if (selectedTab === 'notifications') {
    return <AdminAlertsPage />
  }

  if (selectedTab === 'visitors') {
    return <AdminVisitorsPage />
  }

  if (selectedTab === 'email') {
    return <AdminEmailSettingsPage />
  }

  if (selectedTab === 'ai-config') {
    return <AiConfigPage />
  }

  if (selectedTab === 'ai-council') {
    return <AdminAiCouncilPage />
  }

  if (selectedTab === 'sms-bridge') {
    return <AdminSmsBridgePage />
  }

  return <AdminSalesReviewPage />
}

export default function AdminSettingsPage() {
  const location = useLocation()
  const navigate = useNavigate()

  const selectedTab = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return getTabFromQuery(params.get('tab'))
  }, [location.search])

  const handleTabChange = (nextTab: AdminSettingsTab) => {
    const params = new URLSearchParams(location.search)
    params.set('tab', nextTab)
    navigate(`/admin/settings?${params.toString()}`, { replace: true })
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.2} alignItems="center">
            <AdminPanelSettingsRoundedIcon color="primary" />
            <Box>
              <Typography variant="h5" fontWeight={700}>
                Admin Settings
              </Typography>
              <Typography color="text.secondary">
                Manage users, notifications, visitors, logs, email integrations, SMS bridge activity, and sales review in one place.
              </Typography>
            </Box>
          </Stack>

          <Tabs
            value={selectedTab}
            variant="scrollable"
            scrollButtons="auto"
            onChange={(_, value) => {
              handleTabChange(value as AdminSettingsTab)
            }}
          >
            {adminSettingsTabs.map((tab) => {
              const Icon = tab.icon

              return (
                <Tab
                  key={tab.value}
                  value={tab.value}
                  label={tab.label}
                  icon={<Icon fontSize="small" />}
                  iconPosition="start"
                />
              )
            })}
          </Tabs>
        </Stack>
      </Paper>

      <Suspense
        fallback={(
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography color="text.secondary">Loading settings tab...</Typography>
          </Paper>
        )}
      >
        {renderAdminSettingsTab(selectedTab)}
      </Suspense>
    </Stack>
  )
}

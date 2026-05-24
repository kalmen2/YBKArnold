import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import ManageHistoryRoundedIcon from '@mui/icons-material/ManageHistoryRounded'
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded'
import SupervisedUserCircleRoundedIcon from '@mui/icons-material/SupervisedUserCircleRounded'
import { Box, Paper, Stack, Tab, Tabs, Typography } from '@mui/material'
import { Suspense, lazy, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const AdminUsersPage = lazy(() => import('./AdminUsersPage'))
const AdminLogsPage = lazy(() => import('./AdminLogsPage'))
const AdminVisitorsPage = lazy(() => import('./AdminVisitorsPage'))
const AiConfigPage = lazy(() => import('./AiConfigPage'))
const AdminSalesReviewPage = lazy(() => import('./AdminSalesReviewPage'))

type AdminSettingsTab = 'users' | 'logs' | 'visitors' | 'ai' | 'sales-review'

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
    value: 'visitors',
    label: 'Visitors',
    icon: PeopleAltRoundedIcon,
  },
  {
    value: 'ai',
    label: 'AI Config',
    icon: SmartToyRoundedIcon,
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
    || rawTab === 'visitors'
    || rawTab === 'ai'
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

  if (selectedTab === 'visitors') {
    return <AdminVisitorsPage />
  }

  if (selectedTab === 'ai') {
    return <AiConfigPage />
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
                Manage users, visitors, logs, and AI configuration in one place.
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

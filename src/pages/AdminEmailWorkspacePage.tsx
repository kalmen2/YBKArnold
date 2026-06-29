import AlternateEmailRoundedIcon from '@mui/icons-material/AlternateEmailRounded'
import MarkEmailUnreadRoundedIcon from '@mui/icons-material/MarkEmailUnreadRounded'
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded'
import { Box, Paper, Stack, Tab, Tabs, Typography } from '@mui/material'
import { Suspense, lazy, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const AdminEmailReviewPage = lazy(() => import('./AdminEmailReviewPage'))
const AdminEmailAiConfigPage = lazy(() => import('./AdminEmailAiConfigPage'))

type AdminEmailTab = 'email-review' | 'ai-config'

const adminEmailTabs: Array<{
  value: AdminEmailTab
  label: string
  icon: typeof MarkEmailUnreadRoundedIcon
}> = [
  {
    value: 'email-review',
    label: 'Email Review',
    icon: MarkEmailUnreadRoundedIcon,
  },
  {
    value: 'ai-config',
    label: 'AI Config',
    icon: SmartToyRoundedIcon,
  },
]

function getTabFromQuery(rawTab: string | null): AdminEmailTab {
  if (rawTab === 'email-review' || rawTab === 'ai-config') {
    return rawTab
  }

  return 'email-review'
}

function renderAdminEmailTab(selectedTab: AdminEmailTab) {
  if (selectedTab === 'ai-config') {
    return <AdminEmailAiConfigPage />
  }

  return <AdminEmailReviewPage />
}

export default function AdminEmailWorkspacePage() {
  const location = useLocation()
  const navigate = useNavigate()

  const selectedTab = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return getTabFromQuery(params.get('tab'))
  }, [location.search])

  const handleTabChange = (nextTab: AdminEmailTab) => {
    const params = new URLSearchParams(location.search)
    params.set('tab', nextTab)
    navigate(`/admin/email?${params.toString()}`, { replace: true })
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.2} alignItems="center">
            <AlternateEmailRoundedIcon color="primary" />
            <Box>
              <Typography variant="h5" fontWeight={700}>
                Admin Email
              </Typography>
              <Typography color="text.secondary">
                Review mailbox intake triage and manage email-intake AI rules.
              </Typography>
            </Box>
          </Stack>

          <Tabs
            value={selectedTab}
            variant="scrollable"
            scrollButtons="auto"
            onChange={(_, value) => {
              handleTabChange(value as AdminEmailTab)
            }}
          >
            {adminEmailTabs.map((tab) => {
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
            <Typography color="text.secondary">Loading admin email workspace...</Typography>
          </Paper>
        )}
      >
        {renderAdminEmailTab(selectedTab)}
      </Suspense>
    </Stack>
  )
}

import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined'
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined'
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined'
import PeopleOutlineRoundedIcon from '@mui/icons-material/PeopleOutlineRounded'
import TextSnippetOutlinedIcon from '@mui/icons-material/TextSnippetOutlined'
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, Typography } from '@mui/material'
import { Suspense, lazy, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const TemplatesPage = lazy(() => import('./TemplatesPage'))
const VisitorsPage = lazy(() => import('./VisitorsPage'))
const QuoteReminderSettingsPage = lazy(() => import('./QuoteReminderSettingsPage'))
const ReportIssuePage = lazy(() => import('./ReportIssuePage'))
const DocumentTermsPage = lazy(() => import('./DocumentTermsPage'))

type ConfigTab = 'templates' | 'terms' | 'visitors' | 'quote-reminders' | 'report-issue'

const configTabs: Array<{
  value: ConfigTab
  label: string
  icon: typeof ArticleOutlinedIcon
}> = [
  {
    value: 'visitors',
    label: 'Visitors',
    icon: PeopleOutlineRoundedIcon,
  },
  {
    value: 'templates',
    label: 'Templates',
    icon: ArticleOutlinedIcon,
  },
  {
    value: 'terms',
    label: 'Terms & Conditions',
    icon: TextSnippetOutlinedIcon,
  },
  {
    value: 'quote-reminders',
    label: 'Reminders',
    icon: NotificationsNoneOutlinedIcon,
  },
  {
    value: 'report-issue',
    label: 'Report Issue',
    icon: BugReportOutlinedIcon,
  },
]

function getConfigTabFromQuery(rawTab: string | null): ConfigTab {
  if (rawTab === 'templates') {
    return 'templates'
  }

  if (rawTab === 'quote-reminders') {
    return 'quote-reminders'
  }

  if (rawTab === 'terms') {
    return 'terms'
  }

  if (rawTab === 'report-issue') {
    return 'report-issue'
  }

  return 'visitors'
}

export default function ConfigPage() {
  const location = useLocation()
  const navigate = useNavigate()

  const selectedTab = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return getConfigTabFromQuery(params.get('tab'))
  }, [location.search])

  const handleTabChange = (nextTab: ConfigTab) => {
    const params = new URLSearchParams(location.search)
    params.set('tab', nextTab)
    navigate(`/config?${params.toString()}`, { replace: true })
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '240px minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
      <Paper variant="outlined" sx={{ position: { md: 'sticky' }, top: { md: 16 }, overflow: 'hidden' }}>
        <Stack sx={{ p: 2, pb: 1 }}>
          <Typography variant="h6" fontWeight={800}>Configuration</Typography>
          <Typography variant="body2" color="text.secondary">Website settings</Typography>
        </Stack>
        <List component="nav" sx={{ px: 1, pb: 1 }}>
          {configTabs.map((item) => {
            const Icon = item.icon
            return (
              <ListItemButton
                key={item.value}
                selected={selectedTab === item.value}
                onClick={() => handleTabChange(item.value)}
                sx={{ borderRadius: 1.5, mb: 0.4 }}
              >
                <ListItemIcon sx={{ minWidth: 38 }}><Icon fontSize="small" /></ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            )
          })}
        </List>
      </Paper>

      <Box sx={{ minWidth: 0 }}>
        <Suspense
          fallback={(
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography color="text.secondary">Loading config section...</Typography>
            </Paper>
          )}
        >
          {selectedTab === 'templates'
            ? <TemplatesPage />
            : selectedTab === 'terms'
              ? <DocumentTermsPage />
              : selectedTab === 'quote-reminders'
                ? <QuoteReminderSettingsPage />
                : selectedTab === 'report-issue'
                  ? <ReportIssuePage />
                  : <VisitorsPage />}
        </Suspense>
      </Box>
    </Box>
  )
}

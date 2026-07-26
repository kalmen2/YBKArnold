import { Paper, Stack, Tab, Tabs, Typography } from '@mui/material'
import { Suspense, lazy, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const TemplatesPage = lazy(() => import('./TemplatesPage'))
const VisitorsPage = lazy(() => import('./VisitorsPage'))
const QuoteReminderSettingsPage = lazy(() => import('./QuoteReminderSettingsPage'))

type ConfigTab = 'templates' | 'visitors' | 'quote-reminders'

const configTabs: Array<{
  value: ConfigTab
  label: string
}> = [
  {
    value: 'visitors',
    label: 'Visitors',
  },
  {
    value: 'templates',
    label: 'Templates',
  },
  {
    value: 'quote-reminders',
    label: 'Reminders',
  },
]

function getConfigTabFromQuery(rawTab: string | null): ConfigTab {
  if (rawTab === 'templates') {
    return 'templates'
  }

  if (rawTab === 'quote-reminders') {
    return 'quote-reminders'
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
    <Stack spacing={2}>
      <Tabs
        value={selectedTab}
        variant="scrollable"
        scrollButtons="auto"
        onChange={(_, value) => {
          handleTabChange(value as ConfigTab)
        }}
      >
        {configTabs.map((tab) => {
          return (
            <Tab
              key={tab.value}
              value={tab.value}
              label={tab.label}
            />
          )
        })}
      </Tabs>

      <Suspense
        fallback={(
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography color="text.secondary">Loading config tab...</Typography>
          </Paper>
        )}
      >
        {selectedTab === 'templates'
          ? <TemplatesPage />
          : selectedTab === 'quote-reminders'
            ? <QuoteReminderSettingsPage />
            : <VisitorsPage />}
      </Suspense>
    </Stack>
  )
}

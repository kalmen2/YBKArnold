import { Paper, Stack, Tab, Tabs, Typography } from '@mui/material'
import { Suspense, lazy, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const TemplatesPage = lazy(() => import('./TemplatesPage'))
const VisitorsPage = lazy(() => import('./VisitorsPage'))

type ConfigTab = 'templates' | 'visitors'

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
]

function getConfigTabFromQuery(rawTab: string | null): ConfigTab {
  if (rawTab === 'templates') {
    return 'templates'
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
        {selectedTab === 'templates' ? <TemplatesPage /> : <VisitorsPage />}
      </Suspense>
    </Stack>
  )
}

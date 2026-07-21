import StoreRoundedIcon from '@mui/icons-material/StoreRounded'
import MapRoundedIcon from '@mui/icons-material/MapRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import { Box, CircularProgress, Stack, Tab, Tabs, Typography } from '@mui/material'
import { lazy, Suspense, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

const CrmDealersPage = lazy(() => import('./CrmDealersPage'))
const CrmContactsPage = lazy(() => import('./CrmContactsPage'))
const SalesOpportunitiesPage = lazy(() => import('./SalesOpportunitiesPage'))
const SalesQuotesPage = lazy(() => import('./SalesQuotesPage'))
const SalesQuoteLayoutPage = lazy(() => import('./SalesQuoteLayoutPage'))
const SalesRepsPage = lazy(() => import('./SalesRepsPage'))

type SalesTab = 'dealers' | 'contacts' | 'opportunities' | 'quotes' | 'quote-layout' | 'sales-reps'

function resolveFallbackTab(allowedTabs: SalesTab[]): SalesTab {
  return allowedTabs.includes('opportunities')
    ? 'opportunities'
    : 'dealers'
}

function resolveTab(value: string | null, allowedTabs: SalesTab[]): SalesTab {
  const allowedTabSet = new Set(allowedTabs)
  const fallbackTab = resolveFallbackTab(allowedTabs)

  // Keep compatibility with both current (`dealers`) and legacy (`accounts`) query values.
  if (value === 'dealers' || value === 'accounts') {
    return allowedTabSet.has('dealers') ? 'dealers' : fallbackTab
  }

  if (value === 'contacts') {
    return allowedTabSet.has('contacts') ? 'contacts' : fallbackTab
  }

  if (value === 'opportunities') {
    return allowedTabSet.has('opportunities') ? 'opportunities' : fallbackTab
  }

  if (value === 'quotes') {
    return allowedTabSet.has('quotes') ? 'quotes' : fallbackTab
  }

  if (value === 'quote-layout') {
    return allowedTabSet.has('quote-layout') ? 'quote-layout' : fallbackTab
  }

  if (value === 'sales-reps') {
    return allowedTabSet.has('sales-reps') ? 'sales-reps' : fallbackTab
  }

  return fallbackTab
}

export default function SalesPage() {
  const { appUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const allowedTabs = useMemo<SalesTab[]>(() => {
    if (appUser?.isSalesRep) {
      return ['dealers', 'contacts', 'opportunities', 'quote-layout']
    }

    return ['dealers', 'contacts', 'opportunities', 'quotes', 'quote-layout', 'sales-reps']
  }, [appUser?.isSalesRep])
  const activeTab = resolveTab(searchParams.get('tab'), allowedTabs)
  const visibleTab = activeTab === 'contacts'
    ? 'dealers'
    : activeTab === 'quote-layout'
      ? 'opportunities'
      : activeTab

  function handleTabChange(_: React.SyntheticEvent, value: SalesTab) {
    setSearchParams({ tab: value }, { replace: true })
  }

  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2.5 }}>
        <Tabs
          value={visibleTab}
          onChange={handleTabChange}
          sx={{ minHeight: 44 }}
        >
          <Tab
            value="opportunities"
            label="Opportunities"
            icon={<WorkspacesRoundedIcon fontSize="small" />}
            iconPosition="start"
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
          />
          {!appUser?.isSalesRep ? (
            <Tab
              value="quotes"
              label="Quotes"
              icon={<LocalOfferRoundedIcon fontSize="small" />}
              iconPosition="start"
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
            />
          ) : null}
          <Tab
            value="dealers"
            label="Accounts"
            icon={<StoreRoundedIcon fontSize="small" />}
            iconPosition="start"
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
          />
          {!appUser?.isSalesRep ? (
            <Tab
              value="sales-reps"
              label="Sales Reps"
              icon={<MapRoundedIcon fontSize="small" />}
              iconPosition="start"
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
            />
          ) : null}
        </Tabs>
      </Box>

      <Suspense fallback={(
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ minHeight: 260 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">Opening Sales workspace...</Typography>
        </Stack>
      )}>
        {activeTab === 'dealers'
          ? <CrmDealersPage />
          : activeTab === 'contacts'
            ? <CrmContactsPage />
            : activeTab === 'opportunities'
              ? <SalesOpportunitiesPage />
              : activeTab === 'quotes'
                ? <>
                    <SalesQuotesPage />
                    {searchParams.get('quoteId') ? <SalesOpportunitiesPage detailsOnly /> : null}
                  </>
              : activeTab === 'quote-layout'
                ? <SalesQuoteLayoutPage />
              : <SalesRepsPage />}
      </Suspense>
    </Box>
  )
}

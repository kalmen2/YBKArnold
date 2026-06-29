import StoreRoundedIcon from '@mui/icons-material/StoreRounded'
import ContactsRoundedIcon from '@mui/icons-material/ContactsRounded'
import MapRoundedIcon from '@mui/icons-material/MapRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import ForumRoundedIcon from '@mui/icons-material/ForumRounded'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import { Box, Tab, Tabs } from '@mui/material'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import CrmDealersPage from './CrmDealersPage'
import CrmContactsPage from './CrmContactsPage'
import SalesEngagementPage from './SalesEngagementPage'
import SalesOpportunitiesPage from './SalesOpportunitiesPage'
import SalesQuotesPage from './SalesQuotesPage'
import SalesRepsPage from './SalesRepsPage'

type SalesTab = 'dealers' | 'contacts' | 'opportunities' | 'quotes' | 'engagement' | 'sales-reps'

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

  if (value === 'engagement') {
    return allowedTabSet.has('engagement') ? 'engagement' : fallbackTab
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
      return ['dealers', 'contacts', 'opportunities', 'engagement']
    }

    return ['dealers', 'contacts', 'opportunities', 'quotes', 'engagement', 'sales-reps']
  }, [appUser?.isSalesRep])
  const activeTab = resolveTab(searchParams.get('tab'), allowedTabs)

  function handleTabChange(_: React.SyntheticEvent, value: SalesTab) {
    setSearchParams({ tab: value }, { replace: true })
  }

  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2.5 }}>
        <Tabs
          value={activeTab}
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
            value="engagement"
            label="Engagement"
            icon={<ForumRoundedIcon fontSize="small" />}
            iconPosition="start"
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
          />
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
          <Tab
            value="contacts"
            label="Contacts"
            icon={<ContactsRoundedIcon fontSize="small" />}
            iconPosition="start"
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
          />
        </Tabs>
      </Box>

      {activeTab === 'dealers'
        ? <CrmDealersPage />
        : activeTab === 'contacts'
          ? <CrmContactsPage />
          : activeTab === 'opportunities'
            ? <SalesOpportunitiesPage />
            : activeTab === 'quotes'
              ? <SalesQuotesPage />
            : activeTab === 'engagement'
              ? <SalesEngagementPage />
              : <SalesRepsPage />}
    </Box>
  )
}

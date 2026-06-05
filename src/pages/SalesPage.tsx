import StoreRoundedIcon from '@mui/icons-material/StoreRounded'
import ContactsRoundedIcon from '@mui/icons-material/ContactsRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import MapRoundedIcon from '@mui/icons-material/MapRounded'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
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

type SalesTab = 'dealers' | 'contacts' | 'engagement' | 'opportunities' | 'sales-reps' | 'quotes'

function resolveTab(value: string | null, allowedTabs: SalesTab[]): SalesTab {
  const allowedTabSet = new Set(allowedTabs)

  if (value === 'contacts') {
    return allowedTabSet.has('contacts') ? 'contacts' : 'dealers'
  }

  if (value === 'opportunities') {
    return allowedTabSet.has('opportunities') ? 'opportunities' : 'dealers'
  }

  if (value === 'sales-reps') {
    return allowedTabSet.has('sales-reps') ? 'sales-reps' : 'dealers'
  }

  if (value === 'quotes') {
    return allowedTabSet.has('quotes') ? 'quotes' : 'dealers'
  }

  if (value === 'engagement') {
    return allowedTabSet.has('engagement') ? 'engagement' : 'dealers'
  }

  return 'dealers'
}

export default function SalesPage() {
  const { appUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const allowedTabs = useMemo<SalesTab[]>(() => {
    if (appUser?.isSalesRep) {
      return ['dealers', 'contacts', 'engagement']
    }

    return ['dealers', 'contacts', 'engagement', 'opportunities', 'sales-reps', 'quotes']
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
            value="dealers"
            label="Accounts"
            icon={<StoreRoundedIcon fontSize="small" />}
            iconPosition="start"
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
          />
          <Tab
            value="contacts"
            label="Contacts"
            icon={<ContactsRoundedIcon fontSize="small" />}
            iconPosition="start"
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
          />
          <Tab
            value="engagement"
            label="Engagement"
            icon={<FactCheckRoundedIcon fontSize="small" />}
            iconPosition="start"
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
          />
          {!appUser?.isSalesRep ? (
            <Tab
              value="opportunities"
              label="Opportunities"
              icon={<WorkspacesRoundedIcon fontSize="small" />}
              iconPosition="start"
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
            />
          ) : null}
          {!appUser?.isSalesRep ? (
            <Tab
              value="sales-reps"
              label="Sales Reps"
              icon={<MapRoundedIcon fontSize="small" />}
              iconPosition="start"
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
            />
          ) : null}
          {!appUser?.isSalesRep ? (
            <Tab
              value="quotes"
              label="Quotes"
              icon={<LocalOfferRoundedIcon fontSize="small" />}
              iconPosition="start"
              sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
            />
          ) : null}
        </Tabs>
      </Box>

      {activeTab === 'dealers'
        ? <CrmDealersPage />
        : activeTab === 'contacts'
          ? <CrmContactsPage />
          : activeTab === 'engagement'
            ? <SalesEngagementPage />
            : activeTab === 'opportunities'
              ? <SalesOpportunitiesPage />
                : activeTab === 'sales-reps'
                  ? <SalesRepsPage />
                  : <SalesQuotesPage />}
    </Box>
  )
}

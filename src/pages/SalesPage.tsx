import StoreRoundedIcon from '@mui/icons-material/StoreRounded'
import ContactsRoundedIcon from '@mui/icons-material/ContactsRounded'
import MapRoundedIcon from '@mui/icons-material/MapRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import { Box, Tab, Tabs } from '@mui/material'
import { useSearchParams } from 'react-router-dom'
import CrmDealersPage from './CrmDealersPage'
import CrmContactsPage from './CrmContactsPage'
import SalesOpportunitiesPage from './SalesOpportunitiesPage'
import SalesRepsPage from './SalesRepsPage'

type SalesTab = 'dealers' | 'contacts' | 'opportunities' | 'sales-reps'

function resolveTab(value: string | null): SalesTab {
  if (value === 'contacts') {
    return 'contacts'
  }

  if (value === 'opportunities') {
    return 'opportunities'
  }

  if (value === 'sales-reps') {
    return 'sales-reps'
  }

  return 'dealers'
}

export default function SalesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveTab(searchParams.get('tab'))

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
            label="Dealers"
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
            value="opportunities"
            label="Opportunities"
            icon={<WorkspacesRoundedIcon fontSize="small" />}
            iconPosition="start"
            sx={{ minHeight: 44, textTransform: 'none', fontWeight: 600, gap: 0.75 }}
          />
          <Tab
            value="sales-reps"
            label="Sales Reps"
            icon={<MapRoundedIcon fontSize="small" />}
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
            : <SalesRepsPage />}
    </Box>
  )
}

// The orders tabs.
//
// Everything that used to sit under them — the heading, two count chips, a
// search box and four filled buttons — moved into the grid's own header row,
// where the view picker already lived. Two bars of controls stacked above one
// table was the problem; this is now just the tabs, plus when it last
// refreshed, sitting above the sheet rather than inside it.
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Box,
  CircularProgress,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import type { OrdersListTab } from './useOrdersOverview'

type OrdersToolbarProps = {
  lastRefreshedAt: string | null
  activeTab: OrdersListTab
  onActiveTabChange: (next: OrdersListTab) => void
  tabCounts: {
    all: number
    orders: number
    design: number
    waitingProduction: number
    shipped: number
    archive: number
  }
  isRefreshing: boolean
  onRefresh: () => void
}

/**
 * Date and time, always. A bare time is ambiguous the moment the sync has been
 * stuck since yesterday, which is exactly when this matters.
 */
function refreshedLabel(value: string | null) {
  const refreshedAt = value ? new Date(value) : null

  if (!refreshedAt || Number.isNaN(refreshedAt.getTime())) {
    return 'Never refreshed'
  }

  const date = refreshedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = refreshedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return `Updated ${date}, ${time}`
}

export function OrdersToolbar({
  lastRefreshedAt,
  activeTab,
  onActiveTabChange,
  tabCounts,
  isRefreshing,
  onRefresh,
}: OrdersToolbarProps) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 0.5 }}>
      <Tabs
        value={activeTab}
        onChange={(_event, nextTab: OrdersListTab) => onActiveTabChange(nextTab)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{
          minHeight: 40,
          '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontWeight: 700 },
        }}
      >
        <Tab value="design" label={`Design (${tabCounts.design})`} />
        <Tab value="waiting_production" label={`Waiting (${tabCounts.waitingProduction})`} />
        <Tab value="orders" label={`Orders (${tabCounts.orders})`} />
        <Tab value="shipped" label={`Shipped (${tabCounts.shipped})`} />
        <Tab value="all" label={`All (${tabCounts.all})`} />
        <Tab value="archive" label={`Archived (${tabCounts.archive})`} />
      </Tabs>

      <Box sx={{ flexGrow: 1 }} />

      <Typography variant="caption" color="text.secondary" noWrap>
        {refreshedLabel(lastRefreshedAt)}
      </Typography>

      <Tooltip title={isRefreshing ? 'Refreshing…' : 'Refresh'}>
        <span>
          <IconButton size="small" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing
              ? <CircularProgress size={17} color="inherit" />
              : <RefreshRoundedIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  )
}

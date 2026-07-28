import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import AddCircleRoundedIcon from '@mui/icons-material/AddCircleRounded'
import {
  Button,
  Chip,
  Divider,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { formatDateTime } from '../../lib/formatters'
import type { OrdersViewMode } from './OrdersGrid'
import type { OrdersListTab } from './useOrdersOverview'

type OrdersToolbarProps = {
  totalRows: number
  lastRefreshedAt: string | null
  activeTab: OrdersListTab
  onActiveTabChange: (next: OrdersListTab) => void
  tabCounts: {
    orders: number
    design: number
    shipped: number
    archive: number
  }
  viewMode: OrdersViewMode
  onViewModeChange: (next: OrdersViewMode) => void
  canUseAdminView: boolean
  canOpenBulkUpdate: boolean
  onOpenBulkUpdate: () => void
  bulkUpdateDisabled: boolean
  canAddOrder: boolean
  onAddOrder: () => void
  addOrderDisabled: boolean
  searchText: string
  onSearchTextChange: (next: string) => void
  isRefreshing: boolean
  onRefresh: () => void
  onExport: () => void
}

export function OrdersToolbar({
  totalRows,
  lastRefreshedAt,
  activeTab,
  onActiveTabChange,
  tabCounts,
  viewMode,
  onViewModeChange,
  canUseAdminView,
  canOpenBulkUpdate,
  onOpenBulkUpdate,
  bulkUpdateDisabled,
  canAddOrder,
  onAddOrder,
  addOrderDisabled,
  searchText,
  onSearchTextChange,
  isRefreshing,
  onRefresh,
  onExport,
}: OrdersToolbarProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 1.5, sm: 2 },
        borderRadius: 2,
        background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.02), rgba(15, 23, 42, 0))',
      }}
    >
      <Stack spacing={1.5}>
        <Tabs
          value={activeTab}
          onChange={(_event, nextTab: OrdersListTab) => {
            onActiveTabChange(nextTab)
          }}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{
            minHeight: 40,
            '& .MuiTab-root': {
              minHeight: 40,
              textTransform: 'none',
              fontWeight: 700,
            },
          }}
        >
          <Tab value="orders" label={`Orders (${tabCounts.orders})`} />
          <Tab value="design" label={`Design (${tabCounts.design})`} />
          <Tab value="shipped" label={`Shipped (${tabCounts.shipped})`} />
          <Tab value="archive" label={`Archive (${tabCounts.archive})`} />
        </Tabs>

        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'flex-start', lg: 'center' }}
          justifyContent="space-between"
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Typography variant="subtitle1" fontWeight={800}>
              Orders Controls
            </Typography>
            <Chip label={`Total orders: ${totalRows}`} color="primary" variant="outlined" />
            <Chip label={`Last refreshed: ${formatDateTime(lastRefreshedAt)}`} size="small" variant="outlined" />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            {canAddOrder ? (
              <Button
                variant="contained"
                color="success"
                startIcon={<AddCircleRoundedIcon />}
                onClick={onAddOrder}
                disabled={addOrderDisabled}
                sx={{ minWidth: 138 }}
              >
                Add order
              </Button>
            ) : null}
            <Button
              variant="contained"
              startIcon={<RefreshRoundedIcon />}
              onClick={onRefresh}
              disabled={isRefreshing}
              sx={{ minWidth: 138 }}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button
              variant="outlined"
              startIcon={<DownloadRoundedIcon />}
              onClick={onExport}
              disabled={totalRows === 0}
              sx={{ minWidth: 138 }}
            >
              Export Excel
            </Button>
          </Stack>
        </Stack>

        <Divider />

        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', lg: 'center' }}
          justifyContent="space-between"
        >
          <TextField
            size="small"
            value={searchText}
            onChange={(event) => {
              onSearchTextChange(event.target.value)
            }}
            placeholder="Search order #, name, invoice, amount..."
            sx={{ width: { xs: '100%', lg: 430 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            {canUseAdminView ? (
              <ToggleButtonGroup
                exclusive
                size="small"
                value={viewMode}
                aria-label="Orders view"
                onChange={(_event, nextView: OrdersViewMode | null) => {
                  if (nextView) {
                    onViewModeChange(nextView)
                  }
                }}
              >
                <ToggleButton value="standard">Standard View</ToggleButton>
                <ToggleButton value="admin">Admin View</ToggleButton>
              </ToggleButtonGroup>
            ) : null}

            {canOpenBulkUpdate ? (
              <Button
                size="small"
                variant="contained"
                startIcon={<EditRoundedIcon fontSize="small" />}
                onClick={onOpenBulkUpdate}
                disabled={bulkUpdateDisabled}
                sx={{ minWidth: 132 }}
              >
                Update orders
              </Button>
            ) : null}
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  )
}

import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Button,
  Chip,
  FormControlLabel,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { formatDateTime } from '../../lib/formatters'

type OrdersToolbarProps = {
  totalRows: number
  lastRefreshedAt: string | null
  includeShipped: boolean
  onIncludeShippedChange: (next: boolean) => void
  searchText: string
  onSearchTextChange: (next: string) => void
  isRefreshing: boolean
  onRefresh: () => void
  onExport: () => void
}

export function OrdersToolbar({
  totalRows,
  lastRefreshedAt,
  includeShipped,
  onIncludeShippedChange,
  searchText,
  onSearchTextChange,
  isRefreshing,
  onRefresh,
  onExport,
}: OrdersToolbarProps) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={2}
      alignItems={{ xs: 'flex-start', md: 'center' }}
      justifyContent="space-between"
    >
      <Chip label={`Total orders: ${totalRows}`} color="primary" variant="outlined" />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
        <TextField
          size="small"
          value={searchText}
          onChange={(event) => {
            onSearchTextChange(event.target.value)
          }}
          placeholder="Search order #, name, invoice, amount..."
          sx={{ width: { xs: '100%', sm: 360 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <Typography variant="body2" color="text.secondary">
          Last refreshed: {formatDateTime(lastRefreshedAt)}
        </Typography>
        <FormControlLabel
          control={(
            <Switch
              checked={includeShipped}
              onChange={(event) => {
                onIncludeShippedChange(event.target.checked)
              }}
            />
          )}
          label="Show shipped orders"
        />
        <Button
          variant="outlined"
          startIcon={<DownloadRoundedIcon />}
          onClick={onExport}
          disabled={totalRows === 0}
        >
          Export Excel
        </Button>
        <Button
          variant="contained"
          startIcon={<RefreshRoundedIcon />}
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Stack>
    </Stack>
  )
}

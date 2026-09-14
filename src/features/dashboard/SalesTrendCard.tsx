import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded'
import TrendingFlatRoundedIcon from '@mui/icons-material/TrendingFlatRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import {
  Alert,
  Box,
  Card,
  Chip,
  Divider,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Chart, ChartLegends, useChart } from '../../components/chart'
import { formatCompactCurrency, formatCurrency } from '../../lib/formatters'
import { QUERY_KEYS } from '../../lib/queryKeys'
import { fetchSalesTrend } from './api'
import {
  availableYears,
  buildSalesTrendView,
  matchPreset,
  MONTH_LABELS,
  resolvePreset,
  SALES_TREND_PRESETS,
  type SalesTrendPeriod,
  type SalesTrendPresetKey,
  type SalesTrendSelection,
} from './salesTrend'

const CHART_HEIGHT = 250
const WHOLE_YEAR = 'year'

function DeltaSubheader({
  percentChange,
  comparisonNoun,
  comparisonLabel,
  hasComparisonData,
}: {
  percentChange: number | null
  comparisonNoun: string
  comparisonLabel: string
  hasComparisonData: boolean
}) {
  if (!hasComparisonData) {
    return (
      <Typography variant="body2" color="text.secondary">
        {`No orders on record for ${comparisonLabel} — nothing to compare against.`}
      </Typography>
    )
  }

  if (percentChange === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        {`No orders in ${comparisonLabel} through this point to compare against.`}
      </Typography>
    )
  }

  const isFlat = Math.abs(percentChange) < 0.05
  const isUp = percentChange > 0
  const color = isFlat ? 'text.secondary' : isUp ? 'success.main' : 'error.main'
  const Icon = isFlat ? TrendingFlatRoundedIcon : isUp ? TrendingUpRoundedIcon : TrendingDownRoundedIcon

  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }}>
      <Icon sx={{ fontSize: 18, color }} />
      <Typography variant="subtitle2" sx={{ color }}>
        {isFlat ? 'Flat' : `${isUp ? '+' : ''}${percentChange.toFixed(1)}%`}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {`vs. ${comparisonNoun}`}
      </Typography>
    </Stack>
  )
}

/** Month + year pair for one side of the comparison. */
function PeriodPicker({
  period,
  years,
  disabled,
  onChange,
}: {
  period: SalesTrendPeriod
  years: number[]
  disabled: boolean
  onChange: (next: SalesTrendPeriod) => void
}) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <TextField
        select
        size="small"
        disabled={disabled}
        value={period.monthIndex === null ? WHOLE_YEAR : String(period.monthIndex)}
        onChange={(event) => onChange({
          ...period,
          monthIndex: event.target.value === WHOLE_YEAR ? null : Number(event.target.value),
        })}
        sx={{ minWidth: 104 }}
      >
        <MenuItem value={WHOLE_YEAR}>Whole year</MenuItem>
        {MONTH_LABELS.map((month, index) => (
          <MenuItem key={month} value={String(index)}>{month}</MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        disabled={disabled}
        value={String(period.year)}
        onChange={(event) => onChange({ ...period, year: Number(event.target.value) })}
        sx={{ minWidth: 84 }}
      >
        {years.map((year) => (
          <MenuItem key={year} value={String(year)}>{year}</MenuItem>
        ))}
      </TextField>
    </Stack>
  )
}

export function SalesTrendCard() {
  const theme = useTheme()
  const [selection, setSelection] = useState<SalesTrendSelection>(
    () => resolvePreset('thisVsLastMonth'),
  )
  const [isCustomRange, setIsCustomRange] = useState(false)

  const salesTrendQuery = useQuery({
    queryKey: QUERY_KEYS.dashboardSalesTrend,
    queryFn: () => fetchSalesTrend(),
  })

  const view = useMemo(
    () => buildSalesTrendView(salesTrendQuery.data, selection),
    [salesTrendQuery.data, selection],
  )
  const years = useMemo(
    () => availableYears(salesTrendQuery.data),
    [salesTrendQuery.data],
  )
  const activePreset = useMemo(() => matchPreset(selection), [selection])

  // Both sides have to share an x-axis, so changing one side's granularity
  // brings the other with it rather than charting days against months.
  function changePeriod(side: 'primary' | 'comparison', next: SalesTrendPeriod) {
    setSelection((previous) => {
      const other = side === 'primary' ? previous.comparison : previous.primary
      const alignedOther = next.monthIndex === null
        ? { ...other, monthIndex: null }
        : { ...other, monthIndex: other.monthIndex ?? next.monthIndex }

      return side === 'primary'
        ? { primary: next, comparison: alignedOther }
        : { primary: alignedOther, comparison: next }
    })
  }

  const chartColors = [theme.palette.primary.main, theme.palette.warning.main]

  const chartOptions = useChart({
    colors: chartColors,
    xaxis: {
      categories: view.categories,
      tooltip: { enabled: false },
    },
    yaxis: {
      labels: { formatter: (value: number) => formatCompactCurrency(value) },
    },
    tooltip: {
      shared: true,
      intersect: false,
      y: { formatter: (value: number) => (value === null ? '—' : formatCurrency(value)) },
      x: {
        // Reads off the point index rather than the axis value so the label is
        // right for both the day-number and month-name category axes.
        formatter: (_value: number, opts?: { dataPointIndex?: number }) => {
          const category = view.categories[opts?.dataPointIndex ?? 0] ?? ''
          return view.granularity === 'year' ? `Through ${category}` : `Through day ${category}`
        },
      },
    },
  })

  const chartSeries = [
    { name: view.activePeriod.label, data: view.activePeriod.values },
    { name: view.comparisonPeriod.label, data: view.comparisonPeriod.values },
  ]

  const hasAnyData = (salesTrendQuery.data?.days?.length ?? 0) > 0
  const missingOrderDateCount = salesTrendQuery.data?.ordersMissingOrderDate ?? 0
  const controlsDisabled = salesTrendQuery.isPending || salesTrendQuery.isError
  const showsPriorOwner = view.activePeriod.isPriorOwner || view.comparisonPeriod.isPriorOwner

  return (
    <Card
      variant="outlined"
      sx={{ borderRadius: '12px', borderColor: 'divider', overflow: 'hidden' }}
    >
      {/* One row: name and change on the left, controls on the right. The
          period pickers only appear once Custom range is chosen, so the card
          stays short in the case that is used almost every time. */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ md: 'center' }}
        justifyContent="space-between"
        sx={{ px: 2.5, py: 1.75 }}
      >
        <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={700}>Sales</Typography>
          {salesTrendQuery.isPending || salesTrendQuery.isError ? null : (
            <DeltaSubheader
              percentChange={view.percentChange}
              comparisonNoun={view.comparisonNoun}
              comparisonLabel={view.comparisonPeriod.label}
              hasComparisonData={view.hasComparisonData}
            />
          )}
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {showsPriorOwner ? (
            <Chip
              size="small"
              variant="outlined"
              label="Includes the previous owner"
              sx={{ height: 22, fontSize: '0.7rem' }}
            />
          ) : null}

          {isCustomRange ? (
            <>
              <PeriodPicker
                period={selection.primary}
                years={years}
                disabled={controlsDisabled}
                onChange={(next) => changePeriod('primary', next)}
              />
              <Typography variant="caption" color="text.secondary">vs</Typography>
              <PeriodPicker
                period={selection.comparison}
                years={years}
                disabled={controlsDisabled}
                onChange={(next) => changePeriod('comparison', next)}
              />
            </>
          ) : null}

          <TextField
            select
            size="small"
            disabled={controlsDisabled}
            value={isCustomRange ? 'custom' : (activePreset ?? 'custom')}
            onChange={(event) => {
              const value = event.target.value

              if (value === 'custom') {
                setIsCustomRange(true)
                return
              }

              setIsCustomRange(false)
              setSelection(resolvePreset(value as SalesTrendPresetKey))
            }}
            sx={{ minWidth: 210 }}
          >
            {SALES_TREND_PRESETS.map((preset) => (
              <MenuItem key={preset.value} value={preset.value}>{preset.label}</MenuItem>
            ))}
            <MenuItem value="custom">Custom range</MenuItem>
          </TextField>
        </Stack>
      </Stack>

      <Divider />

      {salesTrendQuery.isError ? (
        <Box sx={{ px: 3, py: 3 }}>
          <Alert severity="error">
            {(salesTrendQuery.error as Error)?.message || 'Could not load sales trend.'}
          </Alert>
        </Box>
      ) : salesTrendQuery.isPending ? (
        <Box sx={{ px: 3, py: 3 }}>
          <Skeleton variant="rounded" sx={{ width: 1, height: CHART_HEIGHT }} />
        </Box>
      ) : !hasAnyData ? (
        <Box sx={{ px: 3, py: 3 }}>
          <Alert severity="info">
            No orders with an order date have been recorded yet.
          </Alert>
        </Box>
      ) : (
        <>
          <ChartLegends
            colors={chartColors}
            labels={[view.activePeriod.label, view.comparisonPeriod.label]}
            sublabels={[view.currentPeriodNote, view.comparisonPeriodNote]}
            values={[
              formatCompactCurrency(view.activePeriod.total),
              formatCompactCurrency(view.comparisonPeriod.total),
            ]}
            sx={{ px: 2.5, pt: 1.75, gap: 3 }}
          />

          <Chart
            type="area"
            series={chartSeries}
            options={chartOptions}
            slotProps={{ loading: { p: 2.5 } }}
            sx={{ pl: 0.5, py: 1.5, pr: 2, height: CHART_HEIGHT }}
          />

          {missingOrderDateCount > 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 3, pb: 2 }}>
              {missingOrderDateCount === 1
                ? '1 order has no order date and is not counted here.'
                : `${missingOrderDateCount} orders have no order date and are not counted here.`}
            </Typography>
          ) : null}
        </>
      )}
    </Card>
  )
}

import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded'
import TrendingFlatRoundedIcon from '@mui/icons-material/TrendingFlatRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import {
  Alert,
  Box,
  Card,
  CardHeader,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Chart, ChartLegends, ChartSelect, useChart } from '../../components/chart'
import { formatCompactCurrency, formatCurrency } from '../../lib/formatters'
import { QUERY_KEYS } from '../../lib/queryKeys'
import { fetchSalesTrend } from './api'
import {
  buildSalesTrendView,
  SALES_TREND_MODE_OPTIONS,
  type SalesTrendMode,
} from './salesTrend'

const CHART_HEIGHT = 320

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
        {`No orders on record for ${comparisonLabel} — nothing to compare against yet.`}
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

export function SalesTrendCard() {
  const theme = useTheme()
  const [mode, setMode] = useState<SalesTrendMode>('monthOverMonth')

  const salesTrendQuery = useQuery({
    queryKey: QUERY_KEYS.dashboardSalesTrend,
    queryFn: () => fetchSalesTrend(),
  })

  const view = useMemo(
    () => buildSalesTrendView(salesTrendQuery.data, mode),
    [salesTrendQuery.data, mode],
  )

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
          return view.mode === 'yearOverYear' ? `Through ${category}` : `Through day ${category}`
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

  return (
    <Card
      variant="outlined"
      sx={{ borderRadius: '8px', borderColor: 'divider', overflow: 'hidden' }}
    >
      <CardHeader
        title="Sales"
        subheader={
          salesTrendQuery.isPending || salesTrendQuery.isError ? (
            <Typography variant="body2" color="text.secondary">
              Booked order value, cumulative
            </Typography>
          ) : (
            <DeltaSubheader
              percentChange={view.percentChange}
              comparisonNoun={view.comparisonNoun}
              comparisonLabel={view.comparisonPeriod.label}
              hasComparisonData={view.hasComparisonData}
            />
          )
        }
        slotProps={{ subheader: { component: 'div' } }}
        action={(
          <ChartSelect
            options={SALES_TREND_MODE_OPTIONS}
            value={mode}
            onChange={(newValue) => setMode(newValue as SalesTrendMode)}
            disabled={salesTrendQuery.isPending}
          />
        )}
        sx={{ mb: 2.5, alignItems: 'flex-start' }}
      />

      {salesTrendQuery.isError ? (
        <Box sx={{ px: 3, pb: 3 }}>
          <Alert severity="error">
            {(salesTrendQuery.error as Error)?.message || 'Could not load sales trend.'}
          </Alert>
        </Box>
      ) : salesTrendQuery.isPending ? (
        <Box sx={{ px: 3, pb: 3 }}>
          <Skeleton variant="rounded" sx={{ width: 1, height: CHART_HEIGHT }} />
        </Box>
      ) : !hasAnyData ? (
        <Box sx={{ px: 3, pb: 3 }}>
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
            sx={{ px: 3, gap: 3 }}
          />

          <Chart
            type="area"
            series={chartSeries}
            options={chartOptions}
            slotProps={{ loading: { p: 2.5 } }}
            sx={{ pl: 1, py: 2.5, pr: 2.5, height: CHART_HEIGHT }}
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

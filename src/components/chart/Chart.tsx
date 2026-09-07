import { lazy, Suspense } from 'react'
import { Box, Skeleton } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ChartProps } from './types'
import './chart.css'

const ApexChart = lazy(() => import('react-apexcharts'))

function ChartLoading({ sx }: { sx?: SxProps<Theme> }) {
  return (
    <Box sx={[{ width: 1, height: 1, p: 2 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Skeleton variant="rounded" sx={{ width: 1, height: 1 }} />
    </Box>
  )
}

export function Chart({ sx, type, series, slotProps, options = {}, ...other }: ChartProps) {
  return (
    <Box
      dir="ltr"
      sx={[
        { width: 1, flexShrink: 0, position: 'relative' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Suspense fallback={<ChartLoading sx={slotProps?.loading} />}>
        <ApexChart type={type} series={series} options={options} width="100%" height="100%" />
      </Suspense>
    </Box>
  )
}

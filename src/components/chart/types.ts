import type { ApexOptions } from 'apexcharts'
import type { ComponentProps } from 'react'
import type { SxProps, Theme } from '@mui/material/styles'
import type { Props as ApexProps } from 'react-apexcharts'

export type ChartOptions = ApexOptions

export type ChartProps = ComponentProps<'div'>
  & Pick<ApexProps, 'type' | 'series' | 'options'>
  & {
    sx?: SxProps<Theme>
    slotProps?: {
      loading?: SxProps<Theme>
    }
  }

import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import { Box, ButtonBase, Paper, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

export type DashboardMetricCardData<K extends string = string> = {
  key: K
  label: string
  value: number
  helper: string
  icon: ReactNode
  color: string
}

type DashboardMetricCardProps = DashboardMetricCardData & {
  onClick: () => void
}

export function DashboardMetricCard({
  label,
  value,
  helper,
  icon,
  color,
  onClick,
}: DashboardMetricCardProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        height: '100%',
        overflow: 'hidden',
        borderRadius: '8px',
        borderColor: 'divider',
        borderTop: `3px solid ${color}`,
      }}
    >
      <ButtonBase
        onClick={onClick}
        aria-label={`View ${label}`}
        sx={{
          width: '100%',
          height: '100%',
          p: 2,
          display: 'block',
          textAlign: 'left',
          transition: 'background-color 140ms ease',
          '&:hover': { bgcolor: 'action.hover' },
          '&:focus-visible': {
            outline: `2px solid ${color}`,
            outlineOffset: -2,
          },
        }}
      >
        <Stack spacing={1.25} height="100%">
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography
              variant="overline"
              color="text.secondary"
              fontWeight={700}
              sx={{ lineHeight: 1.2, letterSpacing: 0 }}
            >
              {label}
            </Typography>
            <Box sx={{ color, display: 'flex' }}>{icon}</Box>
          </Stack>

          <Typography variant="h3" fontWeight={750} lineHeight={1}>
            {value.toLocaleString()}
          </Typography>

          <Stack direction="row" justifyContent="space-between" alignItems="flex-end" mt="auto">
            <Typography variant="caption" color="text.secondary" sx={{ pr: 1 }}>
              {helper}
            </Typography>
            <ArrowForwardRoundedIcon sx={{ color: 'text.disabled', fontSize: 18, flexShrink: 0 }} />
          </Stack>
        </Stack>
      </ButtonBase>
    </Paper>
  )
}
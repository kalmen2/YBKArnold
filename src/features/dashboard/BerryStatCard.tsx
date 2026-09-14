// The two Berry dashboard card shapes, from its Chart widget page.
//
// BerryStatCard  — the big solid-colour block used for the four headline
//                  numbers. Berry puts a sparkline under it; ours has no
//                  per-KPI history to plot, and the card is designed to render
//                  fine without one.
// BerryMiniCard  — the small white card used for the row of six. Title above,
//                  number below, muted label, exactly as Berry lays it out.
import { Box, ButtonBase, Card, Paper, Skeleton, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import type { ReactNode } from 'react'

/**
 * One dashboard card's contents. `value` is null until the snapshot arrives,
 * which is what lets the card take its final size on the first paint instead of
 * appearing later and shoving everything below it down the page.
 */
export type DashboardCardData<K extends string = string> = {
  key: K
  label: string
  value: number | null
  helper: string
  icon: ReactNode
  color: string
}

export function BerryStatCard({
  value,
  title,
  caption,
  icon,
  bgcolor,
  onClick,
}: {
  /** null while the number is still loading. */
  value: number | null
  title: string
  caption?: string
  icon?: ReactNode
  /** A theme path such as 'primary.dark' — Berry uses solid palette colours. */
  bgcolor: string
  onClick?: () => void
}) {
  return (
    <Card sx={{ borderRadius: '12px', boxShadow: 'none', height: '100%' }}>
      <ButtonBase
        onClick={onClick}
        disabled={value === null}
        sx={{ width: '100%', height: '100%', display: 'block', textAlign: 'left' }}
      >
        <Box
          sx={{
            position: 'relative',
            overflow: 'hidden',
            color: 'common.white',
            bgcolor,
            p: 2.5,
            height: '100%',
          }}
        >
          {/* Berry's soft circles in the corner — what gives these cards depth. */}
          <Box
            sx={{
              position: 'absolute',
              width: 210,
              height: 210,
              borderRadius: '50%',
              top: -85,
              right: -95,
              bgcolor: (theme) => alpha(theme.palette.common.white, 0.12),
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              width: 210,
              height: 210,
              borderRadius: '50%',
              top: -125,
              right: -15,
              bgcolor: (theme) => alpha(theme.palette.common.white, 0.08),
            }}
          />

          <Stack sx={{ position: 'relative' }} spacing={0.5}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              {/* The skeleton sits inside the same Typography, so it is exactly
                  as tall as the number that replaces it and nothing shifts. */}
              <Typography variant="h3" sx={{ color: 'inherit', fontWeight: 700, lineHeight: 1.2 }}>
                {value === null ? (
                  <Skeleton
                    variant="text"
                    width={72}
                    sx={{ bgcolor: (theme) => alpha(theme.palette.common.white, 0.24) }}
                  />
                ) : value.toLocaleString()}
              </Typography>
              {icon ? (
                <Box sx={{ display: 'flex', opacity: 0.85 }}>{icon}</Box>
              ) : null}
            </Stack>

            <Typography variant="body2" sx={{ color: 'inherit', fontWeight: 500 }}>
              {title}
            </Typography>

            {caption ? (
              <Typography variant="caption" sx={{ color: 'inherit', opacity: 0.75 }}>
                {caption}
              </Typography>
            ) : null}
          </Stack>
        </Box>
      </ButtonBase>
    </Card>
  )
}

export function BerryMiniCard({
  value,
  title,
  icon,
  accent,
  onClick,
}: {
  /** null while the number is still loading. */
  value: number | null
  title: string
  icon?: ReactNode
  /** Tints the number when there is something to act on. */
  accent?: string
  onClick?: () => void
}) {
  const isQuiet = value === 0

  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: '12px', height: '100%', overflow: 'hidden', borderColor: 'divider' }}
    >
      <ButtonBase
        onClick={onClick}
        disabled={value === null}
        sx={{
          width: '100%',
          height: '100%',
          display: 'block',
          textAlign: 'left',
          p: 2.5,
          transition: 'background-color 140ms ease',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ color: 'grey.500', flexGrow: 1 }} noWrap>
              {title}
            </Typography>
            {icon ? (
              <Box sx={{ display: 'flex', color: isQuiet ? 'text.disabled' : accent }}>{icon}</Box>
            ) : null}
          </Stack>

          <Typography
            variant="h3"
            sx={{ fontWeight: 700, lineHeight: 1, color: isQuiet ? 'text.disabled' : 'text.primary' }}
          >
            {value === null ? <Skeleton variant="text" width={64} /> : value.toLocaleString()}
          </Typography>
        </Stack>
      </ButtonBase>
    </Paper>
  )
}

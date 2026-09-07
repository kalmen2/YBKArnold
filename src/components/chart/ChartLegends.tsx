import { Box, Stack, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

export type ChartLegendsProps = {
  labels?: string[]
  colors?: string[]
  values?: string[]
  sublabels?: string[]
  sx?: SxProps<Theme>
}

export function ChartLegends({
  labels = [],
  colors = [],
  values = [],
  sublabels = [],
  sx,
}: ChartLegendsProps) {
  return (
    <Box
      component="ul"
      sx={[
        { display: 'flex', flexWrap: 'wrap', gap: 2, listStyle: 'none', m: 0, p: 0 },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {labels.map((label, index) => (
        <Box component="li" key={label} sx={{ display: 'inline-flex', flexDirection: 'column' }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box
              sx={{
                width: 12,
                height: 12,
                flexShrink: 0,
                borderRadius: '50%',
                backgroundColor: colors[index] ?? 'text.disabled',
              }}
            />
            <Typography variant="body2" fontWeight={500} sx={{ flexShrink: 0 }}>
              {label}
              {sublabels[index] ? ` (${sublabels[index]})` : null}
            </Typography>
          </Stack>

          {values[index] ? (
            <Typography variant="h6" sx={{ mt: 1 }}>
              {values[index]}
            </Typography>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}

import { CircularProgress, Paper, Stack, Typography } from '@mui/material'

type LoadingPanelProps = {
  loading: boolean
  message?: string
  size?: number
  contained?: boolean
  padding?: number
}

export function LoadingPanel({
  loading,
  message = 'Loading...',
  size = 22,
  contained = true,
  padding = 3,
}: LoadingPanelProps) {
  if (!loading) return null

  const inner = (
    <Stack direction="row" spacing={1.25} alignItems="center">
      <CircularProgress size={size} />
      <Typography color="text.secondary">{message}</Typography>
    </Stack>
  )

  if (!contained) return inner

  return (
    <Paper variant="outlined" sx={{ p: padding }}>
      {inner}
    </Paper>
  )
}

import { Alert, Stack } from '@mui/material'

type StatusAlertsProps = {
  errorMessage?: string | null
  successMessage?: string | null
}

export function StatusAlerts({ errorMessage, successMessage }: StatusAlertsProps) {
  if (!errorMessage && !successMessage) return null

  return (
    <Stack spacing={1}>
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}
    </Stack>
  )
}

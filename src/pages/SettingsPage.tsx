import { Paper, Stack, Typography } from '@mui/material'

export default function SettingsPage() {
  return (
    <Stack spacing={2.5}>
      <Typography variant="h4" fontWeight={700}>
        Settings
      </Typography>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography color="text.secondary">
         Comming Soon.
        </Typography>
      </Paper>
    </Stack>
  )
}
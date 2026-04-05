import { Paper, Stack, Typography } from '@mui/material'

export default function DashboardPage() {
  return (
    <Stack spacing={2.5}>
      <Typography variant="h4" fontWeight={700}>
        Dashboard
      </Typography>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography color="text.secondary">
          Sidebar foundation is ready. Add Monday.com and Zendesk modules as
          separate pages from here.
        </Typography>
      </Paper>
    </Stack>
  )
}
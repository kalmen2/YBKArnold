import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import ScreenShareOutlinedIcon from '@mui/icons-material/ScreenShareOutlined'
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { useDiagnosticReport } from '../features/diagnostics/DiagnosticReportContext'

export default function ReportIssuePage() {
  const { openDiagnosticReport } = useDiagnosticReport()

  return (
    <Card variant="outlined" sx={{ maxWidth: 760, mx: 'auto', mt: { xs: 1, md: 3 }, borderColor: 'primary.100', boxShadow: '0 18px 50px rgba(30,58,138,.08)' }}>
      <CardContent sx={{ p: { xs: 3, md: 4 } }}>
        <Stack spacing={2.5} alignItems="flex-start">
          <Box sx={{ p: 1.25, borderRadius: 2.5, bgcolor: 'primary.50', color: 'primary.main', display: 'flex' }}><ReportProblemOutlinedIcon /></Box>
          <Box>
            <Typography variant="h5" fontWeight={750} mb={.75}>Report an issue</Typography>
            <Typography color="text.secondary">Record the problem while it happens. The screen recording, browser logs, actions, network requests, API responses, and server request results will be sent securely to an administrator.</Typography>
          </Box>
          <Box sx={{ p: 2, width: '100%', borderRadius: 2, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" fontWeight={750} mb={.5}>Before you begin</Typography>
            <Typography variant="body2" color="text.secondary">Briefly describe what is wrong, start the capture, reproduce the issue, then select “Stop &amp; review.”</Typography>
          </Box>
          <Button variant="contained" size="large" startIcon={<ScreenShareOutlinedIcon />} onClick={() => openDiagnosticReport({ area: 'General application issue', action: 'General issue report' })} sx={{ textTransform: 'none', px: 2.5 }}>Start issue report</Button>
        </Stack>
      </CardContent>
    </Card>
  )
}

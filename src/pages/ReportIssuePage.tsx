import RefreshIcon from '@mui/icons-material/Refresh'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import ScreenShareOutlinedIcon from '@mui/icons-material/ScreenShareOutlined'
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../features/api-client'
import { useDiagnosticReport } from '../features/diagnostics/DiagnosticReportContext'

type ReportStatus = 'open' | 'investigating' | 'resolved'
type MyDiagnosticReport = {
  id: string
  reference: string
  summary: string
  details: string
  status: ReportStatus
  createdAt: string
  updatedAt: string
  resolutionExplanation: string
  resolvedAt: string | null
}

const STATUS_META: Record<ReportStatus, { label: string; color: 'error' | 'warning' | 'success' }> = {
  open: { label: 'Open', color: 'error' },
  investigating: { label: 'Investigating', color: 'warning' },
  resolved: { label: 'Solved', color: 'success' },
}

function formatDateTime(value: string | null) {
  const parsed = new Date(value || '')
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

export default function ReportIssuePage() {
  const { openDiagnosticReport } = useDiagnosticReport()
  const [reports, setReports] = useState<MyDiagnosticReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadReports = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest<{ reports: MyDiagnosticReport[] }>('/api/diagnostic-reports/my?limit=200')
      setReports(Array.isArray(data.reports) ? data.reports : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your reports.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadReports()
    const handleCreated = () => { void loadReports() }
    window.addEventListener('arnold:diagnostic-report-created', handleCreated)
    return () => window.removeEventListener('arnold:diagnostic-report-created', handleCreated)
  }, [loadReports])

  return (
    <Stack spacing={3} sx={{ maxWidth: 900, mx: 'auto', mt: { xs: 1, md: 3 } }}>
      <Card variant="outlined" sx={{ borderColor: 'primary.100', boxShadow: '0 18px 50px rgba(30,58,138,.08)' }}>
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          <Stack spacing={2.5} alignItems="flex-start">
            <Box sx={{ p: 1.25, borderRadius: 2.5, bgcolor: 'primary.50', color: 'primary.main', display: 'flex' }}><ReportProblemOutlinedIcon /></Box>
            <Box>
              <Typography variant="h5" fontWeight={750} mb={.75}>Report an issue</Typography>
              <Typography color="text.secondary">Record the problem while it happens. The screen recording, browser logs, actions, network requests, API responses, and server request results will be sent securely to an administrator.</Typography>
            </Box>
            <Box sx={{ p: 2, width: '100%', borderRadius: 2, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="subtitle2" fontWeight={750} mb={.5}>Before you begin</Typography>
              <Typography variant="body2" color="text.secondary">Briefly describe what is wrong, start the capture, reproduce the issue, then select “Stop &amp; review.” You will be able to follow the report below.</Typography>
            </Box>
            <Button variant="contained" size="large" startIcon={<ScreenShareOutlinedIcon />} onClick={() => openDiagnosticReport({ area: 'General application issue', action: 'General issue report' })} sx={{ textTransform: 'none', px: 2.5 }}>Start issue report</Button>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
          <Box>
            <Typography variant="h6" fontWeight={750}>My reports</Typography>
            <Typography variant="body2" color="text.secondary">Track every issue you submitted and read the explanation when it is solved.</Typography>
          </Box>
          <Tooltip title="Refresh reports"><span><IconButton onClick={() => void loadReports()} disabled={loading} sx={{ border: '1px solid', borderColor: 'divider' }}><RefreshIcon /></IconButton></span></Tooltip>
        </Stack>

        {error ? <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert> : null}
        {loading ? <Box sx={{ py: 5, textAlign: 'center' }}><CircularProgress /></Box> : (
          <Stack spacing={1.5}>
            {reports.map((report) => {
              const meta = STATUS_META[report.status] || STATUS_META.open
              return (
                <Card key={report.id} variant="outlined">
                  <CardContent>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} gap={1}>
                      <Box minWidth={0}>
                        <Typography variant="overline" color="primary.main" fontWeight={800}>{report.reference}</Typography>
                        <Typography fontWeight={750}>{report.summary}</Typography>
                        <Typography variant="caption" color="text.secondary">Reported {formatDateTime(report.createdAt)}</Typography>
                      </Box>
                      <Chip size="small" color={meta.color} label={meta.label} />
                    </Stack>
                    {report.details ? <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25, whiteSpace: 'pre-wrap' }}>{report.details}</Typography> : null}
                    {report.status === 'resolved' ? <><Divider sx={{ my: 1.5 }} /><Alert severity="success"><Typography variant="subtitle2" fontWeight={750}>Solved {report.resolvedAt ? `on ${formatDateTime(report.resolvedAt)}` : ''}</Typography><Typography variant="body2">{report.resolutionExplanation || 'This issue was marked solved.'}</Typography></Alert></> : null}
                  </CardContent>
                </Card>
              )
            })}
            {reports.length === 0 ? <Card variant="outlined"><CardContent sx={{ py: 5, textAlign: 'center' }}><Typography color="text.secondary">You have not submitted any issue reports yet.</Typography></CardContent></Card> : null}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}

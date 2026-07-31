import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DownloadIcon from '@mui/icons-material/Download'
import RefreshIcon from '@mui/icons-material/Refresh'
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined'
import {
  Alert,
  Box,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch, apiRequest } from '../features/api-client'

type ReportStatus = 'open' | 'investigating' | 'resolved'
type DiagnosticReport = {
  id: string
  reference: string
  summary: string
  details: string
  status: ReportStatus
  context: Record<string, unknown>
  createdBy: { uid?: string | null; email?: string | null; name?: string | null }
  createdAt: string
  updatedAt: string
  recording: { fileName?: string; contentType?: string; size?: number } | null
  consoleCount: number
  networkCount: number
  interactionCount: number
  durationMs: number
  diagnostics?: Record<string, unknown>
}

const STATUS_META: Record<ReportStatus, { label: string; color: 'error' | 'warning' | 'success' }> = {
  open: { label: 'Open', color: 'error' },
  investigating: { label: 'Investigating', color: 'warning' },
  resolved: { label: 'Resolved', color: 'success' },
}

function formatDateTime(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function JsonBlock({ value, empty = 'No data captured.' }: { value: unknown; empty?: string }) {
  return (
    <Box component="pre" sx={{ m: 0, p: 1.5, borderRadius: 1.5, bgcolor: '#0f172a', color: '#dbeafe', font: '12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 520, overflow: 'auto' }}>
      {value == null ? empty : JSON.stringify(value, null, 2)}
    </Box>
  )
}

export default function AdminDiagnosticReportsPage() {
  const [reports, setReports] = useState<DiagnosticReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<DiagnosticReport | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [tab, setTab] = useState(0)
  const [recordingUrl, setRecordingUrl] = useState('')
  const [recordingLoading, setRecordingLoading] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const loadReports = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (statusFilter) params.set('status', statusFilter)
      const data = await apiRequest<{ reports: DiagnosticReport[] }>(`/api/admin/diagnostic-reports?${params.toString()}`)
      setReports(Array.isArray(data.reports) ? data.reports : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load issue reports.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { void loadReports() }, [loadReports])
  useEffect(() => () => { if (recordingUrl) URL.revokeObjectURL(recordingUrl) }, [recordingUrl])

  const openReport = useCallback(async (row: DiagnosticReport) => {
    setDetailLoading(true)
    setDetailError('')
    setTab(0)
    if (recordingUrl) URL.revokeObjectURL(recordingUrl)
    setRecordingUrl('')
    setSelected(row)
    try {
      const data = await apiRequest<{ report: DiagnosticReport }>(`/api/admin/diagnostic-reports/${encodeURIComponent(row.id)}`)
      setSelected(data.report)
      if (data.report.recording) {
        setRecordingLoading(true)
        const response = await apiFetch(`/api/admin/diagnostic-reports/${encodeURIComponent(row.id)}/recording`)
        setRecordingUrl(URL.createObjectURL(await response.blob()))
      }
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : 'Could not load this report.')
    } finally {
      setDetailLoading(false)
      setRecordingLoading(false)
    }
  }, [recordingUrl])

  const updateStatus = async (status: ReportStatus) => {
    if (!selected || status === selected.status) return
    setStatusSaving(true)
    setDetailError('')
    try {
      const data = await apiRequest<{ report: DiagnosticReport }>(`/api/admin/diagnostic-reports/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }, { processTracking: false })
      setSelected((previous) => previous ? { ...previous, ...data.report, diagnostics: previous.diagnostics } : previous)
      setReports((previous) => previous.map((row) => row.id === selected.id ? { ...row, ...data.report } : row))
    } catch (saveError) {
      setDetailError(saveError instanceof Error ? saveError.message : 'Could not update the report.')
    } finally {
      setStatusSaving(false)
    }
  }

  const downloadDiagnostics = () => {
    if (!selected) return
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selected.reference || 'diagnostic-report'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const deleteReport = async () => {
    if (!selected || !window.confirm(`Delete ${selected.reference}? This permanently removes the report, logs, and screen recording.`)) return
    setDeleteBusy(true)
    setDetailError('')
    try {
      await apiRequest(`/api/admin/diagnostic-reports/${encodeURIComponent(selected.id)}`, { method: 'DELETE' }, { processTracking: false })
      if (recordingUrl) URL.revokeObjectURL(recordingUrl)
      setReports((previous) => previous.filter((row) => row.id !== selected.id))
      setNotice(`${selected.reference} was deleted.`)
      setSelected(null)
      setRecordingUrl('')
    } catch (deleteError) {
      setDetailError(deleteError instanceof Error ? deleteError.message : 'Could not delete the report.')
    } finally {
      setDeleteBusy(false)
    }
  }

  const diagnostics = useMemo(() => selected?.diagnostics || {}, [selected?.diagnostics])
  const network = useMemo(() => Array.isArray(diagnostics.network) ? diagnostics.network : [], [diagnostics])
  const consoleEvents = useMemo(() => Array.isArray(diagnostics.console) ? diagnostics.console : [], [diagnostics])
  const interactions = useMemo(() => Array.isArray(diagnostics.interactions) ? diagnostics.interactions : [], [diagnostics])
  const serverEvents = useMemo(() => Array.isArray(diagnostics.serverEvents) ? diagnostics.serverEvents : [], [diagnostics])

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'flex-start' }} gap={2}>
        <Box><Typography variant="h5" fontWeight={750}>Technical issue reports</Typography><Typography variant="body2" color="text.secondary">Screen recordings, browser errors, user actions, and API request/response details.</Typography></Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 150 }}><InputLabel>Status</InputLabel><Select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><MenuItem value="">All reports</MenuItem><MenuItem value="open">Open</MenuItem><MenuItem value="investigating">Investigating</MenuItem><MenuItem value="resolved">Resolved</MenuItem></Select></FormControl>
          <Tooltip title="Refresh"><IconButton onClick={() => void loadReports()} disabled={loading} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}><RefreshIcon /></IconButton></Tooltip>
        </Stack>
      </Stack>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}
      <Card variant="outlined">
        {loading ? <Box sx={{ p: 6, textAlign: 'center' }}><CircularProgress /></Box> : (
          <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Reference</TableCell><TableCell>Issue</TableCell><TableCell>Reported by</TableCell><TableCell>Area</TableCell><TableCell>Evidence</TableCell><TableCell>Status</TableCell><TableCell>Reported</TableCell></TableRow></TableHead><TableBody>
            {reports.map((report) => { const meta = STATUS_META[report.status] || STATUS_META.open; return <TableRow hover key={report.id} onClick={() => void openReport(report)} sx={{ cursor: 'pointer' }}><TableCell><Typography variant="body2" fontWeight={750} color="primary.main">{report.reference}</Typography></TableCell><TableCell sx={{ maxWidth: 360 }}><Typography variant="body2" noWrap>{report.summary}</Typography></TableCell><TableCell>{report.createdBy.name || report.createdBy.email || 'Unknown'}</TableCell><TableCell>{String(report.context.area || 'Arnold workspace')}</TableCell><TableCell><Stack direction="row" spacing={.5}>{report.recording ? <Chip size="small" icon={<VideocamOutlinedIcon />} label="Video" variant="outlined" /> : null}<Chip size="small" label={`${report.networkCount || 0} calls`} variant="outlined" /></Stack></TableCell><TableCell><Chip size="small" color={meta.color} label={meta.label} /></TableCell><TableCell>{formatDateTime(report.createdAt)}</TableCell></TableRow> })}
            {reports.length === 0 ? <TableRow><TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>No issue reports found.</TableCell></TableRow> : null}
          </TableBody></Table></TableContainer>
        )}
      </Card>

      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} fullWidth maxWidth="lg">
        <DialogTitle><Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}><Stack direction="row" spacing={1.25} alignItems="center" minWidth={0}><Box sx={{ display: 'flex', p: 1, borderRadius: 2, bgcolor: 'primary.50', color: 'primary.main' }}><BugReportOutlinedIcon /></Box><Box minWidth={0}><Typography variant="overline" color="primary" fontWeight={800}>{selected?.reference}</Typography><Typography variant="h6" fontWeight={750} noWrap>{selected?.summary}</Typography></Box></Stack><Stack direction="row" spacing={1} alignItems="center"><FormControl size="small" sx={{ minWidth: 145 }}><Select value={selected?.status || 'open'} onChange={(event) => void updateStatus(event.target.value as ReportStatus)} disabled={statusSaving}><MenuItem value="open">Open</MenuItem><MenuItem value="investigating">Investigating</MenuItem><MenuItem value="resolved">Resolved</MenuItem></Select></FormControl><Tooltip title="Download full JSON"><IconButton onClick={downloadDiagnostics}><DownloadIcon /></IconButton></Tooltip><Tooltip title="Delete report"><span><IconButton color="error" onClick={() => void deleteReport()} disabled={deleteBusy || detailLoading}>{deleteBusy ? <CircularProgress size={20} /> : <DeleteOutlineIcon />}</IconButton></span></Tooltip><IconButton onClick={() => setSelected(null)}><CloseIcon /></IconButton></Stack></Stack></DialogTitle>
        <Divider />
        <DialogContent sx={{ p: 0, height: '74vh', display: 'flex', flexDirection: 'column' }}>
          {detailLoading ? <Box sx={{ p: 6, textAlign: 'center' }}><CircularProgress /></Box> : null}
          {detailError ? <Alert severity="error" sx={{ m: 2 }}>{detailError}</Alert> : null}
          {!detailLoading ? <><Box sx={{ px: 3, pt: 2 }}><Stack direction="row" spacing={2} useFlexGap flexWrap="wrap"><Typography variant="body2"><strong>Reported by:</strong> {selected?.createdBy.name || selected?.createdBy.email || 'Unknown'}</Typography><Typography variant="body2"><strong>When:</strong> {formatDateTime(selected?.createdAt || '')}</Typography><Typography variant="body2"><strong>Duration:</strong> {formatDuration(selected?.durationMs || 0)}</Typography><Typography variant="body2"><strong>Area:</strong> {String(selected?.context.area || 'Arnold workspace')}</Typography></Stack>{selected?.details ? <Alert severity="info" sx={{ mt: 1.5 }}>{selected.details}</Alert> : null}</Box><Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ px: 2, borderBottom: '1px solid', borderColor: 'divider', mt: 1 }} variant="scrollable"><Tab label="Overview" /><Tab label={`Network (${network.length})`} /><Tab label={`Console (${consoleEvents.length})`} /><Tab label={`Actions (${interactions.length})`} /><Tab label={`Server (${serverEvents.length})`} /><Tab label="Environment" /></Tabs><Box sx={{ flex: 1, overflow: 'auto', p: 3, bgcolor: 'grey.50' }}>
            {tab === 0 ? <Stack spacing={2}>{selected?.recording ? <Card variant="outlined" sx={{ p: 2 }}><Stack direction="row" justifyContent="space-between" mb={1}><Typography fontWeight={750}>Screen recording</Typography><Chip size="small" label={`${(Number(selected.recording.size || 0) / 1024 / 1024).toFixed(1)} MB`} /></Stack>{recordingLoading ? <Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Box> : recordingUrl ? <Box component="video" src={recordingUrl} controls preload="metadata" sx={{ width: '100%', maxHeight: 480, borderRadius: 1.5, bgcolor: '#020617' }} /> : <Alert severity="warning">The recording could not be loaded.</Alert>}</Card> : <Alert severity="info">This report contains logs only.</Alert>}<Card variant="outlined" sx={{ p: 2 }}><Typography fontWeight={750} mb={1}>Report context</Typography><JsonBlock value={selected?.context} /></Card></Stack> : null}
            {tab === 1 ? <JsonBlock value={network} /> : null}{tab === 2 ? <JsonBlock value={consoleEvents} /> : null}{tab === 3 ? <JsonBlock value={interactions} /> : null}{tab === 4 ? <JsonBlock value={serverEvents} /> : null}{tab === 5 ? <JsonBlock value={diagnostics.page || diagnostics} /> : null}
          </Box></> : null}
        </DialogContent>
      </Dialog>
    </Stack>
  )
}

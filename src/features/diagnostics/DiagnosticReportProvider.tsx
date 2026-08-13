import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import ScreenShareOutlinedIcon from '@mui/icons-material/ScreenShareOutlined'
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { apiRequest } from '../api-client'
import {
  DiagnosticReportContext,
  type DiagnosticContext,
} from './DiagnosticReportContext'
import {
  beginDiagnosticSession,
  cancelDiagnosticSession,
  finishDiagnosticSession,
  recordDiagnosticInteraction,
} from './diagnostics'

const MAX_RECORDING_MS = 5 * 60 * 1000
// Firebase Functions v1 caps HTTP requests at 10 MB. Keeping the recording at
// 6 MB leaves room for base64 expansion plus the diagnostic JSON payload.
const MAX_RECORDING_BYTES = 6 * 1024 * 1024

function supportedMimeType() {
  return [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ].find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || ''
}

function targetSummary(target: EventTarget | null) {
  const element = target instanceof Element
    ? target.closest('button, [role="button"], a, input, select, textarea, [data-field]')
    : null
  if (!element) return { element: target instanceof Element ? target.tagName : 'unknown' }
  return {
    element: element.tagName,
    role: element.getAttribute('role') || '',
    label: String(
      element.getAttribute('aria-label')
      || element.getAttribute('title')
      || (element as HTMLElement).innerText
      || element.getAttribute('placeholder')
      || '',
    ).trim().slice(0, 180),
    field: element.getAttribute('data-field') || '',
  }
}

async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return window.btoa(binary)
}

export default function DiagnosticReportProvider({ children }: { children: ReactNode }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [phase, setPhase] = useState<'intro' | 'review' | 'success'>('intro')
  const [context, setContext] = useState<DiagnosticContext>({})
  const [summary, setSummary] = useState('')
  const [details, setDetails] = useState('')
  const [includeScreen, setIncludeScreen] = useState(true)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [recordingMimeType, setRecordingMimeType] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submittedReference, setSubmittedReference] = useState('')

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const stopReasonRef = useRef('user')
  const pendingDiagnosticsRef = useRef<Record<string, unknown> | null>(null)

  const reset = useCallback(() => {
    setPhase('intro')
    setSummary('')
    setDetails('')
    setIncludeScreen(true)
    setError('')
    setRecordingBlob(null)
    setRecordingMimeType('')
    setSubmittedReference('')
    setElapsedSeconds(0)
    pendingDiagnosticsRef.current = null
  }, [])

  const openDiagnosticReport = useCallback((nextContext: DiagnosticContext = {}) => {
    if (recording) return
    reset()
    setContext({
      area: nextContext.area || document.title || 'Arnold Contract',
      action: nextContext.action || '',
      ...nextContext,
    })
    setSummary(nextContext.summary || (nextContext.action ? `${nextContext.action} is not working` : ''))
    setDialogOpen(true)
  }, [recording, reset])

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const stopRecording = useCallback((reason = 'user') => {
    stopReasonRef.current = reason
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      stopTracks()
      setRecording(false)
      setDialogOpen(true)
      setPhase('review')
    }
  }, [stopTracks])

  useEffect(() => {
    if (!recording) return undefined
    const interval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000)
      setElapsedSeconds(elapsed)
      if (elapsed * 1000 >= MAX_RECORDING_MS) stopRecording('time-limit')
    }, 1000)
    return () => window.clearInterval(interval)
  }, [recording, stopRecording])

  useEffect(() => {
    if (!recording) return undefined
    const onPointerMove = (event: PointerEvent) => {
      document.documentElement.style.setProperty('--diagnostic-pointer-x', `${event.clientX}px`)
      document.documentElement.style.setProperty('--diagnostic-pointer-y', `${event.clientY}px`)
    }
    const onClick = (event: MouseEvent) => recordDiagnosticInteraction('click', targetSummary(event.target))
    const onChange = (event: Event) => recordDiagnosticInteraction('change', targetSummary(event.target))
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('click', onClick, true)
    window.addEventListener('change', onChange, true)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('change', onChange, true)
    }
  }, [recording])

  useEffect(() => () => {
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
    stopTracks()
    cancelDiagnosticSession()
  }, [stopTracks])

  const beginRecording = async () => {
    setError('')
    if (!summary.trim()) {
      setError('Please add a short summary so the administrator knows what to investigate.')
      return
    }

    let stream: MediaStream | null = null
    if (includeScreen) {
      if (!window.MediaRecorder || !navigator.mediaDevices?.getDisplayMedia) {
        setError('Screen recording is not supported in this browser. Turn it off to submit logs only.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 15, max: 20 } },
          audio: false,
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          surfaceSwitching: 'exclude',
        } as DisplayMediaStreamOptions)
      } catch (shareError) {
        setError(shareError instanceof Error && shareError.name !== 'NotAllowedError'
          ? shareError.message
          : 'Screen sharing was cancelled. Choose this Arnold tab, or turn off screen recording.')
        return
      }
    }

    beginDiagnosticSession({ ...context, summary: summary.trim(), recordingRequested: includeScreen })
    recordDiagnosticInteraction('recording-started', { page: window.location.pathname })
    startedAtRef.current = Date.now()
    setElapsedSeconds(0)
    setDialogOpen(false)
    setRecording(true)

    if (!stream) return
    streamRef.current = stream
    chunksRef.current = []
    const mimeType = supportedMimeType()
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 160000,
    })
    recorderRef.current = recorder
    setRecordingMimeType(recorder.mimeType || mimeType || 'video/webm')
    recorder.ondataavailable = (event) => {
      if (!event.data?.size) return
      chunksRef.current.push(event.data)
      const totalBytes = chunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0)
      if (totalBytes >= MAX_RECORDING_BYTES) stopRecording('size-limit')
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'video/webm' })
      setRecordingBlob(blob.size ? blob : null)
      setRecording(false)
      setPhase('review')
      setDialogOpen(true)
      stopTracks()
      if (stopReasonRef.current === 'time-limit') setError('The five-minute recording limit was reached.')
      if (stopReasonRef.current === 'size-limit') setError('The recording size limit was reached.')
    }
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stopRecording('browser-share-ended'), { once: true })
    recorder.start(1000)
  }

  const handleStop = () => {
    recordDiagnosticInteraction('capture-stopped', { reason: 'user' })
    if (recorderRef.current) stopRecording('user')
    else {
      setRecording(false)
      setPhase('review')
      setDialogOpen(true)
    }
  }

  const submitReport = async () => {
    setSubmitting(true)
    setError('')
    const diagnostics = pendingDiagnosticsRef.current || finishDiagnosticSession({
      stopReason: stopReasonRef.current,
      durationMs: Math.max(0, Date.now() - startedAtRef.current),
    })
    pendingDiagnosticsRef.current = diagnostics
    try {
      const recordingData = recordingBlob
        ? {
            fileName: `arnold-issue-${Date.now()}.${recordingMimeType.includes('mp4') ? 'mp4' : 'webm'}`,
            contentType: recordingMimeType || 'video/webm',
            dataBase64: await blobToBase64(recordingBlob),
          }
        : null
      const response = await apiRequest<{ reference: string }>('/api/diagnostic-reports', {
        method: 'POST',
        body: JSON.stringify({
          summary: summary.trim(),
          details: details.trim(),
          context,
          diagnostics,
          recording: recordingData,
        }),
      }, { timeoutMs: 120_000, processTracking: false })
      setSubmittedReference(response.reference)
      window.dispatchEvent(new CustomEvent('arnold:diagnostic-report-created'))
      pendingDiagnosticsRef.current = null
      setPhase('success')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit the report.')
    } finally {
      setSubmitting(false)
    }
  }

  const closeDialog = () => {
    if (submitting || recording) return
    if (phase !== 'success') cancelDiagnosticSession()
    pendingDiagnosticsRef.current = null
    setDialogOpen(false)
  }

  const value = useMemo(() => ({ openDiagnosticReport, recording }), [openDiagnosticReport, recording])
  const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')
  const seconds = String(elapsedSeconds % 60).padStart(2, '0')

  return (
    <DiagnosticReportContext.Provider value={value}>
      {children}
      {recording ? (
        <>
          <Box aria-hidden sx={{ position: 'fixed', left: 'var(--diagnostic-pointer-x, -100px)', top: 'var(--diagnostic-pointer-y, -100px)', width: 24, height: 24, border: '3px solid #ef4444', bgcolor: 'rgba(255,255,255,.35)', borderRadius: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 10000, boxShadow: '0 0 0 4px rgba(239,68,68,.18)' }} />
          <Box sx={{ position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, bgcolor: '#0f172a', color: 'white', borderRadius: 99, px: 1, py: .75, display: 'flex', alignItems: 'center', gap: 1, boxShadow: '0 12px 32px rgba(15,23,42,.3)' }}>
            <Box sx={{ width: 9, height: 9, bgcolor: '#ef4444', borderRadius: '50%' }} />
            <Typography variant="body2" fontWeight={700}>Capturing issue · {minutes}:{seconds}</Typography>
            <Button size="small" variant="contained" color="error" startIcon={<StopCircleOutlinedIcon />} onClick={handleStop} sx={{ borderRadius: 99, textTransform: 'none' }}>Stop & review</Button>
          </Box>
        </>
      ) : null}

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="sm">
        {phase === 'intro' ? (
          <>
            <DialogTitle>
              <Stack direction="row" spacing={1.25} alignItems="center">
                <Box sx={{ p: 1, borderRadius: 2, bgcolor: 'primary.50', color: 'primary.main', display: 'flex' }}><ReportProblemOutlinedIcon /></Box>
                <Box><Typography variant="h6" fontWeight={750}>Report a technical issue</Typography><Typography variant="body2" color="text.secondary">Capture the problem so an administrator can reproduce it.</Typography></Box>
              </Stack>
            </DialogTitle>
            <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
              {error ? <Alert severity="warning">{error}</Alert> : null}
              <TextField label="What is not working?" placeholder="Example: Generate Documents does not finish" value={summary} onChange={(event) => setSummary(event.target.value)} fullWidth required autoFocus slotProps={{ htmlInput: { maxLength: 240 } }} />
              <Box sx={{ p: 2, border: '1px solid', borderColor: 'primary.100', bgcolor: 'primary.50', borderRadius: 2 }}><Typography variant="subtitle2" fontWeight={750} mb={.75}>What will be captured</Typography><Typography variant="body2" color="text.secondary">Actions in Arnold, console errors, API requests and responses, browser information, server request results, and—if enabled—the screen you choose. Passwords, tokens, cookies, and common secret fields are automatically redacted.</Typography></Box>
              <FormControlLabel control={<Switch checked={includeScreen} onChange={(event) => setIncludeScreen(event.target.checked)} />} label={<Box><Typography variant="body2" fontWeight={700}>Include screen recording</Typography><Typography variant="caption" color="text.secondary">Choose the current Arnold tab in the browser prompt.</Typography></Box>} />
            </Stack></DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}><Button onClick={closeDialog} color="inherit">Cancel</Button><Button variant="contained" onClick={() => void beginRecording()} startIcon={includeScreen ? <ScreenShareOutlinedIcon /> : <ReportProblemOutlinedIcon />} sx={{ textTransform: 'none' }}>{includeScreen ? 'Start secure capture' : 'Start log capture'}</Button></DialogActions>
          </>
        ) : null}
        {phase === 'review' ? (
          <>
            <DialogTitle>Review and send report</DialogTitle>
            <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
              {error ? <Alert severity="info">{error}</Alert> : null}
              <Alert severity="success">Capture complete: {Math.max(1, elapsedSeconds)} seconds, {recordingBlob ? `${(recordingBlob.size / 1024 / 1024).toFixed(1)} MB recording` : 'logs only'}.</Alert>
              <TextField label="Summary" value={summary} onChange={(event) => setSummary(event.target.value)} fullWidth required />
              <TextField label="Anything else the administrator should know? (optional)" value={details} onChange={(event) => setDetails(event.target.value)} fullWidth multiline minRows={3} slotProps={{ htmlInput: { maxLength: 4000 } }} />
              <Typography variant="caption" color="text.secondary">This report is visible only to Arnold administrators.</Typography>
            </Stack></DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}><Button onClick={closeDialog} color="inherit" disabled={submitting}>Discard</Button><Button variant="contained" onClick={() => void submitReport()} disabled={submitting || !summary.trim()}>{submitting ? <><CircularProgress size={16} color="inherit" sx={{ mr: 1 }} />Sending…</> : 'Send to administrator'}</Button></DialogActions>
          </>
        ) : null}
        {phase === 'success' ? (
          <><DialogContent sx={{ textAlign: 'center', py: 5 }}><CheckCircleOutlineIcon sx={{ fontSize: 56, color: 'success.main', mb: 1 }} /><Typography variant="h6" fontWeight={750}>Report sent</Typography><Typography color="text.secondary" mt={.75}>An administrator now has the recording and technical details needed to investigate.</Typography>{submittedReference ? <Chip label={`Reference ${submittedReference}`} sx={{ mt: 2 }} /> : null}</DialogContent><DialogActions sx={{ justifyContent: 'center', pb: 3 }}><Button variant="contained" onClick={closeDialog}>Done</Button></DialogActions></>
        ) : null}
      </Dialog>
    </DiagnosticReportContext.Provider>
  )
}

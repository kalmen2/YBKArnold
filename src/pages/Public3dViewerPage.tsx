import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded'
import { Alert, Box, Button, CircularProgress, IconButton, Stack, Typography } from '@mui/material'
import { useEffect, useMemo, useRef, useState, type ElementType } from 'react'
import { useParams } from 'react-router-dom'
import '@google/model-viewer'

const SmoothModelViewer = 'model-viewer' as unknown as ElementType

type ViewerModel = {
  label: string
  fileName: string
  viewerType?: 'trimble' | 'glb' | 'sketchup'
  glbUrl?: string | null
  embedUrl: string | null
  status?: 'processing' | 'ready' | 'failed'
}

type ViewerData = {
  quoteNumber: string | null
  projectName: string
  customerName: string | null
  fileName: string | null
  status?: 'processing' | 'ready' | 'failed'
  viewerType?: 'trimble' | 'glb' | 'sketchup'
  glbUrl?: string | null
  embedUrl: string | null
  models?: ViewerModel[]
}

function modelDisplayLabel(model: Pick<ViewerModel, 'label' | 'fileName'>, index = 0) {
  const storedLabel = String(model.label || '').trim()
  if (storedLabel && !/^(?:option\s*\d+|primary\s+view)$/i.test(storedLabel)) return storedLabel
  const fileName = String(model.fileName || '').replaceAll('\\', '/').split('/').at(-1) || ''
  return fileName.replace(/\.skp$/i, '').trim() || `Sketch${index + 1}`
}

export default function Public3dViewerPage() {
  const { slug = '' } = useParams()
  const [data, setData] = useState<ViewerData | null>(null)
  const [error, setError] = useState('')
  const [statusCheckNonce, setStatusCheckNonce] = useState(0)
  const [checkingStatus, setCheckingStatus] = useState(true)
  const [activeIndex, setActiveIndex] = useState(0)
  const [viewerNonce, setViewerNonce] = useState(0)
  const [viewerLoading, setViewerLoading] = useState(true)
  const [takingLonger, setTakingLonger] = useState(false)
  const [showViewerHelp, setShowViewerHelp] = useState(false)
  const revealTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const existingRobotsMeta = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const robotsMeta = existingRobotsMeta || document.createElement('meta')
    const previousContent = existingRobotsMeta?.content
    robotsMeta.name = 'robots'
    robotsMeta.content = 'noindex, nofollow, noarchive'
    if (!existingRobotsMeta) document.head.appendChild(robotsMeta)

    return () => {
      if (existingRobotsMeta) robotsMeta.content = previousContent || ''
      else robotsMeta.remove()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const pollSuffix = statusCheckNonce > 0 ? '&poll=1' : ''
    fetch(`/api/public/3d/${encodeURIComponent(slug)}?embed=1${pollSuffix}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.error || 'This 3D model link is unavailable.')
        return payload as ViewerData
      })
      .then(setData)
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError') setError(requestError instanceof Error ? requestError.message : 'The 3D viewer could not be loaded.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setCheckingStatus(false)
      })
    return () => controller.abort()
  }, [slug, statusCheckNonce])

  const models = useMemo<ViewerModel[]>(() => {
    if (!data) return []
    const sourceModels = data.models?.length
      ? data.models
      : [{ label: '', fileName: data.fileName || '3D model', viewerType: data.viewerType, glbUrl: data.glbUrl, embedUrl: data.embedUrl }]
    return sourceModels.map((model, index) => ({ ...model, label: modelDisplayLabel(model, index) }))
  }, [data])
  const activeModel = models[Math.min(activeIndex, Math.max(0, models.length - 1))]
  useEffect(() => {
    if (!activeModel?.embedUrl && !activeModel?.glbUrl) return undefined
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current)
    const isSketchUpViewer = activeModel.viewerType === 'sketchup'
    const slowTimer = isSketchUpViewer
      ? null
      : window.setTimeout(() => setTakingLonger(true), 5_000)
    const hardRevealTimer = window.setTimeout(() => {
      setViewerLoading(false)
      if (!isSketchUpViewer) setTakingLonger(true)
    }, isSketchUpViewer ? 1_000 : 15_000)
    return () => {
      if (slowTimer !== null) window.clearTimeout(slowTimer)
      window.clearTimeout(hardRevealTimer)
      if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current)
    }
  }, [activeModel, viewerNonce])

  const prepareViewer = () => {
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current)
    revealTimerRef.current = window.setTimeout(() => {
      setViewerLoading(false)
      revealTimerRef.current = null
    }, 6_000)
  }

  const selectModel = (index: number) => {
    if (index === activeIndex) return
    setViewerLoading(true)
    setTakingLonger(false)
    setActiveIndex(index)
    setViewerNonce((value) => value + 1)
  }

  const retryViewer = () => {
    setViewerLoading(true)
    setTakingLonger(false)
    setViewerNonce((value) => value + 1)
  }

  const checkModelStatus = () => {
    setCheckingStatus(true)
    setError('')
    setStatusCheckNonce((value) => value + 1)
  }

  return (
    <Box
      sx={{
        height: '100dvh',
        color: '#263746',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: '#f4f2ed',
      }}
    >
      <Box
        component="header"
        sx={{
          position: 'relative',
          px: { xs: 1.5, md: 3 },
          minHeight: { xs: 62, md: 74 },
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          bgcolor: '#fbfaf7',
          borderBottom: '3px solid #b5262d',
          boxShadow: '0 3px 14px rgba(63,51,40,.08)',
          zIndex: 5,
        }}
      >
        <Box component="img" src="/arnold-quote-mark.png" alt="Arnold Contract" sx={{ width: { xs: 40, md: 46 }, height: { xs: 40, md: 46 }, objectFit: 'contain' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: { xs: 19, md: 25 }, fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1 }}>
            <Box component="span" sx={{ color: '#b5262d' }}>Arnold</Box>{' '}
            <Box component="span" sx={{ color: '#263746' }}>Contract</Box>
          </Typography>
          <Typography variant="caption" sx={{ color: '#71808b', display: { xs: 'none', sm: 'block' } }}>Interactive project presentation</Typography>
        </Box>
        {data && activeModel?.viewerType === 'sketchup' ? (
          <Button
            aria-label="3D viewing controls and reference warning"
            onClick={() => setShowViewerHelp(true)}
            size="small"
            startIcon={<InfoOutlinedIcon fontSize="small" />}
            sx={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#263746',
              border: '1px solid rgba(38,55,70,.18)',
              bgcolor: '#fff',
              boxShadow: '0 3px 10px rgba(38,55,70,.1)',
              minWidth: 0,
              px: { xs: 1, sm: 1.5 },
              textTransform: 'none',
              fontSize: { xs: '0.7rem', sm: '0.78rem' },
              fontWeight: 800,
              whiteSpace: 'nowrap',
              '&:hover': { bgcolor: '#f4f2ed' },
            }}
          >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Viewing </Box>controls
          </Button>
        ) : null}
        {data ? (
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
            <Stack alignItems="flex-end" sx={{ minWidth: 0, maxWidth: { xs: 190, sm: 480 } }}>
              <Typography variant="subtitle2" noWrap sx={{ maxWidth: { xs: 170, sm: 480 }, color: '#263746', fontWeight: 900 }}>{data.projectName}</Typography>
              <Typography variant="caption" noWrap sx={{ maxWidth: { xs: 170, sm: 480 }, color: '#71808b' }}>
                {data.quoteNumber ? `Quote ${data.quoteNumber}` : (data.customerName || 'Arnold custom project')}
              </Typography>
            </Stack>
          </Stack>
        ) : null}
      </Box>

      <Box
        sx={{
          px: 2,
          py: { xs: 0.7, md: 0.8 },
          bgcolor: '#f7f5f0',
          borderBottom: '1px solid rgba(38,55,70,.12)',
          textAlign: 'center',
          zIndex: 4,
        }}
      >
        <Typography
          sx={{
            color: '#526471',
            fontSize: { xs: '0.68rem', sm: '0.76rem' },
            fontWeight: 650,
            lineHeight: 1.35,
            letterSpacing: '.01em',
          }}
        >
          REFERENCE ONLY — Do not use this model for measurements or fabrication. Final dimensions and specifications are subject to approved shop drawings.
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {error ? (
          <Box sx={{ maxWidth: 680, mx: 'auto', mt: 8 }}>
            <Alert severity="error" icon={<ArrowBackRoundedIcon />}>{error}</Alert>
          </Box>
        ) : !data ? (
          <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ height: '100%' }}>
            <CircularProgress sx={{ color: '#b5262d' }} />
            <Typography sx={{ color: '#71808b' }}>Preparing your 3D presentation…</Typography>
          </Stack>
        ) : data.status === 'failed' ? (
          <Box sx={{ maxWidth: 680, mx: 'auto', mt: 8 }}>
            <Alert
              severity="error"
              action={<Button color="inherit" size="small" onClick={checkModelStatus}>Try again</Button>}
            >
              Trimble could not prepare this 3D model. Please try again or contact Arnold Contract.
            </Alert>
          </Box>
        ) : data.status === 'processing' || (!activeModel?.embedUrl && !activeModel?.glbUrl) ? (
          <Stack
            alignItems="center"
            justifyContent="center"
            spacing={2}
            sx={{ height: '100%', px: 3, textAlign: 'center', bgcolor: '#f0ece4' }}
          >
            <Box sx={{ width: 72, height: 72, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: '#fff', boxShadow: '0 14px 36px rgba(38,55,70,.14)' }}>
              {checkingStatus ? <CircularProgress size={34} sx={{ color: '#b5262d' }} /> : <ViewInArRoundedIcon sx={{ fontSize: 38, color: '#b5262d' }} />}
            </Box>
            <Stack spacing={0.6} alignItems="center">
              <Typography variant="h5" fontWeight={900}>Still preparing your 3D model</Typography>
              <Typography sx={{ maxWidth: 620, color: '#526471' }}>
                Trimble is converting the SketchUp file for web viewing. Larger models can take several minutes to become available.
              </Typography>
              <Typography variant="body2" sx={{ color: '#71808b' }}>
                This page will not refresh automatically. Click below when you are ready to check again.
              </Typography>
            </Stack>
            <Button
              variant="contained"
              startIcon={checkingStatus ? <CircularProgress size={16} color="inherit" /> : <ReplayRoundedIcon />}
              disabled={checkingStatus}
              onClick={checkModelStatus}
              sx={{ mt: 1, textTransform: 'none', bgcolor: '#b5262d', '&:hover': { bgcolor: '#982027' } }}
            >
              {checkingStatus ? 'Checking…' : 'Try again'}
            </Button>
          </Stack>
        ) : (
          <Box
            sx={{
              width: '100%',
              height: '100%',
              minHeight: 360,
              bgcolor: '#f4f2ed',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {activeModel.glbUrl ? (
              <Box
                key={`${activeModel.glbUrl}-${viewerNonce}`}
                component={SmoothModelViewer}
                src={`${activeModel.glbUrl}${activeModel.glbUrl.includes('?') ? '&' : '?'}reload=${viewerNonce}`}
                alt={`${data.projectName} – ${activeModel.label}`}
                camera-controls
                auto-rotate
                shadow-intensity="0.8"
                exposure="1"
                environment-image="neutral"
                onLoad={() => setViewerLoading(false)}
                sx={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  bgcolor: '#f4f2ed',
                  '--poster-color': '#f4f2ed',
                }}
              />
            ) : (
              <Box
                key={`${activeModel.embedUrl}-${viewerNonce}`}
                component="iframe"
                title={`${data.projectName} – ${activeModel.label}`}
                src={activeModel.embedUrl ? `${activeModel.embedUrl}${activeModel.embedUrl.includes('?') ? '&' : '?'}reload=${viewerNonce}` : undefined}
                allow="fullscreen"
                loading="eager"
                onLoad={() => {
                  if (activeModel.viewerType === 'sketchup') setViewerLoading(false)
                  else prepareViewer()
                }}
                sx={{
                  position: 'absolute',
                  border: 0,
                  display: 'block',
                  top: activeModel.viewerType === 'sketchup' ? '-56px' : '-54px',
                  left: activeModel.viewerType === 'sketchup'
                    ? { xs: '-56px', sm: '-150px', md: '-190px' }
                    : { xs: '-55px', md: '-365px' },
                  width: activeModel.viewerType === 'sketchup'
                    ? { xs: 'calc(100% + 112px)', sm: 'calc(100% + 300px)', md: 'calc(100% + 380px)' }
                    : { xs: 'calc(100% + 55px)', md: 'calc(100% + 365px)' },
                  height: activeModel.viewerType === 'sketchup' ? 'calc(100% + 112px)' : 'calc(100% + 54px)',
                  bgcolor: '#f4f2ed',
                }}
              />
            )}

            {activeModel.viewerType === 'sketchup' ? (
              <Box
                aria-hidden="true"
                sx={{
                  position: 'absolute',
                  zIndex: 2,
                  top: 0,
                  right: 0,
                  width: { xs: '82%', sm: 320 },
                  height: 82,
                  pointerEvents: 'none',
                  background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.98) 24%, #fff 38%)',
                }}
              />
            ) : null}

            {activeModel.viewerType === 'sketchup' && showViewerHelp ? (
              <>
                <Box onClick={() => setShowViewerHelp(false)} sx={{ position: 'absolute', zIndex: 5, inset: 0, bgcolor: 'rgba(38,55,70,.2)', backdropFilter: 'blur(2px)' }} />
                <Box
                  role="dialog"
                  aria-label="How to navigate the 3D model"
                  sx={{
                    position: 'absolute',
                    zIndex: 6,
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 'min(calc(100% - 32px), 520px)',
                    p: { xs: 2, sm: 2.5 },
                    borderRadius: 3,
                    bgcolor: '#fbfaf7',
                    border: '1px solid rgba(38,55,70,.14)',
                    boxShadow: '0 24px 70px rgba(38,55,70,.28)',
                  }}
                >
                  <Stack direction="row" alignItems="flex-start" spacing={1}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h6" sx={{ color: '#263746', fontWeight: 900 }}>3D viewing controls</Typography>
                      <Typography sx={{ color: '#71808b', fontSize: '0.86rem', mt: 0.25 }}>Click once inside the model before using a keyboard shortcut.</Typography>
                    </Box>
                    <IconButton aria-label="Close navigation help" onClick={() => setShowViewerHelp(false)} size="small">
                      <CloseRoundedIcon />
                    </IconButton>
                  </Stack>
                  <Alert severity="warning" sx={{ mt: 2, '& .MuiAlert-message': { fontSize: '0.82rem', fontWeight: 750 } }}>
                    Reference only. Do not use this model for measurements or fabrication.
                  </Alert>
                  <Stack spacing={1} sx={{ mt: 1.25 }}>
                    {[
                      ['O', 'Orbit', 'Press O, then click and drag to rotate the view.'],
                      ['H', 'Pan', 'Press H, then click and drag to move the view.'],
                    ].map(([shortcut, title, description]) => (
                      <Stack key={shortcut} direction="row" spacing={1.25} alignItems="center" sx={{ p: 1.25, borderRadius: 2, bgcolor: '#f1eee8' }}>
                        <Box sx={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: '#fff', color: '#b5262d', fontWeight: 900, fontSize: '0.78rem' }}>
                          {shortcut}
                        </Box>
                        <Box>
                          <Typography sx={{ color: '#263746', fontWeight: 850, fontSize: '0.84rem' }}>{title}</Typography>
                          <Typography sx={{ color: '#526471', fontSize: '0.78rem' }}>{description}</Typography>
                        </Box>
                      </Stack>
                    ))}
                  </Stack>
                </Box>
              </>
            ) : null}

            {models.length > 1 ? (
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ position: 'absolute', zIndex: 3, top: 14, left: 14, right: { xs: 14, md: 'auto' } }}>
                {models.map((model, index) => {
                const selected = index === activeIndex
                return (
                  <Button
                    key={`${model.fileName}-${index}`}
                    size="small"
                    onClick={() => selectModel(index)}
                    startIcon={selected ? <CheckCircleRoundedIcon /> : <ViewInArRoundedIcon />}
                    sx={{
                      color: selected ? '#fff' : '#263746',
                      border: '1px solid rgba(38,55,70,.16)',
                      boxShadow: '0 5px 18px rgba(38,55,70,.12)',
                      backdropFilter: 'blur(10px)',
                      textTransform: 'none',
                      borderRadius: 1.5,
                      bgcolor: selected ? '#b5262d' : 'rgba(255,255,255,.9)',
                      '&:hover': { bgcolor: selected ? '#982027' : '#fff' },
                    }}
                  >
                    {model.label}
                  </Button>
                )
                })}
              </Stack>
            ) : null}

            <Button
              size="small"
              variant="contained"
              startIcon={<ReplayRoundedIcon />}
              onClick={retryViewer}
              sx={{
                position: 'absolute',
                zIndex: 3,
                bottom: 14,
                right: 14,
                textTransform: 'none',
                borderRadius: 1.5,
                bgcolor: 'rgba(38,55,70,.9)',
                boxShadow: '0 5px 18px rgba(38,55,70,.16)',
                backdropFilter: 'blur(10px)',
                '&:hover': { bgcolor: '#263746' },
              }}
            >
              {activeModel.viewerType === 'sketchup' ? 'Reset view' : 'Reload 3D'}
            </Button>

            {viewerLoading ? (
              <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ position: 'absolute', zIndex: 4, inset: 0, bgcolor: '#f0ece4', color: '#263746' }}>
                <Box sx={{ width: 68, height: 68, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: '#fff', boxShadow: '0 14px 36px rgba(38,55,70,.14)' }}>
                  <CircularProgress size={32} sx={{ color: '#b5262d' }} />
                </Box>
                <Stack spacing={0.35} alignItems="center">
                  <Typography fontWeight={900}>{takingLonger ? `Still loading ${activeModel.label}` : `Opening ${activeModel.label}`}</Typography>
                  <Typography variant="body2" color="text.secondary">{takingLonger ? 'Larger SketchUp models can take a little longer.' : 'Preparing the 3D model…'}</Typography>
                </Stack>
                {takingLonger ? (
                  <Button variant="outlined" startIcon={<ReplayRoundedIcon />} onClick={retryViewer} sx={{ mt: 1, textTransform: 'none' }}>
                    Reload viewer
                  </Button>
                ) : null}
              </Stack>
            ) : null}
          </Box>
        )}
      </Box>
    </Box>
  )
}

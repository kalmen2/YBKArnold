import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded'
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import { useEffect, useMemo, useRef, useState, type ElementType } from 'react'
import { useParams } from 'react-router-dom'
import '@google/model-viewer'

const SmoothModelViewer = 'model-viewer' as unknown as ElementType

type ViewerModel = {
  label: string
  fileName: string
  viewerType?: 'trimble' | 'glb'
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
  viewerType?: 'trimble' | 'glb'
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
    const slowTimer = window.setTimeout(() => setTakingLonger(true), 5_000)
    const hardRevealTimer = window.setTimeout(() => {
      setViewerLoading(false)
      setTakingLonger(true)
    }, 15_000)
    return () => {
      window.clearTimeout(slowTimer)
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
        {data ? (
          <Stack alignItems="flex-end" sx={{ minWidth: 0, maxWidth: { xs: 230, sm: 480 } }}>
            <Typography variant="subtitle2" noWrap sx={{ maxWidth: { xs: 210, sm: 480 }, color: '#263746', fontWeight: 900 }}>{data.projectName}</Typography>
            <Typography variant="caption" noWrap sx={{ maxWidth: { xs: 210, sm: 480 }, color: '#71808b' }}>
              {data.quoteNumber ? `Quote ${data.quoteNumber}` : (data.customerName || 'Arnold custom project')}
            </Typography>
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
          Quote concept only — final dimensions, construction details, finishes, and specifications are subject to approved shop drawings.
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
                onLoad={prepareViewer}
                sx={{
                  position: 'absolute',
                  border: 0,
                  display: 'block',
                  top: '-54px',
                  left: { xs: '-55px', md: '-365px' },
                  width: { xs: 'calc(100% + 55px)', md: 'calc(100% + 365px)' },
                  height: 'calc(100% + 54px)',
                  bgcolor: '#f4f2ed',
                }}
              />
            )}

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
              Reload 3D
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

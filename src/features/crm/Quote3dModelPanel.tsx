import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { useEffect, useRef, useState } from 'react'
import { firebaseStorage } from '../../auth/firebase'
import { sanitizeStoragePathSegment } from '../../lib/fileUtils'
import {
  commitTrimbleQuoteModelUpload,
  fetchTrimbleConnectionStatus,
  initiateTrimbleQuoteModelUpload,
  publishGlbQuoteModels,
  publishSketchUpShareLink,
  removeTrimbleQuoteModel,
  startTrimbleConnection,
  uploadTrimbleSavedQuoteModels,
  type CrmQuote,
} from './api'

type Props = {
  quote: CrmQuote
  revisionNumber: number
  canManage: boolean
  onChanged: () => void | Promise<void>
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The 3D model action could not be completed.'
}

function savedSketchUpName(name: string | null | undefined) {
  const normalized = String(name || '').trim()
  const withoutFolderPrefix = normalized.includes('::') ? normalized.split('::').at(-1) || normalized : normalized
  return withoutFolderPrefix.split('/').at(-1)?.trim() || 'saved-rendering.skp'
}

function sketchUpViewLabel(name: string | null | undefined, storedLabel?: string | null, index = 0) {
  const normalizedStoredLabel = String(storedLabel || '').trim()
  if (normalizedStoredLabel && !/^(?:option\s*\d+|primary\s+view)$/i.test(normalizedStoredLabel)) {
    return normalizedStoredLabel
  }
  return savedSketchUpName(name).replace(/\.(?:skp|glb)$/i, '').trim() || `Sketch${index + 1}`
}

function isCustomer3dDocument(document: { name?: string | null; url?: string | null }) {
  return /\.(?:skp|glb)(?:$|[?#])/i.test(String(document.url || ''))
    || /\.(?:skp|glb)$/i.test(savedSketchUpName(document.name))
}

function isGlbName(name: string | null | undefined) {
  return /\.glb$/i.test(savedSketchUpName(name))
}

function isRenderingDocument(name: string | null | undefined) {
  const normalized = String(name || '').replaceAll('::', '/').replaceAll('\\', '/')
  return /(?:^|\/)(?:\d+\s*-\s*)?renderings(?:\/|$)/i.test(normalized)
}

function renderingFileType(name: string | null | undefined) {
  const fileName = savedSketchUpName(name)
  const extension = fileName.includes('.') ? fileName.split('.').at(-1)?.toUpperCase() : ''
  return extension || 'FILE'
}

export default function Quote3dModelPanel({ quote, revisionNumber, canManage, onChanged }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedUrls, setSelectedUrls] = useState<string[]>([])
  const [sketchUpShareUrl, setSketchUpShareUrl] = useState('')

  useEffect(() => {
    let active = true
    fetchTrimbleConnectionStatus()
      .then((status) => {
        if (!active) return
        setConnected(status.connected)
      })
      .catch((requestError) => {
        if (!active) return
        setConnected(false)
        setError(errorMessage(requestError))
      })
    return () => { active = false }
  }, [])

  const connect = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await startTrimbleConnection()
      window.location.assign(response.authorizationUrl)
    } catch (requestError) {
      setError(errorMessage(requestError))
      setBusy(false)
    }
  }

  const upload = async (file: File) => {
    setPickerOpen(false)
    setBusy(true)
    setError('')
    try {
      if (/\.glb$/i.test(file.name)) {
        if (file.size <= 0 || file.size > 2 * 1024 * 1024 * 1024) {
          throw new Error('The GLB file must be between 1 byte and 2 GB.')
        }
        const quoteSegment = sanitizeStoragePathSegment(quote.id, 'quote')
        const fileSegment = sanitizeStoragePathSegment(file.name.replace(/\.glb$/i, ''), 'model')
        const target = storageRef(
          firebaseStorage,
          `crm/opportunities/3d-models/${quoteSegment}/${Date.now()}-${fileSegment}.glb`,
        )
        await uploadBytes(target, file, { contentType: file.type || 'model/gltf-binary' })
        const downloadUrl = await getDownloadURL(target)
        await publishGlbQuoteModels(
          quote.id,
          [{ fileName: file.name, fileSize: file.size, downloadUrl }],
          revisionNumber,
        )
      } else if (/\.skp$/i.test(file.name)) {
        if (!connected) throw new Error('Connect Trimble before publishing a SketchUp .skp file, or upload a smooth .glb web model instead.')
        const session = await initiateTrimbleQuoteModelUpload(quote.id, file, revisionNumber)
        const uploadResponse = await fetch(session.uploadUrl, { method: 'PUT', body: file })
        if (!uploadResponse.ok) throw new Error(`SketchUp upload failed (${uploadResponse.status}).`)
        await commitTrimbleQuoteModelUpload(quote.id, session.uploadId, revisionNumber)
      } else {
        throw new Error('Select a SketchUp .skp file or a smooth web .glb file.')
      }
      await onChanged()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async () => {
    if (!window.confirm('Remove this customer 3D viewer link? The uploaded source file will remain safely stored.')) return
    setBusy(true)
    setError('')
    try {
      await removeTrimbleQuoteModel(quote.id, revisionNumber)
      await onChanged()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const model = quote.trimble3d
  const allDocuments = quote.documents || []
  const detectedRenderingDocuments = allDocuments.filter((document) => isRenderingDocument(document.name))
  const renderingDocuments = detectedRenderingDocuments.length
    ? detectedRenderingDocuments
    : allDocuments.filter((document) => isCustomer3dDocument(document))
  const saved3dDocuments = renderingDocuments.filter((document) => isCustomer3dDocument(document))
  const publishedModels = model?.models?.length
    ? model.models
    : (model?.fileName ? [{ fileName: model.fileName, label: sketchUpViewLabel(model.fileName) }] : [])

  const openPicker = () => {
    setSelectedUrls([])
    setSketchUpShareUrl('')
    setError('')
    setPickerOpen(true)
  }

  const publishSharedSketchUpView = async () => {
    const shareUrl = sketchUpShareUrl.trim()
    if (!shareUrl) return

    setBusy(true)
    setError('')
    try {
      await publishSketchUpShareLink(quote.id, shareUrl, revisionNumber)
      setPickerOpen(false)
      await onChanged()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const toggleRendering = (url: string) => {
    setSelectedUrls((current) => {
      if (current.includes(url)) return current.filter((value) => value !== url)
      if (current.length >= 5) return current
      return [...current, url]
    })
  }

  const publishSelected = async () => {
    const selectedDocuments = selectedUrls
      .map((url) => saved3dDocuments.find((document) => document.url === url))
      .filter((document): document is NonNullable<typeof document> => Boolean(document))
    if (!selectedDocuments.length) return

    setBusy(true)
    setError('')
    try {
      const glbDocuments = selectedDocuments.filter((document) => isGlbName(document.name))
      if (glbDocuments.length && glbDocuments.length !== selectedDocuments.length) {
        throw new Error('Publish GLB and SKP models separately. GLB files use the smooth customer viewer.')
      }
      if (glbDocuments.length) {
        await publishGlbQuoteModels(
          quote.id,
          glbDocuments.map((document, index) => ({
            fileName: savedSketchUpName(document.name),
            downloadUrl: document.url,
            label: sketchUpViewLabel(document.name, null, index),
          })),
          revisionNumber,
        )
      } else {
        if (!connected) throw new Error('Connect Trimble before publishing SketchUp .skp files.')
        await uploadTrimbleSavedQuoteModels(
          quote.id,
          selectedDocuments.map((document, index) => ({
            document,
            fileName: savedSketchUpName(document.name),
            label: sketchUpViewLabel(document.name, null, index),
          })),
          revisionNumber,
        )
      }
      setPickerOpen(false)
      await onChanged()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: 3,
          borderColor: model ? 'rgba(15, 76, 129, 0.28)' : 'divider',
          bgcolor: model ? 'rgba(15, 76, 129, 0.035)' : 'background.paper',
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
            <Box sx={{ width: 44, height: 44, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: '#0f4c81', color: 'white', flexShrink: 0 }}>
              <ViewInArRoundedIcon />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Typography variant="subtitle1" fontWeight={800}>Customer 3D Viewer</Typography>
                {model ? <Chip label={`${publishedModels.length || 1} view${publishedModels.length === 1 ? '' : 's'} published`} color="success" size="small" /> : null}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {model
                  ? 'Customers receive a permanent Arnold link for interactive 3D viewing.'
                  : 'Use a SketchUp Share Link for the exact SketchUp colors and lines, or publish an SKP/GLB file.'}
              </Typography>
              {publishedModels.length ? (
                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                  {publishedModels.map((entry, index) => (
                    <Chip key={`${entry.fileName}-${index}`} size="small" variant="outlined" label={`${sketchUpViewLabel(entry.fileName, entry.label, index)}: ${entry.fileName}`} />
                  ))}
                </Stack>
              ) : null}
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {model?.viewerUrl ? (
                <Button component="a" href={model.viewerUrl} target="_blank" rel="noopener noreferrer" variant="contained" startIcon={<OpenInNewRoundedIcon />} sx={{ textTransform: 'none' }}>
                  Open 3D view
                </Button>
              ) : null}
              {canManage ? (
                <Button disabled={busy} variant={model ? 'outlined' : 'contained'} startIcon={busy ? <CircularProgress size={16} /> : <CloudUploadRoundedIcon />} onClick={openPicker} sx={{ textTransform: 'none' }}>
                  {model ? 'Change 3D views' : 'Publish 3D views'}
                </Button>
              ) : null}
              {canManage && connected === false ? (
                <Button disabled={busy} variant="contained" onClick={() => void connect()} sx={{ textTransform: 'none' }}>
                  Connect Trimble for SKP
                </Button>
              ) : null}
              {canManage && model ? (
                <Button disabled={busy} color="error" variant="text" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => void remove()} sx={{ textTransform: 'none' }}>
                  Remove link
                </Button>
              ) : null}
            </Stack>
          </Stack>
          {error && !pickerOpen ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".glb,.skp,model/gltf-binary,model/gltf+json,application/octet-stream"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
          }}
        />
      </Paper>

      <Dialog open={pickerOpen} onClose={busy ? undefined : () => setPickerOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" fontWeight={900}>Publish customer 3D views</Typography>
          <Typography variant="body2" color="text.secondary">Upload a smooth GLB web model, or publish up to five compatible models already saved under Renderings.</Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="info">
              Recommended for exact SketchUp colors and lines: paste a SketchUp shared-model link. Arnold opens it in presentation mode without the editing sidebars.
            </Alert>
            <TextField
              label="SketchUp Share Link"
              placeholder="https://app.sketchup.com/share/..."
              value={sketchUpShareUrl}
              onChange={(event) => setSketchUpShareUrl(event.target.value)}
              disabled={busy}
              fullWidth
            />
            <Button
              disabled={busy || !sketchUpShareUrl.trim()}
              variant="contained"
              size="large"
              startIcon={<ViewInArRoundedIcon />}
              onClick={() => void publishSharedSketchUpView()}
              sx={{ justifyContent: 'flex-start', textTransform: 'none', py: 1.4 }}
            >
              Use exact SketchUp view
            </Button>
            <Divider><Typography variant="caption" color="text.secondary">OR UPLOAD A MODEL FILE</Typography></Divider>
            <Button
              disabled={busy}
              variant="outlined"
              size="large"
              startIcon={<CloudUploadRoundedIcon />}
              onClick={() => inputRef.current?.click()}
              sx={{ justifyContent: 'flex-start', textTransform: 'none', py: 1.4 }}
            >
              Upload a .glb or .skp file
            </Button>
            <Alert severity="success">
              For smooth curves without segment lines, export from SketchUp as GLTF Binary (.glb), then upload that file here.
            </Alert>
            <Divider><Typography variant="caption" color="text.secondary">OR USE CURRENT RENDERINGS</Typography></Divider>
            {!renderingDocuments.length ? (
              <Alert severity="info">No files are currently saved in this quote’s Renderings section.</Alert>
            ) : (
              <Stack spacing={1}>
                <Alert severity={saved3dDocuments.length ? 'info' : 'warning'}>
                  {saved3dDocuments.length
                    ? `${saved3dDocuments.length} compatible 3D ${saved3dDocuments.length === 1 ? 'model' : 'models'} found among ${renderingDocuments.length} rendering ${renderingDocuments.length === 1 ? 'file' : 'files'}.`
                    : `There are ${renderingDocuments.length} rendering files, but none are GLB or SketchUp models.`}
                </Alert>
                {renderingDocuments.map((document, index) => {
                  const selectable = isCustomer3dDocument(document)
                  const checked = selectedUrls.includes(document.url)
                  const selectedPosition = selectedUrls.indexOf(document.url)
                  return (
                    <Paper
                      key={`${document.url}-${index}`}
                      variant="outlined"
                      onClick={() => { if (selectable) toggleRendering(document.url) }}
                      sx={{
                        p: 1.25,
                        cursor: selectable ? 'pointer' : 'default',
                        borderRadius: 2.5,
                        borderColor: checked ? 'primary.main' : 'divider',
                        bgcolor: checked ? 'rgba(15, 76, 129, 0.055)' : 'background.paper',
                        opacity: selectable ? 1 : 0.62,
                      }}
                    >
                      <Stack direction="row" spacing={1.25} alignItems="center">
                        <Checkbox checked={checked} disabled={!selectable} tabIndex={-1} disableRipple />
                        <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'rgba(15, 76, 129, 0.09)', color: '#0f4c81' }}>
                          <FolderOpenRoundedIcon fontSize="small" />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={800} noWrap>{savedSketchUpName(document.name)}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {selectable ? (isGlbName(document.name) ? 'Smooth GLB web model' : 'SketchUp 3D model') : 'Preview/document only — not a 3D model'}
                          </Typography>
                        </Box>
                        <Chip size="small" variant="outlined" label={renderingFileType(document.name)} />
                        {checked ? <Chip size="small" color="primary" label={sketchUpViewLabel(document.name, null, selectedPosition)} /> : null}
                      </Stack>
                    </Paper>
                  )
                })}
                <Typography variant="caption" color="text.secondary">
                  {selectedUrls.length} {selectedUrls.length === 1 ? 'model' : 'models'} selected · Maximum 5
                </Typography>
              </Stack>
            )}
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button disabled={busy} onClick={() => setPickerOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button
            disabled={busy || !selectedUrls.length}
            variant="contained"
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <ViewInArRoundedIcon />}
            onClick={() => void publishSelected()}
            sx={{ textTransform: 'none' }}
          >
            {busy ? 'Publishing…' : `Publish ${selectedUrls.length || ''} selected`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import JSZip from 'jszip'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { type MouseEvent, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchMondayDashboardSnapshot,
} from '../features/dashboard/api'
import { useAuth } from '../auth/AuthContext'

const DEPLOYED_API_BASE_URL = 'https://us-central1-ybkarnold-b7ec0.cloudfunctions.net/apiV1'
const API_BASE_CANDIDATES = [DEPLOYED_API_BASE_URL, '']

type OrderPhoto = {
  path: string
  url: string
  createdAt: string
}

type OrderPhotoGroup = {
  orderId: string
  photos: OrderPhoto[]
}

type PhotosIndexResponse = {
  generatedAt: string
  orders: OrderPhotoGroup[]
}

type PictureOrder = {
  id: string
  name: string
  photos: OrderPhoto[]
}

type DeleteTarget = {
  orderId: string
  path: string
}

type ViewerTarget = {
  orderId: string
  orderName: string
  photo: OrderPhoto
}

const MIN_VIEWER_ZOOM = 10
const MAX_VIEWER_ZOOM = 400
const VIEWER_ZOOM_STEP = 10

function clampViewerZoom(value: number) {
  return Math.min(MAX_VIEWER_ZOOM, Math.max(MIN_VIEWER_ZOOM, Math.round(value)))
}

function computeViewerFitZoom(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  if (!imageWidth || !imageHeight || !viewportWidth || !viewportHeight) {
    return 100
  }

  const fitRatio = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight, 1)

  return clampViewerZoom(fitRatio * 100)
}

async function request<T>(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers ?? {})

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(path, {
    ...options,
    headers,
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error ?? 'Request failed.')
  }

  return payload as T
}

function buildApiPath(baseUrl: string, relativePath: string) {
  return baseUrl ? `${baseUrl}${relativePath}` : relativePath
}

async function requestWithFallback<T>(relativePath: string, options: RequestInit = {}) {
  let lastError: unknown = null

  for (const baseUrl of API_BASE_CANDIDATES) {
    try {
      return await request<T>(buildApiPath(baseUrl, relativePath), options)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed.')
}

function readErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    const normalized = error.message.trim()

    if (normalized.startsWith('{') && normalized.endsWith('}')) {
      try {
        const parsed = JSON.parse(normalized)
        const nestedMessage = String(parsed?.error_description ?? parsed?.error ?? '').trim()

        if (nestedMessage) {
          return nestedMessage
        }
      } catch {
        // Keep original message when parsing fails.
      }
    }

    return normalized || fallbackMessage
  }

  return fallbackMessage
}

function formatSyncTimestamp(value: string | null) {
  if (!value) {
    return 'Unknown'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function formatDisplayDate(value: string | null) {
  if (!value) {
    return 'Unknown date'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

function sanitizeFileName(value: string) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function buildPhotoFileName(orderId: string, photoPath: string, fallbackIndex = 1) {
  const sourceFileName = String(photoPath ?? '').split('/').pop() || ''
  const safeSourceFileName = sanitizeFileName(sourceFileName)

  if (safeSourceFileName) {
    return safeSourceFileName
  }

  return `order-${sanitizeFileName(orderId)}-photo-${fallbackIndex}.jpg`
}

function buildOrderPhotosArchiveName(orderId: string) {
  const normalizedOrderId = sanitizeFileName(orderId)

  return `order-${normalizedOrderId || 'photos'}-photos.zip`
}

function triggerDownload(blob: Blob, fileName: string) {
  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = objectUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl)
  }, 2000)
}

async function fetchPhotoBlob(orderId: string, path: string) {
  const encodedOrderId = encodeURIComponent(orderId)
  const encodedPath = encodeURIComponent(path)
  const relativePath = `/api/orders/${encodedOrderId}/photos/download?path=${encodedPath}`
  let lastError: unknown = null

  for (const baseUrl of API_BASE_CANDIDATES) {
    try {
      const response = await fetch(buildApiPath(baseUrl, relativePath))

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? 'Could not download this picture right now.')
      }

      return response.blob()
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not download this picture right now.')
}

async function fetchOrderPhotosIndex() {
  return requestWithFallback<PhotosIndexResponse>('/api/orders/photos-index')
}

async function deleteOrderPhoto(orderId: string, path: string) {
  const encodedOrderId = encodeURIComponent(orderId)
  const encodedPath = encodeURIComponent(path)

  try {
    return await requestWithFallback<{ ok: boolean }>(
      `/api/orders/${encodedOrderId}/photos?path=${encodedPath}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ path }),
      },
    )
  } catch (error) {
    throw new Error(readErrorMessage(error, 'Delete endpoint is unavailable.'))
  }
}

export default function PicturesPage() {
  const { logActivity } = useAuth()
  const [pictureOrders, setPictureOrders] = useState<PictureOrder[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [isDeletingPhoto, setIsDeletingPhoto] = useState(false)
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set())
  const [downloadingOrderId, setDownloadingOrderId] = useState<string | null>(null)
  const [downloadingPhotoPath, setDownloadingPhotoPath] = useState<string | null>(null)
  const [photoMenuAnchorEl, setPhotoMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [photoMenuTarget, setPhotoMenuTarget] = useState<DeleteTarget | null>(null)
  const [viewerTarget, setViewerTarget] = useState<ViewerTarget | null>(null)
  const [viewerZoom, setViewerZoom] = useState(100)
  const [viewerImageSize, setViewerImageSize] = useState<{ width: number; height: number } | null>(null)
  const [isViewerDragging, setIsViewerDragging] = useState(false)
  const viewerViewportRef = useRef<HTMLDivElement | null>(null)
  const viewerDragRef = useRef<{
    startX: number
    startY: number
    startScrollLeft: number
    startScrollTop: number
  } | null>(null)

  const loadPictures = useCallback(async (refreshRequested = false) => {
    setErrorMessage(null)

    if (refreshRequested) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    try {
      const [mondayResult, photosIndexResult] = await Promise.allSettled([
        fetchMondayDashboardSnapshot({ refresh: refreshRequested }),
        fetchOrderPhotosIndex(),
      ])

      const mondayOrders =
        mondayResult.status === 'fulfilled' && Array.isArray(mondayResult.value.orders)
          ? mondayResult.value.orders
          : []
      const orderNameById = new Map(
        mondayOrders.map((order) => [String(order.id), order.name]),
      )

      if (photosIndexResult.status !== 'fulfilled') {
        throw photosIndexResult.reason
      }

      const groupedPhotos = Array.isArray(photosIndexResult.value.orders)
        ? photosIndexResult.value.orders
        : []
      const ordersNext = groupedPhotos
        .filter((group) => Array.isArray(group.photos) && group.photos.length > 0)
        .map((group) => ({
          id: String(group.orderId),
          name:
            orderNameById.get(String(group.orderId)) ??
            `Order #${String(group.orderId)}`,
          photos: group.photos,
        }))

      setPictureOrders(ordersNext)
      setExpandedOrderIds((currentExpanded) => {
        const validOrderIds = new Set(ordersNext.map((order) => order.id))

        return new Set(
          [...currentExpanded].filter((orderId) => validOrderIds.has(orderId)),
        )
      })

      if (mondayResult.status === 'fulfilled') {
        setGeneratedAt(mondayResult.value.generatedAt)
      } else {
        setGeneratedAt(photosIndexResult.value.generatedAt)
        setErrorMessage('Loaded pictures, but could not refresh order names from Monday.')
      }
    } catch (error) {
      setPictureOrders([])
      setGeneratedAt(null)
      setErrorMessage(readErrorMessage(error, 'Failed to load pictures.'))
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadPictures(false)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadPictures])

  const filteredOrders = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase()

    if (!normalized) {
      return pictureOrders
    }

    return pictureOrders.filter((order) =>
      String(order.id).toLowerCase().includes(normalized),
    )
  }, [pictureOrders, searchQuery])

  const handleDeletePhoto = useCallback(async () => {
    if (!deleteTarget) {
      return
    }

    setIsDeletingPhoto(true)
    setErrorMessage(null)
    setActionMessage(null)

    try {
      await deleteOrderPhoto(deleteTarget.orderId, deleteTarget.path)
      setPictureOrders((currentOrders) => {
        const nextOrders = currentOrders
          .map((order) => {
            if (order.id !== deleteTarget.orderId) {
              return order
            }

            return {
              ...order,
              photos: order.photos.filter((photo) => photo.path !== deleteTarget.path),
            }
          })
          .filter((order) => order.photos.length > 0)

        return nextOrders
      })
      setActionMessage('Picture deleted successfully.')
      void logActivity({
        action: 'delete_order_photo',
        target: `Order #${deleteTarget.orderId}`,
        path: '/pictures',
        metadata: {
          orderId: deleteTarget.orderId,
          photoPath: deleteTarget.path,
        },
      })
      setDeleteTarget(null)
    } catch (error) {
      setErrorMessage(readErrorMessage(error, 'Failed to delete picture.'))
    } finally {
      setIsDeletingPhoto(false)
    }
  }, [deleteTarget, logActivity])

  const handleToggleOrder = useCallback((orderId: string, isExpanded: boolean) => {
    setExpandedOrderIds((currentExpanded) => {
      const nextExpanded = new Set(currentExpanded)

      if (isExpanded) {
        nextExpanded.add(orderId)
      } else {
        nextExpanded.delete(orderId)
      }

      return nextExpanded
    })

    void logActivity({
      action: isExpanded ? 'open_order_photos' : 'close_order_photos',
      target: `Order #${orderId}`,
      path: '/pictures',
      metadata: {
        orderId,
      },
    })
  }, [logActivity])

  const handleDownloadPhoto = useCallback(async (order: PictureOrder, photo: OrderPhoto, index: number) => {
    setErrorMessage(null)
    setActionMessage(null)
    setDownloadingPhotoPath(photo.path)

    try {
      const blob = await fetchPhotoBlob(order.id, photo.path)
      const fileName = buildPhotoFileName(order.id, photo.path, index + 1)
      triggerDownload(blob, fileName)
      setActionMessage(`Downloaded picture from order #${order.id}.`)

      void logActivity({
        action: 'download_order_photo',
        target: `Order #${order.id}`,
        path: '/pictures',
        metadata: {
          orderId: order.id,
          photoPath: photo.path,
        },
      })
    } catch (error) {
      setErrorMessage(readErrorMessage(error, 'Could not download picture.'))
    } finally {
      setDownloadingPhotoPath(null)
    }
  }, [logActivity])

  const handleDownloadAllOrderPhotos = useCallback(async (order: PictureOrder) => {
    setErrorMessage(null)
    setActionMessage(null)
    setDownloadingOrderId(order.id)

    try {
      if (order.photos.length > 1) {
        const zip = new JSZip()

        for (const [index, photo] of order.photos.entries()) {
          const blob = await fetchPhotoBlob(order.id, photo.path)
          const fileName = buildPhotoFileName(order.id, photo.path, index + 1)
          const zipEntryName = `${String(index + 1).padStart(2, '0')}-${fileName}`
          zip.file(zipEntryName, blob)
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' })
        triggerDownload(zipBlob, buildOrderPhotosArchiveName(order.id))
      } else {
        const firstPhoto = order.photos[0]

        if (!firstPhoto) {
          throw new Error('No pictures are available for this order.')
        }

        const blob = await fetchPhotoBlob(order.id, firstPhoto.path)
        const fileName = buildPhotoFileName(order.id, firstPhoto.path, 1)
        triggerDownload(blob, fileName)
      }

      setActionMessage(`Downloaded ${order.photos.length} pictures from order #${order.id}.`)

      void logActivity({
        action: 'download_all_order_photos',
        target: `Order #${order.id}`,
        path: '/pictures',
        metadata: {
          orderId: order.id,
          photoCount: order.photos.length,
        },
      })
    } catch (error) {
      setErrorMessage(readErrorMessage(error, 'Could not download all pictures.'))
    } finally {
      setDownloadingOrderId(null)
    }
  }, [logActivity])

  const handleClosePhotoMenu = useCallback(() => {
    setPhotoMenuAnchorEl(null)
    setPhotoMenuTarget(null)
  }, [])

  const handleOpenViewer = useCallback((order: PictureOrder, photo: OrderPhoto) => {
    setViewerTarget({
      orderId: order.id,
      orderName: order.name,
      photo,
    })
    setViewerZoom(100)
    setViewerImageSize(null)
    setIsViewerDragging(false)
    viewerDragRef.current = null

    void logActivity({
      action: 'open_order_photo_viewer',
      target: `Order #${order.id}`,
      path: '/pictures',
      metadata: {
        orderId: order.id,
        photoPath: photo.path,
      },
    })
  }, [logActivity])

  const handleCloseViewer = useCallback(() => {
    setViewerTarget(null)
    setViewerZoom(100)
    setViewerImageSize(null)
    setIsViewerDragging(false)
    viewerDragRef.current = null
  }, [])

  const handleViewerZoomChange = useCallback((nextZoom: number) => {
    setViewerZoom(clampViewerZoom(nextZoom))
  }, [])

  const handleViewerWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()

    const viewport = viewerViewportRef.current

    if (!viewport) {
      return
    }

    const previousZoom = viewerZoom
    const nextZoom = clampViewerZoom(
      previousZoom + (event.deltaY < 0 ? VIEWER_ZOOM_STEP : -VIEWER_ZOOM_STEP),
    )

    if (nextZoom === previousZoom) {
      return
    }

    const rect = viewport.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const imageX = viewport.scrollLeft + pointerX
    const imageY = viewport.scrollTop + pointerY
    const zoomRatio = nextZoom / previousZoom

    setViewerZoom(nextZoom)

    window.requestAnimationFrame(() => {
      viewport.scrollLeft = imageX * zoomRatio - pointerX
      viewport.scrollTop = imageY * zoomRatio - pointerY
    })
  }, [viewerZoom])

  const handleViewerMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    const viewport = viewerViewportRef.current

    if (!viewport) {
      return
    }

    viewerDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    }
    setIsViewerDragging(true)
    event.preventDefault()
  }, [])

  const handleViewerMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const viewport = viewerViewportRef.current
    const dragState = viewerDragRef.current

    if (!viewport || !dragState) {
      return
    }

    viewport.scrollLeft = dragState.startScrollLeft - (event.clientX - dragState.startX)
    viewport.scrollTop = dragState.startScrollTop - (event.clientY - dragState.startY)
  }, [])

  const stopViewerDragging = useCallback(() => {
    if (!viewerDragRef.current) {
      return
    }

    viewerDragRef.current = null
    setIsViewerDragging(false)
  }, [])

  const handleViewerImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    const naturalWidth = image.naturalWidth || 0
    const naturalHeight = image.naturalHeight || 0

    setViewerImageSize({
      width: naturalWidth,
      height: naturalHeight,
    })

    const viewport = viewerViewportRef.current

    if (!viewport || !naturalWidth || !naturalHeight) {
      return
    }

    const fitZoom = computeViewerFitZoom(
      naturalWidth,
      naturalHeight,
      viewport.clientWidth - 16,
      viewport.clientHeight - 16,
    )

    setViewerZoom(fitZoom)

    window.requestAnimationFrame(() => {
      viewport.scrollLeft = 0
      viewport.scrollTop = 0
    })
  }, [])

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Pictures
          </Typography>
          <Typography color="text.secondary">
            Order photo gallery • Last sync {formatSyncTimestamp(generatedAt)}
          </Typography>
        </Box>

        <Button
          variant="contained"
          onClick={() => void loadPictures(true)}
          startIcon={<RefreshRoundedIcon />}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <TextField
          fullWidth
          label="Search order number"
          placeholder="Type an order #"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          InputProps={{
            startAdornment: (
              <SearchRoundedIcon sx={{ mr: 1, color: 'text.secondary' }} />
            ),
          }}
        />
      </Paper>

      {actionMessage ? <Alert severity="success">{actionMessage}</Alert> : null}
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

      {isLoading ? (
        <Paper variant="outlined" sx={{ p: 4 }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading pictures...</Typography>
          </Stack>
        </Paper>
      ) : null}

      {!isLoading && filteredOrders.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary">
            {searchQuery.trim()
              ? 'No order numbers match your search.'
              : 'No saved order pictures found yet.'}
          </Typography>
        </Paper>
      ) : null}

      {!isLoading
        ? filteredOrders.map((order) => {
            const photos = order.photos
            const isExpanded = expandedOrderIds.has(order.id)

            return (
              <Accordion
                key={order.id}
                expanded={isExpanded}
                onChange={(_event, expanded) => {
                  handleToggleOrder(order.id, expanded)
                }}
                disableGutters
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreRoundedIcon />}
                  sx={{ px: 2 }}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    gap={1}
                    sx={{ width: '100%', pr: 1 }}
                  >
                    <Box>
                      <Typography variant="h6" fontWeight={700}>
                        {order.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Order #{order.id}
                      </Typography>
                    </Box>

                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip
                        label={`${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}
                        color="primary"
                        variant="outlined"
                      />
                    </Stack>
                  </Stack>
                </AccordionSummary>

                <AccordionDetails sx={{ px: 2, pt: 0, pb: 2 }}>
                  <Stack direction="row" justifyContent="flex-end" sx={{ pb: 1.25 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<DownloadRoundedIcon fontSize="small" />}
                      disabled={downloadingOrderId === order.id}
                      onClick={() => {
                        void handleDownloadAllOrderPhotos(order)
                      }}
                    >
                      {downloadingOrderId === order.id ? 'Downloading...' : 'Download All'}
                    </Button>
                  </Stack>

                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: 'repeat(2, minmax(0, 1fr))',
                        md: 'repeat(4, minmax(0, 1fr))',
                        xl: 'repeat(6, minmax(0, 1fr))',
                      },
                      gap: 1,
                    }}
                  >
                    {photos.map((photo, index) => (
                      <Paper
                        key={photo.path}
                        variant="outlined"
                        sx={{ overflow: 'hidden' }}
                      >
                        <Box
                          sx={{
                            position: 'relative',
                            '&:hover .photo-action-button': {
                              opacity: 1,
                            },
                          }}
                        >
                          <Box
                            component="img"
                            src={photo.url}
                            alt={`Order ${order.id} photo`}
                            onClick={() => {
                              handleOpenViewer(order, photo)
                            }}
                            sx={{
                              width: '100%',
                              aspectRatio: '1 / 1',
                              objectFit: 'cover',
                              display: 'block',
                              bgcolor: 'grey.100',
                              cursor: 'zoom-in',
                            }}
                          />

                          <IconButton
                            size="small"
                            aria-label="Download picture"
                            className="photo-action-button"
                            disabled={downloadingPhotoPath === photo.path || downloadingOrderId === order.id}
                            onClick={() => {
                              void handleDownloadPhoto(order, photo, index)
                            }}
                            sx={{
                              position: 'absolute',
                              right: 8,
                              bottom: 8,
                              opacity: 0,
                              transition: 'opacity 140ms ease',
                              bgcolor: 'rgba(25, 33, 52, 0.78)',
                              color: 'common.white',
                              '&:hover': {
                                bgcolor: 'rgba(15, 20, 34, 0.9)',
                              },
                            }}
                          >
                            <DownloadRoundedIcon fontSize="small" />
                          </IconButton>

                          <IconButton
                            size="small"
                            aria-label="Open picture actions"
                            className="photo-action-button"
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setPhotoMenuAnchorEl(event.currentTarget)
                              setPhotoMenuTarget({
                                orderId: order.id,
                                path: photo.path,
                              })
                            }}
                            sx={{
                              position: 'absolute',
                              right: 8,
                              top: 8,
                              opacity: 0,
                              transition: 'opacity 140ms ease',
                              bgcolor: 'rgba(25, 33, 52, 0.78)',
                              color: 'common.white',
                              '&:hover': {
                                bgcolor: 'rgba(15, 20, 34, 0.9)',
                              },
                            }}
                          >
                            <MoreVertRoundedIcon fontSize="small" />
                          </IconButton>
                        </Box>

                        <Box sx={{ p: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            {formatDisplayDate(photo.createdAt)}
                          </Typography>
                        </Box>
                      </Paper>
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )
          })
        : null}

      <Menu
        anchorEl={photoMenuAnchorEl}
        open={Boolean(photoMenuAnchorEl && photoMenuTarget)}
        onClose={handleClosePhotoMenu}
      >
        <MenuItem
          onClick={() => {
            if (photoMenuTarget) {
              setDeleteTarget(photoMenuTarget)
            }

            handleClosePhotoMenu()
          }}
          disabled={!photoMenuTarget || isDeletingPhoto}
        >
          <ListItemIcon>
            <DeleteOutlineRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!isDeletingPhoto) {
            setDeleteTarget(null)
          }
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Delete Picture</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
            Are you sure you want to delete this picture? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteTarget(null)}
            disabled={isDeletingPhoto}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              void handleDeletePhoto()
            }}
            disabled={isDeletingPhoto || !deleteTarget}
          >
            {isDeletingPhoto ? 'Deleting...' : 'Delete Picture'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(viewerTarget)}
        onClose={handleCloseViewer}
        fullWidth
        maxWidth={false}
        PaperProps={{
          sx: {
            width: 'min(96vw, 1680px)',
            maxHeight: '96vh',
          },
        }}
      >
        <DialogTitle>
          {viewerTarget ? `${viewerTarget.orderName} • Order #${viewerTarget.orderId}` : 'Picture Preview'}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1.25}
              alignItems={{ xs: 'stretch', md: 'center' }}
              justifyContent="space-between"
            >
              <Typography variant="body2" color="text.secondary">
                {viewerTarget ? formatDisplayDate(viewerTarget.photo.createdAt) : ''}
              </Typography>

              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 280 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ZoomOutRoundedIcon fontSize="small" />}
                  onClick={() => {
                    handleViewerZoomChange(viewerZoom - VIEWER_ZOOM_STEP)
                  }}
                  disabled={viewerZoom <= MIN_VIEWER_ZOOM}
                >
                  Zoom Out
                </Button>

                <Slider
                  size="small"
                  value={viewerZoom}
                  min={MIN_VIEWER_ZOOM}
                  max={MAX_VIEWER_ZOOM}
                  step={VIEWER_ZOOM_STEP}
                  valueLabelDisplay="off"
                  onChange={(_event, value) => {
                    handleViewerZoomChange(Array.isArray(value) ? value[0] : value)
                  }}
                  sx={{ mx: 1 }}
                />

                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ZoomInRoundedIcon fontSize="small" />}
                  onClick={() => {
                    handleViewerZoomChange(viewerZoom + VIEWER_ZOOM_STEP)
                  }}
                  disabled={viewerZoom >= MAX_VIEWER_ZOOM}
                >
                  Zoom In
                </Button>

                <Button
                  size="small"
                  variant="text"
                  startIcon={<RestartAltRoundedIcon fontSize="small" />}
                  onClick={() => {
                      if (!viewerImageSize || !viewerViewportRef.current) {
                        handleViewerZoomChange(100)
                        return
                      }

                      const fitZoom = computeViewerFitZoom(
                        viewerImageSize.width,
                        viewerImageSize.height,
                        viewerViewportRef.current.clientWidth - 16,
                        viewerViewportRef.current.clientHeight - 16,
                      )
                      handleViewerZoomChange(fitZoom)
                  }}
                    disabled={!viewerImageSize}
                >
                    Fit
                </Button>
              </Stack>
            </Stack>

            <Box
                ref={viewerViewportRef}
              onWheel={handleViewerWheel}
                onMouseDown={handleViewerMouseDown}
                onMouseMove={handleViewerMouseMove}
                onMouseUp={stopViewerDragging}
                onMouseLeave={stopViewerDragging}
              sx={{
                maxHeight: '72vh',
                overflow: 'auto',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'grey.100',
                p: 1,
                  cursor: isViewerDragging ? 'grabbing' : 'grab',
                  userSelect: 'none',
              }}
            >
              {viewerTarget ? (
                <Box
                  component="img"
                    onLoad={handleViewerImageLoad}
                    draggable={false}
                    onDragStart={(event) => {
                      event.preventDefault()
                    }}
                  src={viewerTarget.photo.url}
                  alt={`Order ${viewerTarget.orderId} photo`}
                  sx={{
                      width: viewerImageSize
                        ? `${Math.max(1, Math.round((viewerImageSize.width * viewerZoom) / 100))}px`
                        : '100%',
                      height: viewerImageSize
                        ? `${Math.max(1, Math.round((viewerImageSize.height * viewerZoom) / 100))}px`
                        : 'auto',
                    maxWidth: 'none',
                    display: 'block',
                      mx: 0,
                    borderRadius: 0.5,
                    boxShadow: 1,
                    bgcolor: 'common.white',
                      pointerEvents: 'none',
                  }}
                />
              ) : null}
            </Box>

            <Typography variant="caption" color="text.secondary">
                Zoom: {viewerZoom}% • Use mouse wheel to zoom and click-drag to pan.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseViewer}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

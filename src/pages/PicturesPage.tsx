import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
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
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Lightbox from 'yet-another-react-lightbox'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import {
  fetchDashboardBootstrap,
} from '../features/dashboard/api'
import { useAuth } from '../auth/useAuth'
import { formatDateTime, formatDisplayDate } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

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
  photo: OrderPhoto
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
  const queryClient = useQueryClient()

  const [searchQuery, setSearchQuery] = useState('')
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

  // ---------------------------------------------------------------------------
  // Data queries
  // bootstrapQuery shares QUERY_KEYS.dashboardBootstrap with DashboardPage —
  // free cache hit on nav. photosIndexQuery has its own key.
  // ---------------------------------------------------------------------------
  const bootstrapQuery = useQuery({
    queryKey: QUERY_KEYS.dashboardBootstrap,
    queryFn: () => fetchDashboardBootstrap({ refresh: false }),
    staleTime: 3 * 60 * 1000,
  })

  const photosIndexQuery = useQuery({
    queryKey: ['pictures', 'photos-index'],
    queryFn: () => fetchOrderPhotosIndex(),
    staleTime: 5 * 60 * 1000,
  })

  // Derive pictureOrders by joining both query results
  const pictureOrders = useMemo(() => {
    const mondayOrders = Array.isArray(bootstrapQuery.data?.mondaySnapshot?.orders) ? bootstrapQuery.data.mondaySnapshot.orders : []
    const orderNameById = new Map(mondayOrders.map((order) => [String(order.id), order.name]))
    const groupedPhotos = Array.isArray(photosIndexQuery.data?.orders) ? photosIndexQuery.data.orders : []

    return groupedPhotos
      .filter((group) => Array.isArray(group.photos) && group.photos.length > 0)
      .map((group) => ({
        id: String(group.orderId),
        name: orderNameById.get(String(group.orderId)) ?? `Order #${String(group.orderId)}`,
        photos: group.photos,
      }))
  }, [bootstrapQuery.data, photosIndexQuery.data])

  const generatedAt = bootstrapQuery.data?.mondaySnapshot?.generatedAt ?? photosIndexQuery.data?.generatedAt ?? null
  const isLoading = photosIndexQuery.isLoading
  const isRefreshing = photosIndexQuery.isFetching && !photosIndexQuery.isLoading
  const loadingError = photosIndexQuery.isError
    ? readErrorMessage(photosIndexQuery.error, 'Failed to load pictures.')
    : bootstrapQuery.isError
      ? 'Loaded pictures, but could not refresh order names from Monday.'
      : null

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
      // Optimistically remove the photo from the cache — no refetch needed
      queryClient.setQueryData<PhotosIndexResponse>(QUERY_KEYS.photosIndex, (old) => {
        if (!old) return old
        return {
          ...old,
          orders: old.orders
            .map((group) =>
              group.orderId !== deleteTarget.orderId
                ? group
                : { ...group, photos: group.photos.filter((photo) => photo.path !== deleteTarget.path) },
            )
            .filter((group) => group.photos.length > 0),
        }
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
  }, [deleteTarget, logActivity, queryClient])

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
      photo,
    })

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
  }, [])

  const viewerSlides = useMemo(
    () => (viewerTarget ? [{ src: viewerTarget.photo.url }] : []),
    [viewerTarget],
  )

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
            Order photo gallery • Last sync {formatDateTime(generatedAt)}
          </Typography>
        </Box>

        <Button
          variant="contained"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.photosIndex })
            void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dashboardBootstrap })
          }}
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
      {(errorMessage || loadingError) ? <Alert severity="error">{errorMessage || loadingError}</Alert> : null}

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
                  {isExpanded ? (
                    <>
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
                                loading="lazy"
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
                                {formatDisplayDate(photo.createdAt, {
                                  emptyLabel: 'Unknown date',
                                  dateOnly: false,
                                })}
                              </Typography>
                            </Box>
                          </Paper>
                        ))}
                      </Box>
                    </>
                  ) : null}
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

      <Lightbox
        open={Boolean(viewerTarget)}
        close={handleCloseViewer}
        slides={viewerSlides}
        plugins={[Zoom]}
        controller={{
          closeOnBackdropClick: true,
          closeOnPullDown: true,
        }}
        carousel={{ finite: true }}
        toolbar={{ buttons: [] }}
        render={{
          buttonPrev: () => null,
          buttonNext: () => null,
        }}
        styles={{
          container: {
            backgroundColor: 'rgba(6, 10, 18, 0.96)',
          },
          slide: {
            padding: 0,
          },
        }}
        zoom={{
          maxZoomPixelRatio: 5,
          wheelZoomDistanceFactor: 120,
          pinchZoomDistanceFactor: 100,
          scrollToZoom: true,
        }}
      />
    </Stack>
  )
}

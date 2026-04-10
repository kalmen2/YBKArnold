import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchMondayDashboardSnapshot,
} from '../features/dashboard/api'

const DEPLOYED_API_BASE_URL = 'https://us-central1-ybkarnold-b7ec0.cloudfunctions.net/apiV1'

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

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error ?? 'Request failed.')
  }

  return payload as T
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

async function fetchOrderPhotosIndex() {
  try {
    return await request<PhotosIndexResponse>('/api/orders/photos-index')
  } catch {
    return request<PhotosIndexResponse>(
      `${DEPLOYED_API_BASE_URL}/api/orders/photos-index`,
    )
  }
}

export default function PicturesPage() {
  const [pictureOrders, setPictureOrders] = useState<PictureOrder[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

      if (mondayResult.status === 'fulfilled') {
        setGeneratedAt(mondayResult.value.generatedAt)
      } else {
        setGeneratedAt(photosIndexResult.value.generatedAt)
        setErrorMessage('Loaded pictures, but could not refresh order names from Monday.')
      }
    } catch (error) {
      setPictureOrders([])
      setGeneratedAt(null)
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to load pictures.',
      )
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

            return (
              <Paper key={order.id} variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    gap={1}
                  >
                    <Box>
                      <Typography variant="h6" fontWeight={700}>
                        {order.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Order #{order.id}
                      </Typography>
                    </Box>

                    <Chip
                      label={`${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}
                      color="primary"
                      variant="outlined"
                    />
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
                    {photos.map((photo) => (
                      <Paper
                        key={photo.path}
                        variant="outlined"
                        sx={{ overflow: 'hidden' }}
                      >
                        <Box
                          component="img"
                          src={photo.url}
                          alt={`Order ${order.id} photo`}
                          sx={{
                            width: '100%',
                            aspectRatio: '1 / 1',
                            objectFit: 'cover',
                            display: 'block',
                            bgcolor: 'grey.100',
                          }}
                        />

                        <Box sx={{ p: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            {formatDisplayDate(photo.createdAt)}
                          </Typography>
                        </Box>
                      </Paper>
                    ))}
                  </Box>
                </Stack>
              </Paper>
            )
          })
        : null}
    </Stack>
  )
}

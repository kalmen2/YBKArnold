import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Popper,
  Stack,
  Typography,
} from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { apiFetch } from '../../features/api-client'
import {
  postOrdersShopDrawingDelete,
  postOrdersShopDrawingUpload,
  type OrdersShopDrawingManageResponse,
  type OrdersOverviewOrder,
} from '../../features/orders/api'
import { QUERY_KEYS } from '../../lib/queryKeys'
import { resolveShopDrawingUrl } from './shopDrawingUrl'

const HOVER_OPEN_DELAY_MS = 220
const HOVER_CLOSE_DELAY_MS = 650

const SHOP_DRAWING_UPLOAD_SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function inferShopDrawingMimeTypeFromFileName(fileName: string) {
  const normalized = String(fileName ?? '').trim().toLowerCase()

  if (normalized.endsWith('.pdf')) {
    return 'application/pdf'
  }

  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
    return 'image/jpeg'
  }

  if (normalized.endsWith('.png')) {
    return 'image/png'
  }

  if (normalized.endsWith('.webp')) {
    return 'image/webp'
  }

  if (normalized.endsWith('.heic')) {
    return 'image/heic'
  }

  if (normalized.endsWith('.heif')) {
    return 'image/heif'
  }

  return ''
}

function resolveShopDrawingUploadMimeType(file: File) {
  const fromFile = String(file?.type ?? '').trim().toLowerCase()

  if (SHOP_DRAWING_UPLOAD_SUPPORTED_MIME_TYPES.has(fromFile)) {
    return fromFile
  }

  const fromName = inferShopDrawingMimeTypeFromFileName(file?.name ?? '')

  if (SHOP_DRAWING_UPLOAD_SUPPORTED_MIME_TYPES.has(fromName)) {
    return fromName
  }

  return ''
}

type ShopDrawingPreviewHandle = {
  openHover: (event: React.MouseEvent<HTMLElement>, order: OrdersOverviewOrder) => void
  closeHover: () => void
  leaveHoverTrigger: () => void
  scheduleHoverClose: () => void
  openDialog: (order: OrdersOverviewOrder) => Promise<void>
}

type ShopDrawingPreviewProps = {
  onError: (message: string) => void
  bind: (handle: ShopDrawingPreviewHandle) => void
}

export function ShopDrawingPreview({ onError, bind }: ShopDrawingPreviewProps) {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()

  const [hoverOpen, setHoverOpen] = useState(false)
  const [hoverAnchorEl, setHoverAnchorEl] = useState<HTMLElement | null>(null)
  const [hoverOrder, setHoverOrder] = useState<OrdersOverviewOrder | null>(null)
  const [hoverUrl, setHoverUrl] = useState('')
  const [hoverLoading, setHoverLoading] = useState(false)

  const [dialogOrder, setDialogOrder] = useState<OrdersOverviewOrder | null>(null)
  const [dialogSrc, setDialogSrc] = useState('')
  const [dialogLoading, setDialogLoading] = useState(false)
  const [dialogActionError, setDialogActionError] = useState<string | null>(null)
  const [dialogActionSuccess, setDialogActionSuccess] = useState<string | null>(null)
  const [isReplacingDrawing, setIsReplacingDrawing] = useState(false)
  const [isDeletingDrawing, setIsDeletingDrawing] = useState(false)

  const objectUrlRef = useRef<string | null>(null)
  const hoverObjectUrlsRef = useRef<Map<string, string>>(new Map())
  const hoverPendingRequestsRef = useRef<Map<string, Promise<string | null>>>(new Map())
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverRequestSeqRef = useRef(0)
  const overTriggerRef = useRef(false)
  const overPopoverRef = useRef(false)
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null)

  const canManageShopDrawing = appUser?.isAdmin === true || appUser?.isManager === true

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()

      reader.onload = () => {
        const result = typeof reader.result === 'string'
          ? reader.result
          : ''

        if (!result) {
          reject(new Error('Could not read file data.'))
          return
        }

        resolve(result)
      }

      reader.onerror = () => {
        reject(new Error('Could not read file data.'))
      }

      reader.readAsDataURL(file)
    })
  }

  const clearObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }, [])

  const clearHoverObjectUrls = useCallback(() => {
    hoverObjectUrlsRef.current.forEach((url) => {
      URL.revokeObjectURL(url)
    })
    hoverObjectUrlsRef.current.clear()
  }, [])

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearObjectUrl()
      clearHoverObjectUrls()
      clearOpenTimer()
      clearCloseTimer()
    }
  }, [clearObjectUrl, clearHoverObjectUrls, clearOpenTimer, clearCloseTimer])

  const loadHoverPreviewUrl = useCallback(
    async (order: OrdersOverviewOrder) => {
      const orderId = String(order?.mondayItemId ?? '').trim()

      if (!orderId) {
        return null
      }

      const cachedObjectUrl = hoverObjectUrlsRef.current.get(orderId)

      if (cachedObjectUrl) {
        return cachedObjectUrl
      }

      const inFlightRequest = hoverPendingRequestsRef.current.get(orderId)

      if (inFlightRequest) {
        return inFlightRequest
      }

      const requestPromise = (async () => {
        const query = new URLSearchParams({ orderId })
        let response: Response

        try {
          response = await apiFetch(`/api/dashboard/monday/shop-drawing/download?${query.toString()}`)
        } catch {
          return null
        }

        const blob = await response.blob()

        if (!blob || blob.size <= 0) {
          return null
        }

        const objectUrl = URL.createObjectURL(blob)
        hoverObjectUrlsRef.current.set(orderId, objectUrl)

        return objectUrl
      })()

      hoverPendingRequestsRef.current.set(orderId, requestPromise)

      try {
        return await requestPromise
      } finally {
        hoverPendingRequestsRef.current.delete(orderId)
      }
    },
    [],
  )

  const closeHover = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    hoverRequestSeqRef.current += 1
    overTriggerRef.current = false
    overPopoverRef.current = false
    setHoverOpen(false)
    setHoverAnchorEl(null)
    setHoverUrl('')
    setHoverLoading(false)
  }, [clearOpenTimer, clearCloseTimer])

  const scheduleHoverClose = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      if (overTriggerRef.current || overPopoverRef.current) {
        closeTimerRef.current = null
        return
      }
      hoverRequestSeqRef.current += 1
      setHoverOpen(false)
      setHoverAnchorEl(null)
      setHoverUrl('')
      setHoverLoading(false)
      closeTimerRef.current = null
    }, HOVER_CLOSE_DELAY_MS)
  }, [clearCloseTimer])

  // Debounced open: a quick mouse pass (<220ms) doesn't fire a preview fetch.
  const openHover = useCallback(
    (event: React.MouseEvent<HTMLElement>, order: OrdersOverviewOrder) => {
      const orderId = String(order?.mondayItemId ?? '').trim()

      if (!orderId) {
        return
      }

      const anchor = event.currentTarget
      overTriggerRef.current = true
      clearCloseTimer()
      clearOpenTimer()
      openTimerRef.current = setTimeout(() => {
        const requestSeq = ++hoverRequestSeqRef.current
        setHoverAnchorEl((existing) => (existing === anchor ? existing : anchor))
        setHoverOrder((existing) => (existing?.id === order.id ? existing : order))
        setHoverUrl('')
        setHoverLoading(true)
        setHoverOpen(true)

        void loadHoverPreviewUrl(order)
          .then((previewUrl) => {
            if (hoverRequestSeqRef.current !== requestSeq) {
              return
            }

            if (!previewUrl) {
              setHoverOpen(false)
              setHoverAnchorEl(null)
              setHoverOrder(null)
              setHoverUrl('')
              setHoverLoading(false)
              return
            }

            setHoverUrl(previewUrl)
            setHoverLoading(false)
          })
          .catch(() => {
            if (hoverRequestSeqRef.current !== requestSeq) {
              return
            }

            setHoverOpen(false)
            setHoverAnchorEl(null)
            setHoverOrder(null)
            setHoverUrl('')
            setHoverLoading(false)
          })

        openTimerRef.current = null
      }, HOVER_OPEN_DELAY_MS)
    },
    [clearOpenTimer, clearCloseTimer, loadHoverPreviewUrl],
  )

  const leaveHoverTrigger = useCallback(() => {
    overTriggerRef.current = false
    scheduleHoverClose()
  }, [scheduleHoverClose])

  const openDialog = useCallback(
    async (order: OrdersOverviewOrder) => {
      const orderId = String(order?.mondayItemId ?? '').trim()
      const sourceUrl = resolveShopDrawingUrl(order)

      if (!orderId || !sourceUrl) {
        onError('No shop drawing is available for this order yet.')
        return
      }

      clearObjectUrl()
      setDialogSrc('')
      setDialogLoading(true)
      setDialogOrder(order)
      setDialogActionError(null)
      setDialogActionSuccess(null)

      try {
        const query = new URLSearchParams({ orderId })
        const response = await apiFetch(`/api/dashboard/monday/shop-drawing/download?${query.toString()}`)
        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        objectUrlRef.current = objectUrl
        setDialogSrc(objectUrl)
        setDialogLoading(false)
      } catch (requestError) {
        setDialogLoading(false)
        setDialogOrder(null)
        setDialogSrc('')
        onError(
          requestError instanceof Error
            ? requestError.message
            : 'Could not load shop drawing preview.',
        )
      }
    },
    [clearObjectUrl, onError],
  )

  const closeDialog = useCallback(() => {
    clearObjectUrl()
    setDialogLoading(false)
    setDialogSrc('')
    setDialogOrder(null)
    setDialogActionError(null)
    setDialogActionSuccess(null)
    setIsReplacingDrawing(false)
    setIsDeletingDrawing(false)

    if (replaceFileInputRef.current) {
      replaceFileInputRef.current.value = ''
    }
  }, [clearObjectUrl])

  const applyShopDrawingOrderUpdate = useCallback((response: OrdersShopDrawingManageResponse) => {
    const currentOrder = dialogOrder

    if (!currentOrder) {
      return
    }

    const normalizedItemId = String(response?.order?.mondayItemId ?? '').trim()
    const currentItemId = String(currentOrder?.mondayItemId ?? '').trim()

    if (!normalizedItemId || normalizedItemId !== currentItemId) {
      return
    }

    const nextCachedUrl = String(response.order.shopDrawingCachedUrl ?? '').trim() || null
    const nextSourceUrl = String(response.order.shopDrawingUrl ?? '').trim() || null
    const nextPreviewUrl = nextCachedUrl || nextSourceUrl || ''

    setDialogOrder((existing) => {
      if (!existing || String(existing.mondayItemId ?? '').trim() !== normalizedItemId) {
        return existing
      }

      return {
        ...existing,
        shopDrawingCachedUrl: nextCachedUrl,
        shopDrawingUrl: nextSourceUrl,
      }
    })

    const cachedHoverUrl = hoverObjectUrlsRef.current.get(normalizedItemId)

    if (cachedHoverUrl) {
      URL.revokeObjectURL(cachedHoverUrl)
      hoverObjectUrlsRef.current.delete(normalizedItemId)
    }

    clearObjectUrl()
    setDialogSrc(nextPreviewUrl)
  }, [clearObjectUrl, dialogOrder])

  const handleReplaceShopDrawingFile = useCallback(async (file: File) => {
    const currentOrder = dialogOrder

    if (!currentOrder || !canManageShopDrawing || isReplacingDrawing || isDeletingDrawing) {
      return
    }

    const mondayItemId = String(currentOrder.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      setDialogActionError('Monday item id is missing for this order.')
      return
    }

    const mimeType = resolveShopDrawingUploadMimeType(file)

    if (!mimeType) {
      setDialogActionError('Only PDF/JPG/PNG/WEBP/HEIC/HEIF files are supported.')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setDialogActionError('File exceeds 10MB limit.')
      return
    }

    setIsReplacingDrawing(true)
    setDialogActionError(null)
    setDialogActionSuccess(null)

    try {
      const fileBase64 = await readFileAsDataUrl(file)
      const response = await postOrdersShopDrawingUpload({
        mondayItemId,
        fileName: file.name,
        mimeType,
        fileBase64,
      })

      applyShopDrawingOrderUpdate(response)
      setDialogActionSuccess('Shop drawing replaced successfully.')

      if (response.warning) {
        setDialogActionError(response.warning)
      }

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Could not replace shop drawing.'

      setDialogActionError(message)
      onError(message)
    } finally {
      setIsReplacingDrawing(false)

      if (replaceFileInputRef.current) {
        replaceFileInputRef.current.value = ''
      }
    }
  }, [
    applyShopDrawingOrderUpdate,
    canManageShopDrawing,
    dialogOrder,
    isDeletingDrawing,
    isReplacingDrawing,
    onError,
    queryClient,
  ])

  const handleDeleteShopDrawing = useCallback(async () => {
    const currentOrder = dialogOrder

    if (!currentOrder || !canManageShopDrawing || isDeletingDrawing || isReplacingDrawing) {
      return
    }

    const mondayItemId = String(currentOrder.mondayItemId ?? '').trim()

    if (!mondayItemId) {
      setDialogActionError('Monday item id is missing for this order.')
      return
    }

    const shouldContinue = window.confirm('Delete this shop drawing from the website and Monday?')

    if (!shouldContinue) {
      return
    }

    setIsDeletingDrawing(true)
    setDialogActionError(null)
    setDialogActionSuccess(null)

    try {
      const response = await postOrdersShopDrawingDelete({ mondayItemId })

      applyShopDrawingOrderUpdate(response)
      setDialogActionSuccess('Shop drawing deleted successfully.')

      if (response.warning) {
        setDialogActionError(response.warning)
      }

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ordersOverview })
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Could not delete shop drawing.'

      setDialogActionError(message)
      onError(message)
    } finally {
      setIsDeletingDrawing(false)
    }
  }, [
    applyShopDrawingOrderUpdate,
    canManageShopDrawing,
    dialogOrder,
    isDeletingDrawing,
    isReplacingDrawing,
    onError,
    queryClient,
  ])

  // Bind imperative API to parent.
  useEffect(() => {
    bind({
      openHover,
      closeHover,
      leaveHoverTrigger,
      scheduleHoverClose,
      openDialog,
    })
  }, [bind, openHover, closeHover, leaveHoverTrigger, scheduleHoverClose, openDialog])

  const handlePopoverEnter = useCallback(() => {
    overPopoverRef.current = true
    clearCloseTimer()
  }, [clearCloseTimer])

  const handlePopoverLeave = useCallback(() => {
    overPopoverRef.current = false
    scheduleHoverClose()
  }, [scheduleHoverClose])

  return (
    <>
      <Popper
        open={Boolean(hoverOpen && hoverAnchorEl)}
        anchorEl={hoverAnchorEl}
        placement="bottom-start"
        modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}
        sx={{ zIndex: 1400 }}
      >
        <Paper
          elevation={8}
          onMouseEnter={handlePopoverEnter}
          onMouseLeave={handlePopoverLeave}
          sx={{
            p: 0.75,
            width: 300,
            borderRadius: 2,
            border: '1px solid rgba(15, 23, 42, 0.14)',
          }}
        >
          <Stack spacing={0.75}>
            {hoverLoading ? (
              <Stack
                alignItems="center"
                justifyContent="center"
                spacing={0.8}
                sx={{
                  width: '100%',
                  height: 172,
                  borderRadius: 1,
                  bgcolor: 'background.paper',
                }}
              >
                <CircularProgress size={16} />
                <Typography variant="caption" color="text.secondary">
                  Loading preview...
                </Typography>
              </Stack>
            ) : hoverUrl ? (
              <Box
                component="iframe"
                title={`Drawing preview ${hoverOrder?.orderNumber ?? ''}`}
                src={hoverUrl}
                sx={{
                  width: '100%',
                  height: 172,
                  border: 0,
                  borderRadius: 1,
                  bgcolor: 'background.paper',
                  pointerEvents: 'none',
                }}
              />
            ) : (
              <Stack
                alignItems="center"
                justifyContent="center"
                sx={{
                  width: '100%',
                  height: 172,
                  borderRadius: 1,
                  bgcolor: 'background.paper',
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  Preview unavailable
                </Typography>
              </Stack>
            )}
            <Typography variant="caption" sx={{ fontWeight: 700, px: 0.25 }}>
              {hoverOrder?.orderName || hoverOrder?.orderNumber || 'Shop Drawing'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ px: 0.25 }}>
              Click the symbol to open full popup.
            </Typography>
          </Stack>
        </Paper>
      </Popper>

      <Dialog open={Boolean(dialogOrder)} onClose={closeDialog} fullWidth maxWidth="lg">
        <DialogTitle>
          {dialogOrder
            ? `Shop Drawing - ${dialogOrder.jobNumber || dialogOrder.mondayItemId}`
            : 'Shop Drawing'}
        </DialogTitle>
        <DialogContent sx={{ p: 0, minHeight: 560 }}>
          {dialogActionError ? (
            <Alert severity="error" sx={{ mx: 2, mt: 2 }}>
              {dialogActionError}
            </Alert>
          ) : null}

          {dialogActionSuccess ? (
            <Alert severity="success" sx={{ mx: 2, mt: dialogActionError ? 1 : 2 }}>
              {dialogActionSuccess}
            </Alert>
          ) : null}

          {dialogLoading ? (
            <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ py: 6 }}>
              <CircularProgress size={28} />
              <Typography color="text.secondary">Loading preview...</Typography>
            </Stack>
          ) : dialogSrc ? (
            <Box
              component="iframe"
              title="Shop drawing preview"
              src={dialogSrc}
              sx={{ border: 0, width: '100%', height: '74vh', display: 'block' }}
            />
          ) : (
            <Alert severity="info" sx={{ m: 2 }}>
              No preview is available for this drawing.
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.25 }}>
          {canManageShopDrawing ? (
            <>
              <Button
                variant="contained"
                disabled={!dialogOrder || isReplacingDrawing || isDeletingDrawing}
                onClick={() => {
                  replaceFileInputRef.current?.click()
                }}
              >
                {isReplacingDrawing ? 'Replacing...' : 'Replace'}
              </Button>
              <Button
                color="error"
                variant="outlined"
                disabled={!dialogOrder || isReplacingDrawing || isDeletingDrawing}
                onClick={() => {
                  void handleDeleteShopDrawing()
                }}
              >
                {isDeletingDrawing ? 'Deleting...' : 'Delete'}
              </Button>
            </>
          ) : null}
          <Button onClick={closeDialog}>Close</Button>
        </DialogActions>
      </Dialog>

      <input
        ref={replaceFileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0]

          if (file) {
            void handleReplaceShopDrawingFile(file)
          }

          event.currentTarget.value = ''
        }}
      />
    </>
  )
}

export type { ShopDrawingPreviewHandle }

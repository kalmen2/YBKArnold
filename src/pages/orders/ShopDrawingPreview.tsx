import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Paper,
  Popper,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import type { OrdersOverviewOrder } from '../../features/orders/api'
import { resolveShopDrawingUrl } from './shopDrawingUrl'

const HOVER_OPEN_DELAY_MS = 220
const HOVER_CLOSE_DELAY_MS = 650

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
  const { getIdToken } = useAuth()

  const [hoverOpen, setHoverOpen] = useState(false)
  const [hoverAnchorEl, setHoverAnchorEl] = useState<HTMLElement | null>(null)
  const [hoverOrder, setHoverOrder] = useState<OrdersOverviewOrder | null>(null)
  const [hoverUrl, setHoverUrl] = useState('')

  const [dialogOrder, setDialogOrder] = useState<OrdersOverviewOrder | null>(null)
  const [dialogSrc, setDialogSrc] = useState('')
  const [dialogLoading, setDialogLoading] = useState(false)

  const objectUrlRef = useRef<string | null>(null)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overTriggerRef = useRef(false)
  const overPopoverRef = useRef(false)

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

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearObjectUrl()
      clearOpenTimer()
      clearCloseTimer()
    }
  }, [clearObjectUrl, clearOpenTimer, clearCloseTimer])

  const closeHover = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    overTriggerRef.current = false
    overPopoverRef.current = false
    setHoverOpen(false)
    setHoverAnchorEl(null)
  }, [clearOpenTimer, clearCloseTimer])

  const scheduleHoverClose = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      if (overTriggerRef.current || overPopoverRef.current) {
        closeTimerRef.current = null
        return
      }
      setHoverOpen(false)
      setHoverAnchorEl(null)
      closeTimerRef.current = null
    }, HOVER_CLOSE_DELAY_MS)
  }, [clearCloseTimer])

  // Debounced open: a quick mouse pass (<220ms) doesn't fire a PDF fetch.
  const openHover = useCallback(
    (event: React.MouseEvent<HTMLElement>, order: OrdersOverviewOrder) => {
      const url = resolveShopDrawingUrl(order)
      if (!url) {
        return
      }
      const anchor = event.currentTarget
      overTriggerRef.current = true
      clearCloseTimer()
      clearOpenTimer()
      openTimerRef.current = setTimeout(() => {
        setHoverAnchorEl((existing) => (existing === anchor ? existing : anchor))
        setHoverOrder((existing) => (existing?.id === order.id ? existing : order))
        setHoverUrl((existing) => (existing === url ? existing : url))
        setHoverOpen(true)
        openTimerRef.current = null
      }, HOVER_OPEN_DELAY_MS)
    },
    [clearOpenTimer, clearCloseTimer],
  )

  const leaveHoverTrigger = useCallback(() => {
    overTriggerRef.current = false
    scheduleHoverClose()
  }, [scheduleHoverClose])

  const openDialog = useCallback(
    async (order: OrdersOverviewOrder) => {
      const orderId = String(order?.mondayItemId ?? '').trim()
      const cachedUrl = String(order?.shopDrawingCachedUrl ?? '').trim()
      const sourceUrl = resolveShopDrawingUrl(order)

      if (!orderId || (!cachedUrl && !sourceUrl)) {
        onError('No shop drawing is available for this order yet.')
        return
      }

      clearObjectUrl()
      setDialogSrc('')
      setDialogLoading(true)
      setDialogOrder(order)

      if (cachedUrl) {
        setDialogSrc(cachedUrl)
        setDialogLoading(false)
        return
      }

      try {
        const idToken = await getIdToken()
        const query = new URLSearchParams({ orderId })
        const response = await fetch(
          `/api/dashboard/monday/shop-drawing/download?${query.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
              'x-client-platform': 'web',
            },
          },
        )

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          const message = typeof payload?.error === 'string'
            ? payload.error
            : 'Could not load shop drawing preview.'
          throw new Error(message)
        }

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
    [clearObjectUrl, getIdToken, onError],
  )

  const closeDialog = useCallback(() => {
    clearObjectUrl()
    setDialogLoading(false)
    setDialogSrc('')
    setDialogOrder(null)
  }, [clearObjectUrl])

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
        open={Boolean(hoverOpen && hoverAnchorEl && hoverUrl)}
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
      </Dialog>
    </>
  )
}

export type { ShopDrawingPreviewHandle }

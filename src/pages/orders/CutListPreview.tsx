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
import { resolveCutListUrl } from './cutListUrl'

const HOVER_OPEN_DELAY_MS = 220
const HOVER_CLOSE_DELAY_MS = 650

type CutListPreviewHandle = {
  openHover: (event: React.MouseEvent<HTMLElement>, order: OrdersOverviewOrder) => void
  closeHover: () => void
  leaveHoverTrigger: () => void
  scheduleHoverClose: () => void
  openDialog: (order: OrdersOverviewOrder) => Promise<void>
}

type CutListPreviewProps = {
  onError: (message: string) => void
  bind: (handle: CutListPreviewHandle) => void
}

export function CutListPreview({ onError, bind }: CutListPreviewProps) {
  const { getIdToken } = useAuth()

  const [hoverOpen, setHoverOpen] = useState(false)
  const [hoverAnchorEl, setHoverAnchorEl] = useState<HTMLElement | null>(null)
  const [hoverOrder, setHoverOrder] = useState<OrdersOverviewOrder | null>(null)
  const [hoverUrl, setHoverUrl] = useState('')
  const [hoverLoading, setHoverLoading] = useState(false)

  const [dialogOrder, setDialogOrder] = useState<OrdersOverviewOrder | null>(null)
  const [dialogSrc, setDialogSrc] = useState('')
  const [dialogLoading, setDialogLoading] = useState(false)

  const objectUrlRef = useRef<string | null>(null)
  const hoverObjectUrlsRef = useRef<Map<string, string>>(new Map())
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverRequestSeqRef = useRef(0)
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

      const idToken = await getIdToken()
      const query = new URLSearchParams({ orderId })
      const response = await fetch(
        `/api/dashboard/monday/cut-list/download?${query.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
            'x-client-platform': 'web',
          },
        },
      )

      if (!response.ok) {
        return null
      }

      const blob = await response.blob()

      if (!blob || blob.size <= 0) {
        return null
      }

      const objectUrl = URL.createObjectURL(blob)
      hoverObjectUrlsRef.current.set(orderId, objectUrl)

      return objectUrl
    },
    [getIdToken],
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
      const cachedUrl = String(order?.cutListCachedUrl ?? '').trim()
      const sourceUrl = resolveCutListUrl(order)

      if (!orderId || (!cachedUrl && !sourceUrl)) {
        onError('No cut list is available for this order yet.')
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
          `/api/dashboard/monday/cut-list/download?${query.toString()}`,
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
            : 'Could not load cut list preview.'
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
            : 'Could not load cut list preview.',
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
                title={`Cut list preview ${hoverOrder?.orderNumber ?? ''}`}
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
              {hoverOrder?.orderName || hoverOrder?.orderNumber || 'Cut List'}
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
            ? `Cut List - ${dialogOrder.jobNumber || dialogOrder.mondayItemId}`
            : 'Cut List'}
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
              title="Cut list preview"
              src={dialogSrc}
              sx={{ border: 0, width: '100%', height: '74vh', display: 'block' }}
            />
          ) : (
            <Alert severity="info" sx={{ m: 2 }}>
              No preview is available for this cut list.
            </Alert>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export type { CutListPreviewHandle }

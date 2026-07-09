import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../features/api-client'
import type { OrdersOverviewOrder } from '../../features/orders/api'

type InvoicePreviewHandle = {
  openDialog: (order: OrdersOverviewOrder) => Promise<void>
}

type InvoicePreviewProps = {
  onError: (message: string) => void
  bind: (handle: InvoicePreviewHandle) => void
}

export function InvoicePreview({ onError, bind }: InvoicePreviewProps) {
  const [dialogOrder, setDialogOrder] = useState<OrdersOverviewOrder | null>(null)
  const [dialogSrc, setDialogSrc] = useState('')
  const [dialogLoading, setDialogLoading] = useState(false)
  const objectUrlRef = useRef<string | null>(null)

  const clearObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearObjectUrl()
    }
  }, [clearObjectUrl])

  const openDialog = useCallback(async (order: OrdersOverviewOrder) => {
    const orderId = String(order?.mondayItemId ?? '').trim()
    const orderNumber = String(order?.orderNumber ?? '').trim()
    const invoiceNumber = String(order?.invoiceNumber ?? '').trim()

    if ((!orderId && !orderNumber) || !invoiceNumber) {
      onError('No invoice is available for this order yet.')
      return
    }

    clearObjectUrl()
    setDialogOrder(order)
    setDialogSrc('')
    setDialogLoading(true)

    try {
      const query = new URLSearchParams()

      if (orderId) {
        query.set('orderId', orderId)
      }

      if (orderNumber) {
        query.set('orderNumber', orderNumber)
      }

      const response = await apiFetch(`/api/orders/invoice/download?${query.toString()}`)
      const blob = await response.blob()

      if (!blob || blob.size <= 0) {
        throw new Error('Could not load invoice preview.')
      }

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
          : 'Could not load invoice preview.',
      )
    }
  }, [clearObjectUrl, onError])

  const closeDialog = useCallback(() => {
    clearObjectUrl()
    setDialogLoading(false)
    setDialogSrc('')
    setDialogOrder(null)
  }, [clearObjectUrl])

  useEffect(() => {
    bind({
      openDialog,
    })
  }, [bind, openDialog])

  return (
    <Dialog open={Boolean(dialogOrder)} onClose={closeDialog} fullWidth maxWidth="lg">
      <DialogTitle>
        {dialogOrder
          ? `Invoice - ${dialogOrder.orderNumber || dialogOrder.jobNumber || dialogOrder.mondayItemId}`
          : 'Invoice'}
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
            title="Invoice preview"
            src={dialogSrc}
            sx={{ border: 0, width: '100%', height: '74vh', display: 'block' }}
          />
        ) : (
          <Alert severity="info" sx={{ m: 2 }}>
            No invoice preview is available.
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  )
}

export type { InvoicePreviewHandle }

import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  fetchDeletedOrders,
  postOrdersDelete,
  restoreDeletedOrder,
  type DeletedOrderQueueRecord,
} from '../features/orders/api'
import { formatDateTime, formatOptional } from '../lib/formatters'
import { useState } from 'react'

export default function AdminDeletedItemsPage() {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [workingKey, setWorkingKey] = useState<string | null>(null)
  const queue = useQuery({
    queryKey: ['orders', 'deletion-queue'],
    queryFn: () => fetchDeletedOrders(),
    enabled: appUser?.isAdmin === true,
  })

  if (!appUser?.isAdmin) return <Navigate to="/dashboard" replace />

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['orders', 'deletion-queue'] })
    await queryClient.invalidateQueries({ queryKey: ['orders'] })
  }

  const restore = async (order: DeletedOrderQueueRecord) => {
    if (!window.confirm(`Restore ${order.order_number || order.order_name || order.orderKey}?`)) return
    setWorkingKey(order.orderKey)
    setErrorMessage(null)
    try {
      await restoreDeletedOrder(order.orderKey)
      setSuccessMessage('Order restored.')
      await refresh()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not restore order.')
    } finally {
      setWorkingKey(null)
    }
  }

  const permanentlyDelete = async (order: DeletedOrderQueueRecord) => {
    const label = order.order_number || order.order_name || order.orderKey
    if (!window.confirm(`Permanently delete ${label} from the website and Monday? This cannot be undone.`)) return
    setWorkingKey(order.orderKey)
    setErrorMessage(null)
    try {
      await postOrdersDelete({ orderKey: order.orderKey })
      setSuccessMessage(`Permanently deleted ${label}.`)
      await refresh()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not permanently delete order.')
    } finally {
      setWorkingKey(null)
    }
  }

  return (
    <Stack spacing={1.5}>
      <StatusAlerts errorMessage={errorMessage} successMessage={successMessage} />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" fontWeight={700}>Deleted Items</Typography>
        <Typography variant="body2" color="text.secondary">
          Non-admin order deletions remain here until an administrator restores or permanently deletes them.
        </Typography>
      </Paper>
      <LoadingPanel loading={queue.isLoading} message="Loading deleted items..." contained />
      {!queue.isLoading && (queue.data?.orders.length ?? 0) === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">No deleted orders are waiting for review.</Typography>
        </Paper>
      ) : null}
      {(queue.data?.orders ?? []).map((order) => {
        const label = order.order_number || order.order_name || order.orderKey
        const working = workingKey === order.orderKey
        return (
          <Paper key={order.orderKey} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ md: 'center' }}>
              <Box>
                <Typography fontWeight={700}>{label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Requested by {formatOptional(order.deleteRequestedByEmail)} on {formatDateTime(order.deleteRequestedAt)}
                  {order.has_quickbooks_record ? ' · Linked to QuickBooks' : ''}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" startIcon={<RestoreRoundedIcon />} disabled={working} onClick={() => void restore(order)}>Restore</Button>
                <Button size="small" color="error" startIcon={<DeleteForeverRoundedIcon />} disabled={working} onClick={() => void permanentlyDelete(order)}>Delete permanently</Button>
              </Stack>
            </Stack>
          </Paper>
        )
      })}
    </Stack>
  )
}

import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded'
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  fetchDeletedOrders,
  postOrdersDelete,
  purgeDeletedOrder,
  restoreDeletedOrder,
  type DeletedOrderQueueRecord,
} from '../features/orders/api'
import {
  confirmCrmQuoteLineLibraryEntryDeletion,
  fetchCrmQuoteLineLibrary,
  restoreCrmQuoteLineLibraryEntry,
  type CrmQuoteLineLibraryEntry,
} from '../features/crm/api'
import { formatDateTime, formatOptional } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'
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
  const quoteLibraryQueue = useQuery({
    queryKey: [...QUERY_KEYS.crmQuoteLineLibrary, 'deleted'],
    queryFn: () => fetchCrmQuoteLineLibrary({ includeDeleted: true }),
    enabled: appUser?.isAdmin === true,
  })

  if (!appUser?.isAdmin) return <Navigate to="/dashboard" replace />

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['orders', 'deletion-queue'] })
    await queryClient.invalidateQueries({ queryKey: ['orders'] })
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuoteLineLibrary })
  }

  const restoreLibraryEntry = async (entry: CrmQuoteLineLibraryEntry) => {
    if (!window.confirm(`Restore ${entry.name}?`)) return
    setWorkingKey(entry.id)
    setErrorMessage(null)
    try {
      await restoreCrmQuoteLineLibraryEntry(entry.id)
      setSuccessMessage('Quote library item restored.')
      await refresh()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not restore the quote library item.')
    } finally {
      setWorkingKey(null)
    }
  }

  const permanentlyDeleteLibraryEntry = async (entry: CrmQuoteLineLibraryEntry) => {
    if (!window.confirm(`Permanently delete ${entry.name}? This cannot be undone.`)) return
    setWorkingKey(entry.id)
    setErrorMessage(null)
    try {
      await confirmCrmQuoteLineLibraryEntryDeletion(entry.id)
      setSuccessMessage('Quote library item permanently deleted.')
      await refresh()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not permanently delete the quote library item.')
    } finally {
      setWorkingKey(null)
    }
  }

  const deletedLibraryEntries = (quoteLibraryQueue.data?.entries || []).filter((entry) => entry.recordStatus === 'deleted')

  const rowKey = (order: DeletedOrderQueueRecord) => order.archivedId || order.orderKey || ''
  const rowLabel = (order: DeletedOrderQueueRecord) => order.order_number || order.order_name || rowKey(order)

  const restore = async (order: DeletedOrderQueueRecord) => {
    if (!order.archivedId) return
    if (!window.confirm(`Push ${rowLabel(order)} back into Orders? Its Monday card was deleted and is not recreated.`)) return
    setWorkingKey(rowKey(order))
    setErrorMessage(null)
    try {
      const response = await restoreDeletedOrder(order.archivedId)
      setSuccessMessage(response.warnings?.[0] || 'Order restored.')
      await refresh()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not restore order.')
    } finally {
      setWorkingKey(null)
    }
  }

  // A cancelled order is still in the live collection, so clearing it means
  // deleting it into the archive first. An archived one is purged outright.
  const permanentlyDelete = async (order: DeletedOrderQueueRecord) => {
    const label = rowLabel(order)
    const prompt = order.state === 'cancelled'
      ? `Delete cancelled order ${label}? It moves to the deleted archive, where it can be pushed back or cleared for good.`
      : `Clear ${label} for good, along with its generated PDFs? This cannot be undone.`
    if (!window.confirm(prompt)) return
    setWorkingKey(rowKey(order))
    setErrorMessage(null)
    try {
      if (order.state === 'cancelled') {
        await postOrdersDelete({ orderKey: order.orderKey ?? undefined })
        setSuccessMessage(`Moved ${label} to the deleted archive.`)
      } else if (order.archivedId) {
        await purgeDeletedOrder(order.archivedId)
        setSuccessMessage(`Cleared ${label} for good.`)
      }
      await refresh()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not delete order.')
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
          A deleted order is removed from Orders completely — Monday card included — and archived here. Its
          acknowledgement number is free to reuse immediately. An admin can push it back into Orders (it returns
          unlinked from Monday) or clear it for good along with its generated PDFs. Cancelled orders are still live
          history; deleting one moves it into the same archive.
        </Typography>
      </Paper>
      <LoadingPanel loading={queue.isLoading} message="Loading deleted items..." contained />
      {!queue.isLoading && !quoteLibraryQueue.isLoading && (queue.data?.orders.length ?? 0) === 0 && deletedLibraryEntries.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">No deleted items are waiting for review.</Typography>
        </Paper>
      ) : null}
      {(queue.data?.orders ?? []).map((order) => {
        const label = rowLabel(order)
        const working = workingKey === rowKey(order)
        return (
          <Paper key={rowKey(order)} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ md: 'center' }}>
              <Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography fontWeight={700}>{label}</Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={order.state === 'cancelled' ? 'warning' : 'default'}
                    label={order.state === 'cancelled' ? 'Cancelled' : 'Deleted'}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {order.state === 'cancelled' ? 'Cancelled' : 'Deleted'} by {formatOptional(order.finishedByEmail)} on {formatDateTime(order.finishedAt)}
                  {order.has_quickbooks_record ? ' · Linked to QuickBooks' : ''}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                {order.state === 'cancelled' ? null : (
                  <Button size="small" startIcon={<RestoreRoundedIcon />} disabled={working} onClick={() => void restore(order)}>Push back</Button>
                )}
                <Button size="small" color="error" startIcon={<DeleteForeverRoundedIcon />} disabled={working} onClick={() => void permanentlyDelete(order)}>
                  {order.state === 'cancelled' ? 'Delete' : 'Clear for good'}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        )
      })}
      {deletedLibraryEntries.map((entry) => {
        const working = workingKey === entry.id
        return (
          <Paper key={entry.id} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ md: 'center' }}>
              <Box>
                <Typography fontWeight={700}>{entry.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Quote line library item requested by {formatOptional(entry.deleteRequestedByEmail)} on {formatDateTime(entry.deleteRequestedAt)}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" startIcon={<RestoreRoundedIcon />} disabled={working} onClick={() => void restoreLibraryEntry(entry)}>Restore</Button>
                <Button size="small" color="error" startIcon={<DeleteForeverRoundedIcon />} disabled={working} onClick={() => void permanentlyDeleteLibraryEntry(entry)}>Delete permanently</Button>
              </Stack>
            </Stack>
          </Paper>
        )
      })}
    </Stack>
  )
}

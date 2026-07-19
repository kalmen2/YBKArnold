import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded'
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  confirmCrmDeletion,
  fetchCrmDeletionQueue,
  restoreCrmDeletion,
  type CrmDeletionQueueRecordContact,
  type CrmDeletionQueueRecordDealer,
} from '../features/crm/api'
import { formatDateTime, formatOptional } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type EntityType = 'dealer' | 'contact'
type ActionType = 'confirm' | 'restore'

const deletionQueueLimit = 500

function byRequestedAtDescending<T extends { deleteRequestedAt: string | null; updatedAt: string | null }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const left = Date.parse(a.deleteRequestedAt ?? a.updatedAt ?? '') || 0
    const right = Date.parse(b.deleteRequestedAt ?? b.updatedAt ?? '') || 0
    return right - left
  })
}

export default function AdminSalesReviewPage() {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()

  const [processingActionKeys, setProcessingActionKeys] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const deletionQueueQuery = useQuery({
    queryKey: QUERY_KEYS.crmDeletionQueue(deletionQueueLimit),
    queryFn: () => fetchCrmDeletionQueue(deletionQueueLimit),
    staleTime: 60 * 1000,
    enabled: appUser?.isAdmin === true,
  })

  const deletionQueueDealers = useMemo(
    () => byRequestedAtDescending(deletionQueueQuery.data?.dealers ?? []),
    [deletionQueueQuery.data?.dealers],
  )

  const deletionQueueContacts = useMemo(
    () => byRequestedAtDescending(deletionQueueQuery.data?.contacts ?? []),
    [deletionQueueQuery.data?.contacts],
  )

  const queueTotal = deletionQueueQuery.data?.total ?? 0

  const makeActionKey = useCallback((action: ActionType, entityType: EntityType, sourceId: string) => {
    return `${action}:${entityType}:${sourceId}`
  }, [])

  const isActionProcessing = useCallback((action: ActionType, entityType: EntityType, sourceId: string) => {
    return processingActionKeys.includes(makeActionKey(action, entityType, sourceId))
  }, [makeActionKey, processingActionKeys])

  const setActionProcessing = useCallback((
    action: ActionType,
    entityType: EntityType,
    sourceId: string,
    processing: boolean,
  ) => {
    const actionKey = makeActionKey(action, entityType, sourceId)

    setProcessingActionKeys((current) => {
      if (processing) {
        return current.includes(actionKey) ? current : [...current, actionKey]
      }

      return current.filter((entry) => entry !== actionKey)
    })
  }, [makeActionKey])

  const refreshData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'deletion-queue'] })
  }, [queryClient])

  const refreshDataAfterMutation = useCallback(() => {
    refreshData()
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmDealers })
  }, [queryClient, refreshData])

  const handleConfirmDeletion = useCallback(async (
    entityType: EntityType,
    sourceId: string,
    entityLabel: string,
  ) => {
    const targetLabel = `${entityType === 'dealer' ? 'account' : 'contact'} ${entityLabel}`

    if (!window.confirm(`Permanently delete ${targetLabel}? This cannot be undone.`)) {
      return
    }

    const includeContacts = entityType === 'dealer'
      ? window.confirm('Also permanently delete all contacts linked to this account?')
      : false

    setErrorMessage(null)
    setSuccessMessage(null)
    setActionProcessing('confirm', entityType, sourceId, true)

    try {
      const result = await confirmCrmDeletion(entityType, sourceId, {
        includeContacts,
      })

      const dealerCount = result.deletedDealerCount ?? (entityType === 'dealer' ? 1 : 0)
      const contactCount = result.deletedContactCount ?? 0

      setSuccessMessage(
        `Deletion confirmed for ${targetLabel}. Dealers removed: ${dealerCount}. Contacts removed: ${contactCount}.`,
      )
      refreshDataAfterMutation()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to confirm deletion.')
    } finally {
      setActionProcessing('confirm', entityType, sourceId, false)
    }
  }, [refreshDataAfterMutation, setActionProcessing])

  const handleRestoreDeletion = useCallback(async (
    entityType: EntityType,
    sourceId: string,
    entityLabel: string,
  ) => {
    const targetLabel = `${entityType === 'dealer' ? 'account' : 'contact'} ${entityLabel}`

    if (!window.confirm(`Restore ${targetLabel} from the deletion queue?`)) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setActionProcessing('restore', entityType, sourceId, true)

    try {
      await restoreCrmDeletion(entityType, sourceId)
      setSuccessMessage(`Restored ${targetLabel}.`)
      refreshDataAfterMutation()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to restore deletion queue entry.')
    } finally {
      setActionProcessing('restore', entityType, sourceId, false)
    }
  }, [refreshDataAfterMutation, setActionProcessing])

  if (!appUser?.isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
          >
            <Stack direction="row" spacing={1.2} alignItems="center">
              <FactCheckRoundedIcon color="primary" />
              <Box>
                <Typography variant="h5" fontWeight={700}>
                  Sales Governance Review
                </Typography>
                <Typography color="text.secondary">
                  Review deletion requests across accounts and contacts.
                </Typography>
              </Box>
            </Stack>

            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={deletionQueueQuery.isFetching}
              onClick={refreshData}
            >
              {deletionQueueQuery.isFetching ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>

          <StatusAlerts errorMessage={errorMessage} successMessage={successMessage} />

          <Chip variant="outlined" size="small" label={`Deletion Queue (${queueTotal})`} sx={{ width: 'fit-content' }} />
        </Stack>
      </Paper>

      <Stack spacing={1.5}>
          <LoadingPanel
            loading={deletionQueueQuery.isLoading}
            message="Loading deletion queue..."
            contained
          />

          {!deletionQueueQuery.isLoading ? (
            <>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                  <Chip variant="outlined" size="small" label={`Queue total: ${queueTotal}`} />
                  <Chip variant="outlined" size="small" label={`Accounts: ${deletionQueueDealers.length}`} />
                  <Chip variant="outlined" size="small" label={`Contacts: ${deletionQueueContacts.length}`} />
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1}>
                  <Typography variant="h6" fontWeight={700}>
                    Account Deletion Queue
                  </Typography>

                  {deletionQueueDealers.length === 0 ? (
                    <Typography color="text.secondary">No accounts are waiting for admin confirmation.</Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700 }}>Account</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>State</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Requested By</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Requested At</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Updated</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, width: 250 }}>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {deletionQueueDealers.map((dealer: CrmDeletionQueueRecordDealer) => {
                            const rowLabel = formatOptional(dealer.name) !== '-'
                              ? formatOptional(dealer.name)
                              : dealer.sourceId

                            return (
                              <TableRow key={dealer.sourceId} hover>
                                <TableCell>
                                  <Stack spacing={0.25}>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {rowLabel}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      ID: {dealer.sourceId}
                                    </Typography>
                                  </Stack>
                                </TableCell>
                                <TableCell>{formatOptional(dealer.accountType || dealer.accountClass)}</TableCell>
                                <TableCell>{formatOptional(dealer.state)}</TableCell>
                                <TableCell>{formatOptional(dealer.deleteRequestedByEmail)}</TableCell>
                                <TableCell>{formatDateTime(dealer.deleteRequestedAt)}</TableCell>
                                <TableCell>{formatDateTime(dealer.updatedAt)}</TableCell>
                                <TableCell align="right">
                                  <Stack direction="row" spacing={0.7} justifyContent="flex-end">
                                    <Button
                                      size="small"
                                      color="error"
                                      variant="contained"
                                      disabled={isActionProcessing('confirm', 'dealer', dealer.sourceId)}
                                      onClick={() => {
                                        void handleConfirmDeletion('dealer', dealer.sourceId, rowLabel)
                                      }}
                                    >
                                      {isActionProcessing('confirm', 'dealer', dealer.sourceId) ? 'Confirming...' : 'Confirm Delete'}
                                    </Button>
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      startIcon={<RestoreRoundedIcon fontSize="small" />}
                                      disabled={isActionProcessing('restore', 'dealer', dealer.sourceId)}
                                      onClick={() => {
                                        void handleRestoreDeletion('dealer', dealer.sourceId, rowLabel)
                                      }}
                                    >
                                      {isActionProcessing('restore', 'dealer', dealer.sourceId) ? 'Restoring...' : 'Restore'}
                                    </Button>
                                  </Stack>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1}>
                  <Typography variant="h6" fontWeight={700}>
                    Contact Deletion Queue
                  </Typography>

                  {deletionQueueContacts.length === 0 ? (
                    <Typography color="text.secondary">No contacts are waiting for admin confirmation.</Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700 }}>Contact</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Account</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>State</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Requested By</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Requested At</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Updated</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, width: 250 }}>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {deletionQueueContacts.map((contact: CrmDeletionQueueRecordContact) => {
                            const rowLabel = formatOptional(contact.name) !== '-'
                              ? formatOptional(contact.name)
                              : contact.sourceId

                            return (
                              <TableRow key={contact.sourceId} hover>
                                <TableCell>
                                  <Stack spacing={0.25}>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {rowLabel}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      ID: {contact.sourceId}
                                    </Typography>
                                  </Stack>
                                </TableCell>
                                <TableCell>{formatOptional(contact.accountName || contact.accountSourceId)}</TableCell>
                                <TableCell>{formatOptional(contact.state)}</TableCell>
                                <TableCell>{formatOptional(contact.deleteRequestedByEmail)}</TableCell>
                                <TableCell>{formatDateTime(contact.deleteRequestedAt)}</TableCell>
                                <TableCell>{formatDateTime(contact.updatedAt)}</TableCell>
                                <TableCell align="right">
                                  <Stack direction="row" spacing={0.7} justifyContent="flex-end">
                                    <Button
                                      size="small"
                                      color="error"
                                      variant="contained"
                                      disabled={isActionProcessing('confirm', 'contact', contact.sourceId)}
                                      onClick={() => {
                                        void handleConfirmDeletion('contact', contact.sourceId, rowLabel)
                                      }}
                                    >
                                      {isActionProcessing('confirm', 'contact', contact.sourceId) ? 'Confirming...' : 'Confirm Delete'}
                                    </Button>
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      startIcon={<RestoreRoundedIcon fontSize="small" />}
                                      disabled={isActionProcessing('restore', 'contact', contact.sourceId)}
                                      onClick={() => {
                                        void handleRestoreDeletion('contact', contact.sourceId, rowLabel)
                                      }}
                                    >
                                      {isActionProcessing('restore', 'contact', contact.sourceId) ? 'Restoring...' : 'Restore'}
                                    </Button>
                                  </Stack>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Stack>
              </Paper>
            </>
          ) : null}
        </Stack>
    </Stack>
  )
}

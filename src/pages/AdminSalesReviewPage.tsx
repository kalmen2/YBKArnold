import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded'
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
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
type QueueView = 'dealer' | 'contact'

const deletionQueueLimit = 500
const defaultRowsPerPage = 10

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
  const [queueView, setQueueView] = useState<QueueView>('dealer')
  const [dealerPage, setDealerPage] = useState(0)
  const [contactPage, setContactPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(defaultRowsPerPage)

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
  const activeRows = queueView === 'dealer' ? deletionQueueDealers : deletionQueueContacts
  const requestedPage = queueView === 'dealer' ? dealerPage : contactPage
  const pageCount = Math.max(1, Math.ceil(activeRows.length / rowsPerPage))
  const activePage = Math.min(requestedPage, pageCount - 1)
  const visibleDealers = deletionQueueDealers.slice(
    activePage * rowsPerPage,
    activePage * rowsPerPage + rowsPerPage,
  )
  const visibleContacts = deletionQueueContacts.slice(
    activePage * rowsPerPage,
    activePage * rowsPerPage + rowsPerPage,
  )

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

  const compactCellSx = {
    py: 0.75,
    px: 1.25,
    fontSize: '0.78rem',
    whiteSpace: 'nowrap',
  }

  const handlePageChange = (_event: unknown, nextPage: number) => {
    if (queueView === 'dealer') {
      setDealerPage(nextPage)
    } else {
      setContactPage(nextPage)
    }
  }

  return (
    <Stack spacing={1.25}>
      <StatusAlerts errorMessage={errorMessage} successMessage={successMessage} />

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          sx={{ px: 1.5, py: 1 }}
        >
          <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
            <FactCheckRoundedIcon color="primary" sx={{ fontSize: 20 }} />
            <Box minWidth={0}>
              <Typography variant="subtitle1" fontWeight={700} lineHeight={1.2}>
                Sales Review
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Confirm or restore account and contact deletion requests.
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={0.75} alignItems="center">
            <Chip size="small" label={`${queueTotal} pending`} />
            <Button
              variant="text"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={deletionQueueQuery.isFetching}
              onClick={refreshData}
              sx={{ minWidth: 88 }}
            >
              {deletionQueueQuery.isFetching ? 'Refreshing' : 'Refresh'}
            </Button>
          </Stack>
        </Stack>

        <Box sx={{ borderTop: 1, borderBottom: 1, borderColor: 'divider', px: 1 }}>
          <Tabs
            value={queueView}
            onChange={(_event, nextView: QueueView) => setQueueView(nextView)}
            sx={{
              minHeight: 38,
              '& .MuiTab-root': {
                minHeight: 38,
                minWidth: 0,
                px: 1.5,
                py: 0.5,
                fontSize: '0.78rem',
                textTransform: 'none',
              },
            }}
          >
            <Tab value="dealer" label={`Accounts (${deletionQueueDealers.length})`} />
            <Tab value="contact" label={`Contacts (${deletionQueueContacts.length})`} />
          </Tabs>
        </Box>

        <LoadingPanel
          loading={deletionQueueQuery.isLoading}
          message="Loading deletion queue..."
          contained
        />

        {!deletionQueueQuery.isLoading && activeRows.length === 0 ? (
          <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No {queueView === 'dealer' ? 'accounts' : 'contacts'} are waiting for confirmation.
            </Typography>
          </Box>
        ) : null}

        {!deletionQueueQuery.isLoading && activeRows.length > 0 ? (
          <>
            <TableContainer sx={{ maxHeight: 520 }}>
              <Table
                size="small"
                stickyHeader
                sx={{
                  '& .MuiTableCell-head': {
                    ...compactCellSx,
                    color: 'text.secondary',
                    fontWeight: 700,
                    bgcolor: 'background.default',
                  },
                  '& .MuiTableCell-body': compactCellSx,
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>{queueView === 'dealer' ? 'Account' : 'Contact'}</TableCell>
                    <TableCell>{queueView === 'dealer' ? 'Type' : 'Account'}</TableCell>
                    <TableCell>State</TableCell>
                    <TableCell>Requested by</TableCell>
                    <TableCell>Requested</TableCell>
                    <TableCell>Updated</TableCell>
                    <TableCell align="right" sx={{ width: 220 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {queueView === 'dealer'
                    ? visibleDealers.map((dealer: CrmDeletionQueueRecordDealer) => {
                        const rowLabel = formatOptional(dealer.name) !== '-'
                          ? formatOptional(dealer.name)
                          : dealer.sourceId

                        return (
                          <TableRow key={dealer.sourceId} hover>
                            <TableCell>
                              <Typography variant="body2" fontWeight={600} lineHeight={1.2}>
                                {rowLabel}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" lineHeight={1.1}>
                                {dealer.sourceId}
                              </Typography>
                            </TableCell>
                            <TableCell>{formatOptional(dealer.accountType || dealer.accountClass)}</TableCell>
                            <TableCell>{formatOptional(dealer.state)}</TableCell>
                            <TableCell>{formatOptional(dealer.deleteRequestedByEmail)}</TableCell>
                            <TableCell>{formatDateTime(dealer.deleteRequestedAt)}</TableCell>
                            <TableCell>{formatDateTime(dealer.updatedAt)}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                <Button
                                  size="small"
                                  color="error"
                                  variant="text"
                                  disabled={isActionProcessing('confirm', 'dealer', dealer.sourceId)}
                                  onClick={() => {
                                    void handleConfirmDeletion('dealer', dealer.sourceId, rowLabel)
                                  }}
                                  sx={{ minWidth: 0, px: 1, fontSize: '0.72rem' }}
                                >
                                  {isActionProcessing('confirm', 'dealer', dealer.sourceId) ? 'Deleting...' : 'Delete'}
                                </Button>
                                <Button
                                  size="small"
                                  variant="text"
                                  startIcon={<RestoreRoundedIcon sx={{ fontSize: '15px !important' }} />}
                                  disabled={isActionProcessing('restore', 'dealer', dealer.sourceId)}
                                  onClick={() => {
                                    void handleRestoreDeletion('dealer', dealer.sourceId, rowLabel)
                                  }}
                                  sx={{ minWidth: 0, px: 1, fontSize: '0.72rem' }}
                                >
                                  {isActionProcessing('restore', 'dealer', dealer.sourceId) ? 'Restoring...' : 'Restore'}
                                </Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    : visibleContacts.map((contact: CrmDeletionQueueRecordContact) => {
                        const rowLabel = formatOptional(contact.name) !== '-'
                          ? formatOptional(contact.name)
                          : contact.sourceId

                        return (
                          <TableRow key={contact.sourceId} hover>
                            <TableCell>
                              <Typography variant="body2" fontWeight={600} lineHeight={1.2}>
                                {rowLabel}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" lineHeight={1.1}>
                                {contact.sourceId}
                              </Typography>
                            </TableCell>
                            <TableCell>{formatOptional(contact.accountName || contact.accountSourceId)}</TableCell>
                            <TableCell>{formatOptional(contact.state)}</TableCell>
                            <TableCell>{formatOptional(contact.deleteRequestedByEmail)}</TableCell>
                            <TableCell>{formatDateTime(contact.deleteRequestedAt)}</TableCell>
                            <TableCell>{formatDateTime(contact.updatedAt)}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                <Button
                                  size="small"
                                  color="error"
                                  variant="text"
                                  disabled={isActionProcessing('confirm', 'contact', contact.sourceId)}
                                  onClick={() => {
                                    void handleConfirmDeletion('contact', contact.sourceId, rowLabel)
                                  }}
                                  sx={{ minWidth: 0, px: 1, fontSize: '0.72rem' }}
                                >
                                  {isActionProcessing('confirm', 'contact', contact.sourceId) ? 'Deleting...' : 'Delete'}
                                </Button>
                                <Button
                                  size="small"
                                  variant="text"
                                  startIcon={<RestoreRoundedIcon sx={{ fontSize: '15px !important' }} />}
                                  disabled={isActionProcessing('restore', 'contact', contact.sourceId)}
                                  onClick={() => {
                                    void handleRestoreDeletion('contact', contact.sourceId, rowLabel)
                                  }}
                                  sx={{ minWidth: 0, px: 1, fontSize: '0.72rem' }}
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

            <TablePagination
              component="div"
              count={activeRows.length}
              page={activePage}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={[10, 25, 50]}
              onPageChange={handlePageChange}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(Number(event.target.value))
                setDealerPage(0)
                setContactPage(0)
              }}
              sx={{
                borderTop: 1,
                borderColor: 'divider',
                minHeight: 44,
                '& .MuiTablePagination-toolbar': { minHeight: 44 },
                '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
                  fontSize: '0.75rem',
                },
              }}
            />
          </>
        ) : null}
      </Paper>
    </Stack>
  )
}

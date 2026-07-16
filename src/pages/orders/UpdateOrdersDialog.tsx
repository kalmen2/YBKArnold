import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { type MutableRefObject, useCallback, useMemo, useState } from 'react'
import {
  postOrdersMondayProgressStatusBulkUpdate,
  type OrdersMondayProgressStatusBulkQueuedRow,
  type OrdersOverviewOrder,
  type OrdersProgressStatusDetail,
} from '../../features/orders/api'
import {
  ORDER_PROGRESS_STAGES,
  normalizeProgressStageKey,
  normalizeProgressStageStatus,
  type OrderProgressStageKey,
  type OrderProgressStatusKey,
} from '../../features/orders/stage-registry'
import { resolveShopDrawingUrl } from './shopDrawingUrl'
import type { ShopDrawingPreviewHandle } from './ShopDrawingPreview'

type StageStatusKey = OrderProgressStatusKey

type StageKey = OrderProgressStageKey

type BulkEditRow = {
  id: string
  mondayItemId: string
  orderNumber: string
  order: OrdersOverviewOrder
  stageByKey: Record<StageKey, {
    columnId: string | null
    status: StageStatusKey | null
  }>
}

const stageConfig = ORDER_PROGRESS_STAGES

const editableStatusOptions: Array<{
  key: StageStatusKey
  label: string
}> = [
  { key: 'working', label: 'Working on it' },
  { key: 'done', label: 'Done' },
  { key: 'stuck', label: 'Stuck' },
]

const normalizeProgressStatusKey = normalizeProgressStageKey

const normalizeStageStatusKey = normalizeProgressStageStatus

function toMondayStatusLabel(statusKey: StageStatusKey | null) {
  if (!statusKey) {
    return ''
  }

  if (statusKey === 'working') {
    return 'Working on it'
  }

  if (statusKey === 'done') {
    return 'Done'
  }

  return 'Stuck'
}

function resolveStatusPalette(status: StageStatusKey | null) {
  if (status === 'stuck') {
    return {
      bg: 'rgba(220, 38, 38, 0.16)',
      border: '#dc2626',
      text: '#b91c1c',
    }
  }

  if (status === 'done') {
    return {
      bg: 'rgba(34, 197, 94, 0.16)',
      border: '#22c55e',
      text: '#15803d',
    }
  }

  return {
    bg: 'rgba(249, 168, 37, 0.13)',
    border: '#f9a825',
    text: '#b45309',
  }
}

function buildStageKeyLookup(progressStatusDetails: OrdersProgressStatusDetail[]) {
  const detailsByKey = new Map<StageKey, OrdersProgressStatusDetail>()

  ;(Array.isArray(progressStatusDetails) ? progressStatusDetails : []).forEach((entry) => {
    const candidateKeys = [
      normalizeProgressStatusKey(entry?.key),
      normalizeProgressStatusKey(entry?.label),
    ]

    candidateKeys.forEach((candidateKey) => {
      if (!candidateKey) {
        return
      }

      const matchingConfig = stageConfig.find((configEntry) => configEntry.key === candidateKey)

      if (!matchingConfig || detailsByKey.has(matchingConfig.key)) {
        return
      }

      detailsByKey.set(matchingConfig.key, entry)
    })
  })

  return detailsByKey
}

function buildStageCellKey(mondayItemId: string, stageKey: StageKey) {
  return `${mondayItemId}:${stageKey}`
}

function buildStatusUpdateRequestKey(mondayItemId: string, columnId: string, status: string) {
  return `${mondayItemId}:${columnId}:${status}`
}

type UpdateOrdersDialogProps = {
  open: boolean
  orders: OrdersOverviewOrder[]
  shopDrawingHandle: MutableRefObject<ShopDrawingPreviewHandle | null>
  onClose: () => void
  onSaved?: (summary: {
    updatedCount: number
    queuedCount: number
    failedCount: number
    queuedUpdates: OrdersMondayProgressStatusBulkQueuedRow[]
    warnings: string[]
  }) => void | Promise<void>
}

export function UpdateOrdersDialog({
  open,
  orders,
  shopDrawingHandle,
  onClose,
  onSaved,
}: UpdateOrdersDialogProps) {
  const [draftStatuses, setDraftStatuses] = useState<Record<string, StageStatusKey | null>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const rows = useMemo<BulkEditRow[]>(() => {
    return orders
      .filter((order) => order.hasMondayRecord && !order.isShipped)
      .map((order) => {
        const normalizedMondayItemId = String(order.mondayItemId ?? '').trim()
        const detailsByKey = buildStageKeyLookup(order.progressStatusDetails)
        const stageByKey = stageConfig.reduce((accumulator, stage) => {
          const detail = detailsByKey.get(stage.key)

          accumulator[stage.key] = {
            columnId: String(detail?.columnId ?? '').trim() || null,
            status: normalizeStageStatusKey(detail?.status),
          }

          return accumulator
        }, {} as Record<StageKey, { columnId: string | null; status: StageStatusKey | null }>)

        return {
          id: order.id,
          mondayItemId: normalizedMondayItemId,
          orderNumber: order.orderNumber,
          order,
          stageByKey,
        }
      })
  }, [orders])

  const pendingEditsCount = useMemo(
    () => Object.keys(draftStatuses).length,
    [draftStatuses],
  )

  const resetDialogState = useCallback(() => {
    setDraftStatuses({})
    setIsSaving(false)
    setErrorMessage(null)
  }, [])

  const resolveEffectiveStatus = useCallback((row: BulkEditRow, stageKey: StageKey) => {
    const draftKey = buildStageCellKey(row.mondayItemId, stageKey)

    if (Object.prototype.hasOwnProperty.call(draftStatuses, draftKey)) {
      return draftStatuses[draftKey] ?? null
    }

    return row.stageByKey[stageKey].status ?? null
  }, [draftStatuses])

  const handleChangeStageStatus = useCallback((
    row: BulkEditRow,
    stageKey: StageKey,
    nextStatus: StageStatusKey | null,
  ) => {
    const draftKey = buildStageCellKey(row.mondayItemId, stageKey)
    const baselineStatus = row.stageByKey[stageKey].status

    setDraftStatuses((currentDrafts) => {
      const nextDrafts = { ...currentDrafts }

      if (nextStatus === baselineStatus) {
        delete nextDrafts[draftKey]
      } else {
        nextDrafts[draftKey] = nextStatus
      }

      return nextDrafts
    })
  }, [])

  const handleRequestClose = useCallback((options?: { skipUnsavedCheck?: boolean }) => {
    if (isSaving) {
      return
    }

    if (!options?.skipUnsavedCheck && pendingEditsCount > 0) {
      const shouldClose = window.confirm(
        'Are you sure? Nothing was saved. Click Save in order to save whatever you changed.',
      )

      if (!shouldClose) {
        return
      }
    }

    resetDialogState()
    onClose()
  }, [isSaving, onClose, pendingEditsCount, resetDialogState])

  const handleSave = useCallback(async () => {
    if (isSaving) {
      return
    }

    const updatesToApply: Array<{
      draftKey: string
      mondayItemId: string
      columnId: string
      payloadStatus: string
    }> = []

    let unresolvedColumnFailures = 0

    rows.forEach((row) => {
      stageConfig.forEach((stage) => {
        const draftKey = buildStageCellKey(row.mondayItemId, stage.key)
        const hasDraftValue = Object.prototype.hasOwnProperty.call(draftStatuses, draftKey)

        if (!hasDraftValue) {
          return
        }

        const nextStatus = draftStatuses[draftKey] ?? null
        const columnId = String(row.stageByKey[stage.key].columnId ?? '').trim()

        if (!columnId) {
          unresolvedColumnFailures += 1
          return
        }

        updatesToApply.push({
          draftKey,
          mondayItemId: row.mondayItemId,
          columnId,
          payloadStatus: toMondayStatusLabel(nextStatus),
        })
      })
    })

    if (updatesToApply.length === 0) {
      if (unresolvedColumnFailures > 0) {
        setErrorMessage('Some stage columns could not be resolved. No updates were saved.')
      } else {
        handleRequestClose({ skipUnsavedCheck: true })
      }
      return
    }

    setIsSaving(true)
    setErrorMessage(null)

    try {
      const response = await postOrdersMondayProgressStatusBulkUpdate({
        updates: updatesToApply.map((entry) => ({
          mondayItemId: entry.mondayItemId,
          columnId: entry.columnId,
          status: entry.payloadStatus,
        })),
      })

      const failedUpdates = Array.isArray(response.failedUpdates)
        ? response.failedUpdates
        : []
      const queuedUpdatesFromResponse = Array.isArray(response.queuedUpdates)
        ? response.queuedUpdates
          .map((entry) => ({
            mondayItemId: String(entry?.mondayItemId ?? '').trim(),
            columnId: String(entry?.columnId ?? '').trim(),
            status: String(entry?.status ?? '').trim(),
          }))
          .filter((entry) => entry.mondayItemId && entry.columnId)
        : []
      const failedUpdateKeys = new Set(
        failedUpdates.map((entry) => buildStatusUpdateRequestKey(
          String(entry?.mondayItemId ?? '').trim(),
          String(entry?.columnId ?? '').trim(),
          String(entry?.status ?? '').trim(),
        )),
      )

      const successfulUpdates = queuedUpdatesFromResponse.length > 0
        ? queuedUpdatesFromResponse
        : updatesToApply
          .filter((entry) => !failedUpdateKeys.has(buildStatusUpdateRequestKey(
            entry.mondayItemId,
            entry.columnId,
            entry.payloadStatus,
          )))
          .map((entry) => ({
            mondayItemId: entry.mondayItemId,
            columnId: entry.columnId,
            status: entry.payloadStatus,
          }))
      const successfulUpdateKeys = new Set(
        successfulUpdates.map((entry) => buildStatusUpdateRequestKey(
          entry.mondayItemId,
          entry.columnId,
          entry.status,
        )),
      )
      const remainingDrafts = { ...draftStatuses }

      updatesToApply.forEach((entry) => {
        const updateKey = buildStatusUpdateRequestKey(
          entry.mondayItemId,
          entry.columnId,
          entry.payloadStatus,
        )

        if (!successfulUpdateKeys.has(updateKey)) {
          return
        }

        delete remainingDrafts[entry.draftKey]
      })

      const updatedCount = successfulUpdates.length
      const queuedCount = Number.isFinite(Number(response.queuedCount))
        ? Number(response.queuedCount)
        : updatedCount
      const failedCount = failedUpdateKeys.size > 0
        ? failedUpdateKeys.size
        : Math.max(0, Number(response.failedCount ?? 0))
      const warningMessages = (Array.isArray(response.warnings) ? response.warnings : [])
        .map((entry) => String(entry ?? '').trim())
        .filter(Boolean)

      setDraftStatuses(remainingDrafts)
      setIsSaving(false)

      if (updatedCount > 0 || failedCount > 0 || warningMessages.length > 0) {
        void Promise.resolve(onSaved?.({
          updatedCount,
          queuedCount,
          failedCount,
          queuedUpdates: successfulUpdates,
          warnings: warningMessages,
        })).catch(() => {})
      }

      if (failedCount > 0) {
        const firstFailureMessage = String(failedUpdates[0]?.error ?? '').trim()
        setErrorMessage(
          `Saved ${queuedCount} updates to backend. ${failedCount} updates failed.${firstFailureMessage ? ` ${firstFailureMessage}` : ''}`,
        )
        return
      }

      handleRequestClose({ skipUnsavedCheck: true })
    } catch (saveError) {
      setIsSaving(false)
      setErrorMessage(
        saveError instanceof Error
          ? saveError.message
          : 'Could not save stage updates right now.',
      )
    }
  }, [draftStatuses, handleRequestClose, isSaving, onSaved, rows])

  const columns = useMemo<GridColDef<BulkEditRow>[]>(() => {
    const baseColumns: GridColDef<BulkEditRow>[] = [
      {
        field: 'orderNumber',
        headerName: 'Order #',
        minWidth: 120,
        width: 130,
        sortable: false,
      },
      {
        field: 'drawing',
        headerName: 'Drawings',
        minWidth: 92,
        width: 96,
        sortable: false,
        align: 'center',
        headerAlign: 'center',
        renderCell: ({ row }) => {
          const drawingUrl = resolveShopDrawingUrl(row.order)
          const canHoverPreview = Boolean(
            drawingUrl && String(row.order.mondayItemId ?? '').trim(),
          )

          if (!drawingUrl) {
            return <Typography variant="body2" color="text.secondary">—</Typography>
          }

          return (
            <IconButton
              size="small"
              aria-label="Drawing preview"
              title={canHoverPreview
                ? 'Hover for quick preview. Click to open full popup.'
                : 'Click to open drawing preview.'}
              onMouseEnter={(event) => {
                if (!canHoverPreview) {
                  return
                }
                shopDrawingHandle.current?.openHover(event, row.order)
              }}
              onMouseLeave={() => {
                if (!canHoverPreview) {
                  return
                }
                shopDrawingHandle.current?.leaveHoverTrigger()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                }
              }}
              onClick={(event) => {
                if (event.detail === 0) {
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                shopDrawingHandle.current?.closeHover()
                void shopDrawingHandle.current?.openDialog(row.order)
              }}
            >
              <PictureAsPdfRoundedIcon fontSize="inherit" />
            </IconButton>
          )
        },
      },
    ]

    const stageColumns: GridColDef<BulkEditRow>[] = stageConfig.map((stage) => ({
      field: stage.key,
      headerName: stage.label,
      minWidth: 144,
      width: stage.key === 'sandorlam' ? 154 : 144,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: ({ row }) => {
        const stageState = row.stageByKey[stage.key]
        const selectedStatus = resolveEffectiveStatus(row, stage.key)
        const palette = resolveStatusPalette(selectedStatus)
        const disabled = isSaving || !stageState.columnId

        return (
          <Box
            sx={{
              width: '100%',
              height: '100%',
              bgcolor: palette.bg,
              border: `1px solid ${palette.border}`,
              borderRadius: 0,
              display: 'flex',
              alignItems: 'center',
              px: 0.5,
              py: 0.2,
            }}
          >
            <FormControl size="small" fullWidth>
              <Select
                value={selectedStatus ?? ''}
                displayEmpty
                variant="standard"
                disableUnderline
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation()
                }}
                onChange={(event) => {
                  const rawValue = String(event.target.value ?? '').trim()

                  if (!rawValue) {
                    handleChangeStageStatus(row, stage.key, null)
                    return
                  }

                  const nextStatus = normalizeStageStatusKey(rawValue)

                  if (!nextStatus) {
                    return
                  }

                  handleChangeStageStatus(row, stage.key, nextStatus)
                }}
                renderValue={(value) => {
                  const normalized = normalizeStageStatusKey(String(value ?? '').trim())

                  if (!normalized) {
                    return stageState.columnId ? 'Select' : 'No column'
                  }

                  const option = editableStatusOptions.find((entry) => entry.key === normalized)

                  return option?.label ?? 'Select'
                }}
                sx={{
                  width: '100%',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  color: palette.text,
                  '& .MuiSelect-select': {
                    py: 0.1,
                    px: 0.2,
                  },
                  '& .MuiSelect-icon': {
                    color: palette.text,
                  },
                }}
              >
                <MenuItem value="">
                  Select (Not started)
                </MenuItem>
                {editableStatusOptions.map((option) => (
                  <MenuItem key={`${row.id}-${stage.key}-${option.key}`} value={option.key}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        )
      },
    }))

    return [...baseColumns, ...stageColumns]
  }, [handleChangeStageStatus, isSaving, resolveEffectiveStatus, shopDrawingHandle])

  return (
    <Dialog
      open={open}
      onClose={() => {
        handleRequestClose()
      }}
      fullWidth
      maxWidth="xl"
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.2} alignItems="center" justifyContent="space-between">
          <Typography variant="h6" fontWeight={800}>Update Orders</Typography>
          <Typography variant="body2" color="text.secondary" fontWeight={600}>
            {rows.length} orders
          </Typography>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ pt: 1, pb: 1.25 }}>
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Edit stage statuses in the grid and click Save once to push all changes to Monday.
          </Typography>

          {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

          <Box sx={{ height: '68vh', minHeight: 460 }}>
            <DataGrid
              rows={rows}
              columns={columns}
              disableRowSelectionOnClick
              disableColumnMenu
              density="standard"
              rowHeight={56}
              columnHeaderHeight={48}
              pageSizeOptions={[25, 50, 100]}
              initialState={{
                pagination: {
                  paginationModel: { pageSize: 50, page: 0 },
                },
              }}
              localeText={{ noRowsLabel: 'No editable orders to show.' }}
              sx={{
                border: 0,
                '& .MuiDataGrid-cell': {
                  alignItems: 'stretch',
                  py: 0,
                },
                '& .MuiDataGrid-columnHeaders': {
                  borderBottom: '1px solid rgba(15, 23, 42, 0.14)',
                  backgroundColor: 'rgba(15, 23, 42, 0.04)',
                },
                '& .MuiDataGrid-columnHeaderTitle': {
                  fontWeight: 800,
                  fontSize: '0.76rem',
                },
              }}
            />
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1.25 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ width: '100%' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700}>
            {pendingEditsCount} pending changes
          </Typography>

          <Stack direction="row" spacing={1}>
            <Button
              variant="text"
              onClick={() => {
                handleRequestClose()
              }}
              disabled={isSaving}
            >
              Close
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                void handleSave()
              }}
              disabled={isSaving || pendingEditsCount === 0}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </Stack>
        </Stack>
      </DialogActions>
    </Dialog>
  )
}

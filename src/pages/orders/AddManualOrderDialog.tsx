import {
  Alert,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  CircularProgress,
  Grid,
  MenuItem,
  TextField,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getOrdersCreateBoards,
  type OrdersCreateBoardOption,
} from '../../features/orders/api'

export type AddManualOrderDialogForm = {
  boardId: string
  name: string
  acknowledgementNumber: string
  salesRep: string
  orderValue: string
  freightValue: string
  poDate: string
  poNumber: string
  description: string
  shipTo: string
  notes: string
}

type AddManualOrderDialogProps = {
  open: boolean
  isSubmitting: boolean
  onClose: () => void
  onSubmit: (form: AddManualOrderDialogForm) => void
}

const INITIAL_FORM: AddManualOrderDialogForm = {
  boardId: '',
  name: '',
  acknowledgementNumber: '',
  salesRep: '',
  orderValue: '',
  freightValue: '',
  poDate: '',
  poNumber: '',
  description: '',
  shipTo: '',
  notes: '',
}

export function AddManualOrderDialog({
  open,
  isSubmitting,
  onClose,
  onSubmit,
}: AddManualOrderDialogProps) {
  const [form, setForm] = useState<AddManualOrderDialogForm>(INITIAL_FORM)
  const [defaultBoardYear, setDefaultBoardYear] = useState(2026)
  const [boardOptions, setBoardOptions] = useState<OrdersCreateBoardOption[]>([])
  const [boardOptionsError, setBoardOptionsError] = useState<string | null>(null)
  const [isLoadingBoardOptions, setIsLoadingBoardOptions] = useState(false)
  const [isRefreshingBoardOptions, setIsRefreshingBoardOptions] = useState(false)

  const loadBoardOptions = useCallback(async (refresh: boolean) => {
    if (refresh) {
      setIsRefreshingBoardOptions(true)
    } else {
      setIsLoadingBoardOptions(true)
    }

    setBoardOptionsError(null)

    try {
      const response = await getOrdersCreateBoards({ refresh })
      const nextOptions = Array.isArray(response?.boards)
        ? response.boards
        : []
      const nextDefaultYear = Number.isFinite(Number(response?.defaultYear))
        ? Number(response.defaultYear)
        : 2026

      if (nextOptions.length === 0) {
        throw new Error('No New Orders board options are available yet.')
      }

      setDefaultBoardYear(nextDefaultYear)
      const defaultBoardId = String(response?.defaultBoardId ?? '').trim()
      setBoardOptions(nextOptions)
      setForm((current) => {
        const currentBoardId = String(current.boardId ?? '').trim()
        const hasCurrent = nextOptions.some((board) => String(board?.id ?? '').trim() === currentBoardId)
        const resolvedDefaultBoardId = defaultBoardId
          && nextOptions.some((board) => String(board?.id ?? '').trim() === defaultBoardId)
          ? defaultBoardId
          : String(nextOptions[0]?.id ?? '').trim()
        const nextBoardId = hasCurrent
          ? currentBoardId
          : resolvedDefaultBoardId

        if (currentBoardId === nextBoardId) {
          return current
        }

        return {
          ...current,
          boardId: nextBoardId,
        }
      })
    } catch (error) {
      setBoardOptions([])
      setBoardOptionsError(
        error instanceof Error
          ? error.message
          : 'Could not load New Orders board options.',
      )
      setForm((current) => ({
        ...current,
        boardId: '',
      }))
    } finally {
      if (refresh) {
        setIsRefreshingBoardOptions(false)
      } else {
        setIsLoadingBoardOptions(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }

    setForm(INITIAL_FORM)
    setDefaultBoardYear(2026)
    setBoardOptions([])
    setBoardOptionsError(null)
    void loadBoardOptions(false)
  }, [loadBoardOptions, open])

  const canSubmit = useMemo(() => {
    return Boolean(
      String(form.boardId ?? '').trim()
      &&
      String(form.name ?? '').trim()
      && String(form.acknowledgementNumber ?? '').trim(),
    )
  }, [form.acknowledgementNumber, form.boardId, form.name])

  const updateField = <Key extends keyof AddManualOrderDialogForm>(
    key: Key,
    value: AddManualOrderDialogForm[Key],
  ) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const handleSubmit = () => {
    if (!canSubmit || isSubmitting) {
      return
    }

    onSubmit({
      boardId: String(form.boardId ?? '').trim(),
      name: String(form.name ?? '').trim(),
      acknowledgementNumber: String(form.acknowledgementNumber ?? '').trim(),
      salesRep: String(form.salesRep ?? '').trim(),
      orderValue: String(form.orderValue ?? '').trim(),
      freightValue: String(form.freightValue ?? '').trim(),
      poDate: String(form.poDate ?? '').trim(),
      poNumber: String(form.poNumber ?? '').trim(),
      description: String(form.description ?? '').trim(),
      shipTo: String(form.shipTo ?? '').trim(),
      notes: String(form.notes ?? '').trim(),
    })
  }

  return (
    <Dialog
      open={open}
      onClose={isSubmitting ? undefined : onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>Add Manual Order</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {boardOptionsError ? (
            <Alert severity="warning">{boardOptionsError}</Alert>
          ) : null}

          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12 }}>
              <TextField
                select
                required
                fullWidth
                label="Monday Board"
                value={form.boardId}
                onChange={(event) => updateField('boardId', event.target.value)}
                disabled={isSubmitting || isLoadingBoardOptions || boardOptions.length === 0}
                helperText={`Default is New Orders ${defaultBoardYear}. Use refresh to check only newer New Orders boards.`}
              >
                {boardOptions.map((board) => {
                  const boardId = String(board?.id ?? '').trim()

                  if (!boardId) {
                    return null
                  }

                  return (
                    <MenuItem key={boardId} value={boardId}>
                      {String(board?.name ?? '').trim() || boardId}
                    </MenuItem>
                  )
                })}
              </TextField>
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                justifyContent="space-between"
              >
                <Button
                  size="small"
                  onClick={() => {
                    void loadBoardOptions(true)
                  }}
                  disabled={
                    isSubmitting
                    || isLoadingBoardOptions
                    || isRefreshingBoardOptions
                  }
                >
                  {isRefreshingBoardOptions ? 'Refreshing boards...' : 'Refresh newer boards'}
                </Button>

                <Stack direction="row" spacing={0.75} alignItems="center">
                  {(isLoadingBoardOptions || isRefreshingBoardOptions) ? (
                    <CircularProgress size={14} />
                  ) : null}
                  <Typography variant="caption" color="text.secondary">
                    {`Newer means ${defaultBoardYear + 1}+ only.`}
                  </Typography>
                </Stack>
              </Stack>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                required
                fullWidth
                label="Name / Account Name"
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                autoFocus
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                required
                fullWidth
                label="Acknowledgement Number (ACK)"
                value={form.acknowledgementNumber}
                onChange={(event) => updateField('acknowledgementNumber', event.target.value)}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Sales Rep"
                value={form.salesRep}
                onChange={(event) => updateField('salesRep', event.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                type="number"
                label="Order Value"
                value={form.orderValue}
                onChange={(event) => updateField('orderValue', event.target.value)}
                slotProps={{
                  htmlInput: {
                    min: 0,
                    step: '0.01',
                  },
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                type="number"
                label="Freight Value"
                value={form.freightValue}
                onChange={(event) => updateField('freightValue', event.target.value)}
                slotProps={{
                  htmlInput: {
                    min: 0,
                    step: '0.01',
                  },
                }}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                type="date"
                label="PO Date"
                value={form.poDate}
                onChange={(event) => updateField('poDate', event.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 8 }}>
              <TextField
                fullWidth
                label="PO Number"
                value={form.poNumber}
                onChange={(event) => updateField('poNumber', event.target.value)}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="Description"
                value={form.description}
                onChange={(event) => updateField('description', event.target.value)}
                multiline
                minRows={2}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="Ship To"
                value={form.shipTo}
                onChange={(event) => updateField('shipTo', event.target.value)}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="Notes"
                value={form.notes}
                onChange={(event) => updateField('notes', event.target.value)}
                multiline
                minRows={2}
              />
            </Grid>
          </Grid>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onClose}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
        >
          {isSubmitting ? 'Creating...' : 'Create Order'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

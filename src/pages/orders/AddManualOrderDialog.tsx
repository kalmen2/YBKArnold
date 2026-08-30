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
  Tab,
  Tabs,
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
  documentLines: Array<{ id: string; parentLineId: string | null; detailLabel: string; description: string; qty: string; unitPrice: string; category: 'product' | 'additional' | 'freight' }>
}

type AddManualOrderDialogProps = {
  open: boolean
  isSubmitting: boolean
  initialForm?: Partial<AddManualOrderDialogForm> | null
  title?: string
  submitLabel?: string
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
  documentLines: [],
}

export function AddManualOrderDialog({
  open,
  isSubmitting,
  initialForm,
  title = 'Add Manual Order',
  submitLabel = 'Create Order',
  onClose,
  onSubmit,
}: AddManualOrderDialogProps) {
  const [form, setForm] = useState<AddManualOrderDialogForm>(INITIAL_FORM)
  const [defaultBoardYear, setDefaultBoardYear] = useState(2026)
  const [boardOptions, setBoardOptions] = useState<OrdersCreateBoardOption[]>([])
  const [boardOptionsError, setBoardOptionsError] = useState<string | null>(null)
  const [isLoadingBoardOptions, setIsLoadingBoardOptions] = useState(false)
  const [isRefreshingBoardOptions, setIsRefreshingBoardOptions] = useState(false)
  const [activeTab, setActiveTab] = useState<'info' | 'lines'>('info')

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
      const suggestedAcknowledgementNumber = String(response?.suggestedAcknowledgementNumber ?? '').trim()
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

        const nextAcknowledgementNumber = current.acknowledgementNumber || suggestedAcknowledgementNumber
        if (
          currentBoardId === nextBoardId
          && current.acknowledgementNumber === nextAcknowledgementNumber
        ) {
          return current
        }

        return {
          ...current,
          boardId: nextBoardId,
          acknowledgementNumber: nextAcknowledgementNumber,
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

    setForm({ ...INITIAL_FORM, ...(initialForm || {}) })
    setActiveTab('info')
    setDefaultBoardYear(2026)
    setBoardOptions([])
    setBoardOptionsError(null)
    void loadBoardOptions(false)
  }, [initialForm, loadBoardOptions, open])

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
    setForm((current) => {
      const next = {
        ...current,
        [key]: value,
      }
      if (key !== 'documentLines' || !Array.isArray(value)) {
        return next
      }

      const totals = value.reduce(
        (sum, line) => {
          const qty = Number(line.qty)
          const unitPrice = Number(line.unitPrice)
          const extension = Number.isFinite(qty) && Number.isFinite(unitPrice)
            ? qty * unitPrice
            : 0
          if (line.category === 'freight') sum.freight += extension
          else sum.product += extension
          return sum
        },
        { product: 0, freight: 0 },
      )
      return {
        ...next,
        orderValue: totals.product.toFixed(2),
        freightValue: totals.freight.toFixed(2),
      }
    })
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
      documentLines: form.documentLines.map((line) => ({ ...line, detailLabel: line.detailLabel.trim(), description: line.description.trim(), qty: line.qty.trim(), unitPrice: line.unitPrice.trim() })),
    })
  }

  return (
    <Dialog
      open={open}
      onClose={isSubmitting ? undefined : onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {boardOptionsError ? (
            <Alert severity="warning">{boardOptionsError}</Alert>
          ) : null}

          <Tabs value={activeTab} onChange={(_event, value: 'info' | 'lines') => setActiveTab(value)}>
            <Tab value="info" label="Order Information" />
            <Tab value="lines" label={`Order Lines (${form.documentLines.length})`} />
          </Tabs>

          {activeTab === 'info' ? <Grid container spacing={1.5}>
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
                helperText="Defaults to the next YYMMNN acknowledgement number. You can change it before creating the order."
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
          </Grid> : null}

          {activeTab === 'lines' ? (
            <Stack spacing={1}>
              <Alert severity="info">Edit the copied lines before creating the duplicate.</Alert>
              {form.documentLines.map((line, index) => (
                <Grid container spacing={1} key={line.id}>
                  <Grid size={{ xs: 12, md: 2 }}><TextField select fullWidth size="small" label="Type" value={line.category} onChange={(event) => updateField('documentLines', form.documentLines.map((entry, entryIndex) => entryIndex === index ? { ...entry, category: event.target.value as typeof entry.category } : entry))}><MenuItem value="product">Product</MenuItem><MenuItem value="additional">Additional</MenuItem><MenuItem value="freight">Freight</MenuItem></TextField></Grid>
                  <Grid size={{ xs: 12, md: 2 }}><TextField fullWidth size="small" label="Detail" value={line.detailLabel} onChange={(event) => updateField('documentLines', form.documentLines.map((entry, entryIndex) => entryIndex === index ? { ...entry, detailLabel: event.target.value } : entry))} /></Grid>
                  <Grid size={{ xs: 12, md: 4 }}><TextField fullWidth size="small" label="Description" value={line.description} onChange={(event) => updateField('documentLines', form.documentLines.map((entry, entryIndex) => entryIndex === index ? { ...entry, description: event.target.value } : entry))} /></Grid>
                  <Grid size={{ xs: 6, md: 1 }}><TextField fullWidth size="small" type="number" label="Qty" value={line.qty} onChange={(event) => updateField('documentLines', form.documentLines.map((entry, entryIndex) => entryIndex === index ? { ...entry, qty: event.target.value } : entry))} /></Grid>
                  <Grid size={{ xs: 6, md: 2 }}><TextField fullWidth size="small" type="number" label="Unit Price" value={line.unitPrice} onChange={(event) => updateField('documentLines', form.documentLines.map((entry, entryIndex) => entryIndex === index ? { ...entry, unitPrice: event.target.value } : entry))} /></Grid>
                  <Grid size={{ xs: 12, md: 1 }}><Button color="error" size="small" onClick={() => updateField('documentLines', form.documentLines.filter((_entry, entryIndex) => entryIndex !== index))}>Remove</Button></Grid>
                </Grid>
              ))}
              <Button size="small" variant="outlined" onClick={() => updateField('documentLines', [...form.documentLines, { id: crypto.randomUUID(), parentLineId: null, detailLabel: '', description: '', qty: '1', unitPrice: '', category: 'product' }])} sx={{ alignSelf: 'flex-start' }}>Add line</Button>
            </Stack>
          ) : null}
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
          {isSubmitting ? 'Creating...' : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

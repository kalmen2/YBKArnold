import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputAdornment,
  InputLabel,
  Link,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useDebounceValue } from '../../hooks/useDebounceValue'
import { formatDateTime } from '../../lib/formatters'
import { QUERY_KEYS } from '../../lib/queryKeys'
import { fetchPurchasingItems, updatePurchasingItemSettings, type PurchasingItemSummary } from '../purchasing/api'
import {
  createOrderDesignPart,
  fetchOrderDesignParts,
  removeOrderDesignPart,
  updateOrderDesignPart,
  type OrderDesignPart,
} from './api'

type EditorMode = 'catalog' | 'requested' | 'edit' | null

type PartDraft = {
  itemName: string
  description: string
  link: string
  quantity: string
  requiresDimensions: boolean
  dimensions: string
  requiresVeneerDirection: boolean
  veneerDirection: 'length' | 'width' | 'none' | ''
  status: string
  vendor: string
  dateOrdered: string
  dateReceived: string
  dueDate: string
}

const EMPTY_DRAFT: PartDraft = {
  itemName: '',
  description: '',
  link: '',
  quantity: '1',
  requiresDimensions: false,
  dimensions: '',
  requiresVeneerDirection: false,
  veneerDirection: '',
  status: '',
  vendor: '',
  dateOrdered: '',
  dateReceived: '',
  dueDate: '',
}

const ORDER_TRACK_SUBITEM_STATUSES = [
  'Working on it', 'Is here', 'Stuck', 'Ordered', 'COM', 'To Be Determined',
  'Make In House', 'Partial', 'Partial Receipt', 'By Other', 'In Cart', 'Canceled',
] as const
const DESIGN_SUBITEM_STATUSES = ['Working on it', 'Done', 'Stuck', 'Is Here'] as const

const VENEER_DIRECTION_LABELS = {
  length: 'Along length',
  width: 'Along width',
  none: 'No preference',
} as const

const CATALOG_PAGE_SIZE = 15

function PartMiniPreview({
  dimensions,
  veneerDirection,
}: {
  dimensions: string | null | undefined
  veneerDirection: PartDraft['veneerDirection'] | null | undefined
}) {
  const values = String(dimensions || '').match(/\d+(?:\.\d+)?/g)?.map(Number).filter((value) => value > 0) || []
  const rawRatio = values.length >= 2 ? values[0] / values[1] : 1.45
  const ratio = Math.min(2.2, Math.max(0.75, rawRatio))
  const grainBackground = veneerDirection === 'length'
    ? 'repeating-linear-gradient(0deg, rgba(121,85,61,.20) 0 2px, transparent 2px 12px)'
    : veneerDirection === 'width'
      ? 'repeating-linear-gradient(90deg, rgba(121,85,61,.20) 0 2px, transparent 2px 12px)'
      : 'linear-gradient(135deg, rgba(121,85,61,.08), rgba(121,85,61,.16))'

  if (!String(dimensions || '').trim()) return null

  return (
    <Paper variant="outlined" sx={{ p: 1, width: 'fit-content', maxWidth: '100%', bgcolor: 'background.default' }}>
      <Typography variant="caption" fontWeight={800} color="text.secondary">PIECE PREVIEW</Typography>
      <Box
        sx={{
          mt: 0.6,
          width: ratio >= 1 ? 155 : 105,
          maxWidth: '100%',
          aspectRatio: ratio,
          maxHeight: 125,
          minHeight: 70,
          border: '2px solid',
          borderColor: 'text.secondary',
          borderRadius: 0.75,
          background: grainBackground,
          display: 'grid',
          placeItems: 'center',
          color: 'primary.dark',
          fontSize: '1.7rem',
          fontWeight: 900,
        }}
      >
        {veneerDirection === 'length' ? '↔' : veneerDirection === 'width' ? '↕' : null}
      </Box>
      <Typography variant="body2" fontWeight={800} sx={{ mt: 0.6 }}>{dimensions}</Typography>
      {veneerDirection ? (
        <Typography variant="caption" color="text.secondary">
          Veneer: {VENEER_DIRECTION_LABELS[veneerDirection]}
        </Typography>
      ) : null}
    </Paper>
  )
}

export function OrderDesignPartsTab({ orderKey, orderNumber, inDesign = false }: { orderKey: string; orderNumber: string; inDesign?: boolean }) {
  const queryClient = useQueryClient()
  const [editorMode, setEditorMode] = useState<EditorMode>(null)
  const [editingPart, setEditingPart] = useState<OrderDesignPart | null>(null)
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<PurchasingItemSummary | null>(null)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogPage, setCatalogPage] = useState(1)
  const debouncedCatalogSearch = useDebounceValue(catalogSearch)
  const [draft, setDraft] = useState<PartDraft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const partsQuery = useQuery({
    queryKey: QUERY_KEYS.orderDesignParts(orderKey),
    queryFn: () => fetchOrderDesignParts(orderKey),
    enabled: Boolean(orderKey),
  })
  const catalogQuery = useQuery({
    queryKey: QUERY_KEYS.purchasingItems(debouncedCatalogSearch, catalogPage, CATALOG_PAGE_SIZE, debouncedCatalogSearch ? 1 : 0),
    queryFn: () => fetchPurchasingItems({ search: debouncedCatalogSearch, page: catalogPage, pageSize: CATALOG_PAGE_SIZE, aiAssist: Boolean(debouncedCatalogSearch) }),
    staleTime: 60_000,
  })
  const parts = useMemo(() => partsQuery.data?.parts || [], [partsQuery.data?.parts])
  const requiresDimensions = draft.requiresDimensions
  const requiresVeneerDirection = requiresDimensions && draft.requiresVeneerDirection
  const dialogTitle = editorMode === 'catalog'
    ? 'Add purchasing item'
    : editorMode === 'requested'
      ? 'Request a new item'
      : 'Edit needed part'

  const closeEditor = () => {
    setEditorMode(null)
    setEditingPart(null)
    setSelectedCatalogItem(null)
    setDraft(EMPTY_DRAFT)
    setError(null)
  }

  const openCatalogEditor = (item: PurchasingItemSummary) => {
    setEditorMode('catalog')
    setEditingPart(null)
    setSelectedCatalogItem(item)
    setDraft({
      ...EMPTY_DRAFT,
      itemName: item.itemRaw,
      description: item.descriptions?.[0] || '',
      requiresDimensions: item.requiresDimensions === true,
      dimensions: item.defaultDimensions || '',
      requiresVeneerDirection: item.requiresVeneerDirection === true,
      veneerDirection: item.defaultVeneerDirection || '',
    })
    setError(null)
  }

  const openRequestEditor = () => {
    setEditorMode('requested')
    setEditingPart(null)
    setSelectedCatalogItem(null)
    setDraft({ ...EMPTY_DRAFT, itemName: catalogSearch.trim(), requiresDimensions: false })
    setError(null)
  }

  const openEdit = (part: OrderDesignPart) => {
    setEditorMode('edit')
    setEditingPart(part)
    setDraft({
      itemName: part.itemName,
      description: part.description || '',
      link: part.link || '',
      quantity: String(part.quantity),
      requiresDimensions: part.requiresDimensions,
      dimensions: part.dimensions || '',
      requiresVeneerDirection: part.requiresVeneerDirection,
      veneerDirection: part.veneerDirection || '',
      status: part.status || '',
      vendor: part.vendor || '',
      dateOrdered: part.dateOrdered?.slice(0, 10) || '',
      dateReceived: part.dateReceived?.slice(0, 10) || '',
      dueDate: part.dueDate?.slice(0, 10) || '',
    })
    setError(null)
  }

  const handleSave = async () => {
    const quantity = Number(draft.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Enter a quantity greater than zero.')
      return
    }
    if (editorMode === 'catalog' && !selectedCatalogItem) {
      setError('Select an item from Purchasing.')
      return
    }
    if (editorMode === 'requested' && !draft.itemName.trim()) {
      setError('Enter the new item name.')
      return
    }
    if (editorMode === 'requested' && !draft.description.trim()) {
      setError('Describe the new item so Purchasing knows what is needed.')
      return
    }
    if (requiresDimensions && !draft.dimensions.trim()) {
      setError('Enter the exact piece size needed.')
      return
    }
    if (requiresVeneerDirection && !draft.veneerDirection) {
      setError('Select the veneer direction.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const catalogItemKey = selectedCatalogItem?.itemKey || editingPart?.itemKey
      if ((editorMode === 'catalog' || editingPart?.sourceType === 'catalog') && catalogItemKey) {
        await updatePurchasingItemSettings(catalogItemKey, {
          requiresDimensions,
          defaultDimensions: requiresDimensions ? draft.dimensions.trim() : null,
          requiresVeneerDirection,
          defaultVeneerDirection: requiresVeneerDirection && draft.veneerDirection
            ? draft.veneerDirection
            : null,
        })
        await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.purchasingItemDetail(catalogItemKey) })
        await queryClient.invalidateQueries({ queryKey: ['purchasing', 'items'] })
      }
      if (editorMode === 'edit' && editingPart) {
        await updateOrderDesignPart(orderKey, editingPart.id, {
          sourceType: editingPart.sourceType === 'requested' ? 'requested' : 'catalog',
          quantity,
          dimensions: draft.dimensions.trim() || null,
          description: draft.description.trim() || null,
          link: draft.link.trim() || null,
          requiresDimensions,
          requiresVeneerDirection,
          veneerDirection: requiresVeneerDirection && draft.veneerDirection ? draft.veneerDirection : null,
          status: draft.status || null,
          vendor: draft.vendor || null,
          dateOrdered: draft.dateOrdered || null,
          dateReceived: draft.dateReceived || null,
          dueDate: draft.dueDate || null,
        })
      } else {
        await createOrderDesignPart(orderKey, {
          sourceType: editorMode === 'requested' ? 'requested' : 'catalog',
          itemKey: selectedCatalogItem?.itemKey || null,
          itemName: editorMode === 'requested' ? draft.itemName.trim() : selectedCatalogItem?.itemRaw,
          description: draft.description.trim() || null,
          link: draft.link.trim() || null,
          quantity,
          requiresDimensions,
          dimensions: requiresDimensions ? draft.dimensions.trim() : null,
          requiresVeneerDirection,
          veneerDirection: requiresVeneerDirection && draft.veneerDirection ? draft.veneerDirection : null,
        })
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.orderDesignParts(orderKey) })
      closeEditor()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this part.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (part: OrderDesignPart) => {
    if (!window.confirm(`Remove ${part.itemName} from this order’s needed parts?`)) return
    setDeletingId(part.id)
    setError(null)
    try {
      await removeOrderDesignPart(orderKey, part.id)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.orderDesignParts(orderKey) })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove this part.')
    } finally {
      setDeletingId('')
    }
  }

  const counts = useMemo(() => ({
    catalog: parts.filter((part) => part.sourceType === 'catalog').length,
    requested: parts.filter((part) => part.sourceType === 'requested').length,
    monday: parts.filter((part) => part.sourceType === 'monday').length,
  }), [parts])

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography variant="h6" fontWeight={825}>Subitems</Typography>
        <Typography variant="body2" color="text.secondary">
          Add and track every subitem needed for order {orderNumber || '—'}. Item settings are remembered for the next order and can always be changed.
        </Typography>
      </Box>

      {error && editorMode === null ? <Alert severity="error">{error}</Alert> : null}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '310px minmax(0, 1fr)' }, gap: 1.5, alignItems: 'start' }}>
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 1.25 }}>
            <Typography fontWeight={800} sx={{ mb: 1 }}>All purchasing items</Typography>
            <TextField
              fullWidth
              size="small"
              value={catalogSearch}
              onChange={(event) => {
                setCatalogSearch(event.target.value)
                setCatalogPage(1)
              }}
              placeholder="Search items with AI…"
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
            />
            {catalogQuery.data?.aiAssist?.used ? (
              <Typography variant="caption" color="primary.main" sx={{ display: 'block', mt: 0.75 }}>
                AI expanded this search to find related purchasing items.
              </Typography>
            ) : null}
          </Box>
          <Divider />
          {catalogQuery.isLoading ? (
            <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={22} /></Stack>
          ) : catalogQuery.isError ? (
            <Alert severity="error" sx={{ m: 1 }}>Could not load purchasing items.</Alert>
          ) : (
            <List disablePadding>
              {(catalogQuery.data?.items || []).map((item) => (
                <ListItemButton key={item.itemKey} onClick={() => openCatalogEditor(item)} divider>
                  <ListItemText
                    primary={item.itemRaw}
                    secondary={item.descriptions?.[0] || (item.requiresDimensions ? 'Piece size required' : 'Quantity only')}
                    primaryTypographyProps={{ fontWeight: 700, fontSize: '0.9rem' }}
                    secondaryTypographyProps={{ noWrap: true }}
                  />
                </ListItemButton>
              ))}
              {(catalogQuery.data?.items || []).length === 0 ? (
                <Box sx={{ px: 2, py: 2 }}>
                  <Typography variant="body2" color="text.secondary">No existing items found.</Typography>
                </Box>
              ) : null}
            </List>
          )}
          {!catalogQuery.isError && (catalogQuery.data?.totalPages || 0) > 0 ? (
            <Stack spacing={0.5} alignItems="center" sx={{ px: 1, py: 1.2 }}>
              <Pagination
                page={catalogQuery.data?.page || catalogPage}
                count={catalogQuery.data?.totalPages || 1}
                onChange={(_event, page) => setCatalogPage(page)}
                size="small"
                siblingCount={0}
                boundaryCount={1}
                showFirstButton
                showLastButton
              />
              <Typography variant="caption" color="text.secondary">
                Page {catalogQuery.data?.page || catalogPage} of {catalogQuery.data?.totalPages || 1} · {catalogQuery.data?.totalCount || 0} items
              </Typography>
            </Stack>
          ) : null}
          <Divider />
          <ListItemButton onClick={openRequestEditor} sx={{ color: 'primary.main' }}>
            <PlaylistAddRoundedIcon sx={{ mr: 1.25 }} />
            <ListItemText
              primary="Request new item"
              secondary={catalogSearch.trim() ? `Can't find “${catalogSearch.trim()}”?` : 'Create a request for Purchasing'}
              primaryTypographyProps={{ fontWeight: 800 }}
            />
          </ListItemButton>
        </Paper>

        <Stack spacing={1}>
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            <Chip size="small" label={`${parts.length} total`} variant="outlined" />
            <Chip size="small" label={`${counts.catalog} catalog`} variant="outlined" />
            <Chip size="small" label={`${counts.requested} requested`} color={counts.requested ? 'warning' : 'default'} variant="outlined" />
            <Chip size="small" label={`${counts.monday} from Monday`} color="info" variant="outlined" />
          </Stack>
          {partsQuery.isLoading ? (
            <Stack alignItems="center" sx={{ py: 5 }}><CircularProgress size={24} /></Stack>
          ) : partsQuery.isError ? (
            <Alert severity="error">Could not load the subitems for this order.</Alert>
          ) : parts.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
              <Typography fontWeight={700}>No subitems have been added yet.</Typography>
              <Typography variant="body2" color="text.secondary">Choose an item from the list or request something new.</Typography>
            </Paper>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 'calc(92vh - 250px)' }}>
              <Table size="small" stickyHeader sx={{ minWidth: 980 }} aria-label="Order subitems">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ minWidth: 310, fontWeight: 800 }}>Subitem</TableCell>
                    <TableCell sx={{ minWidth: 145, fontWeight: 800 }}>Status</TableCell>
                    <TableCell sx={{ minWidth: 145, fontWeight: 800 }}>Vendor</TableCell>
                    <TableCell sx={{ minWidth: 115, fontWeight: 800 }}>Date Ordered</TableCell>
                    <TableCell sx={{ minWidth: 115, fontWeight: 800 }}>Date Received</TableCell>
                    <TableCell sx={{ minWidth: 115, fontWeight: 800 }}>Due Date</TableCell>
                    <TableCell align="right" sx={{ minWidth: 155, fontWeight: 800 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {parts.map((part) => (
                    <TableRow key={part.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                      <TableCell>
                        <Stack spacing={0.45}>
                          <Stack direction="row" spacing={0.65} alignItems="center" useFlexGap flexWrap="wrap">
                            <Typography variant="body2" fontWeight={800}>{part.itemName}</Typography>
                            <Chip
                              size="small"
                              label={part.sourceType === 'requested' ? 'Request' : part.sourceType === 'monday' ? 'Monday' : 'Purchasing'}
                              color={part.sourceType === 'requested' ? 'warning' : part.sourceType === 'monday' ? 'info' : 'primary'}
                              variant="outlined"
                            />
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            Qty {part.quantity}
                            {part.dimensions ? ` · ${part.dimensions}` : ''}
                            {part.requiresVeneerDirection && part.veneerDirection
                              ? ` · Veneer: ${VENEER_DIRECTION_LABELS[part.veneerDirection]}`
                              : ''}
                          </Typography>
                          {part.requiresDimensions ? <PartMiniPreview dimensions={part.dimensions} veneerDirection={part.veneerDirection} /> : null}
                          {part.description ? <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{part.description}</Typography> : null}
                          {part.link ? <Link href={part.link} target="_blank" rel="noopener noreferrer" variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}><LinkRoundedIcon fontSize="inherit" />Open item link</Link> : null}
                          <Typography variant="caption" color="text.disabled">
                            Added by {part.createdByName || part.createdByEmail || 'worker'}{part.createdAt ? ` · ${formatDateTime(part.createdAt)}` : ''}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>{part.status ? <Chip size="small" label={part.status} sx={{ bgcolor: part.statusColor || undefined, fontWeight: 700 }} /> : '—'}</TableCell>
                      <TableCell>{part.vendor || '—'}</TableCell>
                      <TableCell>{part.dateOrdered || '—'}</TableCell>
                      <TableCell>{part.dateReceived || '—'}</TableCell>
                      <TableCell>{part.dueDate || '—'}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                          <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => openEdit(part)}>Edit</Button>
                          {part.sourceType !== 'monday' ? (
                            <Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} disabled={deletingId === part.id} onClick={() => void handleDelete(part)}>
                              {deletingId === part.id ? 'Removing…' : 'Remove'}
                            </Button>
                          ) : null}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </Box>

      <Dialog open={editorMode !== null} onClose={() => { if (!saving) closeEditor() }} maxWidth="sm" fullWidth>
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {editorMode === 'catalog' ? (
              <TextField label="Purchasing item" value={selectedCatalogItem?.itemRaw || ''} disabled />
            ) : (
              <TextField label="Item" value={draft.itemName} disabled={editorMode === 'edit'} onChange={(event) => setDraft((current) => ({ ...current, itemName: event.target.value }))} required={editorMode === 'requested'} />
            )}
            <FormControlLabel
              control={(
                <Checkbox
                  checked={draft.requiresDimensions}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    requiresDimensions: event.target.checked,
                    dimensions: event.target.checked ? current.dimensions : '',
                    requiresVeneerDirection: event.target.checked ? current.requiresVeneerDirection : false,
                    veneerDirection: event.target.checked ? current.veneerDirection : '',
                  }))}
                />
              )}
              label="This item needs an exact piece size"
            />
            {requiresDimensions ? (
              <>
                <TextField
                  label="Exact piece size needed"
                  placeholder={'Example: 48" × 12" × 3/4"'}
                  value={draft.dimensions}
                  onChange={(event) => setDraft((current) => ({ ...current, dimensions: event.target.value }))}
                  required
                  helperText="Enter the piece the designer needs. Purchasing will decide the stock sheet or package to buy."
                />
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={draft.requiresVeneerDirection}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        requiresVeneerDirection: event.target.checked,
                        veneerDirection: event.target.checked ? current.veneerDirection : '',
                      }))}
                    />
                  )}
                  label="Track veneer/grain direction for this item"
                />
                {requiresVeneerDirection ? (
                  <FormControl fullWidth required>
                    <InputLabel id="veneer-direction-label">Veneer direction</InputLabel>
                    <Select
                      labelId="veneer-direction-label"
                      label="Veneer direction"
                      value={draft.veneerDirection}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        veneerDirection: event.target.value as PartDraft['veneerDirection'],
                      }))}
                    >
                      <MenuItem value="length">Along length</MenuItem>
                      <MenuItem value="width">Along width</MenuItem>
                      <MenuItem value="none">No preference</MenuItem>
                    </Select>
                  </FormControl>
                ) : null}
                <PartMiniPreview
                  dimensions={draft.dimensions}
                  veneerDirection={requiresVeneerDirection ? draft.veneerDirection : null}
                />
              </>
            ) : null}
            <TextField label="Quantity" type="number" inputProps={{ min: 0.001, step: 1 }} value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))} required />
            {editorMode === 'edit' ? (
              <>
                <FormControl fullWidth>
                  <InputLabel id="subitem-status-label">Status</InputLabel>
                  <Select labelId="subitem-status-label" label="Status" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                    <MenuItem value=""><em>No status</em></MenuItem>
                    {(inDesign ? DESIGN_SUBITEM_STATUSES : ORDER_TRACK_SUBITEM_STATUSES).map((status) => <MenuItem key={status} value={status}>{status}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField label="Vendor" value={draft.vendor} onChange={(event) => setDraft((current) => ({ ...current, vendor: event.target.value }))} />
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: inDesign ? '1fr' : 'repeat(3, 1fr)' }, gap: 1 }}>
                  {!inDesign ? <TextField label="Date ordered" type="date" InputLabelProps={{ shrink: true }} value={draft.dateOrdered} onChange={(event) => setDraft((current) => ({ ...current, dateOrdered: event.target.value }))} /> : null}
                  <TextField label="Date received" type="date" InputLabelProps={{ shrink: true }} value={draft.dateReceived} onChange={(event) => setDraft((current) => ({ ...current, dateReceived: event.target.value }))} />
                  {!inDesign ? <TextField label="Due date" type="date" InputLabelProps={{ shrink: true }} value={draft.dueDate} onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))} /> : null}
                </Box>
              </>
            ) : null}
            <TextField label={editorMode === 'requested' ? 'Description of new item' : 'Notes (optional)'} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} multiline minRows={3} required={editorMode === 'requested'} />
            <TextField label="Link (optional)" placeholder="https://…" value={draft.link} onChange={(event) => setDraft((current) => ({ ...current, link: event.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditor} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>{saving ? 'Saving…' : editorMode === 'requested' ? 'Submit request' : 'Save part'}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

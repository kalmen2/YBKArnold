// Turning selected buying-list lines into real QuickBooks purchase orders.
//
// Lines are grouped by vendor into one order each, which is what QuickBooks
// wants anyway and what a vendor expects to receive. The project on every line
// is the order it belongs to; standalone shop purchases carry none and need one
// chosen here, because QuickBooks will not take a purchase order line without.
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type { BuyingLine, PurchasingPoContextProject, PurchasingPoContextVendor } from './api'

export type PurchaseOrderDraftLine = {
  line: BuyingLine
  vendorId: string
  unitPrice: string
}

export function CreatePurchaseOrdersDialog({
  open,
  lines,
  vendors,
  projects,
  isSaving,
  errorMessage,
  onConfirm,
  onClose,
}: {
  open: boolean
  lines: BuyingLine[]
  vendors: PurchasingPoContextVendor[]
  projects: PurchasingPoContextProject[]
  isSaving: boolean
  errorMessage: string | null
  onConfirm: (drafts: PurchaseOrderDraftLine[], fallbackProjectId: string) => void
  onClose: () => void
}) {
  // The vendor written on a line is free text; QuickBooks needs its id. Matched
  // by name here, and anything unmatched is chosen by hand below.
  const vendorIdByName = useMemo(() => {
    const byName = new Map<string, string>()

    vendors.forEach((vendor) => {
      byName.set(vendor.name.trim().toLowerCase(), vendor.id)
    })

    return byName
  }, [vendors])

  const [drafts, setDrafts] = useState<PurchaseOrderDraftLine[]>(() => lines.map((line) => ({
    line,
    vendorId: vendorIdByName.get(String(line.vendor ?? '').trim().toLowerCase()) ?? '',
    unitPrice: '',
  })))
  const [fallbackProjectId, setFallbackProjectId] = useState('')

  const needsFallbackProject = drafts.some(({ line }) => !line.projectNumber && !line.projectId)
  const unmatchedVendors = drafts.filter((draft) => !draft.vendorId).length

  const groupedCount = useMemo(
    () => new Set(drafts.map((draft) => draft.vendorId).filter(Boolean)).size,
    [drafts],
  )

  const canConfirm = unmatchedVendors === 0
    && (!needsFallbackProject || Boolean(fallbackProjectId))
    && drafts.length > 0

  function patchDraft(lineId: string, changes: Partial<PurchaseOrderDraftLine>) {
    setDrafts((current) => current.map((draft) => (
      draft.line.lineId === lineId ? { ...draft, ...changes } : draft
    )))
  }

  return (
    <Dialog open={open} onClose={isSaving ? undefined : onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {`Create purchase orders`}
        <Typography variant="body2" color="text.secondary">
          {groupedCount === 1
            ? `${drafts.length} lines going to one vendor, as one purchase order.`
            : `${drafts.length} lines across ${groupedCount} vendors, one purchase order each.`}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {errorMessage ? <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert> : null}

        {unmatchedVendors > 0 ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {`${unmatchedVendors} line${unmatchedVendors === 1 ? '' : 's'} need a QuickBooks vendor picked below.`}
          </Alert>
        ) : null}

        {needsFallbackProject ? (
          <Box sx={{ mb: 2.5 }}>
            <TextField
              select
              fullWidth
              label="Project for shop purchases"
              value={fallbackProjectId}
              onChange={(event) => setFallbackProjectId(event.target.value)}
              helperText="Lines that belong to an order use that order's project. Shop purchases need one chosen."
            >
              {projects.map((project) => (
                <MenuItem key={project.id} value={project.id}>
                  {project.projectNumber ? `${project.projectNumber} · ${project.name}` : project.name}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        ) : null}

        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, whiteSpace: 'nowrap' } }}>
              <TableCell>Item</TableCell>
              <TableCell sx={{ width: 120 }}>Project</TableCell>
              <TableCell sx={{ width: 80 }} align="right">Qty</TableCell>
              <TableCell sx={{ width: 230 }}>Vendor</TableCell>
              <TableCell sx={{ width: 130 }}>Unit price</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {drafts.map((draft) => (
              <TableRow key={draft.line.lineId}>
                <TableCell>
                  <Typography variant="body2">{draft.line.itemName}</Typography>
                  {draft.line.dimensions ? (
                    <Typography variant="caption" color="text.disabled">{draft.line.dimensions}</Typography>
                  ) : null}
                </TableCell>

                <TableCell>
                  <Typography variant="body2" color={draft.line.projectNumber ? undefined : 'text.disabled'}>
                    {draft.line.projectNumber || 'Shop'}
                  </Typography>
                </TableCell>

                <TableCell align="right">{draft.line.quantity}</TableCell>

                <TableCell>
                  <TextField
                    select
                    size="small"
                    fullWidth
                    value={draft.vendorId}
                    error={!draft.vendorId}
                    onChange={(event) => patchDraft(draft.line.lineId, { vendorId: event.target.value })}
                  >
                    <MenuItem value="">Choose a vendor</MenuItem>
                    {vendors.map((vendor) => (
                      <MenuItem key={vendor.id} value={vendor.id}>{vendor.name}</MenuItem>
                    ))}
                  </TextField>
                </TableCell>

                <TableCell>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="0.00"
                    value={draft.unitPrice}
                    onChange={(event) => patchDraft(draft.line.lineId, { unitPrice: event.target.value })}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>

      <DialogActions>
        <Button color="inherit" disabled={isSaving} onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!canConfirm || isSaving}
          onClick={() => onConfirm(drafts, fallbackProjectId)}
          sx={{ bgcolor: 'grey.800', boxShadow: 'none', '&:hover': { bgcolor: 'grey.900', boxShadow: 'none' } }}
        >
          {isSaving ? 'Creating…' : 'Create in QuickBooks'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

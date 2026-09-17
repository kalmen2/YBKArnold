// Adding something to buy that belongs to no order.
//
// Shop supplies, consumables, stock replenishment. It carries no project,
// because there is no order behind it, which is the whole difference between
// this and a part on an order.
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material'
import { useState } from 'react'
import type { PurchasingPoContextProject } from './api'
import { ItemHistoryPicker } from './ItemHistoryPicker'

export type NewPurchaseItem = {
  itemKey: string | null
  itemName: string
  /** Required. General shop spend has a QuickBooks project too. */
  projectId: string
  description: string
  quantity: string
  vendor: string
  source: 'purchase' | 'stock'
  orderByDate: string
  dueDate: string
  notes: string
}

const EMPTY: NewPurchaseItem = {
  itemKey: null,
  itemName: '',
  projectId: '',
  description: '',
  quantity: '1',
  vendor: '',
  source: 'purchase',
  orderByDate: '',
  dueDate: '',
  notes: '',
}

export function AddPurchaseItemDialog({
  open,
  isSaving,
  vendorOptions,
  projects,
  isLoadingProjects,
  onSave,
  onClose,
}: {
  open: boolean
  isSaving: boolean
  vendorOptions: string[]
  projects: PurchasingPoContextProject[]
  isLoadingProjects: boolean
  onSave: (item: NewPurchaseItem) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<NewPurchaseItem>(EMPTY)

  function patch(changes: Partial<NewPurchaseItem>) {
    setForm((current) => ({ ...current, ...changes }))
  }

  const canSave = form.itemName.trim().length > 0
    && Number(form.quantity) > 0
    && Boolean(form.projectId)

  return (
    <Dialog open={open} onClose={isSaving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add an item to buy</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <ItemHistoryPicker
            autoFocus
            value={{ itemKey: form.itemKey, itemName: form.itemName }}
            onChange={(next) => patch(next)}
          />

          {/* Required, and it must be a real QuickBooks project. Asked for here
              rather than at purchase order time, so nothing reaches the buying
              list that cannot actually be bought. */}
          <TextField
            select
            required
            label="Project"
            value={form.projectId}
            onChange={(event) => patch({ projectId: event.target.value })}
            InputLabelProps={{ shrink: true }}
            disabled={isLoadingProjects}
            helperText={isLoadingProjects
              ? 'Loading QuickBooks projects…'
              : 'Shop spend goes to the General project.'}
          >
            {projects.map((project) => (
              <MenuItem key={project.id} value={project.id}>
                {project.projectNumber ? `${project.projectNumber} · ${project.name}` : project.name}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction="row" spacing={1.5}>
            <TextField
              label="Quantity"
              value={form.quantity}
              onChange={(event) => patch({ quantity: event.target.value })}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 120 }}
            />

            <TextField
              select
              label="Source"
              value={form.source}
              onChange={(event) => patch({ source: event.target.value as 'purchase' | 'stock' })}
              InputLabelProps={{ shrink: true }}
              helperText={form.source === 'stock' ? 'Already in the shop; will not be bought.' : ' '}
              sx={{ flexGrow: 1 }}
            >
              <MenuItem value="purchase">Buy it</MenuItem>
              <MenuItem value="stock">Take from stock</MenuItem>
            </TextField>
          </Stack>

          <TextField
            select
            label="Vendor"
            value={form.vendor}
            onChange={(event) => patch({ vendor: event.target.value })}
            InputLabelProps={{ shrink: true }}
            helperText="Needed before a purchase order can be raised."
          >
            <MenuItem value="">Not chosen yet</MenuItem>
            {vendorOptions.map((vendor) => (
              <MenuItem key={vendor} value={vendor}>{vendor}</MenuItem>
            ))}
          </TextField>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              type="date"
              label="Order by"
              value={form.orderByDate}
              onChange={(event) => patch({ orderByDate: event.target.value })}
              InputLabelProps={{ shrink: true }}
              helperText="When it has to be bought."
              sx={{ flexGrow: 1 }}
            />

            <TextField
              type="date"
              label="Needed by"
              value={form.dueDate}
              onChange={(event) => patch({ dueDate: event.target.value })}
              InputLabelProps={{ shrink: true }}
              helperText="When it has to be here."
              sx={{ flexGrow: 1 }}
            />
          </Stack>

          <TextField
            label="Notes"
            value={form.notes}
            onChange={(event) => patch({ notes: event.target.value })}
            InputLabelProps={{ shrink: true }}
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button color="inherit" disabled={isSaving} onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!canSave || isSaving}
          onClick={() => onSave(form)}
          sx={{ bgcolor: 'grey.800', boxShadow: 'none', '&:hover': { bgcolor: 'grey.900', boxShadow: 'none' } }}
        >
          {isSaving ? 'Adding…' : 'Add item'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

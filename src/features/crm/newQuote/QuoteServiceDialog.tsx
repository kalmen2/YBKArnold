// Adding one service or one delivery option, in one dialog.
//
// The staged form spread this across two card selectors, an "add a custom
// service" button and an "add another delivery option" button, all on the page
// at once. Here it is a single button that opens this: choose the kind, pick
// from the standard list or write your own, set the price, add it.
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'
import type { QuoteServiceItemFormState } from '../quoteFormState'

export type QuoteServiceKind = 'service' | 'delivery'

export type QuoteServicePreset = {
  title: string
  description: string
  unitPrice: number | null
}

const CUSTOM_KEY = '__custom__'

export function QuoteServiceDialog({
  open,
  servicePresets,
  deliveryPresets,
  onAdd,
  onClose,
}: {
  open: boolean
  servicePresets: QuoteServicePreset[]
  deliveryPresets: QuoteServicePreset[]
  onAdd: (kind: QuoteServiceKind, item: QuoteServiceItemFormState) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<QuoteServiceKind>('service')
  const [selectedTitle, setSelectedTitle] = useState(CUSTOM_KEY)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [qty, setQty] = useState('1')
  const [unitPrice, setUnitPrice] = useState('')

  const presets = kind === 'service' ? servicePresets : deliveryPresets

  function choosePreset(preset: QuoteServicePreset | null) {
    if (!preset) {
      setSelectedTitle(CUSTOM_KEY)
      setTitle('')
      setDescription('')
      setUnitPrice('')
      return
    }

    setSelectedTitle(preset.title)
    setTitle(preset.title)
    setDescription(preset.description)
    setUnitPrice(preset.unitPrice === null ? '' : String(preset.unitPrice))
  }

  const canAdd = title.trim().length > 0

  function add() {
    if (!canAdd) {
      return
    }

    const quantity = Number(qty) || 0
    const price = Number(unitPrice) || 0

    onAdd(kind, {
      id: crypto.randomUUID(),
      title: title.trim(),
      description: description.trim(),
      qty: qty.trim(),
      unitPrice: unitPrice.trim(),
      extPrice: String(Number((quantity * price).toFixed(2))),
      images: [],
      location: null,
    })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1.5 }}>Add service or delivery</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={kind}
            onChange={(_event, value: QuoteServiceKind | null) => {
              if (value) {
                setKind(value)
                choosePreset(null)
              }
            }}
          >
            <ToggleButton value="service" sx={{ textTransform: 'none' }}>Service</ToggleButton>
            <ToggleButton value="delivery" sx={{ textTransform: 'none' }}>Freight &amp; delivery</ToggleButton>
          </ToggleButtonGroup>

          <Stack spacing={0.75}>
            {presets.map((preset) => {
              const isSelected = selectedTitle === preset.title

              return (
                <Paper
                  key={preset.title}
                  variant="outlined"
                  role="button"
                  tabIndex={0}
                  onClick={() => choosePreset(preset)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') choosePreset(preset)
                  }}
                  sx={{
                    p: 1.25,
                    cursor: 'pointer',
                    borderRadius: 1.5,
                    borderColor: isSelected ? 'primary.main' : 'divider',
                    bgcolor: (theme) => (isSelected ? alpha(theme.palette.primary.main, 0.06) : 'transparent'),
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Typography variant="subtitle2">{preset.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {preset.description}
                      </Typography>
                    </Box>
                    {preset.unitPrice !== null ? (
                      <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {`$${preset.unitPrice.toLocaleString()}`}
                      </Typography>
                    ) : null}
                  </Stack>
                </Paper>
              )
            })}

            <Button
              size="small"
              startIcon={<AddRoundedIcon />}
              onClick={() => choosePreset(null)}
              sx={{ alignSelf: 'flex-start' }}
            >
              Write my own instead
            </Button>
          </Stack>

          <TextField
            label="Name"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setSelectedTitle(CUSTOM_KEY)
            }}
            placeholder={kind === 'service' ? 'Shop drawings' : 'Dock delivery'}
          />

          <TextField
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            multiline
            minRows={2}
            placeholder="What this covers, and anything the customer should know."
          />

          <Stack direction="row" spacing={1.5}>
            <TextField
              label="Qty"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              sx={{ width: 110 }}
            />
            <TextField
              label="Unit price"
              value={unitPrice}
              onChange={(event) => setUnitPrice(event.target.value)}
              placeholder="0.00"
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              sx={{ width: 170 }}
            />
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!canAdd} onClick={add}>Add</Button>
      </DialogActions>
    </Dialog>
  )
}

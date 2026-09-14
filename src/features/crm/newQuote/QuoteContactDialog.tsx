// Editing who the quote is addressed to, without leaving the page.
//
// The pencil used to reopen the account picker, which is the wrong tool for
// fixing a typo in an email address. Picking is a different job from editing,
// so this does the editing and keeps a way back to the picker for the times it
// really is the wrong account.
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'

export function QuoteContactDialog({
  open,
  companyName,
  contactName,
  contactEmail,
  contactPhone,
  onSave,
  onChangeAccount,
  onClose,
}: {
  open: boolean
  companyName: string
  contactName: string
  contactEmail: string
  contactPhone: string
  onSave: (details: { name: string, email: string, phone: string }) => void
  onChangeAccount: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(contactName)
  const [email, setEmail] = useState(contactEmail)
  const [phone, setPhone] = useState(contactPhone)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Contact details</DialogTitle>

      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          {companyName || 'No account chosen'}
        </Typography>

        <Stack spacing={2}>
          <TextField
            autoFocus
            label="Contact name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            type="email"
            label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            InputLabelProps={{ shrink: true }}
            helperText="Saved back to the contact record as well."
          />
          <TextField
            type="tel"
            label="Phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Stack>

        <Divider sx={{ my: 2.5, borderStyle: 'dashed' }} />

        <Button
          size="small"
          startIcon={<SwapHorizRoundedIcon />}
          onClick={onChangeAccount}
        >
          Use a different account or contact
        </Button>
      </DialogContent>

      <DialogActions>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!name.trim()}
          onClick={() => onSave({ name: name.trim(), email: email.trim(), phone: phone.trim() })}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Picking who the quote is for, in one dialog and two steps.
//
// Modelled on Minimal's invoice address picker, but a quote is addressed to a
// person at a dealer rather than to a single address book entry. So the same
// dialog walks forward: first the dealer accounts, then the contacts inside the
// dealer that was chosen. Either step can add a new record instead of picking.
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type { CrmContact, CrmDealer } from '../api'

export type QuoteAccountSelection = { dealer: CrmDealer, contact: CrmContact }

// There are thousands of accounts. Rendering them all costs a visible pause on
// open and on every keystroke, so a page is shown and the rest arrives as the
// list is scrolled.
const PAGE_SIZE = 20

function dealerLocation(dealer: CrmDealer) {
  const city = String(dealer.city ?? '').trim()
  const state = String(dealer.state ?? '').trim().toUpperCase()

  return [city, state].filter(Boolean).join(', ')
}

function matches(haystack: (string | null | undefined)[], query: string) {
  const needle = query.trim().toLowerCase()

  if (!needle) {
    return true
  }

  return haystack.some((value) => String(value ?? '').toLowerCase().includes(needle))
}

function PickerRow({
  primary,
  secondary,
  tertiary,
  onClick,
}: {
  primary: string
  secondary?: string
  tertiary?: string
  onClick: () => void
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        py: 1.1,
        px: 1.5,
        gap: 0.25,
        width: '100%',
        borderRadius: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        textAlign: 'left',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Typography variant="subtitle2" sx={{ width: '100%' }} noWrap>{primary}</Typography>
      {secondary ? (
        <Typography variant="body2" color="text.secondary" sx={{ width: '100%' }} noWrap>
          {secondary}
        </Typography>
      ) : null}
      {tertiary ? (
        <Typography variant="body2" color="text.secondary" sx={{ width: '100%' }} noWrap>
          {tertiary}
        </Typography>
      ) : null}
    </ButtonBase>
  )
}

export function QuoteAccountDialog({
  open,
  dealers,
  contacts,
  isLoadingDealers,
  isLoadingContacts,
  selectedDealer,
  onPickDealer,
  onSelect,
  onAddDealer,
  onAddContact,
  onClose,
}: {
  open: boolean
  dealers: CrmDealer[]
  /** Contacts for `selectedDealer`, fetched by the caller as the step changes. */
  contacts: CrmContact[]
  isLoadingDealers: boolean
  isLoadingContacts: boolean
  selectedDealer: CrmDealer | null
  onPickDealer: (dealer: CrmDealer | null) => void
  onSelect: (selection: QuoteAccountSelection) => void
  onAddDealer: (typedName: string) => void
  onAddContact: (typedName: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const step = selectedDealer ? 'contact' : 'dealer'

  // Each step searches its own list, so moving between them starts a new query
  // and a new first page.
  function pickDealer(dealer: CrmDealer | null) {
    setSearch('')
    setVisibleCount(PAGE_SIZE)
    onPickDealer(dealer)
  }

  function changeSearch(value: string) {
    setSearch(value)
    setVisibleCount(PAGE_SIZE)
  }

  /** Reveals another page once the scroll is within a page of the end. */
  function loadMoreOnScroll(event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget

    if (element.scrollHeight - element.scrollTop - element.clientHeight > 240) {
      return
    }

    setVisibleCount((current) => (current >= matchCount ? current : current + PAGE_SIZE))
  }

  const visibleDealers = useMemo(
    () => dealers.filter((dealer) => matches(
      [dealer.name, dealer.sourceId, dealer.city, dealer.state, dealer.salesRep],
      search,
    )),
    [dealers, search],
  )

  const visibleContacts = useMemo(
    () => contacts.filter((contact) => matches(
      [contact.name, contact.primaryEmail, contact.phone, contact.accountName],
      search,
    )),
    [contacts, search],
  )

  const matchCount = step === 'dealer' ? visibleDealers.length : visibleContacts.length
  const isEmpty = step === 'dealer'
    ? visibleDealers.length === 0
    : !isLoadingContacts && visibleContacts.length === 0
  const hiddenCount = Math.max(0, matchCount - visibleCount)

  return (
    <Dialog fullWidth maxWidth="xs" open={open} onClose={onClose}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ py: 2.5, pl: 2, pr: 1.5 }}>
        {step === 'contact' ? (
          <IconButton size="small" onClick={() => pickDealer(null)} aria-label="Back to accounts">
            <ArrowBackRoundedIcon fontSize="small" />
          </IconButton>
        ) : null}

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6">{step === 'dealer' ? 'Accounts' : 'Contacts'}</Typography>
          {step === 'contact' ? (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {selectedDealer?.name}
            </Typography>
          ) : null}
        </Box>

        <Button
          size="small"
          startIcon={<AddRoundedIcon />}
          onClick={() => (step === 'dealer' ? onAddDealer(search) : onAddContact(search))}
        >
          Add
        </Button>
      </Stack>

      <Box sx={{ px: 2, pb: 2 }}>
        <TextField
          fullWidth
          autoFocus
          size="small"
          value={search}
          onChange={(event) => changeSearch(event.target.value)}
          placeholder={step === 'dealer' ? 'Search accounts…' : 'Search contacts…'}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" sx={{ color: 'text.disabled' }} />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      <Box onScroll={loadMoreOnScroll} sx={{ px: 0.5, pb: 1, maxHeight: 420, overflowY: 'auto' }}>
        {(step === 'dealer' ? isLoadingDealers : isLoadingContacts) && matchCount === 0 ? (
          <Stack alignItems="center" sx={{ py: 5 }}><CircularProgress size={26} /></Stack>
        ) : isEmpty ? (
          <Stack spacing={1} alignItems="center" sx={{ px: 3, py: 5 }}>
            <Typography variant="subtitle2">
              {search.trim() ? `No results for "${search.trim()}"` : 'Nothing here yet'}
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {step === 'dealer'
                ? 'Use Add to create the account.'
                : 'This account has no contacts. Use Add to create one.'}
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={0.25}>
            {step === 'dealer'
              ? visibleDealers.slice(0, visibleCount).map((dealer) => (
                <PickerRow
                  key={dealer.sourceId}
                  primary={String(dealer.name ?? dealer.sourceId ?? '').trim() || dealer.sourceId}
                  secondary={dealerLocation(dealer)}
                  tertiary={String(dealer.sourceId ?? '').trim()}
                  onClick={() => pickDealer(dealer)}
                />
              ))
              : visibleContacts.slice(0, visibleCount).map((contact) => (
                <PickerRow
                  key={contact.sourceId}
                  primary={String(contact.name ?? '').trim() || 'Unnamed contact'}
                  secondary={String(contact.primaryEmail ?? '').trim()}
                  tertiary={String(contact.phone ?? '').trim()}
                  onClick={() => {
                    if (selectedDealer) {
                      onSelect({ dealer: selectedDealer, contact })
                    }
                  }}
                />
              ))}

            {hiddenCount > 0 ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ px: 1.5, py: 1.25, textAlign: 'center' }}
              >
                {`Scroll for ${hiddenCount} more`}
              </Typography>
            ) : null}
          </Stack>
        )}
      </Box>
    </Dialog>
  )
}

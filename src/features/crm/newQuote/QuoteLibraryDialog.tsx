// Saved line blocks, to drop into a quote or to add to from one.
//
// The library dialog in the staged editor is a bare list with an Insert button
// on every row. This shows what each entry actually contains before you commit
// to it, because the names alone ("Reception desk") rarely say enough.
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Dialog,
  DialogTitle,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type { CrmQuoteLineLibraryEntry } from '../api'

/** The first line's heading, which is what the block is recognised by. */
function entrySummary(entry: CrmQuoteLineLibraryEntry) {
  const lines = Array.isArray(entry.lines) ? entry.lines : []
  const first = lines.find((line) => !line.parentLineId) ?? lines[0]
  const description = String(first?.description ?? '').replace(/\r\n?/g, '\n')

  return description.split('\n').filter(Boolean).slice(0, 2).join(' · ')
}

export function QuoteLibraryDialog({
  open,
  entries,
  isLoading,
  errorMessage,
  onInsert,
  onClose,
}: {
  open: boolean
  entries: CrmQuoteLineLibraryEntry[]
  isLoading: boolean
  errorMessage: string | null
  onInsert: (entry: CrmQuoteLineLibraryEntry) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()

    if (!needle) {
      return entries
    }

    return entries.filter((entry) => (
      `${entry.name} ${entrySummary(entry)}`.toLowerCase().includes(needle)
    ))
  }, [entries, search])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1.5 }}>Insert from library</DialogTitle>

      <Box sx={{ px: 3, pb: 2 }}>
        <TextField
          fullWidth
          autoFocus
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search the library…"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" sx={{ color: 'text.disabled' }} />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      <Box sx={{ px: 1.5, pb: 2, maxHeight: 440, overflowY: 'auto' }}>
        {errorMessage ? <Alert severity="error" sx={{ mx: 1.5, mb: 1.5 }}>{errorMessage}</Alert> : null}

        {isLoading && entries.length === 0 ? (
          <Stack alignItems="center" sx={{ py: 5 }}><CircularProgress size={26} /></Stack>
        ) : visible.length === 0 ? (
          <Stack spacing={1} alignItems="center" sx={{ px: 3, py: 5 }}>
            <LibraryAddOutlinedIcon sx={{ fontSize: 34, color: 'text.disabled' }} />
            <Typography variant="subtitle2">
              {search.trim() ? `No results for "${search.trim()}"` : 'The library is empty'}
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Save a line from a quote to start filling it.
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={0.5}>
            {visible.map((entry) => {
              const lineCount = Array.isArray(entry.lines) ? entry.lines.length : 0
              const summary = entrySummary(entry)

              return (
                <ButtonBase
                  key={entry.id}
                  onClick={() => {
                    onInsert(entry)
                    onClose()
                  }}
                  sx={{
                    p: 1.5,
                    gap: 0.5,
                    width: '100%',
                    borderRadius: 1.5,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    textAlign: 'left',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                    <Typography variant="subtitle2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                      {entry.name}
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${lineCount} line${lineCount === 1 ? '' : 's'}`}
                    />
                  </Stack>
                  {summary ? (
                    <Typography variant="body2" color="text.secondary" sx={{ width: '100%' }} noWrap>
                      {summary}
                    </Typography>
                  ) : null}
                </ButtonBase>
              )
            })}
          </Stack>
        )}
      </Box>

      <Box sx={{ px: 3, pb: 2, display: 'flex', justifyContent: 'flex-end' }}>
        <Button color="inherit" onClick={onClose}>Close</Button>
      </Box>
    </Dialog>
  )
}

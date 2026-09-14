// Field labels that show, at a glance, what has already been filled in.
//
// The tick rides on the label rather than inside the field. Selects and
// autocompletes already own the right-hand edge with their dropdown arrows, and
// a mark that lands in a different place on every third field reads as clutter
// rather than as progress.
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import { Box } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * Pass `value` for the usual case — anything but whitespace counts as filled —
 * or `filled` where the field is only really answered when the value is one of
 * a known set, as with Project Type.
 */
export function QuoteFieldLabel({ label, value, filled }: {
  label: ReactNode
  value?: unknown
  filled?: boolean
}) {
  const isFilled = filled ?? String(value ?? '').trim().length > 0

  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
      {label}
      {isFilled ? (
        <CheckCircleRoundedIcon sx={{ fontSize: 17, color: 'success.main' }} />
      ) : null}
    </Box>
  )
}

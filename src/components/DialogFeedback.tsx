import { Alert, Stack } from '@mui/material'

/**
 * The error surface for a dialog.
 *
 * A dialog that reports failures through a page-level banner reports nothing:
 * the modal covers the banner, so the button just looks dead. Every dialog with
 * an action should render one of these next to its actions instead.
 *
 * `npm run check:dialogs` fails the build if an action dialog has no error
 * surface, so this cannot quietly regress.
 */
export function DialogFeedback({
  error,
  success,
  onDismissError,
  sx,
}: {
  error?: string | null
  success?: string | null
  onDismissError?: () => void
  sx?: object
}) {
  if (!error && !success) return null

  return (
    <Stack spacing={0.75} sx={{ px: 2.5, pb: 1, ...sx }}>
      {error ? (
        <Alert severity="error" onClose={onDismissError}>{error}</Alert>
      ) : null}
      {success ? <Alert severity="success">{success}</Alert> : null}
    </Stack>
  )
}

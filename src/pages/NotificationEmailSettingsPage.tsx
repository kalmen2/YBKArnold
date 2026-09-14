// Everyone sets their own email notifications. Nothing here affects anybody
// else, so there is no admin gate — the endpoint only ever writes your row.
import {
  Alert,
  Divider,
  FormControlLabel,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  fetchChatNotificationPreferences,
  saveChatNotificationPreferences,
  type ChatNotificationPreferences,
} from '../features/chat/api'
import { QUERY_KEYS } from '../lib/queryKeys'

type ToggleKey = keyof Omit<ChatNotificationPreferences, 'enabled'>

const TOGGLES: { key: ToggleKey; label: string; helper: string }[] = [
  {
    key: 'mentions',
    label: 'When someone mentions me',
    helper: 'Another worker typed @your name in a chat.',
  },
  {
    key: 'directMessages',
    label: 'Direct messages',
    helper: 'A one-to-one chat sent straight to you.',
  },
  {
    key: 'groupMessages',
    label: 'Group messages',
    helper: 'One email per group until you open it. No repeats while it sits unread.',
  },
  {
    key: 'taskEvents',
    label: 'Task changes',
    helper: 'A task was added, taken or completed in a chat you are in.',
  },
  {
    key: 'whenOnline',
    label: 'Even while I am online',
    helper: 'By default nothing is emailed while you have the app open, since you can already see it.',
  },
]

export default function NotificationEmailSettingsPage() {
  const queryClient = useQueryClient()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const preferencesQuery = useQuery({
    queryKey: QUERY_KEYS.chatNotificationPreferences,
    queryFn: fetchChatNotificationPreferences,
  })

  const saveMutation = useMutation({
    mutationFn: saveChatNotificationPreferences,
    onSuccess: (result) => {
      setErrorMessage(null)
      setSavedAt(Date.now())
      queryClient.setQueryData(QUERY_KEYS.chatNotificationPreferences, {
        preferences: result.preferences,
        deliversTo: preferencesQuery.data?.deliversTo ?? null,
      })
    },
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : 'That did not save.')
    },
  })

  const preferences = preferencesQuery.data?.preferences
  const deliversTo = preferencesQuery.data?.deliversTo

  function update(patch: Partial<ChatNotificationPreferences>) {
    if (!preferences) {
      return
    }

    saveMutation.mutate({ ...preferences, ...patch })
  }

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={800}>Email notifications</Typography>
        <Typography variant="body2" color="text.secondary">
          {deliversTo
            ? `Sent to ${deliversTo}. These settings are yours alone.`
            : 'These settings are yours alone.'}
        </Typography>
      </Stack>

      {errorMessage ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      ) : null}

      {savedAt && !errorMessage ? (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSavedAt(null)}>
          Saved.
        </Alert>
      ) : null}

      {preferencesQuery.isPending ? (
        <Stack spacing={1.5}>
          <Skeleton variant="rounded" height={40} />
          <Skeleton variant="rounded" height={40} />
          <Skeleton variant="rounded" height={40} />
        </Stack>
      ) : preferencesQuery.isError ? (
        <Alert severity="error">
          {(preferencesQuery.error as Error)?.message || 'Could not load your settings.'}
        </Alert>
      ) : preferences ? (
        <Stack spacing={1.5}>
          <FormControlLabel
            control={(
              <Switch
                checked={preferences.enabled}
                disabled={saveMutation.isPending}
                onChange={(event) => update({ enabled: event.target.checked })}
              />
            )}
            label={(
              <Stack>
                <Typography variant="body2" fontWeight={700}>Send me email notifications</Typography>
                <Typography variant="caption" color="text.secondary">
                  The master switch. Everything below is ignored while this is off.
                </Typography>
              </Stack>
            )}
          />

          <Divider />

          <Stack spacing={1.25} sx={{ opacity: preferences.enabled ? 1 : 0.45 }}>
            {TOGGLES.map((toggle) => (
              <FormControlLabel
                key={toggle.key}
                control={(
                  <Switch
                    checked={preferences[toggle.key]}
                    disabled={!preferences.enabled || saveMutation.isPending}
                    onChange={(event) => update({ [toggle.key]: event.target.checked })}
                  />
                )}
                label={(
                  <Stack>
                    <Typography variant="body2" fontWeight={600}>{toggle.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{toggle.helper}</Typography>
                  </Stack>
                )}
              />
            ))}
          </Stack>
        </Stack>
      ) : null}
    </Paper>
  )
}

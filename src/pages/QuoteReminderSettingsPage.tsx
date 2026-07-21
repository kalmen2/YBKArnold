import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { Alert, Box, Button, IconButton, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  fetchCrmQuoteReminderSettings,
  updateCrmQuoteReminderSettings,
  type CrmQuoteReminderSettings,
} from '../features/crm/api'

const reminderSettingsKey = ['crm', 'quote-reminder-settings', 'me'] as const
const emptySettings: CrmQuoteReminderSettings = { rules: [] }

export default function QuoteReminderSettingsPage() {
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState(emptySettings)
  const [successMessage, setSuccessMessage] = useState('')
  const settingsQuery = useQuery({ queryKey: reminderSettingsKey, queryFn: fetchCrmQuoteReminderSettings })
  const saveMutation = useMutation({
    mutationFn: updateCrmQuoteReminderSettings,
    onSuccess: async (response) => {
      setSettings(response.settings)
      setSuccessMessage('Your personal quote reminders were saved.')
      await queryClient.invalidateQueries({ queryKey: reminderSettingsKey })
    },
  })

  useEffect(() => {
    if (!settingsQuery.data?.settings) return
    const timer = window.setTimeout(() => setSettings(settingsQuery.data.settings), 0)
    return () => window.clearTimeout(timer)
  }, [settingsQuery.data?.settings])

  const updateRule = (id: string, patch: Partial<CrmQuoteReminderSettings['rules'][number]>) => {
    setSettings((current) => ({ rules: current.rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule) }))
    setSuccessMessage('')
  }

  const addReminder = () => {
    setSettings((current) => ({
      rules: [...current.rules, { id: crypto.randomUUID(), kind: 'follow_up_due', days: 10, base: 'last_follow_up' }],
    }))
    setSuccessMessage('')
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={1}>
        <Box>
          <Typography variant="h6" fontWeight={800}>My Quote Reminders</Typography>
          <Typography color="text.secondary">These rules belong only to you. With no rules, all quote reminders are off. Sales-rep users receive reminders for their assigned opportunities; unassigned workers can create rules for the shared opportunity list.</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={addReminder}>Add a Reminder</Button>
      </Stack>
      {settingsQuery.error ? <Alert severity="error">{settingsQuery.error instanceof Error ? settingsQuery.error.message : 'Could not load reminders.'}</Alert> : null}
      {saveMutation.error ? <Alert severity="error">{saveMutation.error instanceof Error ? saveMutation.error.message : 'Could not save reminders.'}</Alert> : null}
      {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}
      {settings.rules.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderStyle: 'dashed' }}>
          <Typography fontWeight={750}>No reminders are active</Typography>
          <Typography variant="body2" color="text.secondary">Select “Add a Reminder” when you want to create one.</Typography>
        </Paper>
      ) : (
        <Stack spacing={1}>
          {settings.rules.map((rule, index) => (
            <Paper key={rule.id} variant="outlined" sx={{ p: 1.6, borderRadius: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ xs: 'stretch', md: 'center' }}>
                <Typography fontWeight={800} sx={{ minWidth: 95 }}>Reminder {index + 1}</Typography>
                <TextField select size="small" label="Event" value={rule.kind} onChange={(event) => updateRule(rule.id, { kind: event.target.value as typeof rule.kind })} sx={{ minWidth: 220 }}>
                  <MenuItem value="follow_up_due">Follow-up is overdue</MenuItem>
                  <MenuItem value="link_opened">Tracked link is opened</MenuItem>
                </TextField>
                <TextField size="small" type="number" label="After days" value={rule.days} onChange={(event) => updateRule(rule.id, { days: Math.min(365, Math.max(0, Number(event.target.value) || 0)) })} inputProps={{ min: 0, max: 365 }} sx={{ width: 130 }} />
                <TextField select size="small" label="Count days from" value={rule.base} onChange={(event) => updateRule(rule.id, { base: event.target.value as typeof rule.base })} sx={{ minWidth: 230 }}>
                  <MenuItem value="quote_date">Quote date</MenuItem>
                  <MenuItem value="last_follow_up">Latest follow-up date</MenuItem>
                </TextField>
                <IconButton color="error" aria-label={`Remove reminder ${index + 1}`} onClick={() => setSettings((current) => ({ rules: current.rules.filter((entry) => entry.id !== rule.id) }))}><DeleteOutlineRoundedIcon /></IconButton>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
      <Button variant="contained" disabled={settingsQuery.isLoading || saveMutation.isPending} onClick={() => saveMutation.mutate(settings)} sx={{ alignSelf: 'flex-start' }}>
        {saveMutation.isPending ? 'Saving…' : 'Save My Reminders'}
      </Button>
    </Stack>
  )
}

// The one chat thread. Mentions, reminders, edit and delete live here so the
// dealer, quote and order threads are the same conversation UI with different
// data behind them, instead of three copies drifting apart.
import { useMemo, useState } from 'react'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Mention, MentionsInput } from 'react-mentions'

export type ChatThreadUser = {
  uid: string
  email: string
  displayName?: string | null
}

export type ChatThreadReminder = {
  dueDate: string
  note: string | null
  targetUserUids: string[]
  targetUserEmails: string[]
}

export type ChatThreadMessage = {
  id: string
  message: string
  createdAt: string
  createdByUid?: string | null
  createdByEmail?: string | null
  createdByName?: string | null
  updatedAt?: string | null
  reminder?: (ChatThreadReminder & { id?: string; createdAt?: string }) | null
}

export type ChatThreadSendPayload = {
  message: string
  mentionUserUids: string[]
  mentionUserEmails: string[]
  reminder: ChatThreadReminder | null
}

function formatChatMoment(value: string | null | undefined) {
  const parsed = new Date(String(value ?? ''))

  if (Number.isNaN(parsed.getTime())) {
    return ''
  }

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function normalizeMentionAlias(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]+/g, '')
}

function resolveMentionFirstName(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return ''
  }

  const source = normalized.includes('@')
    ? normalized.slice(0, normalized.indexOf('@'))
    : normalized
  const alias = normalizeMentionAlias(source)
  const firstToken = alias.split(/[._-]/).find(Boolean) ?? ''

  if (!firstToken) {
    return ''
  }

  return `${firstToken.charAt(0).toUpperCase()}${firstToken.slice(1)}`
}

type MentionSuggestionOption = {
  id: string
  display: string
}

const chatMentionsInputStyle = {
  control: {
    width: '100%',
    fontFamily: 'inherit',
    fontSize: 14,
    lineHeight: 1.45,
  },
  '&multiLine': {
    control: {
      minHeight: 84,
      maxHeight: 188,
      border: '1px solid rgba(15, 23, 42, 0.26)',
      borderRadius: 8,
      backgroundColor: '#ffffff',
      overflowY: 'auto',
    },
    highlighter: {
      padding: '10px 12px',
      border: '1px solid transparent',
      boxSizing: 'border-box',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
      color: 'transparent',
    },
    input: {
      margin: 0,
      padding: '10px 12px',
      minHeight: 84,
      border: '1px solid transparent',
      outline: 0,
      boxSizing: 'border-box',
      fontFamily: 'inherit',
      fontSize: 14,
      lineHeight: 1.45,
      color: '#0f172a',
      backgroundColor: 'transparent',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
    },
  },
  suggestions: {
    list: {
      zIndex: 1600,
      backgroundColor: '#ffffff',
      border: '1px solid rgba(15, 23, 42, 0.2)',
      borderRadius: 8,
      boxShadow: '0 10px 28px rgba(15, 23, 42, 0.16)',
      maxHeight: 220,
      overflowY: 'auto',
      padding: '4px',
    },
    item: {
      padding: '0',
    },
  },
} as const

function extractMentionUserUidsFromMarkup(markup: string) {
  const ids = Array.from(String(markup ?? '').matchAll(/@\[[^\]]+\]\(([^)]+)\)/g))
    .map((entry) => String(entry[1] ?? '').trim())
    .filter(Boolean)

  return [...new Set(ids)]
}

function extractMentionAliases(message: string) {
  const aliases = Array.from(message.matchAll(/@([a-zA-Z0-9._-]+)/g))
    .map((entry) => normalizeMentionAlias(entry[1]))
    .filter(Boolean)

  return [...new Set(aliases)]
}

function renderMessageWithMentionPills(message: string) {
  const normalized = String(message ?? '').trim()

  if (!normalized) {
    return '-'
  }

  const segments = normalized.split(/(@[a-zA-Z0-9._-]+)/g)

  return segments.map((segment, index) => {
    if (!/^@[a-zA-Z0-9._-]+$/.test(segment)) {
      return (
        <Box key={`text-${index}`} component="span">
          {segment}
        </Box>
      )
    }

    const label = resolveMentionFirstName(segment.slice(1))

    if (!label) {
      return (
        <Box key={`mention-fallback-${index}`} component="span">
          {segment}
        </Box>
      )
    }

    return (
      <Box
        key={`mention-${index}`}
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          px: 0.85,
          py: 0.05,
          mx: 0.2,
          borderRadius: 999,
          bgcolor: (theme) => alpha(theme.palette.info.main, 0.18),
          color: (theme) => theme.palette.info.dark,
          fontWeight: 700,
          lineHeight: 1.35,
        }}
      >
        @{label}
      </Box>
    )
  })
}

export function ChatThread({
  messages,
  users,
  currentUserUid,
  isLoading = false,
  isSending = false,
  errorMessage,
  canPost = true,
  canManageMessage,
  onSend,
  onEdit,
  onDelete,
  emptyHint = 'No chat messages yet.',
  composerLabel = 'Write update',
  maxHeight = 320,
}: {
  messages: ChatThreadMessage[]
  users: ChatThreadUser[]
  currentUserUid?: string | null
  isLoading?: boolean
  isSending?: boolean
  errorMessage?: string | null
  canPost?: boolean
  canManageMessage?: (message: ChatThreadMessage) => boolean
  onSend: (payload: ChatThreadSendPayload) => Promise<void> | void
  onEdit?: (messageId: string, message: string) => Promise<void> | void
  onDelete?: (messageId: string) => Promise<void> | void
  emptyHint?: string
  composerLabel?: string
  maxHeight?: number | Record<string, number>
}) {
  const [draft, setDraft] = useState('')
  const [draftMarkup, setDraftMarkup] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editDraft, setEditDraft] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderDueDate, setReminderDueDate] = useState('')
  const [reminderRecipientUids, setReminderRecipientUids] = useState<string[]>([])
  const [reminderNote, setReminderNote] = useState('')

  const mentionAliasToUsers = useMemo<Map<string, ChatThreadUser[]>>(() => {
    const aliasMap = new Map<string, ChatThreadUser[]>()

    users.forEach((user) => {
      const aliases = new Set<string>([
        normalizeMentionAlias(user.email),
        normalizeMentionAlias(String(user.email ?? '').split('@')[0]),
        normalizeMentionAlias(user.displayName),
        normalizeMentionAlias(resolveMentionFirstName(user.displayName)),
        normalizeMentionAlias(resolveMentionFirstName(user.email)),
      ].filter(Boolean))

      aliases.forEach((alias) => {
        aliasMap.set(alias, [...(aliasMap.get(alias) ?? []), user])
      })
    })

    return aliasMap
  }, [users])

  const mentionSuggestionSource = useMemo(() => users
    .map((user) => {
      const id = String(user.uid ?? '').trim()
      const email = String(user.email ?? '').trim()
      const display = resolveMentionFirstName(user.displayName || user.email)
        || normalizeMentionAlias(email.split('@')[0])

      return { id, email, display, normalizedDisplay: normalizeMentionAlias(display) }
    })
    .filter((entry) => Boolean(entry.id && entry.normalizedDisplay))
    .sort((left, right) => left.display.localeCompare(right.display)), [users])

  const mentionEmailByUid = useMemo(
    () => new Map(mentionSuggestionSource.map((entry) => [entry.id, entry.email])),
    [mentionSuggestionSource],
  )

  const loadMentionSuggestions = (query: string, callback: (options: MentionSuggestionOption[]) => void) => {
    const normalizedQuery = normalizeMentionAlias(query)
    const everyoneOption = !normalizedQuery || 'all'.startsWith(normalizedQuery)
      ? [{ id: '__mention_all__', display: 'all' }]
      : []

    callback([
      ...everyoneOption,
      ...mentionSuggestionSource
        .filter((entry) => !normalizedQuery || entry.normalizedDisplay.startsWith(normalizedQuery))
        .slice(0, 8)
        .map((entry) => ({ id: entry.id, display: entry.display })),
    ])
  }

  const canSend = Boolean(
    canPost
    && !isSending
    && (draft.trim() || (reminderEnabled && reminderDueDate && reminderRecipientUids.length > 0)),
  )

  const handleSend = async () => {
    const message = draft.trim() || (reminderEnabled ? reminderNote.trim() : '')

    if (!message) {
      return
    }

    const uidsFromMarkup = extractMentionUserUidsFromMarkup(draftMarkup)
    const aliases = extractMentionAliases(message)
    const mentionsEveryone = uidsFromMarkup.includes('__mention_all__') || aliases.includes('all')
    // An alias only resolves when it points at exactly one person.
    const uidsFromAliases = [...new Set(
      aliases.flatMap((alias) => {
        const matched = mentionAliasToUsers.get(alias) ?? []
        return matched.length === 1 ? [matched[0].uid] : []
      }),
    )]
    const mentionUserUids = [...new Set([
      ...uidsFromMarkup.filter((uid) => uid !== '__mention_all__'),
      ...uidsFromAliases,
      ...(mentionsEveryone ? users.map((user) => user.uid) : []),
    ])]
    const mentionUserEmails = users
      .filter((user) => mentionUserUids.includes(user.uid))
      .map((user) => user.email)

    await onSend({
      message,
      mentionUserUids,
      mentionUserEmails,
      reminder: reminderEnabled && reminderDueDate && reminderRecipientUids.length > 0
        ? {
          dueDate: reminderDueDate,
          note: reminderNote.trim() || null,
          targetUserUids: reminderRecipientUids,
          targetUserEmails: users
            .filter((user) => reminderRecipientUids.includes(user.uid))
            .map((user) => user.email),
        }
        : null,
    })

    setDraft('')
    setDraftMarkup('')
    setReminderEnabled(false)
    setReminderDueDate('')
    setReminderRecipientUids([])
    setReminderNote('')
  }

  return (
    <Stack spacing={0.85}>
      <Paper variant="outlined" sx={{ p: 0.75, maxHeight, overflowY: 'auto' }}>
        {isLoading && messages.length === 0 ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">Loading chat...</Typography>
          </Stack>
        ) : messages.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{emptyHint}</Typography>
        ) : (
          <Stack spacing={0.7}>
            {messages.map((message) => {
              const isEditingThisMessage = editingId === message.id
              const canManage = canManageMessage ? canManageMessage(message) : false
              const isDeletingThisMessage = deletingId === message.id
              const hasOtherDeletePending = Boolean(deletingId && deletingId !== message.id)
              const editedAt = formatChatMoment(message.updatedAt ?? null)

              if (isEditingThisMessage && canManage) {
                return (
                  <Paper key={message.id} variant="outlined" sx={{ p: 0.7 }}>
                    <Stack spacing={0.7}>
                      <Typography variant="caption" color="text.secondary">Editing your message</Typography>
                      <TextField
                        size="small"
                        multiline
                        minRows={2}
                        maxRows={6}
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                      />
                      <Stack direction="row" spacing={0.6} justifyContent="flex-end">
                        <Button size="small" variant="outlined" disabled={isSavingEdit} onClick={() => setEditingId('')}>
                          Cancel
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          disabled={isSavingEdit || !editDraft.trim() || !onEdit}
                          onClick={async () => {
                            if (!onEdit) return
                            setIsSavingEdit(true)
                            try {
                              await onEdit(message.id, editDraft.trim())
                              setEditingId('')
                            } finally {
                              setIsSavingEdit(false)
                            }
                          }}
                        >
                          {isSavingEdit ? 'Saving...' : 'Save'}
                        </Button>
                      </Stack>
                    </Stack>
                  </Paper>
                )
              }

              return (
                <Paper key={message.id} variant="outlined" sx={{ p: 0.7 }}>
                  <Stack spacing={0.45}>
                    <Stack direction="row" spacing={0.8} justifyContent="space-between" alignItems="flex-start">
                      <Typography variant="caption" color="text.secondary">
                        {message.createdByName || message.createdByEmail || 'Unknown'} · {formatChatMoment(message.createdAt)}
                        {message.updatedAt && editedAt ? ` · Edited ${editedAt}` : ''}
                      </Typography>

                      {canManage ? (
                        <Stack direction="row" spacing={0.45}>
                          {onEdit ? (
                            <Button
                              size="small"
                              variant="text"
                              disabled={isSavingEdit || isDeletingThisMessage || hasOtherDeletePending}
                              onClick={() => {
                                setEditingId(message.id)
                                setEditDraft(message.message)
                              }}
                            >
                              Edit
                            </Button>
                          ) : null}
                          {onDelete ? (
                            <Button
                              size="small"
                              color="error"
                              variant="text"
                              disabled={isSavingEdit || Boolean(deletingId)}
                              onClick={async () => {
                                if (!window.confirm('Delete this message?')) return
                                setDeletingId(message.id)
                                try {
                                  await onDelete(message.id)
                                } finally {
                                  setDeletingId('')
                                }
                              }}
                            >
                              {isDeletingThisMessage ? 'Deleting...' : 'Delete'}
                            </Button>
                          ) : null}
                        </Stack>
                      ) : null}
                    </Stack>

                    <Box sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.875rem', lineHeight: 1.45 }}>
                      {renderMessageWithMentionPills(message.message)}
                    </Box>

                    {message.reminder ? (
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.5}>
                        <Chip
                          size="small"
                          icon={<NotificationsActiveRoundedIcon fontSize="small" />}
                          label={`Reminder ${message.reminder.dueDate}`}
                          variant="outlined"
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                          For: {message.reminder.targetUserEmails.join(', ') || '-'}
                        </Typography>
                      </Stack>
                    ) : null}
                  </Stack>
                </Paper>
              )
            })}
          </Stack>
        )}
      </Paper>

      {errorMessage ? (
        <Typography variant="caption" color="error.main">{errorMessage}</Typography>
      ) : null}

      {canPost ? (
        <>
          <Stack spacing={0.4}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              {composerLabel}
            </Typography>

            <MentionsInput
              value={draftMarkup}
              onChange={(_event, nextMarkupValue, nextPlainTextValue) => {
                setDraftMarkup(nextMarkupValue)
                setDraft(nextPlainTextValue)
              }}
              placeholder={composerLabel}
              style={chatMentionsInputStyle}
              a11ySuggestionsListLabel="Mention users"
              allowSuggestionsAboveCursor
              disabled={isSending}
            >
              <Mention
                trigger="@"
                markup="@[__display__](__id__)"
                data={loadMentionSuggestions}
                appendSpaceOnAdd
                displayTransform={(_id, display) => `@${display}`}
                style={{
                  backgroundColor: 'rgba(30, 144, 255, 0.18)',
                  borderRadius: 4,
                  color: 'transparent',
                }}
                renderSuggestion={(entry, _search, highlightedDisplay, _index, focused) => (
                  <Box sx={{ px: 0.8, py: 0.6, borderRadius: 0.8, bgcolor: focused ? alpha('#2196f3', 0.14) : 'transparent' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                      {highlightedDisplay}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.15 }}>
                      {mentionEmailByUid.get(String(entry.id ?? '')) || ''}
                    </Typography>
                  </Box>
                )}
              />
            </MentionsInput>
          </Stack>

          <Paper variant="outlined" sx={{ p: 0.75 }}>
            <Stack spacing={0.7}>
              <FormControlLabel
                control={(
                  <Checkbox
                    size="small"
                    checked={reminderEnabled}
                    disabled={isSending}
                    onChange={(event) => {
                      const nextValue = event.target.checked
                      setReminderEnabled(nextValue)

                      if (nextValue && currentUserUid && !reminderRecipientUids.includes(currentUserUid)) {
                        setReminderRecipientUids((current) => [...new Set([...current, currentUserUid])])
                      }
                    }}
                  />
                )}
                label="Create reminder"
              />

              {reminderEnabled ? (
                <Stack spacing={0.7}>
                  <TextField
                    size="small"
                    type="date"
                    label="Reminder date"
                    InputLabelProps={{ shrink: true }}
                    value={reminderDueDate}
                    onChange={(event) => setReminderDueDate(event.target.value)}
                    disabled={isSending}
                  />

                  <FormControl size="small">
                    <InputLabel id="chat-thread-reminder-recipients">Notify workers</InputLabel>
                    <Select
                      labelId="chat-thread-reminder-recipients"
                      multiple
                      label="Notify workers"
                      value={reminderRecipientUids}
                      disabled={isSending}
                      onChange={(event) => {
                        const nextValue = event.target.value
                        setReminderRecipientUids(Array.isArray(nextValue) ? nextValue.map(String) : String(nextValue).split(','))
                      }}
                      renderValue={(selected) => {
                        const selectedIds = Array.isArray(selected) ? selected : []
                        return users
                          .filter((user) => selectedIds.includes(user.uid))
                          .map((user) => String(user.displayName ?? '').trim() || user.email)
                          .join(', ')
                      }}
                    >
                      {users.map((user) => (
                        <MenuItem key={user.uid} value={user.uid}>
                          <Checkbox size="small" checked={reminderRecipientUids.includes(user.uid)} />
                          <Typography variant="body2">
                            {String(user.displayName ?? '').trim() || user.email} ({user.email})
                          </Typography>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    size="small"
                    label="Reminder note"
                    placeholder="What should they remember?"
                    value={reminderNote}
                    onChange={(event) => setReminderNote(event.target.value)}
                    disabled={isSending}
                  />
                </Stack>
              ) : null}
            </Stack>
          </Paper>

          <Stack direction="row" justifyContent="flex-end">
            <Button variant="contained" disabled={!canSend} onClick={() => { void handleSend() }}>
              {isSending ? 'Sending...' : 'Send'}
            </Button>
          </Stack>
        </>
      ) : null}
    </Stack>
  )
}

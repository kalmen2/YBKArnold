import AlternateEmailRoundedIcon from '@mui/icons-material/AlternateEmailRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded'
import OutboxRoundedIcon from '@mui/icons-material/OutboxRounded'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  createMicrosoftAuthorizeUrl,
  createGoogleAuthorizeUrl,
  disconnectMicrosoftEmailConnection,
  disconnectGoogleEmailConnection,
  fetchMicrosoftEmailConnectionStatus,
  fetchGoogleEmailConnectionStatus,
  searchGoogleEmailContacts,
  sendMicrosoftEmail,
  sendGoogleEmail,
  type GoogleEmailContactSuggestion,
  type EmailProvider,
  type EmailSendAsAlias,
} from '../features/email/api'
import { formatDateTime } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'

type OAuthNotice = {
  severity: 'success' | 'error' | 'info'
  message: string
}

function normalizeRecipientToken(value: string) {
  const trimmedValue = String(value ?? '').trim()

  if (!trimmedValue) {
    return ''
  }

  const angleBracketMatch = trimmedValue.match(/<([^<>]+)>/)
  const candidate = angleBracketMatch ? angleBracketMatch[1] : trimmedValue

  return candidate.trim().toLowerCase()
}

function normalizeRecipientValues(values: string[], limit = 60) {
  const normalizedValues = values
    .flatMap((entry) => String(entry ?? '').split(/[\n,;]+/))
    .map((entry) => normalizeRecipientToken(entry))
    .filter(Boolean)

  return [...new Set(normalizedValues)].slice(0, limit)
}

function resolveRecipientPayload(values: string[], inputValue: string, limit = 60) {
  return normalizeRecipientValues([...values, inputValue], limit)
}

function resolveRecipientOptionLabel(value: string, labelsByEmail: Map<string, string>) {
  return labelsByEmail.get(value) || value
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function formatSendAsAliasLabel(alias: EmailSendAsAlias) {
  const displayName = String(alias.displayName ?? '').trim()
  const email = alias.sendAsEmail
  const namePart = displayName && displayName.toLowerCase() !== email
    ? `${displayName} <${email}>`
    : email
  const flags: string[] = []

  if (alias.isDefault) {
    flags.push('default')
  }

  if (alias.isPrimary) {
    flags.push('primary')
  }

  if (alias.verificationStatus && alias.verificationStatus !== 'accepted') {
    flags.push(alias.verificationStatus)
  }

  return flags.length > 0
    ? `${namePart} (${flags.join(', ')})`
    : namePart
}

function getProviderQueryKey(provider: EmailProvider) {
  return provider === 'google'
    ? QUERY_KEYS.adminEmailGoogleStatus
    : QUERY_KEYS.adminEmailMicrosoftStatus
}

function getProviderLabel(provider: EmailProvider) {
  return provider === 'google' ? 'Gmail' : 'Microsoft Outlook'
}

export default function AdminEmailSettingsPage() {
  const queryClient = useQueryClient()
  const [activeProvider, setActiveProvider] = useState<EmailProvider>('google')
  const [oauthNotice, setOauthNotice] = useState<OAuthNotice | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [toRecipients, setToRecipients] = useState<string[]>([])
  const [ccRecipients, setCcRecipients] = useState<string[]>([])
  const [bccRecipients, setBccRecipients] = useState<string[]>([])
  const [toInputValue, setToInputValue] = useState('')
  const [ccInputValue, setCcInputValue] = useState('')
  const [bccInputValue, setBccInputValue] = useState('')
  const [googleContactLookupQuery, setGoogleContactLookupQuery] = useState('')
  const [googleContactSuggestions, setGoogleContactSuggestions] = useState<GoogleEmailContactSuggestion[]>([])
  const [isGoogleContactLookupLoading, setIsGoogleContactLookupLoading] = useState(false)
  const [googleContactLookupError, setGoogleContactLookupError] = useState<string | null>(null)
  const [subjectInput, setSubjectInput] = useState('')
  const [messageInput, setMessageInput] = useState('')
  const [fromEmailInput, setFromEmailInput] = useState('')
  const providerLabel = getProviderLabel(activeProvider)
  const statusQueryKey = getProviderQueryKey(activeProvider)

  const statusQuery = useQuery({
    queryKey: statusQueryKey,
    queryFn: () => (
      activeProvider === 'google'
        ? fetchGoogleEmailConnectionStatus()
        : fetchMicrosoftEmailConnectionStatus()
    ),
    staleTime: 20 * 1000,
  })

  const disconnectMutation = useMutation({
    mutationFn: () => (
      activeProvider === 'google'
        ? disconnectGoogleEmailConnection()
        : disconnectMicrosoftEmailConnection()
    ),
    onSuccess: () => {
      setActionError(null)
      setActionSuccess(`Disconnected ${providerLabel} account.`)
      void queryClient.invalidateQueries({ queryKey: statusQueryKey })
    },
    onError: (error) => {
      setActionError(toErrorMessage(error, `Could not disconnect ${providerLabel}.`))
      setActionSuccess(null)
    },
  })

  const sendMutation = useMutation({
    mutationFn: () => {
      const to = resolveRecipientPayload(toRecipients, toInputValue, 60)
      const cc = resolveRecipientPayload(ccRecipients, ccInputValue, 30)
      const bcc = resolveRecipientPayload(bccRecipients, bccInputValue, 30)
      const payload = {
        fromEmail: fromEmailInput || undefined,
        to,
        cc,
        bcc,
        subject: subjectInput.trim(),
        text: messageInput.trim(),
      }

      return activeProvider === 'google'
        ? sendGoogleEmail(payload)
        : sendMicrosoftEmail(payload)
    },
    onSuccess: (payload) => {
      setActionError(null)
      setActionSuccess(
        payload.messageId
          ? `Email sent from ${payload.fromEmail} (message id: ${payload.messageId}).`
          : `Email sent from ${payload.fromEmail}.`,
      )
      setSubjectInput('')
      setMessageInput('')
    },
    onError: (error) => {
      setActionError(toErrorMessage(error, `Could not send ${providerLabel} email.`))
      setActionSuccess(null)
    },
  })

  const handleConnect = async () => {
    setActionError(null)
    setActionSuccess(null)
    setOauthNotice(null)

    try {
      const authorizeUrl = activeProvider === 'google'
        ? await createGoogleAuthorizeUrl('/admin/settings?tab=email')
        : await createMicrosoftAuthorizeUrl('/admin/settings?tab=email')
      window.location.assign(authorizeUrl)
    } catch (error) {
      setActionError(toErrorMessage(error, `Could not start ${providerLabel} connection flow.`))
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const providerCandidates: EmailProvider[] = ['google', 'microsoft']
    const matchedProvider = providerCandidates.find((provider) => {
      const status = params.get(provider)
      const message = params.get(`${provider}Message`)

      return Boolean(status || message)
    })

    if (!matchedProvider) {
      return
    }

    const status = params.get(matchedProvider)
    const message = params.get(`${matchedProvider}Message`)

    const normalizedStatus = String(status ?? '').trim().toLowerCase()
    const severity: OAuthNotice['severity'] = normalizedStatus === 'connected'
      ? 'success'
      : normalizedStatus === 'error'
        ? 'error'
        : 'info'

    const matchedProviderLabel = getProviderLabel(matchedProvider)

    setActiveProvider(matchedProvider)

    setOauthNotice({
      severity,
      message: message?.trim()
        || (normalizedStatus === 'connected'
          ? `${matchedProviderLabel} connected successfully.`
          : normalizedStatus === 'error'
            ? `${matchedProviderLabel} connection failed.`
            : `${matchedProviderLabel} connection updated.`),
    })

    providerCandidates.forEach((provider) => {
      params.delete(provider)
      params.delete(`${provider}Message`)
    })

    const nextQuery = params.toString()
    const nextLocation = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`

    window.history.replaceState({}, '', nextLocation)

    void queryClient.invalidateQueries({ queryKey: getProviderQueryKey(matchedProvider) })
  }, [queryClient])

  const status = statusQuery.data
  const isConnected = Boolean(status?.connected)
  const sendAsAliases = useMemo(() => {
    const aliases = Array.isArray(status?.sendAsAliases)
      ? status.sendAsAliases
      : []

    if (aliases.length > 0) {
      return aliases
    }

    const fallbackConnectedEmail = String(status?.connectedEmail ?? '').trim().toLowerCase()

    if (!fallbackConnectedEmail) {
      return []
    }

    return [{
      sendAsEmail: fallbackConnectedEmail,
      displayName: status?.connectedDisplayName ?? null,
      replyToAddress: null,
      isPrimary: true,
      isDefault: true,
      treatAsAlias: false,
      verificationStatus: null,
      isVerified: true,
    }]
  }, [status?.connectedDisplayName, status?.connectedEmail, status?.sendAsAliases])

  useEffect(() => {
    if (!isConnected || sendAsAliases.length === 0) {
      if (fromEmailInput) {
        setFromEmailInput('')
      }

      return
    }

    if (sendAsAliases.some((alias) => alias.sendAsEmail === fromEmailInput)) {
      return
    }

    const defaultAlias = sendAsAliases.find((alias) => alias.isDefault)
      || sendAsAliases.find((alias) => alias.isPrimary)
      || sendAsAliases[0]

    setFromEmailInput(defaultAlias?.sendAsEmail ?? '')
  }, [fromEmailInput, isConnected, sendAsAliases])

  useEffect(() => {
    if (activeProvider === 'google' && isConnected) {
      return
    }

    setGoogleContactLookupQuery('')
    setGoogleContactSuggestions([])
    setGoogleContactLookupError(null)
    setIsGoogleContactLookupLoading(false)
  }, [activeProvider, isConnected])

  useEffect(() => {
    if (activeProvider !== 'google' || !isConnected) {
      return
    }

    const query = googleContactLookupQuery.trim()

    if (query.length < 2) {
      setGoogleContactSuggestions([])
      setGoogleContactLookupError(null)
      setIsGoogleContactLookupLoading(false)
      return
    }

    let cancelled = false
    const timerId = window.setTimeout(async () => {
      setIsGoogleContactLookupLoading(true)

      try {
        const payload = await searchGoogleEmailContacts(query, 12)

        if (cancelled) {
          return
        }

        setGoogleContactSuggestions(Array.isArray(payload?.suggestions) ? payload.suggestions : [])
        setGoogleContactLookupError(null)
      } catch (error) {
        if (cancelled) {
          return
        }

        setGoogleContactSuggestions([])
        setGoogleContactLookupError(toErrorMessage(error, 'Could not load Google contact suggestions.'))
      } finally {
        if (!cancelled) {
          setIsGoogleContactLookupLoading(false)
        }
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timerId)
    }
  }, [activeProvider, googleContactLookupQuery, isConnected])

  const googleContactLabelsByEmail = useMemo(
    () => new Map(googleContactSuggestions.map((entry) => [entry.email, entry.label] as const)),
    [googleContactSuggestions],
  )

  const googleContactOptionValues = useMemo(
    () => googleContactSuggestions.map((entry) => entry.email),
    [googleContactSuggestions],
  )

  const toRecipientsPayload = useMemo(
    () => resolveRecipientPayload(toRecipients, toInputValue, 60),
    [toInputValue, toRecipients],
  )

  const canSend = isConnected
    && Boolean(fromEmailInput)
    && toRecipientsPayload.length > 0
    && Boolean(messageInput.trim())
    && !sendMutation.isPending

  const statusLabel = useMemo(() => {
    if (statusQuery.isPending) {
      return `Loading ${providerLabel} connection status...`
    }

    if (!status?.isConfigured) {
      return `${providerLabel} OAuth is not configured in backend environment variables.`
    }

    if (!isConnected) {
      return `No ${providerLabel} account connected yet.`
    }

    const connectedEmail = String(status?.connectedEmail ?? '').trim()

    return connectedEmail
      ? `Connected as ${connectedEmail}`
      : `${providerLabel} connected.`
  }, [isConnected, providerLabel, status, statusQuery.isPending])

  return (
    <Stack spacing={2.2}>
      <Paper variant="outlined" sx={{ p: { xs: 1.8, md: 2.2 } }}>
        <Stack spacing={1.4}>
          <Stack direction="row" spacing={1.1} alignItems="center">
            <AlternateEmailRoundedIcon color="primary" />
            <Box>
              <Typography variant="h6" fontWeight={700}>
                Email Connections
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Connect Gmail or Microsoft Outlook for this admin user and send email directly from the app.
              </Typography>
            </Box>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              variant={activeProvider === 'google' ? 'contained' : 'outlined'}
              onClick={() => {
                setActiveProvider('google')
                setActionError(null)
                setActionSuccess(null)
              }}
              startIcon={<AlternateEmailRoundedIcon />}
            >
              Gmail
            </Button>
            <Button
              variant={activeProvider === 'microsoft' ? 'contained' : 'outlined'}
              onClick={() => {
                setActiveProvider('microsoft')
                setActionError(null)
                setActionSuccess(null)
              }}
              startIcon={<LinkRoundedIcon />}
            >
              Microsoft Outlook
            </Button>
          </Stack>

          {oauthNotice ? (
            <Alert severity={oauthNotice.severity}>{oauthNotice.message}</Alert>
          ) : null}
          {actionError ? <Alert severity="error">{actionError}</Alert> : null}
          {actionSuccess ? <Alert severity="success">{actionSuccess}</Alert> : null}
          {status?.sendAsSyncError ? (
            <Alert severity="warning">Send As aliases could not fully sync: {status.sendAsSyncError}</Alert>
          ) : null}
          {status?.grantedMissingScopes && status.grantedMissingScopes.length > 0 ? (
            <Alert severity="warning">
              Required {providerLabel} permissions are missing for this connection. Reconnect to grant required scopes.
              {' '}
              Missing: {status.grantedMissingScopes.join(', ')}.
            </Alert>
          ) : null}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {statusLabel}
            </Typography>

            {statusQuery.isFetching ? <CircularProgress size={16} /> : null}

            <Button
              variant="contained"
              startIcon={<LinkRoundedIcon />}
              onClick={() => {
                void handleConnect()
              }}
              disabled={!status?.isConfigured || statusQuery.isPending}
            >
              {isConnected ? `Reconnect ${providerLabel}` : `Connect ${providerLabel}`}
            </Button>

            <Button
              variant="outlined"
              color="warning"
              startIcon={<LinkOffRoundedIcon />}
              onClick={() => {
                void disconnectMutation.mutateAsync()
              }}
              disabled={!isConnected || disconnectMutation.isPending}
            >
              Disconnect
            </Button>
          </Stack>

          {isConnected && status?.updatedAt ? (
            <Typography variant="caption" color="text.secondary">
              Last updated: {formatDateTime(status.updatedAt)}
            </Typography>
          ) : null}

          {isConnected && sendAsAliases.length > 0 ? (
            <Typography variant="caption" color="text.secondary">
              Available sender addresses: {sendAsAliases.length}
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 1.8, md: 2.2 } }}>
        <Stack spacing={1.3}>
          <Stack direction="row" spacing={1.1} alignItems="center">
            <OutboxRoundedIcon color="primary" />
            <Typography variant="h6" fontWeight={700}>
              Send Email
            </Typography>
          </Stack>

          <FormControl fullWidth size="small" disabled={!isConnected || sendAsAliases.length === 0}>
            <InputLabel id="admin-send-from-label">Send From</InputLabel>
            <Select
              labelId="admin-send-from-label"
              label="Send From"
              value={fromEmailInput}
              onChange={(event) => setFromEmailInput(String(event.target.value || ''))}
            >
              {sendAsAliases.map((alias) => (
                <MenuItem
                  key={alias.sendAsEmail}
                  value={alias.sendAsEmail}
                  disabled={!alias.isVerified}
                >
                  {formatSendAsAliasLabel(alias)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {activeProvider === 'google' && googleContactLookupError ? (
            <Alert severity="warning">{googleContactLookupError}</Alert>
          ) : null}

          <Autocomplete
            multiple
            freeSolo
            filterSelectedOptions
            disabled={!isConnected}
            options={activeProvider === 'google' ? googleContactOptionValues : []}
            loading={activeProvider === 'google' && isGoogleContactLookupLoading}
            value={toRecipients}
            inputValue={toInputValue}
            onChange={(_event, value) => {
              setToRecipients(normalizeRecipientValues(value, 60))
            }}
            onInputChange={(_event, value, reason) => {
              setToInputValue(value)

              if (reason === 'input' || reason === 'clear') {
                setGoogleContactLookupQuery(value)
              }
            }}
            getOptionLabel={(option) => resolveRecipientOptionLabel(option, googleContactLabelsByEmail)}
            renderOption={(props, option) => (
              <li {...props}>
                {resolveRecipientOptionLabel(option, googleContactLabelsByEmail)}
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="To"
                placeholder="Type name or email"
                size="small"
                helperText={activeProvider === 'google'
                  ? 'Start typing to search Google contacts. You can still paste comma-separated emails.'
                  : 'Enter one or more recipient emails (comma or semicolon separated).'}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {activeProvider === 'google' && isGoogleContactLookupLoading ? (
                        <CircularProgress color="inherit" size={16} sx={{ mr: 0.8 }} />
                      ) : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
            <Autocomplete
              multiple
              freeSolo
              filterSelectedOptions
              disabled={!isConnected}
              options={activeProvider === 'google' ? googleContactOptionValues : []}
              loading={activeProvider === 'google' && isGoogleContactLookupLoading}
              value={ccRecipients}
              inputValue={ccInputValue}
              onChange={(_event, value) => {
                setCcRecipients(normalizeRecipientValues(value, 30))
              }}
              onInputChange={(_event, value, reason) => {
                setCcInputValue(value)

                if (reason === 'input' || reason === 'clear') {
                  setGoogleContactLookupQuery(value)
                }
              }}
              getOptionLabel={(option) => resolveRecipientOptionLabel(option, googleContactLabelsByEmail)}
              renderOption={(props, option) => (
                <li {...props}>
                  {resolveRecipientOptionLabel(option, googleContactLabelsByEmail)}
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Cc"
                  placeholder="optional"
                  size="small"
                  helperText={activeProvider === 'google'
                    ? 'Google contact suggestions are available while typing.'
                    : 'Optional recipients.'}
                />
              )}
            />

            <Autocomplete
              multiple
              freeSolo
              filterSelectedOptions
              disabled={!isConnected}
              options={activeProvider === 'google' ? googleContactOptionValues : []}
              loading={activeProvider === 'google' && isGoogleContactLookupLoading}
              value={bccRecipients}
              inputValue={bccInputValue}
              onChange={(_event, value) => {
                setBccRecipients(normalizeRecipientValues(value, 30))
              }}
              onInputChange={(_event, value, reason) => {
                setBccInputValue(value)

                if (reason === 'input' || reason === 'clear') {
                  setGoogleContactLookupQuery(value)
                }
              }}
              getOptionLabel={(option) => resolveRecipientOptionLabel(option, googleContactLabelsByEmail)}
              renderOption={(props, option) => (
                <li {...props}>
                  {resolveRecipientOptionLabel(option, googleContactLabelsByEmail)}
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Bcc"
                  placeholder="optional"
                  size="small"
                  helperText="Optional hidden recipients."
                />
              )}
            />
          </Stack>

          <TextField
            label="Subject"
            value={subjectInput}
            onChange={(event) => setSubjectInput(event.target.value)}
            fullWidth
            size="small"
          />

          <TextField
            label="Message"
            placeholder="Type your email message..."
            value={messageInput}
            onChange={(event) => setMessageInput(event.target.value)}
            multiline
            minRows={8}
            fullWidth
          />

          <Stack direction="row" justifyContent="flex-end">
            <Button
              variant="contained"
              onClick={() => {
                void sendMutation.mutateAsync()
              }}
              disabled={!canSend}
              startIcon={sendMutation.isPending ? <CircularProgress size={16} color="inherit" /> : null}
            >
              Send From Selected Address
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  )
}

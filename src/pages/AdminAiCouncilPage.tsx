import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createGoogleAuthorizeUrl } from '../features/email/api'
import {
  createAiCouncilChat,
  deleteAiCouncilChat,
  fetchAiCouncilChats,
  fetchAiCouncilMessages,
  fetchAiCouncilRules,
  fetchAiCouncilStatus,
  postAiCouncilModeratorNote,
  saveAiCouncilRule,
  runAiCouncilSequence,
  sendAiCouncilMessage,
  updateAiCouncilChat,
  type AiCouncilAiMember,
  type AiCouncilChat,
  type AiCouncilChatType,
  type AiCouncilMember,
} from '../features/ai-council/api'
import { QUERY_KEYS } from '../lib/queryKeys'

const members: Array<{ key: AiCouncilMember; label: string }> = [
  { key: 'moderator', label: 'Moderator' },
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'claude', label: 'Claude' },
]

function formatRelativeTime(value: string | null) {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function chatSort(left: AiCouncilChat, right: AiCouncilChat) {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  return String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))
}

function formatRuleJson(value: Record<string, string> | undefined) {
  return JSON.stringify(value ?? {}, null, 2)
}

function parseRuleJson(value: string, label: string) {
  try {
    const parsed = JSON.parse(value || '{}')

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`)
    }

    return parsed as Record<string, string>
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `${label} must be valid JSON.`)
  }
}

export default function AdminAiCouncilPage() {
  const queryClient = useQueryClient()
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [messageText, setMessageText] = useState('')
  const [selectedMember, setSelectedMember] = useState<AiCouncilMember>('chatgpt')
  const [instructionDraft, setInstructionDraft] = useState('')
  const [turnInstructionsDraft, setTurnInstructionsDraft] = useState('{}')
  const [tagsDraft, setTagsDraft] = useState('{}')
  const [runtimeInstructionsDraft, setRuntimeInstructionsDraft] = useState('{}')
  const [ruleDraftError, setRuleDraftError] = useState<string | null>(null)
  const [chatMenuAnchor, setChatMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuChat, setMenuChat] = useState<AiCouncilChat | null>(null)
  const [councilRunStage, setCouncilRunStage] = useState<string | null>(null)
  const [chatMode, setChatMode] = useState<AiCouncilChatType>('council')
  const [directChatMember, setDirectChatMember] = useState<AiCouncilAiMember>('claude')

  const statusQuery = useQuery({
    queryKey: QUERY_KEYS.aiCouncilStatus,
    queryFn: fetchAiCouncilStatus,
    staleTime: 60 * 1000,
  })
  const rulesQuery = useQuery({
    queryKey: QUERY_KEYS.aiCouncilRules,
    queryFn: fetchAiCouncilRules,
    staleTime: 60 * 1000,
  })
  const chatsQuery = useQuery({
    queryKey: QUERY_KEYS.aiCouncilChats(
      chatMode,
      chatMode === 'direct' ? directChatMember : 'all',
    ),
    queryFn: () => fetchAiCouncilChats({
      chatType: chatMode,
      targetMember: chatMode === 'direct' ? directChatMember : null,
    }),
    staleTime: 15 * 1000,
  })

  const chats = useMemo(
    () => [...(chatsQuery.data?.chats ?? [])].sort(chatSort),
    [chatsQuery.data?.chats],
  )
  const selectedChat = chats.find((chat) => chat.id === selectedChatId) ?? null
  const isSelectedChatProcessing = Boolean(
    selectedChat?.status
    && /(processing|researching)/i.test(String(selectedChat.status)),
  )

  useEffect(() => {
    if (chats.length === 0) {
      setSelectedChatId(null)
      return
    }

    if (!selectedChatId || !chats.some((chat) => chat.id === selectedChatId)) {
      setSelectedChatId(chats[0].id)
    }
  }, [chats, selectedChatId])

  const messagesQuery = useQuery({
    queryKey: QUERY_KEYS.aiCouncilMessages(selectedChatId ?? 'none'),
    queryFn: () => fetchAiCouncilMessages(selectedChatId ?? ''),
    enabled: Boolean(selectedChatId),
    staleTime: 3 * 1000,
    refetchInterval: isSelectedChatProcessing ? 4000 : false,
  })

  const selectedRule = rulesQuery.data?.rules?.[selectedMember]

  useEffect(() => {
    setInstructionDraft(selectedRule?.instructions ?? '')
    setTurnInstructionsDraft(formatRuleJson(selectedRule?.turnInstructions))
    setTagsDraft(formatRuleJson(selectedRule?.tags))
    setRuntimeInstructionsDraft(formatRuleJson(selectedRule?.runtimeInstructions))
    setRuleDraftError(null)
  }, [
    selectedMember,
    selectedRule?.instructions,
    selectedRule?.runtimeInstructions,
    selectedRule?.tags,
    selectedRule?.turnInstructions,
  ])

  const createChatMutation = useMutation({
    mutationFn: () => createAiCouncilChat({
      chatType: chatMode,
      targetMember: chatMode === 'direct' ? directChatMember : null,
    }),
    onSuccess: async (payload) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'ai-council', 'chats'] })
      setSelectedChatId(payload.chat.id)
    },
  })

  const sendMessageMutation = useMutation({
    mutationFn: ({ chatId, text }: { chatId: string; text: string }) => sendAiCouncilMessage(chatId, text),
    onSuccess: async (payload, variables) => {
      setMessageText('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'ai-council', 'chats'] }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiCouncilMessages(payload.chat.id) }),
      ])
      setCouncilRunStage(selectedChat?.chatType === 'direct' ? 'Direct Chat' : 'Council')
      try {
        await runAiCouncilSequence(payload.chat.id, variables.text)
      } catch (error) {
        try {
          await postAiCouncilModeratorNote(
            payload.chat.id,
            `@Kal, the council flow stopped before completion. ${error instanceof Error ? error.message : 'Please try again or check the function logs.'}`,
          )
        } catch (noteError) {
          console.error('AI Council failure note failed.', noteError)
        }
      } finally {
        setCouncilRunStage(null)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['admin', 'ai-council', 'chats'] }),
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiCouncilMessages(payload.chat.id) }),
        ])
      }
    },
  })

  const updateChatMutation = useMutation({
    mutationFn: ({ chatId, pinned, status }: { chatId: string; pinned?: boolean; status?: 'active' | 'finished' }) =>
      updateAiCouncilChat(chatId, { pinned, status }),
    onSuccess: async (payload) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'ai-council', 'chats'] }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiCouncilMessages(payload.chat.id) }),
      ])
    },
  })

  const deleteChatMutation = useMutation({
    mutationFn: deleteAiCouncilChat,
    onSuccess: async (_payload, chatId) => {
      if (selectedChatId === chatId) {
        const nextChat = chats.find((chat) => chat.id !== chatId)
        setSelectedChatId(nextChat?.id ?? null)
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'ai-council', 'chats'] })
    },
  })

  const saveRuleMutation = useMutation({
    mutationFn: () => {
      setRuleDraftError(null)
      const payload: {
        instructions: string
        turnInstructions?: Record<string, string>
        tags?: Record<string, string>
        runtimeInstructions?: Record<string, string>
      } = {
        instructions: instructionDraft,
      }

      if (selectedMember === 'moderator') {
        payload.tags = parseRuleJson(tagsDraft, 'Moderator tags')
        payload.runtimeInstructions = parseRuleJson(runtimeInstructionsDraft, 'Runtime instructions')
      } else {
        payload.turnInstructions = parseRuleJson(turnInstructionsDraft, 'Turn instructions')
      }

      return saveAiCouncilRule(selectedMember, payload)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiCouncilRules })
    },
    onError: (error) => {
      setRuleDraftError(error instanceof Error ? error.message : 'Unable to save instructions.')
    },
  })
  const connectGoogleMutation = useMutation({
    mutationFn: () => createGoogleAuthorizeUrl('/admin/settings?tab=ai-council'),
    onSuccess: (authorizeUrl) => {
      window.location.assign(authorizeUrl)
    },
  })

  const messages = messagesQuery.data?.messages ?? []
  const googleDrive = statusQuery.data?.googleDrive
  const errors = [
    statusQuery.error,
    rulesQuery.error,
    chatsQuery.error,
    messagesQuery.error,
    sendMessageMutation.error,
    createChatMutation.error,
    updateChatMutation.error,
    deleteChatMutation.error,
    saveRuleMutation.error,
    connectGoogleMutation.error,
  ]
  const errorMessage = errors.find((error): error is Error => error instanceof Error)?.message ?? null

  const handleOpenChatMenu = (event: React.MouseEvent<HTMLElement>, chat: AiCouncilChat) => {
    event.stopPropagation()
    setMenuChat(chat)
    setChatMenuAnchor(event.currentTarget)
  }

  const handleCloseChatMenu = () => {
    setMenuChat(null)
    setChatMenuAnchor(null)
  }

  const handleSendMessage = () => {
    const text = messageText.trim()

    if (!selectedChatId || !text || sendMessageMutation.isPending) {
      return
    }

    sendMessageMutation.mutate({ chatId: selectedChatId, text })
  }

  const activeChatType = selectedChat?.chatType ?? chatMode
  const activeTargetLabel = (selectedChat?.targetMember ?? directChatMember) === 'claude' ? 'Claude' : 'ChatGPT'
  const messagePlaceholder = activeChatType === 'direct'
    ? `Message ${activeTargetLabel} directly...`
    : 'Message the AI Council...'

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
        >
          <Stack direction="row" spacing={1.2} alignItems="center">
            <SmartToyRoundedIcon color="primary" />
            <Box>
              <Typography variant="h6" fontWeight={700}>
                AI Council
              </Typography>
              <Typography color="text.secondary">
                Admin council chats, member instructions, and Google Drive readiness.
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              icon={<DriveFileMoveRoundedIcon />}
              color={googleDrive?.connected && googleDrive.grantedDriveScope ? 'success' : 'warning'}
              variant="outlined"
              label={googleDrive?.connected && googleDrive.grantedDriveScope ? 'Drive connected' : 'Drive reconnect needed'}
            />
            <Chip
              size="small"
              color={googleDrive?.brainReadable ? 'success' : 'warning'}
              variant="outlined"
              label={googleDrive?.brainReadable ? `Brain readable (${googleDrive.brainFilesRead})` : 'Brain not readable'}
            />
            <Chip
              size="small"
              color={googleDrive?.googleClientConfigured ? 'success' : 'warning'}
              variant="outlined"
              label={googleDrive?.googleClientConfigured ? 'Google client ready' : 'Google client missing'}
            />
          </Stack>
        </Stack>
      </Paper>

      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      {googleDrive && !googleDrive.driveScopeConfigured ? (
        <Alert severity="warning">
          Google OAuth exists here, but Drive read scope is not configured yet. Add {googleDrive.requiredDriveScope} to
          GOOGLE_OAUTH_SCOPES and register this redirect URI in Google Cloud: {googleDrive.configuredRedirectUri}
        </Alert>
      ) : null}
      {googleDrive && (!googleDrive.connected || !googleDrive.grantedDriveScope) ? (
        <Alert
          severity="info"
          action={(
            <Button
              color="inherit"
              size="small"
              disabled={connectGoogleMutation.isPending || !googleDrive.googleClientConfigured}
              onClick={() => connectGoogleMutation.mutate()}
            >
              {googleDrive.connected ? 'Reconnect Google' : 'Connect Google'}
            </Button>
          )}
        >
          AI Council reads company brain files from Google Drive folder {googleDrive.brainFolderId}. Connect or reconnect
          Google to grant Drive read access.
        </Alert>
      ) : null}
      {googleDrive && googleDrive.connected && googleDrive.grantedDriveScope && !googleDrive.brainReadable ? (
        <Alert severity="warning">
          Google is connected, but AI Council could not read any brain text from Drive folder {googleDrive.brainFolderId}.
          {googleDrive.brainReadError ? ` ${googleDrive.brainReadError}` : ' Add readable .md, .txt, or Google Docs files to that folder, or check folder access.'}
        </Alert>
      ) : null}

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', lg: '280px minmax(0, 1fr) 340px' },
          alignItems: 'start',
          minHeight: 0,
        }}
      >
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Stack spacing={0}>
            <Stack spacing={1.2} sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Typography fontWeight={700}>Chats</Typography>
                <Tooltip title={`New ${chatMode === 'direct' ? 'direct' : 'council'} chat`}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => createChatMutation.mutate()}
                      disabled={createChatMutation.isPending}
                    >
                      <AddRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>

              <ToggleButtonGroup
                size="small"
                exclusive
                value={chatMode}
                onChange={(_, value: AiCouncilChatType | null) => {
                  if (!value) return
                  setChatMode(value)
                }}
                fullWidth
              >
                <ToggleButton value="council">Council</ToggleButton>
                <ToggleButton value="direct">Direct</ToggleButton>
              </ToggleButtonGroup>

              {chatMode === 'direct' ? (
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={directChatMember}
                  onChange={(_, value: AiCouncilAiMember | null) => {
                    if (!value) return
                    setDirectChatMember(value)
                  }}
                  fullWidth
                >
                  <ToggleButton value="chatgpt">ChatGPT</ToggleButton>
                  <ToggleButton value="claude">Claude</ToggleButton>
                </ToggleButtonGroup>
              ) : null}
            </Stack>
            <Divider />
            <List dense disablePadding sx={{ maxHeight: { xs: 260, lg: 'calc(100vh - 260px)' }, overflow: 'auto' }}>
              {chats.map((chat) => {
                const modeLabel = chat.chatType === 'direct'
                  ? `direct/${chat.targetMember ?? 'ai'}`
                  : 'council'
                const outcomeLabel = chat.outcome ? ` - ${chat.outcome}` : ''

                return (
                  <ListItemButton
                    key={chat.id}
                    selected={chat.id === selectedChatId}
                    onClick={() => setSelectedChatId(chat.id)}
                    sx={{ alignItems: 'flex-start', gap: 1, py: 1 }}
                  >
                    <ListItemText
                      primary={(
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          {chat.pinned ? <PushPinRoundedIcon fontSize="inherit" color="primary" /> : null}
                          <Typography variant="body2" fontWeight={700} noWrap>
                            {chat.title}
                          </Typography>
                        </Stack>
                      )}
                      secondary={`${modeLabel} - ${chat.status}${outcomeLabel}${chat.updatedAt ? ` - ${formatRelativeTime(chat.updatedAt)}` : ''}`}
                      slotProps={{
                        secondary: { sx: { textTransform: 'capitalize' } },
                      }}
                    />
                    <IconButton size="small" onClick={(event) => handleOpenChatMenu(event, chat)}>
                      <MoreVertRoundedIcon fontSize="small" />
                    </IconButton>
                  </ListItemButton>
                )
              })}
              {chats.length === 0 ? (
                <Box sx={{ p: 2 }}>
                  <Typography color="text.secondary" variant="body2">
                    No chats yet.
                  </Typography>
                </Box>
              ) : null}
            </List>
          </Stack>
        </Paper>

        <Paper
          variant="outlined"
          sx={{
            height: { xs: 'calc(100vh - 220px)', lg: 'calc(100vh - 230px)' },
            minHeight: { xs: 520, lg: 640 },
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ p: 1.5 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography fontWeight={700} noWrap>
                {selectedChat?.title ?? 'Select a chat'}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                {councilRunStage
                  ? `${councilRunStage} is answering...`
                  : selectedChat
                    ? `${selectedChat.chatType === 'direct' ? `direct/${selectedChat.targetMember ?? 'ai'}` : 'council'} - ${selectedChat.status}${selectedChat.outcome ? ` - ${selectedChat.outcome}` : ''} - ${formatRelativeTime(selectedChat.updatedAt)}`
                    : 'Create a chat to begin.'}
              </Typography>
              {selectedChat?.outcomeReason ? (
                <Typography color="text.secondary" variant="caption">
                  {selectedChat.outcomeReason}
                </Typography>
              ) : null}
            </Box>
            {selectedChat ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<CheckCircleRoundedIcon />}
                disabled={updateChatMutation.isPending}
                onClick={() => updateChatMutation.mutate({ chatId: selectedChat.id, status: 'finished' })}
              >
                Finish
              </Button>
            ) : null}
          </Stack>
          <Divider />

          <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: 2 }}>
            {messages.map((message) => {
              const isKal = message.sender === 'Kal'
              const isDiscussion = message.type === 'discussion'
              const isFinal = message.type === 'final'
              const isModerator = message.type === 'moderator'
              const isError = message.type === 'error'
              const isResearch = message.type === 'research'
              const isAiNote = message.type === 'ai_note'
              const providerLabel = message.provider ? message.provider.toUpperCase() : null

              return (
                <Box
                  key={message.id}
                  sx={{
                    alignSelf: isKal ? 'flex-end' : 'flex-start',
                    maxWidth: isModerator ? '72%' : '84%',
                    border: isDiscussion || isResearch || isAiNote ? '0' : '1px solid',
                    borderLeft: isDiscussion
                      ? '3px solid #f59e0b'
                      : isResearch
                        ? '3px solid #14b8a6'
                        : isAiNote
                          ? '3px solid #7c3aed'
                        : undefined,
                    borderColor: isError
                      ? 'error.light'
                      : isModerator
                        ? 'rgba(74, 144, 217, 0.35)'
                        : 'divider',
                    bgcolor: isKal
                      ? 'primary.main'
                      : isDiscussion
                        ? '#1a1200'
                        : isResearch
                          ? '#061b1a'
                          : isAiNote
                            ? '#160c2e'
                          : isError
                            ? 'rgba(211, 47, 47, 0.08)'
                            : isModerator
                              ? 'rgba(74, 144, 217, 0.08)'
                              : '#ffffff',
                    color: isKal
                      ? 'primary.contrastText'
                      : isDiscussion
                        ? '#f5d78e'
                        : isResearch
                          ? '#9ff3e8'
                          : isAiNote
                            ? '#dbc4ff'
                          : isError
                            ? 'error.dark'
                            : isModerator
                              ? 'text.primary'
                              : '#0d0d1a',
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 1.1,
                    fontSize: isFinal ? '1.02rem' : undefined,
                  }}
                >
                  <Typography variant="caption" sx={{ opacity: 0.8, fontWeight: 700 }}>
                    {isDiscussion
                      ? '💬 internal discussion'
                      : isResearch
                        ? 'Research'
                        : isAiNote
                          ? 'AI note to Kal'
                      : isFinal
                        ? '✅ Final Answer'
                        : isError
                          ? 'Error'
                          : isModerator
                            ? 'Moderator'
                            : message.sender}
                  </Typography>
                  {(isDiscussion || isResearch || isFinal || isAiNote) ? (
                    <Typography variant="caption" sx={{ display: 'block', opacity: 0.8, fontWeight: 700 }}>
                      {providerLabel ? `${message.sender} - ${providerLabel}` : message.sender}
                    </Typography>
                  ) : null}
                  <Typography
                    variant={isModerator ? 'caption' : 'body2'}
                    sx={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {message.text}
                  </Typography>
                </Box>
              )
            })}
            {messages.length === 0 ? (
              <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ minHeight: 280 }}>
                <AutoAwesomeRoundedIcon color="primary" />
                <Typography color="text.secondary">Start the council with a topic.</Typography>
              </Stack>
            ) : null}
          </Stack>

          <Divider />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ p: 1.5 }}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={5}
              placeholder={messagePlaceholder}
              value={messageText}
              disabled={!selectedChatId || sendMessageMutation.isPending || Boolean(councilRunStage)}
              onChange={(event) => setMessageText(event.target.value)}
            />
            <Button
              variant="contained"
              endIcon={<SendRoundedIcon />}
              disabled={!selectedChatId || !messageText.trim() || sendMessageMutation.isPending || Boolean(councilRunStage)}
              onClick={handleSendMessage}
              sx={{ alignSelf: { xs: 'stretch', sm: 'flex-end' }, minWidth: 120 }}
            >
              {sendMessageMutation.isPending
                ? 'Sending...'
                : councilRunStage
                  ? `${councilRunStage}...`
                  : 'Send'}
            </Button>
          </Stack>
        </Paper>

        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            maxHeight: { lg: 'calc(100vh - 230px)' },
            overflow: 'auto',
          }}
        >
          <Stack spacing={1.5}>
            <Box>
              <Typography fontWeight={700}>Instructions</Typography>
              <Typography variant="body2" color="text.secondary">
                Local behavior rules for each AI. Company knowledge belongs in Drive.
              </Typography>
            </Box>

            <ToggleButtonGroup
              exclusive
              size="small"
              value={selectedMember}
              onChange={(_, value: AiCouncilMember | null) => {
                if (value) setSelectedMember(value)
              }}
              fullWidth
            >
              {members.map((member) => (
                <ToggleButton key={member.key} value={member.key}>
                  {member.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <Stack spacing={0.5}>
              <Typography variant="body2" fontWeight={700}>
                {selectedRule?.label ?? selectedMember}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {selectedRule?.role ?? 'Council member'} - {(selectedRule?.provider ?? 'openai')} / {selectedRule?.model ?? 'gpt-4o'}
              </Typography>
            </Stack>

            <TextField
              multiline
              minRows={16}
              value={instructionDraft}
              onChange={(event) => setInstructionDraft(event.target.value)}
              disabled={rulesQuery.isLoading || saveRuleMutation.isPending}
            />

            {selectedMember !== 'moderator' ? (
              <TextField
                label="Turn instructions JSON"
                multiline
                minRows={8}
                value={turnInstructionsDraft}
                onChange={(event) => setTurnInstructionsDraft(event.target.value)}
                disabled={rulesQuery.isLoading || saveRuleMutation.isPending}
                spellCheck={false}
              />
            ) : null}

            {selectedMember === 'moderator' ? (
              <>
                <TextField
                  label="Moderator tags JSON"
                  multiline
                  minRows={8}
                  value={tagsDraft}
                  onChange={(event) => setTagsDraft(event.target.value)}
                  disabled={rulesQuery.isLoading || saveRuleMutation.isPending}
                  spellCheck={false}
                />
                <TextField
                  label="Runtime instructions JSON"
                  multiline
                  minRows={6}
                  value={runtimeInstructionsDraft}
                  onChange={(event) => setRuntimeInstructionsDraft(event.target.value)}
                  disabled={rulesQuery.isLoading || saveRuleMutation.isPending}
                  spellCheck={false}
                />
              </>
            ) : null}

            {ruleDraftError ? <Alert severity="error">{ruleDraftError}</Alert> : null}

            <Button
              variant="contained"
              startIcon={<SaveRoundedIcon />}
              disabled={!instructionDraft.trim() || saveRuleMutation.isPending}
              onClick={() => saveRuleMutation.mutate()}
            >
              {saveRuleMutation.isPending ? 'Saving...' : 'Save Instructions'}
            </Button>
          </Stack>
        </Paper>
      </Box>

      <Menu
        anchorEl={chatMenuAnchor}
        open={Boolean(chatMenuAnchor)}
        onClose={handleCloseChatMenu}
      >
        <MenuItem
          onClick={() => {
            if (menuChat) {
              updateChatMutation.mutate({ chatId: menuChat.id, pinned: !menuChat.pinned })
            }
            handleCloseChatMenu()
          }}
        >
          <PushPinRoundedIcon fontSize="small" sx={{ mr: 1 }} />
          {menuChat?.pinned ? 'Unpin' : 'Pin'}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuChat) {
              deleteChatMutation.mutate(menuChat.id)
            }
            handleCloseChatMenu()
          }}
        >
          <DeleteOutlineRoundedIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>
    </Stack>
  )
}

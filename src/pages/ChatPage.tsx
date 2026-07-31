import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import PersonRoundedIcon from '@mui/icons-material/PersonRounded'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Mention, MentionsInput } from 'react-mentions'
import { useAuth } from '../auth/useAuth'
import {
  createChatGroup,
  createDirectChat,
  deleteChatMessage,
  deleteChatThread,
  fetchChatMessages,
  fetchChatThreads,
  fetchChatUsers,
  sendChatMessage,
  updateChatThreadPreferences,
  updateChatGroup,
  type AppChatAttachmentKind,
  type AppChatMessage,
  type AppChatThread,
} from '../features/chat/api'
import { QUERY_KEYS } from '../lib/queryKeys'

const maxAttachmentSizeBytes = 6 * 1024 * 1024
const mentionAllId = '__mention_all__'

const chatMentionsInputStyle = {
  control: {
    width: '100%',
    fontFamily: 'inherit',
    fontSize: 14,
    lineHeight: 1.45,
  },
  '&multiLine': {
    control: {
      minHeight: 76,
      maxHeight: 180,
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
      color: 'transparent',
    },
    input: {
      padding: '10px 12px',
      minHeight: 76,
      border: '1px solid transparent',
      outline: 0,
      boxSizing: 'border-box',
      fontFamily: 'inherit',
      fontSize: 14,
      lineHeight: 1.45,
      color: '#0f172a',
      backgroundColor: 'transparent',
    },
  },
  suggestions: {
    list: {
      zIndex: 1600,
      backgroundColor: '#fff',
      border: '1px solid rgba(15, 23, 42, 0.2)',
      borderRadius: 8,
      boxShadow: '0 10px 28px rgba(15, 23, 42, 0.16)',
      maxHeight: 240,
      overflowY: 'auto',
      padding: 4,
    },
    item: {
      padding: '8px 10px',
      borderRadius: 6,
    },
  },
} as const

function extractMentionUids(markup: string) {
  return [...new Set(
    Array.from(String(markup ?? '').matchAll(/@\[[^\]]+\]\(([^)]+)\)/g))
      .map((entry) => String(entry[1] ?? '').trim())
      .filter(Boolean),
  )]
}

type AttachmentDraft = {
  kind: AppChatAttachmentKind
  dataUrl: string
  mimeType: string
  fileName: string
  sizeBytes: number
}

function formatChatTime(value: string | null) {
  if (!value) {
    return ''
  }

  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function buildThreadTitle(thread: AppChatThread, currentUid: string) {
  if (thread.type === 'group') {
    return thread.name || 'Group chat'
  }

  const peer = thread.memberProfiles.find((member) => member.uid !== currentUid) || thread.memberProfiles[0]

  if (!peer) {
    return 'Direct chat'
  }

  return peer.displayName || peer.email
}

function buildThreadSubtitle(thread: AppChatThread, currentUid: string) {
  if (thread.type === 'group') {
    return `${thread.memberUids.length} members`
  }

  const peer = thread.memberProfiles.find((member) => member.uid !== currentUid) || thread.memberProfiles[0]
  return peer?.email ?? 'Direct thread'
}

function canDeleteMessage(message: AppChatMessage, currentUid: string, currentEmail: string, isAdmin: boolean) {
  if (isAdmin) {
    return true
  }

  if (message.createdByUid && message.createdByUid === currentUid) {
    return true
  }

  const messageEmail = normalizeEmail(message.createdByEmail)
  return Boolean(currentEmail && messageEmail && currentEmail === messageEmail)
}

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result

      if (typeof result === 'string') {
        resolve(result)
        return
      }

      reject(new Error('Unable to read the selected file.'))
    }

    reader.onerror = () => {
      reject(new Error('Unable to read the selected file.'))
    }

    reader.readAsDataURL(file)
  })
}

export default function ChatPage() {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const messageBottomRef = useRef<HTMLDivElement | null>(null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [messageDraftMarkup, setMessageDraftMarkup] = useState('')
  const [attachmentDraft, setAttachmentDraft] = useState<AttachmentDraft | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [newDirectUserUid, setNewDirectUserUid] = useState<string | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupMemberUids, setNewGroupMemberUids] = useState<string[]>([])
  const [groupDraftName, setGroupDraftName] = useState('')
  const [groupDraftMemberUids, setGroupDraftMemberUids] = useState<string[]>([])
  const [adminDeleteThread, setAdminDeleteThread] = useState<AppChatThread | null>(null)
  const currentUid = String(appUser?.uid ?? '').trim()
  const currentEmail = normalizeEmail(appUser?.email)
  const isAdmin = Boolean(appUser?.isAdmin)
  const canStartDirect = Boolean(appUser?.isAdmin || appUser?.isManager || appUser?.isOfficeWorker)

  const usersQuery = useQuery({
    queryKey: QUERY_KEYS.chatUsers,
    queryFn: fetchChatUsers,
    staleTime: 60 * 1000,
  })

  const threadsQuery = useQuery({
    queryKey: QUERY_KEYS.chatThreads('all'),
    queryFn: () => fetchChatThreads('all'),
    staleTime: 5000,
    refetchInterval: 6000,
  })

  const users = useMemo(
    () => usersQuery.data?.users ?? [],
    [usersQuery.data?.users],
  )
  const threads = useMemo(() => {
    const orderedThreads = [...(threadsQuery.data?.threads ?? [])].sort((left, right) => {
      const leftSort = String(left.lastMessageAt ?? left.updatedAt ?? left.createdAt ?? '')
      const rightSort = String(right.lastMessageAt ?? right.updatedAt ?? right.createdAt ?? '')
      return rightSort.localeCompare(leftSort)
    })

    return orderedThreads.sort((left, right) => Number(right.pinned) - Number(left.pinned))
  }, [threadsQuery.data?.threads])

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads],
  )

  useEffect(() => {
    if (threads.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedThreadId(null)
      return
    }

    if (!selectedThreadId || !threads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(threads[0]?.id ?? null)
    }
  }, [selectedThreadId, threads])

  useEffect(() => {
    if (!selectedThread || selectedThread.type !== 'group') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGroupDraftName('')
      setGroupDraftMemberUids([])
      return
    }

    setGroupDraftName(selectedThread.name || '')
    setGroupDraftMemberUids(selectedThread.memberUids)
  }, [selectedThread])

  const messagesQuery = useQuery({
    queryKey: QUERY_KEYS.chatMessages(selectedThreadId ?? 'none', 160, 0),
    queryFn: () => fetchChatMessages(selectedThreadId ?? '', { limit: 160, offset: 0 }),
    enabled: Boolean(selectedThreadId),
    staleTime: 3000,
    refetchInterval: selectedThreadId ? 4000 : false,
  })

  const messages = messagesQuery.data?.messages ?? []

  useEffect(() => {
    messageBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, selectedThreadId])

  const groupUserOptions = useMemo(
    () => users.filter((user) => user.uid !== currentUid),
    [currentUid, users],
  )
  const mentionOptions = useMemo(() => [
    { id: mentionAllId, display: 'all' },
    ...users.map((user) => ({
      id: user.uid,
      display: String(user.displayName || user.email.split('@')[0] || user.email).trim(),
    })),
  ], [users])

  const createDirectMutation = useMutation({
    mutationFn: createDirectChat,
    onSuccess: async (payload) => {
      setActionError(null)
      setNewDirectUserUid(null)
      setSelectedThreadId(payload.thread.id)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') })
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Unable to create a direct chat.')
    },
  })

  const updateThreadPreferenceMutation = useMutation({
    mutationFn: ({ threadId, pinned }: { threadId: string; pinned: boolean }) => (
      updateChatThreadPreferences(threadId, { pinned })
    ),
    onSuccess: async () => {
      setActionError(null)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') })
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Unable to update this chat.')
    },
  })

  const deleteThreadMutation = useMutation({
    mutationFn: ({
      threadId,
      deleteForEveryone,
    }: {
      threadId: string
      deleteForEveryone: boolean
    }) => deleteChatThread(threadId, deleteForEveryone),
    onSuccess: async (_payload, { threadId }) => {
      if (selectedThreadId === threadId) {
        setSelectedThreadId(null)
      }
      setAdminDeleteThread(null)
      setActionError(null)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') })
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Unable to delete this chat.')
    },
  })

  const createGroupMutation = useMutation({
    mutationFn: createChatGroup,
    onSuccess: async (payload) => {
      setActionError(null)
      setNewGroupName('')
      setNewGroupMemberUids([])
      setSelectedThreadId(payload.thread.id)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') })
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Unable to create the group.')
    },
  })

  const updateGroupMutation = useMutation({
    mutationFn: ({
      threadId,
      payload,
    }: {
      threadId: string
      payload: { name: string; memberUids: string[] }
    }) => updateChatGroup(threadId, payload),
    onSuccess: async () => {
      setActionError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatMessages(selectedThreadId ?? 'none', 160, 0) }),
      ])
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Unable to save group settings.')
    },
  })

  const sendMessageMutation = useMutation({
    mutationFn: ({
      threadId,
      payload,
    }: {
      threadId: string
      payload: {
        text?: string
        mentionUserUids?: string[]
        attachment?: {
          kind: AppChatAttachmentKind
          dataUrl: string
          mimeType: string
          fileName: string
        }
      }
    }) => sendChatMessage(threadId, payload),
    onSuccess: async () => {
      setActionError(null)
      setMessageDraft('')
      setMessageDraftMarkup('')
      setAttachmentDraft(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatMessages(selectedThreadId ?? 'none', 160, 0) }),
      ])
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Unable to send the message.')
    },
  })

  const deleteMessageMutation = useMutation({
    mutationFn: deleteChatMessage,
    onSuccess: async () => {
      setActionError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatMessages(selectedThreadId ?? 'none', 160, 0) }),
      ])
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Unable to delete this message.')
    },
  })

  const handleCreateGroup = () => {
    if (!isAdmin || createGroupMutation.isPending) {
      return
    }

    const normalizedGroupName = newGroupName.trim()

    if (!normalizedGroupName) {
      setActionError('Group name is required.')
      return
    }

    if (newGroupMemberUids.length === 0) {
      setActionError('Select at least one group member.')
      return
    }

    createGroupMutation.mutate({
      name: normalizedGroupName,
      memberUids: newGroupMemberUids,
    })
  }

  const handleSaveGroupSettings = () => {
    if (!selectedThread || selectedThread.type !== 'group' || !isAdmin || updateGroupMutation.isPending) {
      return
    }

    const normalizedName = groupDraftName.trim()

    if (!normalizedName) {
      setActionError('Group name is required.')
      return
    }

    if (groupDraftMemberUids.length === 0) {
      setActionError('Select at least one member for this group.')
      return
    }

    updateGroupMutation.mutate({
      threadId: selectedThread.id,
      payload: {
        name: normalizedName,
        memberUids: groupDraftMemberUids,
      },
    })
  }

  const handleSendMessage = () => {
    const normalizedText = messageDraft.trim()

    if (!selectedThreadId || sendMessageMutation.isPending) {
      return
    }

    if (!normalizedText && !attachmentDraft) {
      return
    }

    sendMessageMutation.mutate({
      threadId: selectedThreadId,
      payload: {
        mentionUserUids: (() => {
          const ids = extractMentionUids(messageDraftMarkup)
          return ids.includes(mentionAllId)
            ? [...new Set(users.map((user) => user.uid))]
            : ids
        })(),
        ...(normalizedText
          ? {
              text: normalizedText,
            }
          : {}),
        ...(attachmentDraft
          ? {
              attachment: {
                kind: attachmentDraft.kind,
                dataUrl: attachmentDraft.dataUrl,
                mimeType: attachmentDraft.mimeType,
                fileName: attachmentDraft.fileName,
              },
            }
          : {}),
      },
    })
  }

  const handleDeleteMessage = (message: AppChatMessage) => {
    if (deleteMessageMutation.isPending) {
      return
    }

    if (!window.confirm('Delete this message?')) {
      return
    }

    deleteMessageMutation.mutate(message.id)
  }

  const handleAttachmentButtonClick = () => {
    setActionError(null)
    fileInputRef.current?.click()
  }

  const handleAttachmentFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!selectedFile) {
      return
    }

    if (selectedFile.size > maxAttachmentSizeBytes) {
      setActionError('Attachment is too large. Max size is 6 MB.')
      return
    }

    const fileMimeType = String(selectedFile.type ?? '').trim().toLowerCase()
    const attachmentKind = fileMimeType.startsWith('image/')
      ? 'image'
      : fileMimeType.startsWith('audio/')
        ? 'voice'
        : null

    if (!attachmentKind) {
      setActionError('Only image and audio files are supported.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)

      setAttachmentDraft({
        kind: attachmentKind,
        dataUrl,
        mimeType: fileMimeType || (attachmentKind === 'image' ? 'image/jpeg' : 'audio/mp4'),
        fileName: selectedFile.name || (attachmentKind === 'image' ? 'photo.jpg' : 'voice-note.m4a'),
        sizeBytes: selectedFile.size,
      })
      setActionError(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to attach this file.')
    }
  }

  const selectedGroupMemberProfiles = useMemo(
    () => groupUserOptions.filter((user) => groupDraftMemberUids.includes(user.uid)),
    [groupDraftMemberUids, groupUserOptions],
  )

  const newGroupMemberProfiles = useMemo(
    () => groupUserOptions.filter((user) => newGroupMemberUids.includes(user.uid)),
    [groupUserOptions, newGroupMemberUids],
  )

  const selectedThreadTitle = selectedThread
    ? buildThreadTitle(selectedThread, currentUid)
    : 'Select a chat'

  const combinedErrorMessage = [
    actionError,
    usersQuery.error instanceof Error ? usersQuery.error.message : null,
    threadsQuery.error instanceof Error ? threadsQuery.error.message : null,
    messagesQuery.error instanceof Error ? messagesQuery.error.message : null,
  ].find(Boolean) ?? null

  return (
    <Stack spacing={2}>
      {combinedErrorMessage ? <Alert severity="error">{combinedErrorMessage}</Alert> : null}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: '320px minmax(0, 1fr)',
          },
          gap: 2,
          minHeight: {
            xs: 'auto',
            md: 'calc(100vh - 220px)',
          },
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            minHeight: 0,
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Chat Threads
          </Typography>

          {canStartDirect ? (
            <Stack spacing={1}>
              <Typography variant="subtitle2" color="text.secondary">
                New direct chat
              </Typography>
              <Autocomplete
                options={groupUserOptions}
                value={groupUserOptions.find((user) => user.uid === newDirectUserUid) ?? null}
                onChange={(_event, value) => {
                  setNewDirectUserUid(value?.uid ?? null)
                }}
                getOptionLabel={(option) => option.displayName || option.email}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Team member"
                    placeholder="Select a user"
                  />
                )}
              />
              <Button
                variant="contained"
                size="small"
                startIcon={<PersonRoundedIcon />}
                disabled={!newDirectUserUid || createDirectMutation.isPending}
                onClick={() => {
                  if (newDirectUserUid) {
                    createDirectMutation.mutate(newDirectUserUid)
                  }
                }}
              >
                {createDirectMutation.isPending ? 'Starting...' : 'Start Chat'}
              </Button>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Your conversations will appear here when a team member adds you.
            </Typography>
          )}

          {isAdmin ? (
            <Stack spacing={1.25}>
              <Divider />
              <Typography variant="subtitle2" color="text.secondary">
                Create group
              </Typography>

              <TextField
                size="small"
                label="Group name"
                value={newGroupName}
                onChange={(event) => {
                  setNewGroupName(event.target.value)
                }}
              />

              <Autocomplete
                multiple
                options={groupUserOptions}
                value={newGroupMemberProfiles}
                onChange={(_event, value) => {
                  setNewGroupMemberUids(value.map((user) => user.uid))
                }}
                getOptionLabel={(option) => option.displayName || option.email}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Members"
                    placeholder="Add members"
                  />
                )}
              />

              <Button
                variant="contained"
                size="small"
                startIcon={<AddRoundedIcon />}
                onClick={handleCreateGroup}
                disabled={createGroupMutation.isPending}
              >
                {createGroupMutation.isPending ? 'Creating...' : 'Create Group'}
              </Button>
            </Stack>
          ) : null}

          <Divider />

          <List
            sx={{
              p: 0,
              borderRadius: 1.5,
              border: (theme) => `1px solid ${theme.palette.divider}`,
              overflow: 'auto',
              flexGrow: 1,
              minHeight: 180,
            }}
          >
            {threads.length === 0 ? (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  No chats yet. Start a direct chat or create a group.
                </Typography>
              </Box>
            ) : threads.map((thread) => {
              const isSelected = selectedThreadId === thread.id
              const title = buildThreadTitle(thread, currentUid)
              const subtitle = thread.lastMessagePreview || buildThreadSubtitle(thread, currentUid)

              return (
                <ListItemButton
                  key={thread.id}
                  selected={isSelected}
                  onClick={() => {
                    setSelectedThreadId(thread.id)
                    setActionError(null)
                  }}
                  sx={{
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                    alignItems: 'flex-start',
                    gap: 1,
                  }}
                >
                  <Avatar sx={{ width: 30, height: 30, mt: 0.25 }}>
                    {thread.type === 'group' ? <GroupsRoundedIcon fontSize="small" /> : <PersonRoundedIcon fontSize="small" />}
                  </Avatar>

                  <ListItemText
                    primary={title}
                    secondary={subtitle}
                    primaryTypographyProps={{
                      noWrap: true,
                      fontWeight: 600,
                    }}
                    secondaryTypographyProps={{
                      noWrap: true,
                    }}
                  />
                  <Stack direction="row" spacing={0.25} sx={{ ml: 'auto' }}>
                    <IconButton
                      size="small"
                      aria-label={thread.pinned ? 'Unpin chat' : 'Pin chat'}
                      onClick={(event) => {
                        event.stopPropagation()
                        updateThreadPreferenceMutation.mutate({
                          threadId: thread.id,
                          pinned: !thread.pinned,
                        })
                      }}
                    >
                      {thread.pinned
                        ? <PushPinRoundedIcon fontSize="inherit" color="primary" />
                        : <PushPinOutlinedIcon fontSize="inherit" />}
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      aria-label="Delete chat"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (isAdmin) {
                          setAdminDeleteThread(thread)
                        } else if (window.confirm('Delete this chat for you? Its existing messages will stay hidden if you start the chat again.')) {
                          deleteThreadMutation.mutate({
                            threadId: thread.id,
                            deleteForEveryone: false,
                          })
                        }
                      }}
                    >
                      <DeleteOutlineRoundedIcon fontSize="inherit" />
                    </IconButton>
                  </Stack>
                </ListItemButton>
              )
            })}
          </List>
        </Paper>

        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            display: 'flex',
            flexDirection: 'column',
            minHeight: {
              xs: 520,
              md: 'auto',
            },
            gap: 1.5,
          }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
          >
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {selectedThreadTitle}
              </Typography>
              {selectedThread ? (
                <Typography variant="body2" color="text.secondary">
                  {buildThreadSubtitle(selectedThread, currentUid)}
                </Typography>
              ) : null}
            </Box>

            {selectedThread ? (
              <Chip
                size="small"
                label={selectedThread.type === 'group' ? 'Group' : 'Direct'}
                color={selectedThread.type === 'group' ? 'secondary' : 'default'}
              />
            ) : null}
          </Stack>

          {selectedThread && selectedThread.type === 'group' && isAdmin ? (
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1}
              sx={{
                p: 1,
                borderRadius: 1.5,
                bgcolor: 'background.default',
                border: (theme) => `1px solid ${theme.palette.divider}`,
              }}
            >
              <TextField
                size="small"
                label="Group name"
                value={groupDraftName}
                onChange={(event) => {
                  setGroupDraftName(event.target.value)
                }}
                sx={{ minWidth: 220 }}
              />

              <Autocomplete
                multiple
                options={groupUserOptions}
                value={selectedGroupMemberProfiles}
                onChange={(_event, value) => {
                  setGroupDraftMemberUids(value.map((user) => user.uid))
                }}
                getOptionLabel={(option) => option.displayName || option.email}
                sx={{ minWidth: 280, flexGrow: 1 }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Group members"
                    placeholder="Select members"
                  />
                )}
              />

              <Button
                variant="outlined"
                onClick={handleSaveGroupSettings}
                disabled={updateGroupMutation.isPending}
              >
                {updateGroupMutation.isPending ? 'Saving...' : 'Save Group'}
              </Button>
            </Stack>
          ) : null}

          <Divider />

          <Box
            sx={{
              flexGrow: 1,
              minHeight: 220,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              pr: 0.5,
            }}
          >
            {!selectedThread ? (
              <Box
                sx={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Select a thread on the left to start chatting.
                </Typography>
              </Box>
            ) : messages.length === 0 ? (
              <Box
                sx={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  No messages yet. Send the first one.
                </Typography>
              </Box>
            ) : messages.map((message) => {
              const isMine = Boolean(
                (message.createdByUid && message.createdByUid === currentUid)
                || (message.createdByEmail && normalizeEmail(message.createdByEmail) === currentEmail),
              )
              const senderLabel = isMine
                ? 'You'
                : message.createdByName || message.createdByEmail || 'Teammate'
              const deleted = Boolean(message.deletedAt || message.messageType === 'deleted')
              const attachment = message.attachment
              const canDelete = canDeleteMessage(message, currentUid, currentEmail, isAdmin)

              return (
                <Stack
                  key={message.id}
                  alignItems={isMine ? 'flex-end' : 'flex-start'}
                  spacing={0.35}
                >
                  <Stack
                    direction="row"
                    spacing={0.75}
                    alignItems="center"
                    sx={{
                      px: 0.75,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {senderLabel}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatChatTime(message.createdAt)}
                    </Typography>
                    {canDelete && !deleted ? (
                      <IconButton
                        size="small"
                        onClick={() => {
                          handleDeleteMessage(message)
                        }}
                        disabled={deleteMessageMutation.isPending}
                      >
                        <DeleteOutlineRoundedIcon fontSize="inherit" />
                      </IconButton>
                    ) : null}
                  </Stack>

                  <Paper
                    variant="outlined"
                    sx={{
                      p: 1,
                      maxWidth: {
                        xs: '100%',
                        sm: '78%',
                      },
                      borderRadius: 2,
                      bgcolor: isMine ? 'primary.50' : 'background.paper',
                    }}
                  >
                    {deleted ? (
                      <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                        Message deleted.
                      </Typography>
                    ) : null}

                    {!deleted && message.text ? (
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {message.text}
                      </Typography>
                    ) : null}

                    {!deleted && attachment?.kind === 'image' && attachment.dataUrl ? (
                      <Box
                        component="img"
                        src={attachment.dataUrl}
                        alt={attachment.fileName || 'Chat image'}
                        sx={{
                          mt: message.text ? 1 : 0,
                          width: '100%',
                          maxHeight: 280,
                          objectFit: 'cover',
                          borderRadius: 1.5,
                          border: (theme) => `1px solid ${theme.palette.divider}`,
                        }}
                      />
                    ) : null}

                    {!deleted && attachment?.kind === 'voice' && attachment.dataUrl ? (
                      <Box sx={{ mt: message.text ? 1 : 0 }}>
                        <Box
                          component="audio"
                          controls
                          preload="none"
                          src={attachment.dataUrl}
                          sx={{ width: '100%' }}
                        />
                      </Box>
                    ) : null}

                    {!deleted && attachment?.kind === 'file' && attachment.dataUrl ? (
                      <Button
                        component="a"
                        href={attachment.dataUrl}
                        download={attachment.fileName || 'attachment'}
                        size="small"
                        variant="outlined"
                        startIcon={<AttachFileRoundedIcon />}
                        sx={{ mt: message.text ? 1 : 0 }}
                      >
                        {attachment.fileName || 'Download file'}
                      </Button>
                    ) : null}
                  </Paper>
                </Stack>
              )
            })}
            <Box ref={messageBottomRef} />
          </Box>

          {selectedThread ? (
            <Stack spacing={1}>
              {attachmentDraft ? (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1,
                    borderRadius: 1.5,
                    bgcolor: 'background.default',
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip
                        size="small"
                        label={attachmentDraft.kind === 'image' ? 'Photo' : 'Voice note'}
                        color={attachmentDraft.kind === 'image' ? 'secondary' : 'primary'}
                        variant="outlined"
                      />
                      <Typography variant="caption" color="text.secondary">
                        {attachmentDraft.fileName} ({Math.max(1, Math.round(attachmentDraft.sizeBytes / 1024))} KB)
                      </Typography>
                    </Stack>

                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => {
                        setAttachmentDraft(null)
                      }}
                    >
                      Remove
                    </Button>
                  </Stack>

                  {attachmentDraft.kind === 'image' ? (
                    <Box
                      component="img"
                      src={attachmentDraft.dataUrl}
                      alt={attachmentDraft.fileName}
                      sx={{
                        mt: 1,
                        width: 120,
                        height: 90,
                        objectFit: 'cover',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                      }}
                    />
                  ) : null}
                </Paper>
              ) : null}

              <MentionsInput
                value={messageDraftMarkup}
                onChange={(_event, nextMarkup, nextPlainText) => {
                  setMessageDraftMarkup(nextMarkup)
                  setMessageDraft(nextPlainText)
                }}
                placeholder="Write a message... Use @ to tag someone or @all to notify everyone."
                style={chatMentionsInputStyle}
                allowSuggestionsAboveCursor
              >
                <Mention
                  trigger="@"
                  markup="@[__display__](__id__)"
                  displayTransform={(_id, display) => `@${display}`}
                  data={mentionOptions}
                  appendSpaceOnAdd
                />
              </MentionsInput>

              <Stack direction="row" spacing={1} justifyContent="space-between">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,audio/*"
                  hidden
                  onChange={handleAttachmentFileChange}
                />

                <Button
                  variant="outlined"
                  startIcon={<AttachFileRoundedIcon />}
                  onClick={handleAttachmentButtonClick}
                >
                  Attach
                </Button>

                <Button
                  variant="contained"
                  endIcon={<SendRoundedIcon />}
                  disabled={sendMessageMutation.isPending}
                  onClick={handleSendMessage}
                >
                  {sendMessageMutation.isPending ? 'Sending...' : 'Send'}
                </Button>
              </Stack>
            </Stack>
          ) : null}
        </Paper>
      </Box>

      <Dialog
        open={Boolean(adminDeleteThread)}
        onClose={() => {
          if (!deleteThreadMutation.isPending) {
            setAdminDeleteThread(null)
          }
        }}
      >
        <DialogTitle>Delete chat</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete this chat only for you, or clear and remove it for every member?
            Existing messages will not return if the chat is started again.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setAdminDeleteThread(null)}
            disabled={deleteThreadMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            color="error"
            disabled={!adminDeleteThread || deleteThreadMutation.isPending}
            onClick={() => {
              if (adminDeleteThread) {
                deleteThreadMutation.mutate({
                  threadId: adminDeleteThread.id,
                  deleteForEveryone: false,
                })
              }
            }}
          >
            Delete for me
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!adminDeleteThread || deleteThreadMutation.isPending}
            onClick={() => {
              if (adminDeleteThread) {
                deleteThreadMutation.mutate({
                  threadId: adminDeleteThread.id,
                  deleteForEveryone: true,
                })
              }
            }}
          >
            Delete for everyone
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

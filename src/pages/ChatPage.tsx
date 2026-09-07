// Worker chat. Three panes: threads, conversation, details — wired to
// /api/chat/*. Everything here is internal-only: the people you can reach are
// exactly the approved users the API returns.
import CallRoundedIcon from '@mui/icons-material/CallRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import {
  createChatGroup,
  createDirectChat,
  deleteChatMessage,
  deleteChatThread,
  endChatCall,
  fetchChatActivity,
  fetchChatMessages,
  fetchChatThreads,
  fetchChatUsers,
  leaveChatCall,
  sendChatMessage,
  setChatTyping,
  startChatCall,
  toggleChatMessageReaction,
  updateChatGroup,
  updateChatPresence,
  updateChatThreadPreferences,
  type AppChatCallMode,
  type AppChatMessage,
  type AppChatPresenceStatus,
  type AppChatThread,
} from '../features/chat/api'
import { ChatAvatar } from '../features/chat/ChatAvatar'
import { ChatCallWindow, type ChatCallSession } from '../features/chat/ChatCallWindow'
import { ChatComposer, type ChatAttachmentDraft } from '../features/chat/ChatComposer'
import { NewChatDialog, NewGroupDialog } from '../features/chat/ChatCreateDialogs'
import { ChatDetailsPanel } from '../features/chat/ChatDetailsPanel'
import { ChatMessageList } from '../features/chat/ChatMessageList'
import { ChatSidebar } from '../features/chat/ChatSidebar'
import {
  buildThreadSubtitle,
  buildThreadTitle,
  CHAT_MAX_ATTACHMENT_BYTES,
  extractMentionUids,
  findThreadPeer,
  normalizeEmail,
  readFileAsDataUrl,
} from '../features/chat/chatUi'
import { useFillViewportHeight } from '../features/chat/useFillViewportHeight'
import { QUERY_KEYS } from '../lib/queryKeys'

const mentionAllId = '__mention_all__'
// Attachments ride inline in the message payload, so a big first page is
// genuinely heavy. Load a screenful, then fetch older ones on request.
const messagesPageSize = 40
const messagesPageStep = 40
const sidebarWidth = 330

function resolveAttachmentKind(mimeType: string) {
  if (mimeType.startsWith('image/')) {
    return 'image' as const
  }

  if (mimeType.startsWith('audio/')) {
    return 'voice' as const
  }

  return 'file' as const
}

export default function ChatPage() {
  const { appUser } = useAuth()
  const queryClient = useQueryClient()
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))
  const typingSentAtRef = useRef(0)
  const { ref: chatShellRef, height: chatShellHeight } = useFillViewportHeight()
  const [searchParams, setSearchParams] = useSearchParams()
  const autoJoinThreadId = searchParams.get('join')

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [messageMarkup, setMessageMarkup] = useState('')
  const [messageText, setMessageText] = useState('')
  const [attachmentDraft, setAttachmentDraft] = useState<ChatAttachmentDraft | null>(null)
  const [replyTo, setReplyTo] = useState<AppChatMessage | null>(null)
  const [draftThreadId, setDraftThreadId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AppChatThread | null>(null)
  const [callSession, setCallSession] = useState<ChatCallSession | null>(null)
  const [messageLimit, setMessageLimit] = useState(messagesPageSize)

  const currentUid = String(appUser?.uid ?? '').trim()
  const currentEmail = normalizeEmail(appUser?.email)
  const isAdmin = Boolean(appUser?.isAdmin)
  const canStartDirect = Boolean(appUser?.isAdmin || appUser?.isManager || appUser?.isOfficeWorker)

  const usersQuery = useQuery({
    queryKey: QUERY_KEYS.chatUsers,
    queryFn: fetchChatUsers,
    // Presence dots go stale fast, so refresh them on the same rhythm the
    // server uses to decide who still counts as online.
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  })

  const threadsQuery = useQuery({
    queryKey: QUERY_KEYS.chatThreads('all'),
    queryFn: () => fetchChatThreads('all'),
    staleTime: 3000,
    refetchInterval: 6000,
  })

  const users = useMemo(() => usersQuery.data?.users ?? [], [usersQuery.data?.users])
  // The server decides whether calling is available, so the buttons are never
  // offered when they would only return an error.
  const videoCallsEnabled = usersQuery.data?.videoCallsEnabled === true
  // Shop workers and sales reps get a short user list, so fall back to the
  // signed-in profile rather than showing an anonymous header.
  const me = useMemo(() => {
    const fromDirectory = users.find((user) => user.uid === currentUid)

    if (fromDirectory || !appUser) {
      return fromDirectory ?? null
    }

    return {
      uid: appUser.uid,
      email: appUser.email,
      onlineStatus: 'available' as const,
      lastSeenAt: null,
      displayName: appUser.displayName,
      imageUrl: appUser.photoURL,
      role: appUser.role,
      isAdmin: appUser.isAdmin,
      isManager: appUser.isManager,
      isSalesRep: appUser.isSalesRep,
      isShopWorker: appUser.isShopWorker,
      isOfficeWorker: appUser.isOfficeWorker,
      hasWebAccess: appUser.hasWebAccess,
      hasAppAccess: appUser.hasAppAccess,
    }
  }, [appUser, currentUid, users])
  const otherUsers = useMemo(
    () => users.filter((user) => user.uid !== currentUid),
    [currentUid, users],
  )

  const threads = useMemo(() => {
    const ordered = [...(threadsQuery.data?.threads ?? [])].sort((left, right) => {
      const leftSort = String(left.lastMessageAt ?? left.updatedAt ?? left.createdAt ?? '')
      const rightSort = String(right.lastMessageAt ?? right.updatedAt ?? right.createdAt ?? '')
      return rightSort.localeCompare(leftSort)
    })

    return ordered.sort((left, right) => Number(right.pinned) - Number(left.pinned))
  }, [threadsQuery.data?.threads])

  // The open thread is derived, not stored: when the selection disappears
  // (deleted, or the list has not loaded yet) the newest thread takes over
  // without a round trip through an effect.
  const activeThreadId = useMemo(() => {
    if (selectedThreadId && threads.some((thread) => thread.id === selectedThreadId)) {
      return selectedThreadId
    }

    return threads[0]?.id ?? null
  }, [selectedThreadId, threads])

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads],
  )

  const messagesQuery = useQuery({
    queryKey: QUERY_KEYS.chatMessages(activeThreadId ?? 'none', messageLimit, 0),
    queryFn: () => fetchChatMessages(activeThreadId ?? '', { limit: messageLimit, offset: 0 }),
    enabled: Boolean(activeThreadId),
    staleTime: 2000,
    refetchInterval: activeThreadId ? 4000 : false,
    // Hold the current thread's messages while a larger page loads, so
    // "load earlier" does not blank the conversation. Never hold them across
    // a thread switch — that would show one thread under another's header.
    placeholderData: (previousData, previousQuery) => (
      previousQuery?.queryKey?.[2] === activeThreadId ? previousData : undefined
    ),
  })

  const activityQuery = useQuery({
    queryKey: QUERY_KEYS.chatActivity(activeThreadId ?? 'none'),
    queryFn: () => fetchChatActivity(activeThreadId ?? ''),
    enabled: Boolean(activeThreadId),
    refetchInterval: activeThreadId ? 4000 : false,
  })

  const messages = useMemo(() => messagesQuery.data?.messages ?? [], [messagesQuery.data?.messages])

  const typingLabel = useMemo(() => {
    const typingUsers = activityQuery.data?.typingUsers ?? []

    if (typingUsers.length === 0) {
      return null
    }

    const names = typingUsers.map((user) => user.displayName || user.email || 'Someone')

    if (names.length === 1) {
      return `${names[0]} is typing...`
    }

    if (names.length === 2) {
      return `${names[0]} and ${names[1]} are typing...`
    }

    return `${names.length} people are typing...`
  }, [activityQuery.data?.typingUsers])

  const mentionOptions = useMemo(() => [
    { id: mentionAllId, display: 'all' },
    ...users.map((user) => ({
      id: user.uid,
      display: String(user.displayName || user.email.split('@')[0] || user.email).trim(),
    })),
  ], [users])

  const invalidateThreadViews = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') }),
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.chatMessages(activeThreadId ?? 'none', messageLimit, 0),
      }),
    ])
  }, [activeThreadId, messageLimit, queryClient])

  const reportError = useCallback((error: unknown, fallback: string) => {
    setActionError(error instanceof Error ? error.message : fallback)
  }, [])

  const createDirectMutation = useMutation({
    mutationFn: createDirectChat,
    onSuccess: async (payload) => {
      setActionError(null)
      setNewChatOpen(false)
      setSelectedThreadId(payload.thread.id)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') })
    },
    onError: (error) => reportError(error, 'Unable to start that chat.'),
  })

  const createGroupMutation = useMutation({
    mutationFn: createChatGroup,
    onSuccess: async (payload) => {
      setActionError(null)
      setNewGroupOpen(false)
      setSelectedThreadId(payload.thread.id)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') })
    },
    onError: (error) => reportError(error, 'Unable to create the group.'),
  })

  const updateGroupMutation = useMutation({
    mutationFn: ({ threadId, payload }: {
      threadId: string
      payload: { name: string; memberUids: string[] }
    }) => updateChatGroup(threadId, payload),
    onSuccess: async () => {
      setActionError(null)
      await invalidateThreadViews()
    },
    onError: (error) => reportError(error, 'Unable to save group settings.'),
  })

  const preferencesMutation = useMutation({
    mutationFn: ({ threadId, pinned }: { threadId: string; pinned: boolean }) => (
      updateChatThreadPreferences(threadId, { pinned })
    ),
    onSuccess: async () => {
      setActionError(null)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') })
    },
    onError: (error) => reportError(error, 'Unable to update this chat.'),
  })

  const deleteThreadMutation = useMutation({
    mutationFn: ({ threadId, deleteForEveryone }: { threadId: string; deleteForEveryone: boolean }) => (
      deleteChatThread(threadId, deleteForEveryone)
    ),
    onSuccess: async (_payload, { threadId }) => {
      if (activeThreadId === threadId) {
        setSelectedThreadId(null)
      }

      setDeleteTarget(null)
      setActionError(null)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatThreads('all') })
    },
    onError: (error) => reportError(error, 'Unable to delete this chat.'),
  })

  const sendMessageMutation = useMutation({
    mutationFn: ({ threadId, payload }: {
      threadId: string
      payload: Parameters<typeof sendChatMessage>[1]
    }) => sendChatMessage(threadId, payload),
    onSuccess: async () => {
      setActionError(null)
      setMessageMarkup('')
      setMessageText('')
      setAttachmentDraft(null)
      setReplyTo(null)
      await invalidateThreadViews()
    },
    onError: (error) => reportError(error, 'Unable to send the message.'),
  })

  const deleteMessageMutation = useMutation({
    mutationFn: deleteChatMessage,
    onSuccess: async () => {
      setActionError(null)
      await invalidateThreadViews()
    },
    onError: (error) => reportError(error, 'Unable to delete this message.'),
  })

  const reactionMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) => (
      toggleChatMessageReaction(messageId, emoji)
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.chatMessages(activeThreadId ?? 'none', messageLimit, 0),
      })
    },
    onError: (error) => reportError(error, 'Unable to save that reaction.'),
  })

  const presenceMutation = useMutation({
    mutationFn: updateChatPresence,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatUsers })
    },
    onError: (error) => reportError(error, 'Unable to update your status.'),
  })

  // Reset the draft when the conversation changes so a half-written message
  // never lands in the wrong thread.
  if (draftThreadId !== activeThreadId) {
    setDraftThreadId(activeThreadId)
    setMessageLimit(messagesPageSize)
    setMessageMarkup('')
    setMessageText('')
    setAttachmentDraft(null)
    setReplyTo(null)
  }

  const handleTyping = useCallback(() => {
    if (!activeThreadId) {
      return
    }

    const now = Date.now()

    if (now - typingSentAtRef.current < 3000) {
      return
    }

    typingSentAtRef.current = now
    void setChatTyping(activeThreadId, true).catch(() => {})
  }, [activeThreadId])

  const handleSend = useCallback(() => {
    const text = messageText.trim()

    if (!activeThreadId || sendMessageMutation.isPending || (!text && !attachmentDraft)) {
      return
    }

    const mentionUids = extractMentionUids(messageMarkup)
    const resolvedMentionUids = mentionUids.includes(mentionAllId)
      ? [...new Set(users.map((user) => user.uid))]
      : mentionUids

    typingSentAtRef.current = 0
    void setChatTyping(activeThreadId, false).catch(() => {})

    sendMessageMutation.mutate({
      threadId: activeThreadId,
      payload: {
        mentionUserUids: resolvedMentionUids,
        ...(text ? { text } : {}),
        ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
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
  }, [
    activeThreadId,
    attachmentDraft,
    messageMarkup,
    messageText,
    replyTo,
    sendMessageMutation,
    users,
  ])

  const handleAttach = useCallback(async (file: File) => {
    if (file.size > CHAT_MAX_ATTACHMENT_BYTES) {
      setActionError('Attachment is too large. Max size is 6 MB.')
      return
    }

    const mimeType = String(file.type ?? '').trim().toLowerCase()

    try {
      const dataUrl = await readFileAsDataUrl(file)

      setAttachmentDraft({
        kind: resolveAttachmentKind(mimeType),
        dataUrl,
        mimeType: mimeType || 'application/octet-stream',
        fileName: file.name || 'attachment',
        sizeBytes: file.size,
      })
      setActionError(null)
    } catch (error) {
      reportError(error, 'Unable to attach this file.')
    }
  }, [reportError])

  const handleSelectThread = useCallback((threadId: string) => {
    setSelectedThreadId(threadId)
    setActionError(null)
    setMobileSidebarOpen(false)
  }, [])

  const handleTogglePin = useCallback((thread: AppChatThread) => {
    preferencesMutation.mutate({ threadId: thread.id, pinned: !thread.pinned })
  }, [preferencesMutation])

  const handlePresenceChange = useCallback((status: AppChatPresenceStatus) => {
    presenceMutation.mutate(status)
  }, [presenceMutation])

  const startCallMutation = useMutation({
    mutationFn: ({ threadId, mode }: { threadId: string; mode: AppChatCallMode }) => (
      startChatCall(threadId, mode)
    ),
    onSuccess: async (payload) => {
      setActionError(null)
      setCallSession({ call: payload.call, url: payload.url, token: payload.token })

      // The server posts and later rewrites the call message itself, so it can
      // report the outcome once the call ends.
      await invalidateThreadViews()
    },
    onError: (error) => reportError(error, 'Unable to start the call.'),
  })

  const endCallMutation = useMutation({
    mutationFn: endChatCall,
    onSuccess: async () => {
      setCallSession(null)
      setActionError(null)
      await invalidateThreadViews()
    },
    onError: (error) => reportError(error, 'Unable to end the call.'),
  })

  const handleLeaveCall = useCallback(() => {
    const threadId = callSession?.call ? activeThreadId : null

    setCallSession(null)

    if (threadId) {
      void leaveChatCall(threadId)
        .then(() => invalidateThreadViews())
        .catch(() => {})
    }
  }, [activeThreadId, callSession?.call, invalidateThreadViews])

  const handleStartCall = useCallback((mode: AppChatCallMode) => {
    if (!activeThreadId || startCallMutation.isPending) {
      return
    }

    startCallMutation.mutate({ threadId: activeThreadId, mode })
  }, [activeThreadId, startCallMutation])

  // Arriving from the incoming-call popup: select that thread and join once.
  if (autoJoinThreadId) {
    const target = autoJoinThreadId
    setSearchParams({}, { replace: true })
    setSelectedThreadId(target)

    if (!callSession && !startCallMutation.isPending) {
      startCallMutation.mutate({ threadId: target, mode: 'video' })
    }
  }

  const selectedPeer = findThreadPeer(selectedThread, currentUid)
  const headerTitle = selectedThread ? buildThreadTitle(selectedThread, currentUid) : 'Chat'
  const headerSubtitle = selectedThread ? buildThreadSubtitle(selectedThread, currentUid) : ''

  const combinedError = [
    actionError,
    usersQuery.error instanceof Error ? usersQuery.error.message : null,
    threadsQuery.error instanceof Error ? threadsQuery.error.message : null,
    messagesQuery.error instanceof Error ? messagesQuery.error.message : null,
  ].find(Boolean) ?? null

  const sidebar = (
    <ChatSidebar
      me={me}
      currentUid={currentUid}
      threads={threads}
      selectedThreadId={activeThreadId}
      isAdmin={isAdmin}
      canStartDirect={canStartDirect}
      onSelectThread={handleSelectThread}
      onNewChat={() => setNewChatOpen(true)}
      onNewGroup={() => setNewGroupOpen(true)}
      onTogglePin={handleTogglePin}
      onDeleteThread={(thread) => setDeleteTarget(thread)}
      onChangePresence={handlePresenceChange}
    />
  )

  return (
    <Stack spacing={1.5} sx={{ height: '100%', overflow: 'hidden' }}>
      {combinedError ? (
        <Alert severity="error" onClose={() => setActionError(null)}>{combinedError}</Alert>
      ) : null}

      <Box
        ref={chatShellRef}
        sx={{
          display: 'flex',
          gap: 1.5,
          // Measured rather than calculated, so the page fits the screen
          // exactly instead of overflowing by a stray few pixels.
          height: chatShellHeight ? `${chatShellHeight}px` : undefined,
          minHeight: chatShellHeight ? undefined : 480,
          overflow: 'hidden',
        }}
      >
        {isDesktop ? (
          <Paper sx={{ width: sidebarWidth, flexShrink: 0, overflow: 'hidden' }}>
            {sidebar}
          </Paper>
        ) : (
          <Drawer
            open={mobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
            slotProps={{ paper: { sx: { width: sidebarWidth, maxWidth: '86vw' } } }}
          >
            {sidebar}
          </Drawer>
        )}

        <Paper sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ px: { xs: 1.5, md: 2.5 }, py: 1.25, borderBottom: (t) => `1px solid ${t.palette.divider}` }}
          >
            {!isDesktop ? (
              <IconButton onClick={() => setMobileSidebarOpen(true)} aria-label="Open chat list">
                <MenuRoundedIcon />
              </IconButton>
            ) : null}

            {selectedThread ? (
              <ChatAvatar
                size={42}
                name={headerTitle}
                isGroup={selectedThread.type === 'group'}
                imageUrl={selectedPeer?.imageUrl ?? null}
                status={selectedThread.type === 'group' ? null : selectedPeer?.onlineStatus ?? 'offline'}
                colorKey={selectedPeer?.uid ?? selectedThread.id}
              />
            ) : null}

            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                {headerTitle}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                {typingLabel ?? headerSubtitle}
              </Typography>
            </Box>

            {selectedThread ? (
              <>
                <Chip
                  size="small"
                  label={selectedThread.type === 'group' ? 'Group' : 'Direct'}
                  color={selectedThread.type === 'group' ? 'secondary' : 'default'}
                  sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
                />
                {!videoCallsEnabled ? null : selectedThread.activeCall ? (
                  <Button
                    size="small"
                    color="success"
                    variant="contained"
                    startIcon={<VideocamRoundedIcon />}
                    disabled={startCallMutation.isPending}
                    onClick={() => handleStartCall(selectedThread.activeCall?.mode ?? 'video')}
                  >
                    {startCallMutation.isPending ? 'Joining...' : 'Join call'}
                  </Button>
                ) : (
                  <>
                    <Tooltip title="Start a call">
                      <span>
                        <IconButton
                          aria-label="Start a call"
                          disabled={startCallMutation.isPending}
                          onClick={() => handleStartCall('audio')}
                        >
                          <CallRoundedIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Start a video call">
                      <span>
                        <IconButton
                          aria-label="Start a video call"
                          disabled={startCallMutation.isPending}
                          onClick={() => handleStartCall('video')}
                        >
                          <VideocamRoundedIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </>
                )}
                <Tooltip title="Chat details">
                  <IconButton
                    aria-label="Chat details"
                    color={detailsOpen ? 'primary' : 'default'}
                    onClick={() => setDetailsOpen((previous) => !previous)}
                  >
                    <InfoOutlinedIcon />
                  </IconButton>
                </Tooltip>
              </>
            ) : null}
          </Stack>

          <ChatMessageList
            thread={selectedThread}
            messages={messages}
            currentUid={currentUid}
            currentEmail={currentEmail}
            isAdmin={isAdmin}
            isLoading={messagesQuery.isLoading}
            hasMore={Boolean(messagesQuery.data?.hasMore)}
            isLoadingMore={messagesQuery.isFetching && messagesQuery.data?.messages.length !== messages.length}
            onLoadMore={() => setMessageLimit((current) => current + messagesPageStep)}
            typingLabel={typingLabel}
            onReply={(message) => setReplyTo(message)}
            onToggleReaction={(message, emoji) => reactionMutation.mutate({ messageId: message.id, emoji })}
            onDeleteMessage={(message) => {
              if (window.confirm('Delete this message?')) {
                deleteMessageMutation.mutate(message.id)
              }
            }}
          />

          {selectedThread ? (
            <ChatComposer
              isSending={sendMessageMutation.isPending}
              markup={messageMarkup}
              plainText={messageText}
              attachment={attachmentDraft}
              replyTo={replyTo}
              mentionOptions={mentionOptions}
              onChange={(nextMarkup, nextPlainText) => {
                setMessageMarkup(nextMarkup)
                setMessageText(nextPlainText)
              }}
              onSend={handleSend}
              onAttach={(file) => { void handleAttach(file) }}
              onClearAttachment={() => setAttachmentDraft(null)}
              onClearReply={() => setReplyTo(null)}
              onTyping={handleTyping}
            />
          ) : null}
        </Paper>

        {selectedThread && detailsOpen && isDesktop ? (
          <Paper sx={{ width: 320, flexShrink: 0, overflow: 'hidden' }}>
            <ChatDetailsPanel
              thread={selectedThread}
              messages={messages}
              users={users}
              currentUid={currentUid}
              isAdmin={isAdmin}
              isSavingGroup={updateGroupMutation.isPending}
              onClose={() => setDetailsOpen(false)}
              onSaveGroup={(payload) => {
                if (!payload.name || payload.memberUids.length === 0) {
                  setActionError('A group needs a name and at least one member.')
                  return
                }

                updateGroupMutation.mutate({ threadId: selectedThread.id, payload })
              }}
              onTogglePin={handleTogglePin}
              onDeleteThread={(thread) => setDeleteTarget(thread)}
            />
          </Paper>
        ) : null}
      </Box>

      {selectedThread && !isDesktop ? (
        <Drawer
          anchor="right"
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          slotProps={{ paper: { sx: { width: 320, maxWidth: '90vw' } } }}
        >
          <ChatDetailsPanel
            thread={selectedThread}
            messages={messages}
            users={users}
            currentUid={currentUid}
            isAdmin={isAdmin}
            isSavingGroup={updateGroupMutation.isPending}
            onClose={() => setDetailsOpen(false)}
            onSaveGroup={(payload) => {
              if (!payload.name || payload.memberUids.length === 0) {
                setActionError('A group needs a name and at least one member.')
                return
              }

              updateGroupMutation.mutate({ threadId: selectedThread.id, payload })
            }}
            onTogglePin={handleTogglePin}
            onDeleteThread={(thread) => setDeleteTarget(thread)}
          />
        </Drawer>
      ) : null}

      <NewChatDialog
        open={newChatOpen}
        users={otherUsers}
        isPending={createDirectMutation.isPending}
        onClose={() => setNewChatOpen(false)}
        onSelect={(uid) => createDirectMutation.mutate(uid)}
      />

      <NewGroupDialog
        open={newGroupOpen}
        users={otherUsers}
        isPending={createGroupMutation.isPending}
        onClose={() => setNewGroupOpen(false)}
        onCreate={(payload) => createGroupMutation.mutate(payload)}
      />

      <ChatCallWindow
        open={Boolean(callSession)}
        session={callSession}
        threadTitle={headerTitle}
        canEndForEveryone={Boolean(
          selectedThread?.activeCall
          && (isAdmin || selectedThread.activeCall.startedByUid === currentUid),
        )}
        isEnding={endCallMutation.isPending}
        onClose={handleLeaveCall}
        onEndForEveryone={() => {
          if (activeThreadId) {
            endCallMutation.mutate(activeThreadId)
          }
        }}
      />

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleteThreadMutation.isPending) {
            setDeleteTarget(null)
          }
        }}
      >
        <DialogTitle>Delete chat</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete this chat only for you, or clear and remove it for every member?
            Existing messages will not come back if the chat is started again.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteThreadMutation.isPending}>
            Cancel
          </Button>
          <Button
            color="error"
            disabled={!deleteTarget || deleteThreadMutation.isPending}
            onClick={() => {
              if (deleteTarget) {
                deleteThreadMutation.mutate({ threadId: deleteTarget.id, deleteForEveryone: false })
              }
            }}
          >
            Delete for me
          </Button>
          {isAdmin ? (
            <Button
              color="error"
              variant="contained"
              disabled={!deleteTarget || deleteThreadMutation.isPending}
              onClick={() => {
                if (deleteTarget) {
                  deleteThreadMutation.mutate({ threadId: deleteTarget.id, deleteForEveryone: true })
                }
              }}
            >
              Delete for everyone
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

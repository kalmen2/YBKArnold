// The conversation itself: day separators, grouped bubbles, attachments,
// reactions, reply context and delivery ticks.
import AddReactionOutlinedIcon from '@mui/icons-material/AddReactionOutlined'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { CHAT_REACTION_EMOJIS, type AppChatMessage, type AppChatThread } from './api'
import { ChatAvatar } from './ChatAvatar'
import {
  buildMessagePreview,
  canDeleteMessage,
  formatAttachmentSize,
  formatChatDayLabel,
  formatChatTime,
  isMyMessage,
  resolveAttachmentSrc,
} from './chatUi'

function DeliveryTicks({ status }: { status: AppChatMessage['deliveryStatus'] }) {
  if (status === 'sent') {
    return <CheckRoundedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
  }

  return (
    <DoneAllRoundedIcon
      sx={{ fontSize: 14, color: status === 'seen' ? 'primary.main' : 'text.disabled' }}
    />
  )
}

export function ChatMessageList({
  thread,
  messages,
  currentUid,
  currentEmail,
  isAdmin,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  typingLabel,
  onReply,
  onToggleReaction,
  onDeleteMessage,
}: {
  thread: AppChatThread | null
  messages: AppChatMessage[]
  currentUid: string
  currentEmail: string
  isAdmin: boolean
  isLoading: boolean
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  typingLabel: string | null
  onReply: (message: AppChatMessage) => void
  onToggleReaction: (message: AppChatMessage, emoji: string) => void
  onDeleteMessage: (message: AppChatMessage) => void
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [reactionAnchor, setReactionAnchor] = useState<{ el: HTMLElement; message: AppChatMessage } | null>(null)

  const lastMessageId = messages[messages.length - 1]?.id ?? null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lastMessageId, thread?.id, typingLabel])

  // Consecutive messages from the same person collapse into one visual group,
  // and each new calendar day gets a divider.
  const rows = useMemo(() => {
    const built: {
      message: AppChatMessage
      dayLabel: string
      showDayDivider: boolean
      startsGroup: boolean
    }[] = []

    for (const message of messages) {
      const previous = built[built.length - 1]
      const dayLabel = formatChatDayLabel(message.createdAt)
      const senderKey = String(message.createdByUid || message.createdByEmail || 'unknown')
      const previousSenderKey = previous
        ? String(previous.message.createdByUid || previous.message.createdByEmail || 'unknown')
        : ''
      const showDayDivider = dayLabel !== (previous?.dayLabel ?? '')

      built.push({
        message,
        dayLabel,
        showDayDivider,
        startsGroup: showDayDivider || senderKey !== previousSenderKey,
      })
    }

    return built
  }, [messages])

  if (!thread) {
    return (
      <Stack sx={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Typography variant="body2" color="text.secondary">
          Pick a conversation on the left, or start a new one.
        </Typography>
      </Stack>
    )
  }

  if (isLoading && messages.length === 0) {
    return (
      <Stack sx={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={26} />
      </Stack>
    )
  }

  return (
    <Box
      sx={{
        flexGrow: 1,
        minHeight: 0,
        overflowY: 'auto',
        px: { xs: 1.5, md: 3 },
        py: 2,
      }}
    >
      {hasMore ? (
        <Stack alignItems="center" sx={{ mb: 1.5 }}>
          <Button size="small" variant="outlined" disabled={isLoadingMore} onClick={onLoadMore}>
            {isLoadingMore ? 'Loading...' : 'Load earlier messages'}
          </Button>
        </Stack>
      ) : null}

      {messages.length === 0 ? (
        <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No messages yet. Say hello.
          </Typography>
        </Stack>
      ) : null}

      {rows.map(({ message, dayLabel, showDayDivider, startsGroup }) => {
        const mine = isMyMessage(message, currentUid, currentEmail)
        const deleted = Boolean(message.deletedAt || message.messageType === 'deleted')
        const attachment = message.attachment
        const attachmentSrc = resolveAttachmentSrc(attachment)
        const senderLabel = mine ? 'You' : message.createdByName || message.createdByEmail || 'Teammate'
        const canDelete = !deleted && canDeleteMessage(message, currentUid, currentEmail, isAdmin)

        return (
          <Fragment key={message.id}>
            {showDayDivider ? (
              <Divider sx={{ my: 1.75 }}>
                <Chip size="small" label={dayLabel} sx={{ fontWeight: 600 }} />
              </Divider>
            ) : null}

            <Stack
              direction="row"
              spacing={1}
              sx={{
                mt: startsGroup ? 1.25 : 0.25,
                justifyContent: mine ? 'flex-end' : 'flex-start',
                alignItems: 'flex-end',
                '&:hover .chat-message-actions': { opacity: 1 },
              }}
            >
              {!mine ? (
                <Box sx={{ width: 30, flexShrink: 0 }}>
                  {startsGroup ? (
                    <ChatAvatar
                      size={30}
                      name={senderLabel}
                      colorKey={message.createdByUid ?? message.createdByEmail}
                    />
                  ) : null}
                </Box>
              ) : null}

              <Box sx={{ maxWidth: { xs: '84%', md: '68%' }, minWidth: 0 }}>
                {startsGroup && !mine && thread.type === 'group' ? (
                  <Typography variant="caption" sx={{ ml: 1, fontWeight: 700, color: 'text.secondary' }}>
                    {senderLabel}
                  </Typography>
                ) : null}

                <Paper
                  sx={{
                    px: 1.25,
                    py: 0.85,
                    // Explicit pixels: theme.shape.borderRadius is 14, so a
                    // numeric shorthand here would render a pill.
                    borderRadius: '10px',
                    borderTopRightRadius: mine && startsGroup ? '4px' : undefined,
                    borderTopLeftRadius: !mine && startsGroup ? '4px' : undefined,
                    bgcolor: (theme) => (mine
                      ? alpha(theme.palette.primary.main, 0.1)
                      : theme.palette.background.paper),
                    borderColor: (theme) => (mine
                      ? alpha(theme.palette.primary.main, 0.25)
                      : theme.palette.divider),
                    boxShadow: 'none',
                  }}
                >
                  {message.replyTo ? (
                    <Box
                      sx={{
                        mb: 0.6,
                        px: 0.9,
                        py: 0.4,
                        borderLeft: (theme) => `3px solid ${theme.palette.primary.main}`,
                        borderRadius: '6px',
                        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.06),
                      }}
                    >
                      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                        {message.replyTo.createdByName || message.replyTo.createdByEmail || 'Teammate'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                        {buildMessagePreview(message.replyTo)}
                      </Typography>
                    </Box>
                  ) : null}

                  {deleted ? (
                    <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                      Message deleted.
                    </Typography>
                  ) : null}

                  {!deleted && message.text ? (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {message.text}
                    </Typography>
                  ) : null}

                  {!deleted && attachment?.kind === 'image' && attachmentSrc ? (
                    <Box
                      component="img"
                      src={attachmentSrc}
                      alt={attachment.fileName || 'Chat image'}
                      loading="lazy"
                      decoding="async"
                      sx={{
                        mt: message.text ? 1 : 0,
                        display: 'block',
                        width: '100%',
                        maxWidth: 320,
                        maxHeight: 300,
                        objectFit: 'cover',
                        borderRadius: '8px',
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                      }}
                    />
                  ) : null}

                  {!deleted && attachment?.kind === 'voice' && attachmentSrc ? (
                    <Box
                      component="audio"
                      controls
                      preload="none"
                      src={attachmentSrc}
                      sx={{ mt: message.text ? 1 : 0, width: 260, maxWidth: '100%' }}
                    />
                  ) : null}

                  {!deleted && attachment?.kind === 'file' && attachmentSrc ? (
                    <Button
                      component="a"
                      href={attachmentSrc}
                      download={attachment.fileName || 'attachment'}
                      size="small"
                      variant="outlined"
                      startIcon={<InsertDriveFileOutlinedIcon />}
                      sx={{ mt: message.text ? 1 : 0, maxWidth: '100%' }}
                    >
                      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {attachment.fileName || 'Download file'}
                        {formatAttachmentSize(attachment.sizeBytes)
                          ? ` · ${formatAttachmentSize(attachment.sizeBytes)}`
                          : ''}
                      </Box>
                    </Button>
                  ) : null}

                  <Stack
                    direction="row"
                    spacing={0.5}
                    alignItems="center"
                    justifyContent="flex-end"
                    sx={{ mt: 0.2 }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                      {formatChatTime(message.createdAt)}
                    </Typography>
                    {mine && !deleted ? <DeliveryTicks status={message.deliveryStatus} /> : null}
                  </Stack>
                </Paper>

                {message.reactions.length > 0 ? (
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ mt: 0.5, justifyContent: mine ? 'flex-end' : 'flex-start', flexWrap: 'wrap' }}
                  >
                    {message.reactions.map((reaction) => (
                      <Chip
                        key={reaction.emoji}
                        size="small"
                        label={`${reaction.emoji} ${reaction.count}`}
                        variant={reaction.reactedByMe ? 'filled' : 'outlined'}
                        color={reaction.reactedByMe ? 'primary' : 'default'}
                        onClick={() => onToggleReaction(message, reaction.emoji)}
                        sx={{ height: 24, fontSize: 12 }}
                      />
                    ))}
                  </Stack>
                ) : null}
              </Box>

              <Stack
                className="chat-message-actions"
                direction="row"
                spacing={0.25}
                sx={{ opacity: 0, transition: 'opacity 120ms ease', flexShrink: 0 }}
              >
                {!deleted ? (
                  <Tooltip title="React">
                    <IconButton
                      size="small"
                      onClick={(event) => setReactionAnchor({ el: event.currentTarget, message })}
                    >
                      <AddReactionOutlinedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                ) : null}
                {!deleted ? (
                  <Tooltip title="Reply">
                    <IconButton size="small" onClick={() => onReply(message)}>
                      <ReplyRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                ) : null}
                {canDelete ? (
                  <Tooltip title="Delete message">
                    <IconButton size="small" color="error" onClick={() => onDeleteMessage(message)}>
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </Stack>
            </Stack>
          </Fragment>
        )
      })}

      {typingLabel ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, ml: 5 }}>
          {typingLabel}
        </Typography>
      ) : null}

      <Box ref={bottomRef} />

      <Menu
        anchorEl={reactionAnchor?.el ?? null}
        open={Boolean(reactionAnchor)}
        onClose={() => setReactionAnchor(null)}
        slotProps={{ list: { sx: { display: 'flex', p: 0.5 } } }}
      >
        {CHAT_REACTION_EMOJIS.map((emoji) => (
          <MenuItem
            key={emoji}
            onClick={() => {
              if (reactionAnchor) {
                onToggleReaction(reactionAnchor.message, emoji)
              }
              setReactionAnchor(null)
            }}
            sx={{ fontSize: 18, minWidth: 0, borderRadius: '8px', px: 1 }}
          >
            {emoji}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}

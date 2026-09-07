// Composer: reply context, attachment draft, @mentions, emoji and send.
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import MoodRoundedIcon from '@mui/icons-material/MoodRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Box,
  Chip,
  ClickAwayListener,
  IconButton,
  Paper,
  Popper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useRef, useState } from 'react'
import { Mention, MentionsInput } from 'react-mentions'
import type { AppChatAttachmentKind, AppChatMessage } from './api'
import { ChatEmojiPicker } from './ChatEmojiPicker'
import { buildMessagePreview, formatAttachmentSize } from './chatUi'

export type ChatAttachmentDraft = {
  kind: AppChatAttachmentKind
  dataUrl: string
  mimeType: string
  fileName: string
  sizeBytes: number
}

const mentionsInputStyle = {
  control: {
    width: '100%',
    fontFamily: 'inherit',
    fontSize: 14,
    lineHeight: 1.5,
  },
  '&multiLine': {
    control: {
      minHeight: 44,
      maxHeight: 160,
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
      minHeight: 44,
      border: 0,
      outline: 0,
      boxSizing: 'border-box',
      fontFamily: 'inherit',
      fontSize: 14,
      lineHeight: 1.5,
      color: '#10243d',
      backgroundColor: 'transparent',
    },
  },
  suggestions: {
    list: {
      zIndex: 1600,
      backgroundColor: '#fff',
      border: '1px solid rgba(16, 36, 61, 0.16)',
      borderRadius: 10,
      boxShadow: '0 12px 30px rgba(16, 36, 61, 0.18)',
      maxHeight: 240,
      overflowY: 'auto',
      padding: 4,
      fontSize: 14,
    },
    item: {
      padding: '8px 10px',
      borderRadius: 6,
      '&focused': {
        backgroundColor: 'rgba(31, 111, 235, 0.12)',
      },
    },
  },
} as const

export function ChatComposer({
  isSending,
  markup,
  plainText,
  attachment,
  replyTo,
  mentionOptions,
  onChange,
  onSend,
  onAttach,
  onClearAttachment,
  onClearReply,
  onTyping,
}: {
  isSending: boolean
  markup: string
  plainText: string
  attachment: ChatAttachmentDraft | null
  replyTo: AppChatMessage | null
  mentionOptions: { id: string; display: string }[]
  onChange: (markup: string, plainText: string) => void
  onSend: () => void
  onAttach: (file: File) => void
  onClearAttachment: () => void
  onClearReply: () => void
  onTyping: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [emojiAnchorEl, setEmojiAnchorEl] = useState<HTMLElement | null>(null)
  const canSend = Boolean(plainText.trim() || attachment) && !isSending

  return (
    <Box
      sx={{
        px: { xs: 1.5, md: 2.5 },
        py: 1.25,
        borderTop: (theme) => `1px solid ${theme.palette.divider}`,
      }}
    >
      {replyTo ? (
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{
            mb: 0.75,
            px: 1.1,
            py: 0.6,
            borderRadius: '8px',
            borderLeft: (theme) => `3px solid ${theme.palette.primary.main}`,
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.07),
          }}
        >
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
              Replying to {replyTo.createdByName || replyTo.createdByEmail || 'teammate'}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {buildMessagePreview(replyTo)}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClearReply} aria-label="Cancel reply">
            <CloseRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Stack>
      ) : null}

      {attachment ? (
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.25}
          sx={{
            mb: 0.75,
            p: 0.85,
            borderRadius: '8px',
            border: (theme) => `1px solid ${theme.palette.divider}`,
            bgcolor: 'background.default',
          }}
        >
          {attachment.kind === 'image' ? (
            <Box
              component="img"
              src={attachment.dataUrl}
              alt={attachment.fileName}
              sx={{ width: 42, height: 42, objectFit: 'cover', borderRadius: '6px' }}
            />
          ) : (
            <Chip
              size="small"
              label={attachment.kind === 'voice' ? 'Voice note' : 'File'}
              color="primary"
              variant="outlined"
            />
          )}

          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
              {attachment.fileName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatAttachmentSize(attachment.sizeBytes)}
            </Typography>
          </Box>

          <IconButton size="small" onClick={onClearAttachment} aria-label="Remove attachment">
            <CloseRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Stack>
      ) : null}

      <Stack direction="row" spacing={0.5} alignItems="flex-end">
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null
            event.target.value = ''

            if (file) {
              onAttach(file)
            }
          }}
        />

        <Tooltip title="Attach a photo, voice note or file">
          <span>
            <IconButton
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach file"
            >
              <AttachFileRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Emoji">
          <span>
            <IconButton
              aria-label="Insert emoji"
              onClick={(event) => setEmojiAnchorEl(emojiAnchorEl ? null : event.currentTarget)}
            >
              <MoodRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>

        <Paper
          sx={{
            flexGrow: 1,
            minWidth: 0,
            px: 0.5,
            borderRadius: '12px',
            bgcolor: 'background.default',
          }}
        >
          <MentionsInput
            value={markup}
            allowSuggestionsAboveCursor
            style={mentionsInputStyle}
            placeholder="Write a message. Use @ to tag a teammate, or @all for everyone."
            onChange={(_event, nextMarkup, nextPlainText) => {
              onChange(nextMarkup, nextPlainText)
              onTyping()
            }}
            onKeyDown={(event) => {
              // react-mentions only forwards keys when its suggestion overlay
              // is closed, so Enter here always means "send", never "pick".
              if (event.key !== 'Enter' || event.shiftKey) {
                return
              }

              event.preventDefault()

              if (canSend) {
                onSend()
              }
            }}
          >
            <Mention
              trigger="@"
              markup="@[__display__](__id__)"
              displayTransform={(_id, display) => `@${display}`}
              data={mentionOptions}
              appendSpaceOnAdd
              style={{ backgroundColor: 'rgba(31, 111, 235, 0.16)', borderRadius: 4 }}
            />
          </MentionsInput>
        </Paper>

        <Tooltip title="Send">
          <span>
            <IconButton
              color="primary"
              disabled={!canSend}
              onClick={onSend}
              aria-label="Send message"
              sx={{
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
                '&:hover': { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.2) },
              }}
            >
              <SendRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Popper
        open={Boolean(emojiAnchorEl)}
        anchorEl={emojiAnchorEl}
        placement="top-start"
        sx={{ zIndex: 1400 }}
      >
        <ClickAwayListener onClickAway={() => setEmojiAnchorEl(null)}>
          <Paper sx={{ mb: 1, overflow: 'hidden', boxShadow: '0 16px 40px rgba(16,36,61,0.18)' }}>
            <ChatEmojiPicker
              onSelect={(emoji) => {
                onChange(`${markup}${emoji}`, `${plainText}${emoji}`)
              }}
            />
          </Paper>
        </ClickAwayListener>
      </Popper>
    </Box>
  )
}

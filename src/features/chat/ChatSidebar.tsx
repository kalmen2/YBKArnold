// Left rail: who I am, my presence, search, the two create actions, and the
// thread list with unread badges.
import AddCommentRoundedIcon from '@mui/icons-material/AddCommentRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import NotificationsOffRoundedIcon from '@mui/icons-material/NotificationsOffRounded'
import GroupAddRoundedIcon from '@mui/icons-material/GroupAddRounded'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Badge,
  Box,
  Button,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type { AppChatPresenceStatus, AppChatThread, AppChatUser } from './api'
import { ChatAvatar, PresenceDot } from './ChatAvatar'
import { isChatSoundMuted, playChatChime, setChatSoundMuted } from './chatNotifications'
import {
  buildThreadTitle,
  chatPresenceLabels,
  findThreadPeer,
  formatChatListTime,
  resolveUserLabel,
} from './chatUi'

export function ChatSidebar({
  me,
  currentUid,
  threads,
  selectedThreadId,
  isAdmin,
  canStartDirect,
  onSelectThread,
  onNewChat,
  onNewGroup,
  onTogglePin,
  onDeleteThread,
  onChangePresence,
}: {
  me: AppChatUser | null
  currentUid: string
  threads: AppChatThread[]
  selectedThreadId: string | null
  isAdmin: boolean
  canStartDirect: boolean
  onSelectThread: (threadId: string) => void
  onNewChat: () => void
  onNewGroup: () => void
  onTogglePin: (thread: AppChatThread) => void
  onDeleteThread: (thread: AppChatThread) => void
  onChangePresence: (status: AppChatPresenceStatus) => void
}) {
  const [search, setSearch] = useState('')
  const [presenceAnchorEl, setPresenceAnchorEl] = useState<HTMLElement | null>(null)
  const [soundMuted, setSoundMuted] = useState(() => isChatSoundMuted())

  const filteredThreads = useMemo(() => {
    const needle = search.trim().toLowerCase()

    if (!needle) {
      return threads
    }

    return threads.filter((thread) => {
      const title = buildThreadTitle(thread, currentUid).toLowerCase()
      const members = thread.memberProfiles
        .map((member) => `${member.displayName ?? ''} ${member.email}`.toLowerCase())
        .join(' ')
      const preview = String(thread.lastMessagePreview ?? '').toLowerCase()

      return title.includes(needle) || members.includes(needle) || preview.includes(needle)
    })
  }, [currentUid, search, threads])

  const myStatus: AppChatPresenceStatus = me?.onlineStatus ?? 'available'

  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Stack spacing={1.5} sx={{ p: 1.75, pb: 1.25 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <ChatAvatar
            name={resolveUserLabel(me)}
            imageUrl={me?.imageUrl ?? null}
            status={myStatus}
            colorKey={me?.uid ?? null}
          />

          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {resolveUserLabel(me)}
            </Typography>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <PresenceDot status={myStatus} size={8} />
              <Typography variant="caption" color="text.secondary">
                {chatPresenceLabels[myStatus]}
              </Typography>
            </Stack>
          </Box>

          <Tooltip title={soundMuted ? 'Message sound is off' : 'Message sound is on'}>
            <IconButton
              size="small"
              aria-label={soundMuted ? 'Turn message sound on' : 'Turn message sound off'}
              onClick={() => {
                const nextMuted = !soundMuted
                setChatSoundMuted(nextMuted)
                setSoundMuted(nextMuted)

                // Play the chime when switching it back on, so they hear what
                // they just enabled.
                if (!nextMuted) {
                  playChatChime()
                }
              }}
            >
              {soundMuted
                ? <NotificationsOffRoundedIcon fontSize="small" />
                : <NotificationsActiveRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>

          <Tooltip title="Set your status">
            <IconButton
              size="small"
              aria-label="Set your chat status"
              onClick={(event) => setPresenceAnchorEl(event.currentTarget)}
            >
              <ExpandMoreRoundedIcon />
            </IconButton>
          </Tooltip>

          <Menu
            anchorEl={presenceAnchorEl}
            open={Boolean(presenceAnchorEl)}
            onClose={() => setPresenceAnchorEl(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {(['available', 'do_not_disturb', 'offline'] as AppChatPresenceStatus[]).map((status) => (
              <MenuItem
                key={status}
                selected={status === myStatus}
                onClick={() => {
                  onChangePresence(status)
                  setPresenceAnchorEl(null)
                }}
              >
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <PresenceDot status={status} size={9} />
                  <span>{chatPresenceLabels[status]}</span>
                </Stack>
              </MenuItem>
            ))}
          </Menu>
        </Stack>

        <TextField
          size="small"
          fullWidth
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search people and chats"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />

        <Stack direction="row" spacing={1}>
          <Button
            fullWidth
            size="small"
            variant="contained"
            startIcon={<AddCommentRoundedIcon />}
            onClick={onNewChat}
            disabled={!canStartDirect}
          >
            New chat
          </Button>

          {isAdmin ? (
            <Button
              fullWidth
              size="small"
              variant="outlined"
              startIcon={<GroupAddRoundedIcon />}
              onClick={onNewGroup}
            >
              New group
            </Button>
          ) : null}
        </Stack>
      </Stack>

      <List sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', px: 1, py: 0 }}>
        {filteredThreads.length === 0 ? (
          <Box sx={{ px: 1.5, py: 3 }}>
            <Typography variant="body2" color="text.secondary">
              {threads.length === 0
                ? canStartDirect
                  ? 'No chats yet. Start one with New chat.'
                  : 'Your conversations appear here once a teammate adds you.'
                : 'No chats match that search.'}
            </Typography>
          </Box>
        ) : filteredThreads.map((thread) => {
          const isSelected = thread.id === selectedThreadId
          const peer = findThreadPeer(thread, currentUid)
          const title = buildThreadTitle(thread, currentUid)
          const preview = thread.lastMessagePreview
            || (thread.type === 'group' ? `${thread.memberUids.length} members` : 'No messages yet')

          return (
            <ListItemButton
              key={thread.id}
              selected={isSelected}
              onClick={() => onSelectThread(thread.id)}
              sx={{
                borderRadius: '10px',
                mb: 0.35,
                px: 1.1,
                py: 0.85,
                gap: 1.25,
                alignItems: 'flex-start',
                '&.Mui-selected': {
                  backgroundColor: (theme) => theme.palette.action.selected,
                },
                '&:hover .chat-thread-actions': { opacity: 1 },
              }}
            >
              <ChatAvatar
                name={title}
                size={38}
                isGroup={thread.type === 'group'}
                imageUrl={peer?.imageUrl ?? null}
                status={thread.type === 'group' ? null : peer?.onlineStatus ?? 'offline'}
                colorKey={peer?.uid ?? thread.id}
              />

              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Typography
                    noWrap
                    variant="subtitle2"
                    sx={{ fontWeight: thread.unreadCount > 0 ? 800 : 600, flexGrow: 1, minWidth: 0 }}
                  >
                    {title}
                  </Typography>
                  {thread.pinned ? (
                    <PushPinRoundedIcon sx={{ fontSize: 14, color: 'primary.main' }} />
                  ) : null}
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {formatChatListTime(thread.lastMessageAt)}
                  </Typography>
                </Stack>

                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography
                    noWrap
                    variant="body2"
                    color={thread.unreadCount > 0 ? 'text.primary' : 'text.secondary'}
                    sx={{ flexGrow: 1, minWidth: 0, fontWeight: thread.unreadCount > 0 ? 600 : 400 }}
                  >
                    {preview}
                  </Typography>

                  {thread.unreadCount > 0 ? (
                    <Badge
                      badgeContent={thread.unreadCount > 99 ? '99+' : thread.unreadCount}
                      color="primary"
                      sx={{ mr: 1.5, '& .MuiBadge-badge': { position: 'static', transform: 'none' } }}
                    />
                  ) : null}
                </Stack>

                <Stack
                  className="chat-thread-actions"
                  direction="row"
                  spacing={0.25}
                  sx={{ opacity: 0, transition: 'opacity 120ms ease', mt: 0.25, ml: -0.75 }}
                >
                  <Tooltip title={thread.pinned ? 'Unpin chat' : 'Pin chat'}>
                    <IconButton
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation()
                        onTogglePin(thread)
                      }}
                    >
                      {thread.pinned
                        ? <PushPinRoundedIcon sx={{ fontSize: 15 }} color="primary" />
                        : <PushPinOutlinedIcon sx={{ fontSize: 15 }} />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete chat">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteThread(thread)
                      }}
                    >
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>
            </ListItemButton>
          )
        })}
      </List>
    </Stack>
  )
}

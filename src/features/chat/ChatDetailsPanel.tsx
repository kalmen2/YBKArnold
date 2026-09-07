// Right rail: who is in this conversation, admin-only group editing, shared
// attachments, and the pin / delete controls for the open thread.
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import type { AppChatMessage, AppChatThread, AppChatUser } from './api'
import { ChatAvatar } from './ChatAvatar'
import {
  buildThreadTitle,
  formatAttachmentSize,
  formatLastSeen,
  resolveAttachmentSrc,
  resolveUserLabel,
} from './chatUi'

export function ChatDetailsPanel({
  thread,
  messages,
  users,
  currentUid,
  isAdmin,
  isSavingGroup,
  onClose,
  onSaveGroup,
  onTogglePin,
  onDeleteThread,
}: {
  thread: AppChatThread
  messages: AppChatMessage[]
  users: AppChatUser[]
  currentUid: string
  isAdmin: boolean
  isSavingGroup: boolean
  onClose: () => void
  onSaveGroup: (input: { name: string; memberUids: string[] }) => void
  onTogglePin: (thread: AppChatThread) => void
  onDeleteThread: (thread: AppChatThread) => void
}) {
  const [groupName, setGroupName] = useState(thread.name ?? '')
  const [memberUids, setMemberUids] = useState<string[]>(thread.memberUids)
  const [draftThreadId, setDraftThreadId] = useState(thread.id)

  // Switching threads re-seeds the group draft from the new thread.
  if (draftThreadId !== thread.id) {
    setDraftThreadId(thread.id)
    setGroupName(thread.name ?? '')
    setMemberUids(thread.memberUids)
  }

  const isGroup = thread.type === 'group'
  const canEditGroup = isGroup && isAdmin
  const memberOptions = users.filter((user) => user.uid !== currentUid)
  const selectedMembers = memberOptions.filter((user) => memberUids.includes(user.uid))
  const sharedAttachments = messages
    .filter((message) => !message.deletedAt && resolveAttachmentSrc(message.attachment))
    .slice(-12)
    .reverse()

  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ p: 1.5, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>
          Chat details
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label="Close chat details">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
        <Stack alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <ChatAvatar
            size={64}
            isGroup={isGroup}
            name={buildThreadTitle(thread, currentUid)}
            colorKey={thread.id}
          />
          <Typography variant="subtitle1" sx={{ fontWeight: 700, textAlign: 'center' }}>
            {buildThreadTitle(thread, currentUid)}
          </Typography>
          <Chip
            size="small"
            label={isGroup ? `Group · ${thread.memberUids.length} members` : 'Direct chat'}
            color={isGroup ? 'secondary' : 'default'}
          />
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button
            fullWidth
            size="small"
            variant="outlined"
            startIcon={thread.pinned ? <PushPinRoundedIcon /> : <PushPinOutlinedIcon />}
            onClick={() => onTogglePin(thread)}
          >
            {thread.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            fullWidth
            size="small"
            variant="outlined"
            color="error"
            startIcon={<DeleteOutlineRoundedIcon />}
            onClick={() => onDeleteThread(thread)}
          >
            Delete
          </Button>
        </Stack>

        {canEditGroup ? (
          <>
            <Divider sx={{ mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary">Group settings</Typography>
            </Divider>

            <Stack spacing={1.25} sx={{ mb: 2 }}>
              <TextField
                size="small"
                label="Group name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
              />

              <Autocomplete
                multiple
                size="small"
                options={memberOptions}
                value={selectedMembers}
                onChange={(_event, value) => setMemberUids(value.map((user) => user.uid))}
                getOptionLabel={(option) => resolveUserLabel(option)}
                isOptionEqualToValue={(option, value) => option.uid === value.uid}
                renderInput={(params) => (
                  <TextField {...params} label="Members" placeholder="Add a worker" />
                )}
              />

              <Button
                size="small"
                variant="contained"
                disabled={isSavingGroup}
                onClick={() => onSaveGroup({ name: groupName.trim(), memberUids })}
              >
                {isSavingGroup ? 'Saving...' : 'Save group'}
              </Button>
            </Stack>
          </>
        ) : null}

        <Divider sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {isGroup ? 'Members' : 'People'}
          </Typography>
        </Divider>

        <Stack spacing={1} sx={{ mb: 2 }}>
          {thread.memberProfiles.map((member) => (
            <Stack key={member.uid} direction="row" spacing={1.25} alignItems="center">
              <ChatAvatar
                size={32}
                name={resolveUserLabel(member)}
                imageUrl={member.imageUrl}
                status={member.onlineStatus}
                colorKey={member.uid}
              />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {resolveUserLabel(member)}
                  {member.uid === currentUid ? ' (you)' : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                  {formatLastSeen(member)}
                </Typography>
              </Box>
              {member.isAdmin ? <Chip size="small" label="Admin" variant="outlined" /> : null}
            </Stack>
          ))}
        </Stack>

        {sharedAttachments.length > 0 ? (
          <>
            <Divider sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary">Shared files</Typography>
            </Divider>

            <Stack spacing={0.75}>
              {sharedAttachments.map((message) => {
                const attachment = message.attachment
                const attachmentSrc = resolveAttachmentSrc(attachment)

                if (!attachment || !attachmentSrc) {
                  return null
                }

                return (
                  <Stack
                    key={message.id}
                    component="a"
                    href={attachmentSrc}
                    download={attachment.fileName || 'attachment'}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    {attachment.kind === 'image' ? (
                      <Box
                        component="img"
                        src={attachmentSrc}
                        alt={attachment.fileName || 'Shared image'}
                        loading="lazy"
                        decoding="async"
                        sx={{ width: 34, height: 34, borderRadius: '6px', objectFit: 'cover' }}
                      />
                    ) : (
                      <Chip size="small" label={attachment.kind === 'voice' ? 'Audio' : 'File'} />
                    )}
                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 600 }}>
                        {attachment.fileName || 'Attachment'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatAttachmentSize(attachment.sizeBytes)}
                      </Typography>
                    </Box>
                  </Stack>
                )
              })}
            </Stack>
          </>
        ) : null}
      </Box>
    </Stack>
  )
}

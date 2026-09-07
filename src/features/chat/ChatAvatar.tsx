// Avatar with a presence dot. Groups get an icon, people get their photo or
// tinted initials, and the dot is only drawn when we actually know a status.
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import { Avatar, Badge, Box, Tooltip } from '@mui/material'
import type { AppChatPresenceStatus } from './api'
import { avatarColorFromKey, resolveInitials } from './chatUi'

const presenceColors: Record<AppChatPresenceStatus, string> = {
  available: '#2e9c62',
  do_not_disturb: '#e0a325',
  offline: '#9aa8ba',
}

const presenceTitles: Record<AppChatPresenceStatus, string> = {
  available: 'Available',
  do_not_disturb: 'Do not disturb',
  offline: 'Offline',
}

export function PresenceDot({
  status,
  size = 10,
}: {
  status: AppChatPresenceStatus
  size?: number
}) {
  return (
    <Tooltip title={presenceTitles[status]}>
      <Box
        component="span"
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          display: 'inline-block',
          backgroundColor: presenceColors[status],
          border: '2px solid #ffffff',
          boxSizing: 'content-box',
        }}
      />
    </Tooltip>
  )
}

export function ChatAvatar({
  name,
  imageUrl = null,
  status = null,
  isGroup = false,
  size = 40,
  colorKey = null,
}: {
  name: string
  imageUrl?: string | null
  status?: AppChatPresenceStatus | null
  isGroup?: boolean
  size?: number
  colorKey?: string | null
}) {
  const background = isGroup ? '#4b6179' : avatarColorFromKey(colorKey ?? name)

  const avatar = (
    <Avatar
      alt={name}
      src={imageUrl || undefined}
      sx={{
        width: size,
        height: size,
        bgcolor: background,
        color: '#ffffff',
        fontSize: Math.max(11, Math.round(size * 0.36)),
        fontWeight: 700,
      }}
    >
      {isGroup ? <GroupsRoundedIcon sx={{ fontSize: Math.round(size * 0.55) }} /> : resolveInitials(name)}
    </Avatar>
  )

  if (!status) {
    return avatar
  }

  return (
    <Badge
      overlap="circular"
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      badgeContent={<PresenceDot status={status} size={Math.max(8, Math.round(size * 0.22))} />}
    >
      {avatar}
    </Badge>
  )
}

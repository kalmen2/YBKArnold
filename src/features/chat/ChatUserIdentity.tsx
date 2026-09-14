// One person, shown the same way everywhere they can be picked or listed.
//
// The email is what makes the row usable: two workers can share a display name,
// and without it there is no way to tell which one you are about to message.
import { Box, Stack, Tooltip, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import type { AppChatUser } from './api'
import { ChatAvatar } from './ChatAvatar'
import { resolveUserLabel } from './chatUi'

type ChatUserIdentityUser = Pick<
  AppChatUser,
  'uid' | 'displayName' | 'email' | 'imageUrl' | 'onlineStatus'
>

export function ChatUserIdentity({
  user,
  size = 32,
  nameSuffix = '',
  tooltip,
  children,
}: {
  user: ChatUserIdentityUser
  size?: number
  nameSuffix?: string
  /** Extra detail — last seen, say — that has no room on the row itself. */
  tooltip?: string
  /** Trailing content, such as an Admin chip. */
  children?: ReactNode
}) {
  const label = resolveUserLabel(user)
  const email = String(user.email ?? '').trim()
  // When someone has no display name the label already IS their email, so
  // repeating it underneath would just be noise.
  const showEmail = Boolean(email) && email !== label

  const row = (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
      <ChatAvatar
        size={size}
        name={label}
        imageUrl={user.imageUrl}
        status={user.onlineStatus}
        colorKey={user.uid}
      />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          {`${label}${nameSuffix}`}
        </Typography>
        {showEmail ? (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {email}
          </Typography>
        ) : null}
      </Box>
      {children}
    </Stack>
  )

  if (!tooltip) {
    return row
  }

  return (
    <Tooltip title={tooltip} placement="left" enterDelay={400}>
      {row}
    </Tooltip>
  )
}

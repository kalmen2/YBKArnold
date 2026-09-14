// Right rail, tasks mode. Shares the shell of ChatDetailsPanel so switching
// between Info and Tasks swaps only the contents, never the frame.
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { Box, IconButton, Stack, Typography } from '@mui/material'
import type { AppChatThread } from './api'
import { ChatTaskList } from './ChatTaskList'
import { buildThreadTitle } from './chatUi'

export function ChatTasksPanel({
  thread,
  currentUid,
  onClose,
}: {
  thread: AppChatThread
  currentUid: string
  onClose: () => void
}) {
  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ p: 1.5, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Tasks
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {buildThreadTitle(thread, currentUid)}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close tasks">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
        <ChatTaskList threadId={thread.id} currentUid={currentUid} />
      </Box>
    </Stack>
  )
}

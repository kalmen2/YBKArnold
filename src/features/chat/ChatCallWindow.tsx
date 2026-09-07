// The call, rendered as real React components rather than a vendor iframe —
// so it inherits our theme instead of sitting in a foreign box.
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRemoteParticipants,
  VideoConference,
} from '@livekit/components-react'
import '@livekit/components-styles'
import { useEffect, useState } from 'react'
import type { AppChatCall } from './api'

export type ChatCallSession = {
  call: AppChatCall
  url: string
  token: string
}

const ALONE_GRACE_SECONDS = 20
const ALONE_COUNTDOWN_SECONDS = 15

// Sitting alone in a room you started is the "nobody answered" case. After a
// grace period we ask whether to keep waiting, and leave if there is no
// answer — otherwise an unanswered call quietly stays open all day.
function AloneWatcher({ onLeave }: { onLeave: () => void }) {
  const remoteParticipants = useRemoteParticipants()
  const isAlone = remoteParticipants.length === 0
  const [promptVisible, setPromptVisible] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(ALONE_COUNTDOWN_SECONDS)

  const [wasAlone, setWasAlone] = useState(isAlone)

  // Someone joining dismisses the prompt immediately.
  if (wasAlone !== isAlone) {
    setWasAlone(isAlone)

    if (!isAlone) {
      setPromptVisible(false)
    }
  }

  useEffect(() => {
    if (!isAlone) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSecondsLeft(ALONE_COUNTDOWN_SECONDS)
      setPromptVisible(true)
    }, ALONE_GRACE_SECONDS * 1000)

    return () => window.clearTimeout(timeoutId)
  }, [isAlone])

  useEffect(() => {
    if (!promptVisible) {
      return
    }

    const intervalId = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [promptVisible])

  useEffect(() => {
    if (promptVisible && secondsLeft === 0) {
      onLeave()
    }
  }, [onLeave, promptVisible, secondsLeft])

  return (
    <Dialog open={promptVisible} onClose={() => setPromptVisible(false)} maxWidth="xs" fullWidth>
      <DialogContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
          Nobody has joined yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Stay in the call and keep waiting, or leave. Leaving automatically in {secondsLeft}s.
        </Typography>
        <LinearProgress
          variant="determinate"
          value={(secondsLeft / ALONE_COUNTDOWN_SECONDS) * 100}
          sx={{ mt: 1.5 }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button fullWidth color="inherit" variant="outlined" onClick={onLeave}>
          Leave
        </Button>
        <Button fullWidth variant="contained" onClick={() => setPromptVisible(false)}>
          Stay in call
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function ChatCallWindow({
  open,
  session,
  threadTitle,
  canEndForEveryone,
  isEnding,
  onClose,
  onEndForEveryone,
}: {
  open: boolean
  session: ChatCallSession | null
  threadTitle: string
  canEndForEveryone: boolean
  isEnding: boolean
  onClose: () => void
  onEndForEveryone: () => void
}) {
  return (
    <Dialog
      open={open && Boolean(session)}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      slotProps={{
        paper: { sx: { height: 'min(88vh, 820px)', display: 'flex', flexDirection: 'column' } },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, py: 1.25, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}
      >
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 800 }}>
            {session?.call.mode === 'audio' ? 'Call' : 'Video call'} · {threadTitle}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {session?.call.startedByName ? `Started by ${session.call.startedByName}` : 'In progress'}
          </Typography>
        </Box>

        {canEndForEveryone ? (
          <Button
            size="small"
            color="error"
            variant="outlined"
            startIcon={<CallEndRoundedIcon />}
            disabled={isEnding}
            onClick={onEndForEveryone}
          >
            {isEnding ? 'Ending...' : 'End for everyone'}
          </Button>
        ) : null}

        <Tooltip title="Leave call">
          <IconButton size="small" onClick={onClose} aria-label="Leave call">
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {session ? (
        <Box sx={{ flexGrow: 1, minHeight: 0, '& [data-lk-theme]': { height: '100%' } }}>
          <LiveKitRoom
            token={session.token}
            serverUrl={session.url}
            connect
            // An audio call still joins with the mic on, just no camera.
            video={session.call.mode === 'video'}
            audio
            // Leaving the call closes the window, so hanging up inside the
            // call UI and closing the dialog do the same thing.
            onDisconnected={onClose}
            data-lk-theme="default"
            style={{ height: '100%' }}
          >
            <VideoConference />
            <RoomAudioRenderer />
            <AloneWatcher onLeave={onClose} />
          </LiveKitRoom>
        </Box>
      ) : null}
    </Dialog>
  )
}

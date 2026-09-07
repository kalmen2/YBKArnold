// The ringing popup. Auto-declines on a visible countdown so an unanswered
// call stops ringing on its own instead of nagging forever.
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded'
import CallRoundedIcon from '@mui/icons-material/CallRounded'
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import type { AppChatCall } from './api'
import { ChatAvatar } from './ChatAvatar'

export const INCOMING_CALL_TIMEOUT_SECONDS = 15

export function IncomingCallDialog({
  open,
  threadTitle,
  isGroup,
  call,
  onAccept,
  onDecline,
}: {
  open: boolean
  threadTitle: string
  isGroup: boolean
  call: AppChatCall | null
  onAccept: () => void
  onDecline: () => void
}) {
  const [secondsLeft, setSecondsLeft] = useState(INCOMING_CALL_TIMEOUT_SECONDS)
  const roomName = call?.roomName ?? ''
  const [countdownRoom, setCountdownRoom] = useState(roomName)

  // Restart the countdown for each new call, during render rather than in an
  // effect, so the dialog never paints a stale number first.
  if (countdownRoom !== roomName) {
    setCountdownRoom(roomName)
    setSecondsLeft(INCOMING_CALL_TIMEOUT_SECONDS)
  }

  useEffect(() => {
    if (!open || !roomName) {
      return
    }

    const intervalId = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [open, roomName])

  useEffect(() => {
    if (open && secondsLeft === 0) {
      onDecline()
    }
  }, [onDecline, open, secondsLeft])

  return (
    <Dialog open={open && Boolean(call)} onClose={onDecline} maxWidth="xs" fullWidth>
      <DialogContent sx={{ pb: 1 }}>
        <Stack alignItems="center" spacing={1.5}>
          <ChatAvatar size={72} name={threadTitle} isGroup={isGroup} colorKey={threadTitle} />

          <Typography variant="h6" sx={{ fontWeight: 800, textAlign: 'center' }}>
            {threadTitle}
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            {call?.startedByName ? `${call.startedByName} is calling` : 'Incoming call'}
            {isGroup ? ' the group' : ''}
            {call?.mode === 'audio' ? '' : ' · video'}
          </Typography>

          <Stack sx={{ width: '100%', pt: 0.5 }} spacing={0.5}>
            <LinearProgress
              variant="determinate"
              value={(secondsLeft / INCOMING_CALL_TIMEOUT_SECONDS) * 100}
            />
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              Ringing · {secondsLeft}s
            </Typography>
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button
          fullWidth
          color="inherit"
          variant="outlined"
          startIcon={<CallEndRoundedIcon />}
          onClick={onDecline}
        >
          Decline
        </Button>
        <Button
          fullWidth
          color="success"
          variant="contained"
          startIcon={call?.mode === 'audio' ? <CallRoundedIcon /> : <VideocamRoundedIcon />}
          onClick={onAccept}
        >
          Join
        </Button>
      </DialogActions>
    </Dialog>
  )
}

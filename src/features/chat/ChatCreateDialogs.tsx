// The two create flows. "New chat" picks one teammate; "New group" is admin
// only. Both only ever list approved workers from /api/chat/users.
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItemButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type { AppChatUser } from './api'
import { ChatAvatar } from './ChatAvatar'
import { formatLastSeen, resolveUserLabel } from './chatUi'

export function NewChatDialog({
  open,
  users,
  isPending,
  onClose,
  onSelect,
}: {
  open: boolean
  users: AppChatUser[]
  isPending: boolean
  onClose: () => void
  onSelect: (uid: string) => void
}) {
  const [search, setSearch] = useState('')
  const [wasOpen, setWasOpen] = useState(open)

  // Reset while rendering rather than in an effect: React re-renders before
  // painting, so the list never flashes the previous search.
  if (open !== wasOpen) {
    setWasOpen(open)

    if (open) {
      setSearch('')
    }
  }

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase()

    if (!needle) {
      return users
    }

    return users.filter((user) => (
      `${user.displayName ?? ''} ${user.email} ${user.role}`.toLowerCase().includes(needle)
    ))
  }, [search, users])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 1 }}>New chat</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search workers"
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

        <List sx={{ mt: 1, maxHeight: 360, overflowY: 'auto', px: 0 }}>
          {filteredUsers.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2 }}>
              No workers match that search.
            </Typography>
          ) : filteredUsers.map((user) => (
            <ListItemButton
              key={user.uid}
              disabled={isPending}
              onClick={() => onSelect(user.uid)}
              sx={{ borderRadius: '10px', gap: 1.25, mb: 0.25 }}
            >
              <ChatAvatar
                size={36}
                name={resolveUserLabel(user)}
                imageUrl={user.imageUrl}
                status={user.onlineStatus}
                colorKey={user.uid}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {resolveUserLabel(user)}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                  {formatLastSeen(user)}
                </Typography>
              </Box>
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isPending}>Cancel</Button>
      </DialogActions>
    </Dialog>
  )
}

export function NewGroupDialog({
  open,
  users,
  isPending,
  onClose,
  onCreate,
}: {
  open: boolean
  users: AppChatUser[]
  isPending: boolean
  onClose: () => void
  onCreate: (input: { name: string; memberUids: string[] }) => void
}) {
  const [name, setName] = useState('')
  const [members, setMembers] = useState<AppChatUser[]>([])
  const [wasOpen, setWasOpen] = useState(open)

  if (open !== wasOpen) {
    setWasOpen(open)

    if (open) {
      setName('')
      setMembers([])
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 1 }}>New group</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <Stack spacing={1.5}>
          <TextField
            autoFocus
            size="small"
            label="Group name"
            placeholder="Shop floor, Install crew, Office..."
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <Autocomplete
            multiple
            size="small"
            options={users}
            value={members}
            onChange={(_event, value) => setMembers(value)}
            getOptionLabel={(option) => resolveUserLabel(option)}
            isOptionEqualToValue={(option, value) => option.uid === value.uid}
            renderInput={(params) => (
              <TextField {...params} label="Members" placeholder="Add workers" />
            )}
          />

          <Typography variant="caption" color="text.secondary">
            You are added automatically. Only admins can create or edit groups.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isPending}>Cancel</Button>
        <Button
          variant="contained"
          disabled={isPending || !name.trim() || members.length === 0}
          onClick={() => onCreate({ name: name.trim(), memberUids: members.map((user) => user.uid) })}
        >
          {isPending ? 'Creating...' : 'Create group'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

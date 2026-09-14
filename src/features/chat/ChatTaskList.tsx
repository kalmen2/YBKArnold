// Tasks attached to one conversation.
//
// Anyone in the thread can add a task, take it, and tick it off. Deleting is
// the restricted one, and the server decides: when an admin is in the thread
// only an admin may delete, otherwise any member can. `canDelete` comes back
// with the list rather than being guessed here.
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import PanToolAltOutlinedIcon from '@mui/icons-material/PanToolAltOutlined'
import {
  Alert,
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  Fab,
  IconButton,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createChatTask,
  deleteChatTask,
  fetchChatTasks,
  updateChatTask,
  type AppChatTask,
  type AppChatTasksResponse,
} from './api'
import { QUERY_KEYS } from '../../lib/queryKeys'

export function ChatTaskList({
  threadId,
  currentUid,
}: {
  threadId: string
  currentUid: string
}) {
  const queryClient = useQueryClient()
  const [draftTitle, setDraftTitle] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const tasksQuery = useQuery<AppChatTasksResponse>({
    queryKey: QUERY_KEYS.chatTasks(threadId),
    queryFn: () => fetchChatTasks(threadId),
    staleTime: 15 * 1000,
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatTasks(threadId) })
    // Every task change posts a line in the thread, so the conversation and
    // the sidebar have to reload together.
    void queryClient.invalidateQueries({ queryKey: ['chat', 'messages', threadId] })
    void queryClient.invalidateQueries({ queryKey: ['chat', 'threads'] })
  }

  function onMutationError(error: unknown) {
    setErrorMessage(error instanceof Error ? error.message : 'That did not save.')
  }

  const createMutation = useMutation({
    mutationFn: (title: string) => createChatTask(threadId, title),
    onSuccess: () => {
      setDraftTitle('')
      setErrorMessage(null)
      invalidate()
    },
    onError: onMutationError,
  })

  const updateMutation = useMutation({
    mutationFn: ({ taskId, input }: {
      taskId: string
      input: { isDone?: boolean; claimed?: boolean }
    }) => updateChatTask(taskId, input),
    onSuccess: () => {
      setErrorMessage(null)
      invalidate()
    },
    onError: onMutationError,
  })

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => deleteChatTask(taskId),
    onSuccess: () => {
      setErrorMessage(null)
      invalidate()
    },
    onError: onMutationError,
  })

  const tasks = tasksQuery.data?.tasks ?? []
  const canDelete = tasksQuery.data?.canDelete === true
  const openCount = tasks.filter((task) => !task.isDone).length

  function submitDraft() {
    const title = draftTitle.trim()

    if (!title || createMutation.isPending) {
      return
    }

    createMutation.mutate(title)
  }

  return (
    <Stack spacing={1.25} sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          {tasks.length === 0
            ? 'No tasks yet'
            : `${openCount} open · ${tasks.length - openCount} done`}
        </Typography>
        {tasksQuery.isFetching && !tasksQuery.isPending ? (
          <CircularProgress size={13} />
        ) : null}
      </Stack>

      {errorMessage ? (
        <Alert severity="error" onClose={() => setErrorMessage(null)} sx={{ py: 0 }}>
          {errorMessage}
        </Alert>
      ) : null}

      {tasksQuery.isPending ? (
        <Stack spacing={0.75}>
          <Skeleton variant="rounded" height={30} />
          <Skeleton variant="rounded" height={30} />
        </Stack>
      ) : null}

      <Stack
        spacing={0.25}
        // Berry strikes completed items through rather than hiding them, so a
        // finished task still reads as something that got done.
        sx={{ '& .chat-task-done .chat-task-title': { textDecoration: 'line-through' } }}
      >
        {tasks.map((task) => (
          <ChatTaskRow
            key={task.id}
            task={task}
            currentUid={currentUid}
            canDelete={canDelete}
            isBusy={
              (updateMutation.isPending && updateMutation.variables?.taskId === task.id)
              || (deleteMutation.isPending && deleteMutation.variables === task.id)
            }
            onToggleDone={() => updateMutation.mutate({
              taskId: task.id,
              input: { isDone: !task.isDone },
            })}
            onToggleClaim={() => updateMutation.mutate({
              taskId: task.id,
              input: { claimed: task.claimedByUid !== currentUid },
            })}
            onDelete={() => deleteMutation.mutate(task.id)}
          />
        ))}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          fullWidth
          size="small"
          placeholder="Add a task"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submitDraft()
            }
          }}
          disabled={createMutation.isPending}
        />
        <Fab
          size="small"
          color="primary"
          aria-label="Add task"
          disabled={!draftTitle.trim() || createMutation.isPending}
          onClick={submitDraft}
          sx={{ flexShrink: 0, boxShadow: 'none' }}
        >
          <AddRoundedIcon fontSize="small" />
        </Fab>
      </Stack>
    </Stack>
  )
}

function ChatTaskRow({
  task,
  currentUid,
  canDelete,
  isBusy,
  onToggleDone,
  onToggleClaim,
  onDelete,
}: {
  task: AppChatTask
  currentUid: string
  canDelete: boolean
  isBusy: boolean
  onToggleDone: () => void
  onToggleClaim: () => void
  onDelete: () => void
}) {
  const isMine = task.claimedByUid === currentUid
  const claimLabel = isMine
    ? 'Release this task'
    : task.claimedByUid
      ? `Taken by ${task.claimedByName ?? 'a teammate'} — take it over`
      : 'Take this task'

  return (
    <Stack
      className={task.isDone ? 'chat-task-done' : undefined}
      direction="row"
      spacing={0.5}
      alignItems="flex-start"
      sx={{
        borderRadius: '8px',
        px: 0.5,
        py: 0.25,
        opacity: isBusy ? 0.5 : 1,
        transition: 'background-color 120ms ease',
        '&:hover': { bgcolor: 'action.hover' },
        '&:hover .chat-task-actions': { opacity: 1 },
      }}
    >
      <Checkbox
        size="small"
        color="primary"
        checked={task.isDone}
        disabled={isBusy}
        onChange={onToggleDone}
        sx={{ p: 0.5, mt: 0.1 }}
        inputProps={{ 'aria-label': `Mark ${task.title} ${task.isDone ? 'not done' : 'done'}` }}
      />

      <Box sx={{ minWidth: 0, flexGrow: 1, py: 0.4 }}>
        <Typography
          className="chat-task-title"
          variant="body2"
          sx={{ wordBreak: 'break-word', color: task.isDone ? 'text.secondary' : 'text.primary' }}
        >
          {task.title}
        </Typography>

        {task.isDone && task.doneByName ? (
          <Typography variant="caption" color="text.secondary">
            {`Done by ${task.doneByName}`}
          </Typography>
        ) : task.claimedByUid ? (
          <Chip
            size="small"
            label={isMine ? 'You took this' : task.claimedByName ?? 'Taken'}
            sx={(theme) => ({
              height: 18,
              fontSize: '0.66rem',
              fontWeight: 600,
              mt: 0.25,
              color: 'primary.main',
              bgcolor: alpha(theme.palette.primary.main, 0.1),
            })}
          />
        ) : null}
      </Box>

      <Stack direction="row" spacing={0.25} alignItems="center">
        {/* Taking a task is the point of the list, so it is always visible.
            Deleting is rare and destructive, so it waits for a hover. */}
        {!task.isDone ? (
          <Tooltip title={claimLabel}>
            <span>
              <IconButton size="small" disabled={isBusy} onClick={onToggleClaim}>
                <PanToolAltOutlinedIcon
                  sx={{ fontSize: 16, color: isMine ? 'primary.main' : 'text.secondary' }}
                />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
        {canDelete ? (
          <Tooltip title="Delete task">
            <span>
              <IconButton
                className="chat-task-actions"
                size="small"
                color="error"
                disabled={isBusy}
                onClick={onDelete}
                sx={{
                  opacity: 0,
                  transition: 'opacity 120ms ease',
                  '@media (hover: none)': { opacity: 1 },
                }}
              >
                <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Stack>
    </Stack>
  )
}

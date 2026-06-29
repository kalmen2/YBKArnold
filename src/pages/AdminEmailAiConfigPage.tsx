import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded'
import {
  Alert,
  Box,
  ButtonBase,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  chatForAiRules,
  fetchAiRules,
  saveAiRules,
  type AiModelQuality,
} from '../features/ai/api'

type DiffOp = {
  type: 'equal' | 'remove' | 'add'
  line: string
}

type RuleEditHunk = {
  id: string
  baseStart: number
  baseDeleteCount: number
  removedLines: string[]
  addedLines: string[]
}

type RulesProposal = {
  baseRules: string
  proposedRules: string
  hunks: RuleEditHunk[]
  acceptedHunkIds: string[]
}

const MODEL_OPTIONS: { value: AiModelQuality; label: string }[] = [
  { value: 'fast', label: 'Fast' },
  { value: 'better', label: 'Better' },
  { value: 'deep', label: 'Deep' },
]

const EMAIL_RULES_LIMIT = 12000

function splitLines(value: string) {
  if (!value) {
    return []
  }

  return String(value).replace(/\r\n/g, '\n').split('\n')
}

function buildLineDiffOps(baseRules: string, nextRules: string): DiffOp[] {
  const baseLines = splitLines(baseRules)
  const nextLines = splitLines(nextRules)
  const rows = baseLines.length
  const cols = nextLines.length
  const matrix: number[][] = Array.from({ length: rows + 1 }, () => (
    new Array(cols + 1).fill(0)
  ))

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      if (baseLines[row] === nextLines[col]) {
        matrix[row][col] = matrix[row + 1][col + 1] + 1
      } else {
        matrix[row][col] = Math.max(matrix[row + 1][col], matrix[row][col + 1])
      }
    }
  }

  const ops: DiffOp[] = []
  let row = 0
  let col = 0

  while (row < rows && col < cols) {
    if (baseLines[row] === nextLines[col]) {
      ops.push({ type: 'equal', line: baseLines[row] })
      row += 1
      col += 1
      continue
    }

    if (matrix[row + 1][col] >= matrix[row][col + 1]) {
      ops.push({ type: 'remove', line: baseLines[row] })
      row += 1
      continue
    }

    ops.push({ type: 'add', line: nextLines[col] })
    col += 1
  }

  while (row < rows) {
    ops.push({ type: 'remove', line: baseLines[row] })
    row += 1
  }

  while (col < cols) {
    ops.push({ type: 'add', line: nextLines[col] })
    col += 1
  }

  return ops
}

function buildRuleEditHunks(baseRules: string, nextRules: string): RuleEditHunk[] {
  const ops = buildLineDiffOps(baseRules, nextRules)
  const hunks: RuleEditHunk[] = []
  let opIndex = 0
  let baseCursor = 0

  while (opIndex < ops.length) {
    const currentOp = ops[opIndex]

    if (currentOp.type === 'equal') {
      baseCursor += 1
      opIndex += 1
      continue
    }

    const baseStart = baseCursor
    const removedLines: string[] = []
    const addedLines: string[] = []

    while (opIndex < ops.length && ops[opIndex].type !== 'equal') {
      if (ops[opIndex].type === 'remove') {
        removedLines.push(ops[opIndex].line)
        baseCursor += 1
      }

      if (ops[opIndex].type === 'add') {
        addedLines.push(ops[opIndex].line)
      }

      opIndex += 1
    }

    hunks.push({
      id: `edit-${hunks.length + 1}`,
      baseStart,
      baseDeleteCount: removedLines.length,
      removedLines,
      addedLines,
    })
  }

  return hunks
}

function applyAcceptedHunks(baseRules: string, hunks: RuleEditHunk[], acceptedHunkIds: Set<string>) {
  const baseLines = splitLines(baseRules)
  const sortedHunks = [...hunks].sort((left, right) => left.baseStart - right.baseStart)
  const resultLines: string[] = []
  let cursor = 0

  sortedHunks.forEach((hunk) => {
    const start = Math.max(cursor, Math.min(hunk.baseStart, baseLines.length))
    const deleteCount = Math.max(0, hunk.baseDeleteCount)

    resultLines.push(...baseLines.slice(cursor, start))

    if (acceptedHunkIds.has(hunk.id)) {
      resultLines.push(...hunk.addedLines)
    } else {
      resultLines.push(...baseLines.slice(start, start + deleteCount))
    }

    cursor = start + deleteCount
  })

  resultLines.push(...baseLines.slice(cursor))

  return resultLines.join('\n')
}

export default function AdminEmailAiConfigPage() {
  const queryClient = useQueryClient()
  const [promptInput, setPromptInput] = useState('')
  const [modelQuality, setModelQuality] = useState<AiModelQuality>('better')
  const [chatError, setChatError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editedRules, setEditedRules] = useState('')
  const [rulesInitialized, setRulesInitialized] = useState(false)
  const [proposal, setProposal] = useState<RulesProposal | null>(null)

  const rulesQuery = useQuery({
    queryKey: ['ai', 'rules', 'email_intake'],
    queryFn: () => fetchAiRules('email_intake'),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!rulesInitialized && rulesQuery.data) {
      setEditedRules(rulesQuery.data.content ?? '')
      setRulesInitialized(true)
    }
  }, [rulesInitialized, rulesQuery.data])

  const chatMutation = useMutation({
    mutationFn: async (input: { prompt: string; baseRules: string }) => {
      const payload = await chatForAiRules(
        'email_intake',
        [{ role: 'user', content: input.prompt }],
        modelQuality,
      )

      return {
        ...payload,
        baseRules: input.baseRules,
      }
    },
    onSuccess: (payload) => {
      if (payload.proposedRules) {
        const hunks = buildRuleEditHunks(payload.baseRules, payload.proposedRules)
        setProposal({
          baseRules: payload.baseRules,
          proposedRules: payload.proposedRules,
          hunks,
          acceptedHunkIds: [],
        })
      } else {
        setProposal(null)
      }

      setChatError(null)
    },
    onError: (error) => {
      setChatError(error instanceof Error ? error.message : 'AI chat failed.')
    },
  })

  const saveMutation = useMutation({
    mutationFn: () => saveAiRules('email_intake', editedRules),
    onSuccess: () => {
      queryClient.setQueryData(['ai', 'rules', 'email_intake'], {
        category: 'email_intake',
        content: editedRules,
      })
      setSaveSuccess('Rules saved.')
      setSaveError(null)
      setTimeout(() => setSaveSuccess(null), 3000)
    },
    onError: (error) => {
      setSaveSuccess(null)
      setSaveError(error instanceof Error ? error.message : 'Could not save rules.')
    },
  })

  const savedRulesContent = rulesQuery.data?.content ?? ''
  const hasUnsavedChanges = rulesInitialized && editedRules !== savedRulesContent

  const acceptedCount = proposal?.acceptedHunkIds.length ?? 0
  const proposalEditCount = proposal?.hunks.length ?? 0
  const acceptedSet = useMemo(() => new Set(proposal?.acceptedHunkIds ?? []), [proposal?.acceptedHunkIds])
  const proposalAddedLineCount = useMemo(() => (
    proposal?.hunks.reduce((sum, hunk) => sum + hunk.addedLines.length, 0) ?? 0
  ), [proposal?.hunks])
  const proposalRemovedLineCount = useMemo(() => (
    proposal?.hunks.reduce((sum, hunk) => sum + hunk.removedLines.length, 0) ?? 0
  ), [proposal?.hunks])

  function handleSendMessage() {
    const trimmed = promptInput.trim()

    if (!trimmed || chatMutation.isPending) {
      return
    }

    setPromptInput('')

    chatMutation.mutate({
      prompt: trimmed,
      baseRules: editedRules,
    })
  }

  function handleAcceptEdit(hunkId: string) {
    if (!proposal || acceptedSet.has(hunkId)) {
      return
    }

    const nextAcceptedIds = [...proposal.acceptedHunkIds, hunkId]
    const nextRules = applyAcceptedHunks(proposal.baseRules, proposal.hunks, new Set(nextAcceptedIds))

    setEditedRules(nextRules)

    if (nextAcceptedIds.length >= proposal.hunks.length) {
      setProposal(null)
      return
    }

    setProposal({
      ...proposal,
      acceptedHunkIds: nextAcceptedIds,
    })
  }

  function handleAcceptAll() {
    if (!proposal) {
      return
    }

    setEditedRules(proposal.proposedRules)
    setProposal(null)
  }

  function handleResetAppliedEdits() {
    if (!proposal) {
      return
    }

    setEditedRules(proposal.baseRules)
    setProposal({
      ...proposal,
      acceptedHunkIds: [],
    })
  }

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          sx={{
            width: 42,
            height: 42,
            bgcolor: '#7c3aed',
            borderRadius: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <SmartToyRoundedIcon sx={{ color: 'white', fontSize: 24 }} />
        </Box>

        <Box>
          <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
            Email Intake AI Rules
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Edit email-intake rules and apply AI-suggested edits one change at a time.
          </Typography>
        </Box>
      </Stack>

      <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden' }}>
        <Box
          sx={{
            px: 2,
            py: 1.25,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: '#fafafa',
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography variant="subtitle2" fontWeight={700}>
              Rules Editor
            </Typography>
            {hasUnsavedChanges ? (
              <Chip size="small" color="warning" variant="outlined" label="Unsaved changes" />
            ) : null}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            This is the exact rules text used by Email Review AI.
          </Typography>
        </Box>

        <Box sx={{ p: 1.75 }}>
          {rulesQuery.isLoading ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2.5 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Loading rules...
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={1.4}>
              {saveSuccess ? <Alert severity="success">{saveSuccess}</Alert> : null}
              {saveError ? <Alert severity="warning">{saveError}</Alert> : null}

              {rulesQuery.isError ? (
                <Alert severity="warning">Could not load email-intake rules.</Alert>
              ) : null}

              <TextField
                multiline
                minRows={14}
                maxRows={32}
                fullWidth
                value={editedRules}
                placeholder="Add concise routing and summary rules for email intake..."
                onChange={(event) => {
                  setEditedRules(event.target.value)

                  if (proposal) {
                    setProposal(null)
                  }
                }}
                disabled={saveMutation.isPending}
                inputProps={{ maxLength: EMAIL_RULES_LIMIT }}
                helperText={`${editedRules.length} / ${EMAIL_RULES_LIMIT.toLocaleString()} characters`}
                sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.85rem' } }}
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="flex-end">
                <Button
                  variant="contained"
                  startIcon={saveMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <SaveRoundedIcon />}
                  onClick={() => {
                    void saveMutation.mutateAsync()
                  }}
                  disabled={saveMutation.isPending}
                  sx={{
                    bgcolor: '#7c3aed',
                    '&:hover': { bgcolor: '#6d28d9' },
                  }}
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Rules'}
                </Button>
              </Stack>
            </Stack>
          )}
        </Box>
      </Paper>

      <Paper
        variant="outlined"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 360,
          borderRadius: 1.5,
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 1.25,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: '#fafafa',
            flexShrink: 0,
          }}
        >
          <Typography variant="subtitle2" fontWeight={700}>
            AI Prompt
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Type one prompt, then click each added/removed rule or use Accept All.
          </Typography>

          <TextField
            select
            size="small"
            label="Model"
            value={modelQuality}
            onChange={(event) => {
              setModelQuality(event.target.value as AiModelQuality)
            }}
            sx={{ mt: 1, minWidth: 150 }}
          >
            {MODEL_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Stack
          spacing={1.25}
          sx={{
            flex: proposal ? 1 : 0,
            overflowY: 'auto',
            p: 1.75,
            bgcolor: '#f3f2f1',
          }}
        >
          {chatMutation.isPending ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.25 }}>
              <Paper
                elevation={0}
                sx={{
                  px: 1.75,
                  py: 1.25,
                  bgcolor: 'white',
                  border: '1px solid rgba(0,0,0,0.1)',
                  borderRadius: '2px 12px 12px 12px',
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={13} sx={{ color: '#7c3aed' }} />
                  <Typography variant="body2" color="text.secondary">
                    Thinking...
                  </Typography>
                </Stack>
              </Paper>
            </Box>
          ) : null}

          {chatError ? (
            <Alert severity="warning" onClose={() => setChatError(null)}>
              {chatError}
            </Alert>
          ) : null}

          {proposal ? (
            <Paper
              variant="outlined"
              sx={{
                p: 1.25,
                borderRadius: 1.5,
                borderColor: 'rgba(124,58,237,0.3)',
                bgcolor: 'rgba(124,58,237,0.03)',
              }}
            >
              <Stack spacing={1.1}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                  justifyContent="space-between"
                >
                  <Typography variant="subtitle2" color="#7c3aed" fontWeight={700}>
                    Proposed edits: {proposalEditCount} · +{proposalAddedLineCount} / -{proposalRemovedLineCount}
                    {proposalEditCount > 0 ? ` · ${acceptedCount} accepted` : ''}
                  </Typography>

                  <Stack direction="row" spacing={0.8}>
                    <Button size="small" variant="text" onClick={handleResetAppliedEdits}>
                      Reset applied
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => setProposal(null)}>
                      Dismiss
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={handleAcceptAll}
                      disabled={proposalEditCount === 0}
                      sx={{ bgcolor: '#7c3aed', '&:hover': { bgcolor: '#6d28d9' } }}
                    >
                      Accept All
                    </Button>
                  </Stack>
                </Stack>

                {proposal.hunks.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    AI returned a rules block that matches your current text.
                  </Typography>
                ) : (
                  <Stack spacing={1}>
                    {proposal.hunks.map((hunk, hunkIndex) => {
                      const isAccepted = acceptedSet.has(hunk.id)

                      return (
                        <Paper
                          key={hunk.id}
                          variant="outlined"
                          sx={{
                            p: 1,
                            borderColor: isAccepted ? 'success.main' : 'divider',
                            bgcolor: isAccepted ? 'rgba(46,125,50,0.05)' : 'background.paper',
                          }}
                        >
                          <Stack spacing={0.85}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Typography variant="caption" fontWeight={700}>
                                Edit {hunkIndex + 1}
                              </Typography>

                              <Chip
                                size="small"
                                color={isAccepted ? 'success' : 'default'}
                                variant={isAccepted ? 'filled' : 'outlined'}
                                label={isAccepted ? 'Accepted' : 'Click red/green line to accept'}
                              />
                            </Stack>

                            {hunk.removedLines.length > 0 ? (
                              <Box
                                sx={{
                                  border: '1px solid rgba(211,47,47,0.35)',
                                  bgcolor: 'rgba(211,47,47,0.08)',
                                  borderRadius: 1,
                                  px: 1,
                                  py: 0.8,
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                  fontSize: '0.78rem',
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {hunk.removedLines.map((line, lineIndex) => (
                                  <ButtonBase
                                    key={`remove-${hunk.id}-${lineIndex}`}
                                    onClick={() => {
                                      handleAcceptEdit(hunk.id)
                                    }}
                                    disabled={isAccepted}
                                    sx={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      px: 0.35,
                                      py: 0.2,
                                      borderRadius: 0.6,
                                      '&:hover': {
                                        bgcolor: isAccepted ? 'transparent' : 'rgba(142,34,34,0.12)',
                                      },
                                    }}
                                  >
                                    <Typography
                                      component="div"
                                      sx={{ color: '#8e2222', fontFamily: 'inherit', fontSize: 'inherit' }}
                                    >
                                      - {line}
                                    </Typography>
                                  </ButtonBase>
                                ))}
                              </Box>
                            ) : null}

                            {hunk.addedLines.length > 0 ? (
                              <Box
                                sx={{
                                  border: '1px solid rgba(46,125,50,0.35)',
                                  bgcolor: 'rgba(46,125,50,0.1)',
                                  borderRadius: 1,
                                  px: 1,
                                  py: 0.8,
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                  fontSize: '0.78rem',
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {hunk.addedLines.map((line, lineIndex) => (
                                  <ButtonBase
                                    key={`add-${hunk.id}-${lineIndex}`}
                                    onClick={() => {
                                      handleAcceptEdit(hunk.id)
                                    }}
                                    disabled={isAccepted}
                                    sx={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      px: 0.35,
                                      py: 0.2,
                                      borderRadius: 0.6,
                                      '&:hover': {
                                        bgcolor: isAccepted ? 'transparent' : 'rgba(23,107,29,0.12)',
                                      },
                                    }}
                                  >
                                    <Typography
                                      component="div"
                                      sx={{ color: '#176b1d', fontFamily: 'inherit', fontSize: 'inherit' }}
                                    >
                                      + {line}
                                    </Typography>
                                  </ButtonBase>
                                ))}
                              </Box>
                            ) : null}
                          </Stack>
                        </Paper>
                      )
                    })}
                  </Stack>
                )}
              </Stack>
            </Paper>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ py: 0.25 }}>
              Send a prompt to generate rule changes. New rules are applied to the editor above when you click each red/green line or Accept All.
            </Typography>
          )}
        </Stack>

        <Box
          sx={{
            p: 1.5,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            flexShrink: 0,
          }}
        >
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
            <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ flex: 1 }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Describe how the email-intake rules should change..."
                value={promptInput}
                onChange={(event) => setPromptInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    handleSendMessage()
                  }
                }}
                disabled={chatMutation.isPending}
                multiline
                maxRows={4}
              />
              <IconButton
                onClick={handleSendMessage}
                disabled={!promptInput.trim() || chatMutation.isPending}
                sx={{
                  bgcolor: '#7c3aed',
                  color: 'white',
                  flexShrink: 0,
                  '&:hover': { bgcolor: '#6d28d9' },
                  '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' },
                }}
              >
                <SendRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>

            <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
              <Chip size="small" color="success" variant="outlined" label={`+${proposalAddedLineCount}`} />
              <Chip size="small" color="error" variant="outlined" label={`-${proposalRemovedLineCount}`} />
              <Button
                size="small"
                variant="contained"
                onClick={handleAcceptAll}
                disabled={!proposal || proposalEditCount === 0}
                sx={{ bgcolor: '#7c3aed', '&:hover': { bgcolor: '#6d28d9' } }}
              >
                Accept All
              </Button>
            </Stack>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            Press Enter to send. Shift+Enter adds a new line. Click a red or green rule line to apply that single edit.
          </Typography>
        </Box>
      </Paper>
    </Stack>
  )
}

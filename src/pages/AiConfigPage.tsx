import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  chatForAiRules,
  fetchAiRules,
  saveAiRules,
  type AiChatMessage,
  type AiModelQuality,
  type AiRuleCategory,
} from '../features/ai/api'

type ChatEntry = {
  role: 'user' | 'assistant'
  content: string
}

const CATEGORIES: { key: AiRuleCategory; label: string; description: string }[] = [
  {
    key: 'general',
    label: 'General',
    description: 'Company-wide business context that support AI must understand first',
  },
  {
    key: 'support',
    label: 'Support',
    description: 'Rules for support replies after applying General business rules',
  },
  {
    key: 'summaries',
    label: 'Summaries',
    description: 'Rules for AI summaries after applying General business rules',
  },
  {
    key: 'purchasing',
    label: 'Purchasing',
    description: 'Rules for exact-item supplier search used on the Purchasing page',
  },
]

const MODEL_OPTIONS: { value: AiModelQuality; label: string }[] = [
  { value: 'fast', label: 'Fast' },
  { value: 'better', label: 'Better' },
  { value: 'deep', label: 'Deep' },
]

function isAiRuleCategory(value: string | undefined): value is AiRuleCategory {
  return CATEGORIES.some((category) => category.key === value)
}

export default function AiConfigPage() {
  const queryClient = useQueryClient()
  const location = useLocation()

  const [selectedCategory, setSelectedCategory] = useState<AiRuleCategory>('support')
  const [chatHistories, setChatHistories] = useState<Record<string, ChatEntry[]>>({})
  const [editedRules, setEditedRules] = useState<Record<string, string>>({})
  const [rulesInitialized, setRulesInitialized] = useState<Record<string, boolean>>({})
  const [pendingProposedRules, setPendingProposedRules] = useState<Record<string, string | null>>({})
  const [modelQuality, setModelQuality] = useState<AiModelQuality>('better')
  const [isConfirming, setIsConfirming] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatError, setChatError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const categoryMountedRef = useRef(false)

  // Pre-fill from navigation state when arriving from "Teach AI" button on Support page
  useEffect(() => {
    const state = location.state as { category?: string; prefillMessage?: string } | null
    if (!state?.prefillMessage) return
    if (isAiRuleCategory(state.category)) setSelectedCategory(state.category)
    setChatInput(state.prefillMessage)
  }, [location.state])

  const currentChat = chatHistories[selectedCategory] ?? []
  const currentEditedRules = editedRules[selectedCategory] ?? ''

  const rulesQuery = useQuery({
    queryKey: ['ai', 'rules', selectedCategory],
    queryFn: () => fetchAiRules(selectedCategory),
    staleTime: 5 * 60 * 1000,
  })

  // Initialize editedRules from DB once per category (don't overwrite user edits)
  useEffect(() => {
    if (rulesQuery.data !== undefined && !rulesInitialized[selectedCategory]) {
      setEditedRules((prev) => ({
        ...prev,
        [selectedCategory]: rulesQuery.data?.content ?? '',
      }))
      setRulesInitialized((prev) => ({ ...prev, [selectedCategory]: true }))
    }
  }, [rulesQuery.data, selectedCategory, rulesInitialized])

  // Scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentChat.length])

  // Clear chat input and errors when switching categories (skip initial mount)
  useEffect(() => {
    if (!categoryMountedRef.current) {
      categoryMountedRef.current = true
      return
    }
    setChatInput('')
    setChatError(null)
    setSaveSuccess(null)
    setSaveError(null)
    setPendingProposedRules((prev) => ({ ...prev, [selectedCategory]: null }))
  }, [selectedCategory])

  const chatMutation = useMutation({
    mutationFn: (messages: AiChatMessage[]) => chatForAiRules(selectedCategory, messages, modelQuality),
    onSuccess: (data) => {
      setChatHistories((prev) => ({
        ...prev,
        [selectedCategory]: [
          ...(prev[selectedCategory] ?? []),
          { role: 'assistant', content: data.message },
        ],
      }))

      if (data.proposedRules) {
        setPendingProposedRules((prev) => ({ ...prev, [selectedCategory]: data.proposedRules }))
      }

      setChatError(null)
    },
    onError: (error) => {
      setChatError(error instanceof Error ? error.message : 'AI chat failed.')
    },
  })

  const saveMutation = useMutation({
    mutationFn: () => saveAiRules(selectedCategory, currentEditedRules),
    onSuccess: () => {
      queryClient.setQueryData(['ai', 'rules', selectedCategory], {
        category: selectedCategory,
        content: currentEditedRules,
      })
      setPendingProposedRules((prev) => ({ ...prev, [selectedCategory]: null }))
      setSaveSuccess('Rules saved.')
      setSaveError(null)
      setTimeout(() => setSaveSuccess(null), 3000)
    },
    onError: (error) => {
      setSaveError(error instanceof Error ? error.message : 'Could not save rules.')
      setSaveSuccess(null)
    },
  })

  function handleSendMessage() {
    const trimmed = chatInput.trim()

    if (!trimmed || chatMutation.isPending) {
      return
    }

    const newHistory: ChatEntry[] = [
      ...currentChat,
      { role: 'user', content: trimmed },
    ]

    setChatHistories((prev) => ({ ...prev, [selectedCategory]: newHistory }))
    setChatInput('')
    chatMutation.mutate(newHistory.map((m) => ({ role: m.role, content: m.content })))
  }

  const selectedCategoryMeta = CATEGORIES.find((c) => c.key === selectedCategory)
  const savedRulesContent = rulesQuery.data?.content ?? ''
  const currentPendingRules = pendingProposedRules[selectedCategory] ?? null
  const isGeneralCategory = selectedCategory === 'general'
  const contentLimit =
    selectedCategory === 'general'
      ? 20000
      : selectedCategory === 'purchasing'
        ? 6000
        : 2000
  const chatPanelHint = isGeneralCategory
    ? 'Talk through your business in depth. Ask for a full company write-up, then confirm to save it.'
    : 'Describe the rule you need. AI only proposes rules for review.'
  const pendingContentLabel = isGeneralCategory
    ? 'Proposed business document — review before saving:'
    : 'Proposed rules — review before saving:'
  const rulesPanelLabel = isGeneralCategory
    ? `${selectedCategoryMeta?.label ?? ''} Business Document`
    : `${selectedCategoryMeta?.label ?? ''} Rules`
  const rulesPanelHint = isGeneralCategory
    ? 'AI-assisted and editable · Capture full company context used by Support AI'
    : 'AI-generated and editable · Keep rules short and specific'
  const editorPlaceholder = isGeneralCategory
    ? 'No General business document yet.\n\nChat with AI on the left to draft a full company document, or write it directly here.'
    : `No ${selectedCategoryMeta?.label.toLowerCase()} rules yet.\n\nChat with AI on the left to generate them, or type rules directly here.`
  const hasUnsavedChanges =
    rulesInitialized[selectedCategory] && currentEditedRules !== savedRulesContent

  async function handleConfirmRules() {
    if (!currentPendingRules || isConfirming) return
    setIsConfirming(true)
    setSaveError(null)
    try {
      await saveAiRules(selectedCategory, currentPendingRules)
      setEditedRules((prev) => ({ ...prev, [selectedCategory]: currentPendingRules }))
      setRulesInitialized((prev) => ({ ...prev, [selectedCategory]: true }))
      queryClient.setQueryData(['ai', 'rules', selectedCategory], {
        category: selectedCategory,
        content: currentPendingRules,
      })
      setPendingProposedRules((prev) => ({ ...prev, [selectedCategory]: null }))
      setSaveSuccess('Rules saved.')
      setTimeout(() => setSaveSuccess(null), 3000)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save rules.')
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <Stack spacing={2.5}>
      {/* Page header */}
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
            AI Configuration
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Define rules that guide Support, Summaries, and Purchasing AI behavior
          </Typography>
        </Box>
      </Stack>

      {/* Category tabs */}
      <Paper variant="outlined" sx={{ borderRadius: 1.5 }}>
        <Tabs
          value={selectedCategory}
          onChange={(_e, value: AiRuleCategory) => setSelectedCategory(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 1 }}
        >
          {CATEGORIES.map((cat) => (
            <Tab key={cat.key} value={cat.key} label={cat.label} />
          ))}
        </Tabs>
      </Paper>

      {selectedCategoryMeta ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: -1.5 }}>
          {selectedCategoryMeta.description}
        </Typography>
      ) : null}

      {/* Two-panel layout */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1fr 380px' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        {/* ── Chat panel ── */}
        <Paper
          variant="outlined"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: { xs: 500, lg: 680 },
            borderRadius: 1.5,
            overflow: 'hidden',
          }}
        >
          {/* Chat header */}
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
              Chat with AI
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {chatPanelHint}
            </Typography>
            <TextField
              select
              size="small"
              label="Model"
              value={modelQuality}
              onChange={(event) => setModelQuality(event.target.value as AiModelQuality)}
              sx={{ mt: 1, minWidth: 150 }}
            >
              {MODEL_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          {/* Messages area */}
          <Stack
            spacing={1.25}
            sx={{
              flex: 1,
              overflowY: 'auto',
              p: 1.75,
              bgcolor: '#f3f2f1',
            }}
          >
            {currentChat.length === 0 ? (
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  py: 8,
                  gap: 1.5,
                }}
              >
                <AutoAwesomeRoundedIcon
                  sx={{ fontSize: 44, color: '#7c3aed', opacity: 0.45 }}
                />
                <Typography
                  variant="body2"
                  color="text.secondary"
                  textAlign="center"
                  sx={{ maxWidth: 340, lineHeight: 1.6 }}
                >
                  {isGeneralCategory ? (
                    <>
                      Start a conversation to build a full <strong>business document</strong> for your company.
                      <br />
                      Ask for a 2-page company explanation, then refine it in chat until it is accurate.
                    </>
                  ) : (
                    <>
                      Start a conversation to define <strong>{selectedCategoryMeta?.label.toLowerCase()}</strong> rules.
                      <br />
                      Tell the AI how you want to handle situations, and it will write the rules for you.
                    </>
                  )}
                </Typography>
              </Box>
            ) : null}

            {currentChat.map((message, index) => {
              const isUser = message.role === 'user'

              return (
                <Box
                  key={index}
                  sx={{
                    display: 'flex',
                    justifyContent: isUser ? 'flex-end' : 'flex-start',
                  }}
                >
                  <Paper
                    elevation={0}
                    sx={{
                      px: 1.75,
                      py: 1.25,
                      maxWidth: '84%',
                      bgcolor: isUser ? '#7c3aed' : 'white',
                      color: isUser ? 'white' : 'text.primary',
                      borderRadius: isUser
                        ? '12px 12px 2px 12px'
                        : '2px 12px 12px 12px',
                      border: isUser ? 'none' : '1px solid',
                      borderColor: isUser ? 'transparent' : 'rgba(0,0,0,0.1)',
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.65 }}
                    >
                      {message.content}
                    </Typography>
                  </Paper>
                </Box>
              )
            })}

            {chatMutation.isPending ? (
              <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
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
                      Thinking…
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

            <div ref={chatEndRef} />
          </Stack>

          {/* Confirm proposed rules — shows rules here for review before saving */}
          {currentPendingRules ? (
            <Box
              sx={{
                px: 1.75,
                py: 1.25,
                borderTop: '2px solid',
                borderColor: 'rgba(124,58,237,0.35)',
                bgcolor: 'rgba(124,58,237,0.04)',
                flexShrink: 0,
              }}
            >
              <Stack spacing={1}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="caption" fontWeight={700} color="#7c3aed">
                    {pendingContentLabel}
                  </Typography>
                  {saveError ? (
                    <Typography variant="caption" color="error">{saveError}</Typography>
                  ) : null}
                </Stack>
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    lineHeight: 1.6,
                    bgcolor: 'white',
                    border: '1px solid rgba(124,58,237,0.2)',
                    borderRadius: 1,
                    px: 1.25,
                    py: 1,
                  }}
                >
                  {currentPendingRules}
                </Typography>
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setPendingProposedRules((prev) => ({ ...prev, [selectedCategory]: null }))}
                    disabled={isConfirming}
                    sx={{ color: 'text.secondary' }}
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => { void handleConfirmRules() }}
                    disabled={isConfirming}
                    startIcon={isConfirming ? <CircularProgress size={12} color="inherit" /> : null}
                    sx={{ bgcolor: '#7c3aed', '&:hover': { bgcolor: '#6d28d9' } }}
                  >
                    {isConfirming ? 'Saving…' : 'Confirm & Save'}
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ) : null}

          {/* Chat input */}
          <Box
            sx={{
              p: 1.5,
              borderTop: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              flexShrink: 0,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="flex-end">
              <TextField
                fullWidth
                size="small"
                placeholder={isGeneralCategory ? 'Ask for a full business write-up or refine one section…' : `Describe ${selectedCategoryMeta?.label.toLowerCase()} rules…`}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
                disabled={chatMutation.isPending}
                multiline
                maxRows={4}
              />
              <IconButton
                onClick={handleSendMessage}
                disabled={!chatInput.trim() || chatMutation.isPending}
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
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              Press Enter to send · Shift+Enter for new line
            </Typography>
          </Box>
        </Paper>

        {/* ── Rules panel ── */}
        <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden' }}>
          {/* Rules header */}
          <Box
            sx={{
              px: 2,
              py: 1.25,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: '#fafafa',
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle2" fontWeight={700}>
                {rulesPanelLabel}
              </Typography>
              {hasUnsavedChanges ? (
                <Typography variant="caption" color="warning.main" fontWeight={600}>
                  Unsaved changes
                </Typography>
              ) : null}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {rulesPanelHint}
            </Typography>
          </Box>

          <Box sx={{ p: 1.75 }}>
            {rulesQuery.isLoading ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2.5 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Loading rules…
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={1.5}>
                {saveSuccess ? (
                  <Alert severity="success" sx={{ py: 0.5 }}>
                    {saveSuccess}
                  </Alert>
                ) : null}

                {saveError ? (
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    {saveError}
                  </Alert>
                ) : null}

                {rulesQuery.isError ? (
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    Could not load rules.
                  </Alert>
                ) : null}

                <TextField
                  multiline
                  minRows={10}
                  maxRows={22}
                  fullWidth
                  placeholder={editorPlaceholder}
                  value={currentEditedRules}
                  onChange={(e) =>
                    setEditedRules((prev) => ({
                      ...prev,
                      [selectedCategory]: e.target.value,
                    }))
                  }
                  disabled={saveMutation.isPending}
                  inputProps={{ maxLength: contentLimit }}
                  helperText={`${currentEditedRules.length} / ${contentLimit.toLocaleString()} characters`}
                  sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                />

                <Button
                  variant="contained"
                  fullWidth
                  startIcon={
                    saveMutation.isPending ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <SaveRoundedIcon />
                    )
                  }
                  onClick={() => void saveMutation.mutateAsync()}
                  disabled={saveMutation.isPending}
                  sx={{
                    bgcolor: '#7c3aed',
                    '&:hover': { bgcolor: '#6d28d9' },
                  }}
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save Rules'}
                </Button>
              </Stack>
            )}
          </Box>
        </Paper>
      </Box>
    </Stack>
  )
}

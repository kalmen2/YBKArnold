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
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  chatForAiRules,
  fetchAiRules,
  saveAiRules,
  type AiChatMessage,
  type AiRuleCategory,
} from '../features/ai/api'

type ChatEntry = {
  role: 'user' | 'assistant'
  content: string
}

const CATEGORIES: { key: AiRuleCategory; label: string; description: string }[] = [
  {
    key: 'support',
    label: 'Support',
    description: 'Rules for handling customer support tickets and replies',
  },
  {
    key: 'orders',
    label: 'Orders',
    description: 'Rules for processing and responding to order-related questions',
  },
  {
    key: 'crm',
    label: 'CRM',
    description: 'Rules for managing dealers, contacts, and sales interactions',
  },
  {
    key: 'general',
    label: 'General',
    description: 'General company-wide operational rules',
  },
]

export default function AiConfigPage() {
  const queryClient = useQueryClient()

  const [selectedCategory, setSelectedCategory] = useState<AiRuleCategory>('support')
  const [chatHistories, setChatHistories] = useState<Record<string, ChatEntry[]>>({})
  const [editedRules, setEditedRules] = useState<Record<string, string>>({})
  const [rulesInitialized, setRulesInitialized] = useState<Record<string, boolean>>({})
  const [chatInput, setChatInput] = useState('')
  const [chatError, setChatError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)

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

  // Clear chat input and errors when switching categories
  useEffect(() => {
    setChatInput('')
    setChatError(null)
    setSaveSuccess(null)
    setSaveError(null)
  }, [selectedCategory])

  const chatMutation = useMutation({
    mutationFn: (messages: AiChatMessage[]) => chatForAiRules(selectedCategory, messages),
    onSuccess: (data) => {
      setChatHistories((prev) => ({
        ...prev,
        [selectedCategory]: [
          ...(prev[selectedCategory] ?? []),
          { role: 'assistant', content: data.message },
        ],
      }))

      if (data.rulesUpdated) {
        setEditedRules((prev) => ({ ...prev, [selectedCategory]: data.rules }))
        setRulesInitialized((prev) => ({ ...prev, [selectedCategory]: true }))
        queryClient.setQueryData(['ai', 'rules', selectedCategory], {
          category: selectedCategory,
          content: data.rules,
        })
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
  const hasUnsavedChanges =
    rulesInitialized[selectedCategory] && currentEditedRules !== savedRulesContent

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
            Define rules that guide AI replies and auto-generation on the Support page
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
              Describe what rules you need. AI will write them and save automatically.
            </Typography>
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
                  Start a conversation to define{' '}
                  <strong>{selectedCategoryMeta?.label.toLowerCase()}</strong> rules.
                  <br />
                  Tell the AI how you want to handle situations, and it will write the rules for you.
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
                placeholder={`Describe ${selectedCategoryMeta?.label.toLowerCase()} rules…`}
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
                {selectedCategoryMeta?.label ?? ''} Rules
              </Typography>
              {hasUnsavedChanges ? (
                <Typography variant="caption" color="warning.main" fontWeight={600}>
                  Unsaved changes
                </Typography>
              ) : null}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              AI-generated and editable · Keep rules short and specific
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
                  placeholder={
                    `No ${selectedCategoryMeta?.label.toLowerCase()} rules yet.\n\n` +
                    `Chat with AI on the left to generate them, or type rules directly here.`
                  }
                  value={currentEditedRules}
                  onChange={(e) =>
                    setEditedRules((prev) => ({
                      ...prev,
                      [selectedCategory]: e.target.value,
                    }))
                  }
                  disabled={saveMutation.isPending}
                  inputProps={{ maxLength: 2000 }}
                  helperText={`${currentEditedRules.length} / 2000 characters`}
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

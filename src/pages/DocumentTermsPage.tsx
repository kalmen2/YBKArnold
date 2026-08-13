import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  createCrmDocumentTerm,
  fetchCrmDealers,
  fetchCrmDocumentTerms,
  removeCrmDocumentTerm,
  updateCrmDocumentTerm,
  type CrmDealer,
  type CrmDocumentTerm,
  type CrmDocumentType,
} from '../features/crm/api'
import { QUERY_KEYS } from '../lib/queryKeys'

const DOCUMENT_TYPE_LABELS: Record<CrmDocumentType, string> = {
  quote: 'Quote',
  order_confirmation: 'Order Confirmation',
  proforma_invoice: 'Proforma Invoice',
  work_order: 'Work Order',
  bill_of_lading: 'Bill of Lading',
  change_order: 'Change Order',
}

const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as CrmDocumentType[]

type TermDraft = {
  id: string | null
  documentType: CrmDocumentType
  title: string
  body: string
  sortOrder: number
  isDefault: boolean
  includedDealerSourceIds: string[]
  excludedDealerSourceIds: string[]
  isBuiltIn: boolean
}

function createDraft(documentType: CrmDocumentType, term?: CrmDocumentTerm | null): TermDraft {
  return term ? {
    id: term.id,
    documentType: term.documentType,
    title: term.title,
    body: term.body,
    sortOrder: term.sortOrder,
    isDefault: term.isDefault,
    includedDealerSourceIds: [...term.includedDealerSourceIds],
    excludedDealerSourceIds: [...term.excludedDealerSourceIds],
    isBuiltIn: term.isBuiltIn,
  } : {
    id: null,
    documentType,
    title: '',
    body: '',
    sortOrder: 100,
    isDefault: true,
    includedDealerSourceIds: [],
    excludedDealerSourceIds: [],
    isBuiltIn: false,
  }
}

function dealerLabel(dealer: CrmDealer) {
  return dealer.name || dealer.quoteCompanyName || dealer.sourceId
}

export default function DocumentTermsPage() {
  const queryClient = useQueryClient()
  const [documentType, setDocumentType] = useState<CrmDocumentType>('order_confirmation')
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TermDraft>(() => createDraft('order_confirmation'))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)

  const termsQuery = useQuery({
    queryKey: QUERY_KEYS.crmDocumentTerms(),
    queryFn: () => fetchCrmDocumentTerms(),
  })
  const dealersQuery = useQuery({
    queryKey: QUERY_KEYS.crmTermsDealers,
    queryFn: () => fetchCrmDealers({ limit: 2500 }),
  })
  const dealers = useMemo(
    () => [...(dealersQuery.data?.dealers || [])].sort((a, b) => dealerLabel(a).localeCompare(dealerLabel(b))),
    [dealersQuery.data?.dealers],
  )
  const terms = useMemo(
    () => (termsQuery.data?.terms || []).filter((term) => term.documentType === documentType),
    [documentType, termsQuery.data?.terms],
  )
  const selectedTerm = useMemo(
    () => termsQuery.data?.terms.find((term) => term.id === selectedTermId) || null,
    [selectedTermId, termsQuery.data?.terms],
  )

  useEffect(() => {
    if (selectedTerm) setDraft(createDraft(selectedTerm.documentType, selectedTerm))
  }, [selectedTerm])

  useEffect(() => {
    if (selectedTermId === '__new__') return
    if (selectedTermId && terms.some((term) => term.id === selectedTermId)) return
    const first = terms[0] || null
    setSelectedTermId(first?.id || null)
    setDraft(createDraft(documentType, first))
  }, [documentType, selectedTermId, terms])

  const assignedIds = draft.isDefault
    ? draft.excludedDealerSourceIds
    : draft.includedDealerSourceIds
  const assignedDealers = dealers.filter((dealer) => assignedIds.includes(dealer.sourceId))

  const handleSave = async () => {
    if (!draft.title.trim() || !draft.body.trim()) {
      setMessage({ severity: 'error', text: 'Enter a title and the term text.' })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const payload = {
        documentType: draft.documentType,
        title: draft.title.trim(),
        body: draft.body.trim(),
        sortOrder: draft.sortOrder,
        isDefault: draft.isDefault,
        includedDealerSourceIds: draft.isDefault ? [] : draft.includedDealerSourceIds,
        excludedDealerSourceIds: draft.isDefault ? draft.excludedDealerSourceIds : [],
      }
      const result = draft.id
        ? await updateCrmDocumentTerm(draft.id, payload)
        : await createCrmDocumentTerm(payload)
      setSelectedTermId(result.term.id)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmDocumentTermsRoot })
      setMessage({ severity: 'success', text: 'Term saved.' })
    } catch (error) {
      setMessage({ severity: 'error', text: error instanceof Error ? error.message : 'Could not save the term.' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!draft.id || !window.confirm(`Remove “${draft.title}” from the terms library?`)) return
    setSaving(true)
    setMessage(null)
    try {
      await removeCrmDocumentTerm(draft.id)
      setSelectedTermId(null)
      setDraft(createDraft(documentType))
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmDocumentTermsRoot })
      setMessage({ severity: 'success', text: 'Term removed.' })
    } catch (error) {
      setMessage({ severity: 'error', text: error instanceof Error ? error.message : 'Could not remove the term.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2.2 }}>
        <Typography variant="h5" fontWeight={800}>Terms and Conditions</Typography>
        <Typography color="text.secondary">
          Manage the standard terms for every customer document, then include or exclude individual dealers.
        </Typography>
      </Paper>

      {message ? <Alert severity={message.severity}>{message.text}</Alert> : null}
      {termsQuery.isError ? <Alert severity="error">Could not load document terms.</Alert> : null}

      <Paper variant="outlined">
        <Tabs
          value={documentType}
          onChange={(_event, value: CrmDocumentType) => {
            setDocumentType(value)
            setSelectedTermId(null)
            setMessage(null)
          }}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}
        >
          {DOCUMENT_TYPES.map((type) => <Tab key={type} value={type} label={DOCUMENT_TYPE_LABELS[type]} />)}
        </Tabs>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(260px, 32%) 1fr' }, minHeight: 520 }}>
          <Box sx={{ borderRight: { lg: 1 }, borderBottom: { xs: 1, lg: 0 }, borderColor: 'divider', p: 1.2 }}>
            <Button
              fullWidth
              variant="outlined"
              startIcon={<AddRoundedIcon />}
              onClick={() => {
                setSelectedTermId('__new__')
                setDraft(createDraft(documentType))
                setMessage(null)
              }}
            >
              Add term
            </Button>
            <List dense sx={{ mt: 1 }}>
              {terms.map((term) => {
                const coverage = term.isDefault
                  ? term.excludedDealerSourceIds.length
                    ? `All except ${term.excludedDealerSourceIds.length}`
                    : 'All dealers'
                  : `${term.includedDealerSourceIds.length} selected`
                return (
                  <ListItemButton key={term.id} selected={term.id === selectedTermId} onClick={() => setSelectedTermId(term.id)}>
                    <ListItemText primary={term.title} secondary={coverage} />
                    {term.isBuiltIn ? <Chip label="Basic" size="small" variant="outlined" /> : null}
                  </ListItemButton>
                )
              })}
              {!termsQuery.isLoading && terms.length === 0 ? (
                <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>No terms for this document yet.</Typography>
              ) : null}
            </List>
          </Box>

          <Stack spacing={2} sx={{ p: 2 }}>
            <TextField
              label="Term name"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              fullWidth
              helperText="Write any name you want for this term."
            />
            <TextField
              label="Terms and conditions text"
              value={draft.body}
              onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
              multiline
              minRows={8}
              fullWidth
            />
            <Divider />
            <FormControlLabel
              control={<Checkbox checked={draft.isDefault} onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))} />}
              label="Use this term for all dealers by default"
            />
            <Autocomplete
              multiple
              options={dealers}
              value={assignedDealers}
              getOptionLabel={dealerLabel}
              isOptionEqualToValue={(option, value) => option.sourceId === value.sourceId}
              onChange={(_event, values) => {
                const ids = values.map((dealer) => dealer.sourceId)
                setDraft((current) => current.isDefault
                  ? { ...current, excludedDealerSourceIds: ids }
                  : { ...current, includedDealerSourceIds: ids })
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={draft.isDefault ? 'Do not use for these dealers' : 'Use only for these dealers'}
                  helperText={draft.isDefault
                    ? 'These dealers will not receive this otherwise-standard term.'
                    : 'Only the selected dealers will receive this term.'}
                />
              )}
            />
            <Typography variant="body2" color="text.secondary">
              {draft.isDefault
                ? assignedIds.length ? `Applies to every dealer except ${assignedIds.length}.` : 'Applies to every dealer.'
                : `Applies to ${assignedIds.length} selected dealer${assignedIds.length === 1 ? '' : 's'}.`}
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              {draft.id ? (
                <Button color="error" variant="outlined" startIcon={<DeleteOutlineRoundedIcon />} disabled={saving} onClick={() => void handleDelete()}>
                  Remove term
                </Button>
              ) : null}
              <Button variant="contained" startIcon={<SaveRoundedIcon />} disabled={saving || !draft.title.trim() || !draft.body.trim()} onClick={() => void handleSave()}>
                {saving ? 'Saving…' : 'Save term'}
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Paper>
    </Stack>
  )
}

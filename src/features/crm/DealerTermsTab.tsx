import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  fetchCrmDocumentTerms,
  updateCrmDocumentTerm,
  type CrmDocumentTerm,
  type CrmDocumentType,
} from './api'
import { QUERY_KEYS } from '../../lib/queryKeys'

const DOCUMENT_TYPE_LABELS: Record<CrmDocumentType, string> = {
  quote: 'Quote',
  order_confirmation: 'Order Confirmation',
  proforma_invoice: 'Proforma Invoice',
  work_order: 'Work Order',
  bill_of_lading: 'Bill of Lading',
  change_order: 'Change Order',
}

const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as CrmDocumentType[]

export function DealerTermsTab({ dealerSourceId }: { dealerSourceId: string }) {
  const queryClient = useQueryClient()
  const [documentType, setDocumentType] = useState<CrmDocumentType>('order_confirmation')
  const [savingTermId, setSavingTermId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const termsQuery = useQuery({
    queryKey: QUERY_KEYS.crmDocumentTerms(dealerSourceId),
    queryFn: () => fetchCrmDocumentTerms(dealerSourceId),
    enabled: Boolean(dealerSourceId),
  })
  const terms = useMemo(
    () => (termsQuery.data?.terms || []).filter((term) => term.documentType === documentType),
    [documentType, termsQuery.data?.terms],
  )

  const toggleTerm = async (term: CrmDocumentTerm, enabled: boolean) => {
    setSavingTermId(term.id)
    setError(null)
    try {
      const included = new Set(term.includedDealerSourceIds)
      const excluded = new Set(term.excludedDealerSourceIds)

      if (term.isDefault) {
        if (enabled) excluded.delete(dealerSourceId)
        else excluded.add(dealerSourceId)
      } else if (enabled) {
        included.add(dealerSourceId)
      } else {
        included.delete(dealerSourceId)
      }

      await updateCrmDocumentTerm(term.id, {
        includedDealerSourceIds: [...included],
        excludedDealerSourceIds: [...excluded],
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmDocumentTerms(dealerSourceId) }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmDocumentTermsRoot }),
      ])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update this dealer’s terms.')
    } finally {
      setSavingTermId('')
    }
  }

  return (
    <Stack spacing={1.5}>
      <Stack spacing={0.25}>
        <Typography variant="h6" fontWeight={800}>Terms and Conditions</Typography>
        <Typography variant="body2" color="text.secondary">
          Turn document terms on or off for this dealer. Standard terms are inherited from Config.
        </Typography>
      </Stack>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Paper variant="outlined">
        <Tabs
          value={documentType}
          onChange={(_event, value: CrmDocumentType) => setDocumentType(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}
        >
          {DOCUMENT_TYPES.map((type) => <Tab key={type} value={type} label={DOCUMENT_TYPE_LABELS[type]} />)}
        </Tabs>
        <Stack spacing={1} sx={{ p: 1.5 }}>
          {termsQuery.isLoading ? (
            <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography>Loading terms…</Typography></Stack>
          ) : null}
          {!termsQuery.isLoading && terms.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No terms have been created for this document.</Typography>
          ) : null}
          {terms.map((term) => {
            const enabled = term.appliesToDealer === true
            return (
              <Paper key={term.id} variant="outlined" sx={{ p: 1.4, opacity: enabled ? 1 : 0.65 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between">
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                      <Typography fontWeight={800}>{term.title}</Typography>
                      <Chip size="small" variant="outlined" label={term.isDefault ? 'Standard' : 'Dealer-specific'} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6, whiteSpace: 'pre-wrap' }}>{term.body}</Typography>
                  </Box>
                  <FormControlLabel
                    sx={{ alignSelf: { xs: 'flex-start', md: 'center' }, flexShrink: 0 }}
                    control={(
                      <Switch
                        checked={enabled}
                        disabled={Boolean(savingTermId)}
                        onChange={(event) => void toggleTerm(term, event.target.checked)}
                      />
                    )}
                    label={savingTermId === term.id ? 'Saving…' : enabled ? 'Included' : 'Removed'}
                  />
                </Stack>
              </Paper>
            )
          })}
        </Stack>
      </Paper>
    </Stack>
  )
}

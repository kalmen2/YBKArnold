import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { Alert, Box, Button, Checkbox, Divider, FormControlLabel, Paper, Stack, TextField, Typography } from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { firebaseStorage } from '../auth/firebase'
import { LoadingPanel } from '../components/LoadingPanel'
import {
  fetchCrmQuotePrintSettings,
  updateCrmQuotePrintSettings,
  type CrmQuote,
  type CrmQuotePrintSettings,
} from '../features/crm/api'
import { DEFAULT_QUOTE_PRINT_SETTINGS, QuotePdfPreviewDialog } from '../features/crm/NativeQuotePdf'
import { QUERY_KEYS } from '../lib/queryKeys'

const sampleQuote: CrmQuote = {
  id: 'sample',
  dealerSourceId: '',
  dealerName: 'Sample Customer',
  companyName: 'Sample Customer',
  contactName: 'Jordan Smith',
  contactEmail: 'jordan@example.com',
  contactPhone: '(555) 555-0100',
  salesRep: 'House',
  projectType: 'Conference Table',
  opportunityDate: new Date().toISOString().slice(0, 10),
  opportunityStage: 'proposal_submission',
  quoteNumber: 'SAMPLE-R0',
  title: 'Sample Conference Room',
  description: null,
  status: 'draft',
  subtotal: 7450,
  freight: 450,
  freightDescription: 'Delivery and installation',
  totalAmount: 7900,
  currency: 'USD',
  paymentTerms: '50% deposit, balance before delivery',
  leadTime: '8–10 weeks',
  lineItems: [{
    id: 'sample-line',
    itemNumber: 1,
    description: 'Custom conference table with integrated wire management and durable commercial finish.',
    qty: 1,
    unitPrice: 7200,
    extPrice: 7200,
    images: [],
  }],
  additionalServices: [{ id: 'sample-service', title: 'Shop Drawing', description: 'Includes up to two revisions.', price: 250, images: [] }],
  shippingServices: [{ id: 'sample-shipping', title: 'Delivery & Installation', description: 'Scheduled delivery and installation.', price: 450, images: [] }],
  sentAt: null,
  acceptedAt: null,
  rejectedAt: null,
  notes: 'Pricing is valid for 30 days.',
  lastStatusChangedAt: new Date().toISOString(),
  createdByUid: null,
  createdByEmail: null,
  updatedAt: new Date().toISOString(),
}

export default function SalesQuoteLayoutPage() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: QUERY_KEYS.crmQuotePrintSettings,
    queryFn: fetchCrmQuotePrintSettings,
  })
  const [draft, setDraft] = useState<CrmQuotePrintSettings>(DEFAULT_QUOTE_PRINT_SETTINGS)
  const [addressText, setAddressText] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!settingsQuery.data?.settings) return
    setDraft(settingsQuery.data.settings)
    setAddressText(settingsQuery.data.settings.addressLines.join('\n'))
  }, [settingsQuery.data?.settings])

  const previewSettings = useMemo(() => ({
    ...draft,
    addressLines: addressText.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 5),
  }), [addressText, draft])

  const setField = <Key extends keyof CrmQuotePrintSettings>(key: Key, value: CrmQuotePrintSettings[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const handleLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setMessage({ severity: 'error', text: 'Logo must be an image file.' })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ severity: 'error', text: 'Logo must be 5 MB or smaller.' })
      return
    }

    setUploading(true)
    setMessage(null)
    try {
      const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0] || '.png'
      const path = `crm/opportunities/settings/quote-logo-${Date.now()}${extension}`
      const reference = storageRef(firebaseStorage, path)
      await uploadBytes(reference, file, { contentType: file.type })
      const url = await getDownloadURL(reference)
      setDraft((current) => ({ ...current, logoUrl: url, logoName: file.name }))
    } catch (error) {
      setMessage({ severity: 'error', text: error instanceof Error ? error.message : 'Logo upload failed.' })
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const result = await updateCrmQuotePrintSettings({
        logoUrl: draft.logoUrl,
        logoName: draft.logoName,
        companyName: draft.companyName,
        addressLines: previewSettings.addressLines,
        phone: draft.phone,
        email: draft.email,
        website: draft.website,
        headerText: draft.headerText,
        footerText: draft.footerText,
        accentColor: draft.accentColor,
        showPaymentTerms: draft.showPaymentTerms,
        showLeadTime: draft.showLeadTime,
        showFreight: draft.showFreight,
        customerInformation: draft.customerInformation,
        projectManagers: draft.projectManagers,
        depositRequestBody: draft.depositRequestBody,
        depositRequestTerms: draft.depositRequestTerms,
        orderConfirmationRequestedInfo: draft.orderConfirmationRequestedInfo,
        orderConfirmationNotes: draft.orderConfirmationNotes,
        orderConfirmationTerms: draft.orderConfirmationTerms,
      })
      setDraft(result.settings)
      setAddressText(result.settings.addressLines.join('\n'))
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmQuotePrintSettings })
      setMessage({ severity: 'success', text: 'Quote layout saved.' })
    } catch (error) {
      setMessage({ severity: 'error', text: error instanceof Error ? error.message : 'Could not save quote layout.' })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setDraft(DEFAULT_QUOTE_PRINT_SETTINGS)
    setAddressText('')
    setMessage(null)
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2.2 }}>
        <Stack spacing={0.5}>
          <Typography variant="h5" fontWeight={700}>Document Templates</Typography>
          <Typography color="text.secondary">Shared Arnold letterhead and editable defaults for estimates and order documents.</Typography>
        </Stack>
      </Paper>

      <LoadingPanel loading={settingsQuery.isLoading} message="Loading quote layout…" contained />
      {message ? <Alert severity={message.severity}>{message.text}</Alert> : null}

      {!settingsQuery.isLoading ? (
        <Paper variant="outlined" sx={{ p: 2.2 }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <Box sx={{ width: { xs: '100%', md: 220 } }}>
                <Stack spacing={1}>
                  <Typography fontWeight={700}>Logo</Typography>
                  <Box component="img" src={draft.logoUrl || DEFAULT_QUOTE_PRINT_SETTINGS.logoUrl || ''} alt="Quote logo" sx={{ width: '100%', height: 100, objectFit: 'contain', border: '1px solid', borderColor: 'divider', borderRadius: 1 }} />
                  <Button component="label" variant="outlined" startIcon={<CloudUploadRoundedIcon />} disabled={uploading}>
                    {uploading ? 'Uploading…' : 'Upload logo'}
                    <input hidden type="file" accept="image/*" onChange={handleLogoUpload} />
                  </Button>
                </Stack>
              </Box>
              <Stack spacing={1.4} flex={1}>
                <TextField label="Company name" value={draft.companyName} onChange={(event) => setField('companyName', event.target.value)} fullWidth />
                <TextField label="Address lines" value={addressText} onChange={(event) => setAddressText(event.target.value)} multiline minRows={3} helperText="One line per row, up to five lines" />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2}>
                  <TextField label="Phone" value={draft.phone || ''} onChange={(event) => setField('phone', event.target.value || null)} fullWidth />
                  <TextField label="Email" value={draft.email || ''} onChange={(event) => setField('email', event.target.value || null)} fullWidth />
                  <TextField label="Website" value={draft.website || ''} onChange={(event) => setField('website', event.target.value || null)} fullWidth />
                </Stack>
                <Typography variant="h6" fontWeight={800}>Estimate / Quote</Typography>
                <TextField label="Footer text" value={draft.footerText || ''} onChange={(event) => setField('footerText', event.target.value || null)} multiline minRows={3} />
                <Alert severity="info">Quote and order terms are managed in Config → Terms &amp; Conditions.</Alert>
                <TextField label="Accent color" type="color" value={draft.accentColor} onChange={(event) => setField('accentColor', event.target.value)} sx={{ width: 180 }} />
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <FormControlLabel control={<Checkbox checked={draft.showLeadTime} onChange={(event) => setField('showLeadTime', event.target.checked)} />} label="Show lead time" />
                  <FormControlLabel control={<Checkbox checked={draft.showPaymentTerms} onChange={(event) => setField('showPaymentTerms', event.target.checked)} />} label="Show payment terms" />
                  <FormControlLabel control={<Checkbox checked={draft.showFreight} onChange={(event) => setField('showFreight', event.target.checked)} />} label="Show freight" />
                </Stack>
                <Divider />
                <Typography variant="h6" fontWeight={800}>Order Confirmation</Typography>
                <TextField label="Default project managers" value={draft.projectManagers} onChange={(event) => setField('projectManagers', event.target.value)} helperText="Separate names with commas" />
                <TextField label="Deposit instructions" value={draft.depositRequestBody} onChange={(event) => setField('depositRequestBody', event.target.value)} multiline minRows={4} helperText="The percentage entered during conversion replaces the percentage in this message. There is no separate Deposit Request document." />
              </Stack>
            </Stack>

            <Stack direction="row" spacing={1} justifyContent="flex-end" useFlexGap flexWrap="wrap">
              <Button variant="text" startIcon={<RestartAltRoundedIcon />} onClick={handleReset}>Reset</Button>
              <Button variant="outlined" startIcon={<PictureAsPdfRoundedIcon />} onClick={() => setPreviewOpen(true)}>Preview PDF</Button>
              <Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={() => void handleSave()} disabled={saving || !draft.companyName.trim()}>{saving ? 'Saving…' : 'Save Templates'}</Button>
            </Stack>
          </Stack>
        </Paper>
      ) : null}

      <QuotePdfPreviewDialog open={previewOpen} quote={sampleQuote} settings={previewSettings} onClose={() => setPreviewOpen(false)} />
    </Stack>
  )
}

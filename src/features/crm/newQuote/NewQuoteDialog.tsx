// The single-page quote form.
//
// The staged Add Opportunity dialog is still there and still the default. This
// is the alternative: everything on one surface — who it is for, the header
// fields, the lines, the services — with Create opening the PDF to check before
// anything is saved. Laid out after Minimal's invoice create page.
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState, type ReactNode } from 'react'
import type { CrmContact, CrmDealer, CrmQuoteLineLibraryEntry } from '../api'
import { QUOTE_SENDER, type QuoteFormState, type QuoteServiceItemFormState } from '../quoteFormState'
import { NewQuoteLines } from './NewQuoteLines'
import { QuoteAccountDialog, type QuoteAccountSelection } from './QuoteAccountDialog'
import { QuoteContactDialog } from './QuoteContactDialog'
import { QuoteLibraryDialog } from './QuoteLibraryDialog'
import { QuoteServiceDialog, type QuoteServicePreset } from './QuoteServiceDialog'

const ADD_LEAD_TIME = '__add_lead_time__'

export type NewQuotePricing = {
  productTotal: number
  freightTotal: number
  discountAmount: number
  netTotal: number
}

function money(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function serviceLineTotal(item: QuoteServiceItemFormState) {
  return (Number(item.qty) || 0) * (Number(item.unitPrice) || 0)
}

export function NewQuoteDialog({
  open,
  form,
  pricing,
  dealers,
  contacts,
  isLoadingDealers,
  isLoadingContacts,
  selectedDealer,
  salesRepOptions,
  projectTypeOptions,
  leadTimeOptions,
  servicePresets,
  deliveryPresets,
  libraryEntries,
  isLoadingLibrary,
  isSaving,
  isUploadingImage,
  errorMessage,
  renderPreview,
  onPickDealer,
  onPickContact,
  onFormChange,
  onAddDealer,
  onAddContact,
  onAddLeadTime,
  onUseOldForm,
  onPickImage,
  onRemoveImage,
  onEditImage,
  onSaveContact,
  onInsertLibraryEntry,
  onSaveLibraryEntry,
  onCreate,
  onClose,
}: {
  open: boolean
  form: QuoteFormState
  pricing: NewQuotePricing
  dealers: CrmDealer[]
  contacts: CrmContact[]
  isLoadingDealers: boolean
  isLoadingContacts: boolean
  selectedDealer: CrmDealer | null
  salesRepOptions: readonly string[]
  projectTypeOptions: readonly string[]
  leadTimeOptions: readonly string[]
  servicePresets: QuoteServicePreset[]
  deliveryPresets: QuoteServicePreset[]
  libraryEntries: CrmQuoteLineLibraryEntry[]
  isLoadingLibrary: boolean
  isSaving: boolean
  isUploadingImage: boolean
  errorMessage: string | null
  /** The page owns the PDF machinery, so it supplies the preview. */
  renderPreview: () => ReactNode
  onPickDealer: (dealer: CrmDealer | null) => void
  onPickContact: (contact: CrmContact) => void
  onFormChange: (next: QuoteFormState) => void
  onAddDealer: (typedName: string) => void
  onAddContact: (typedName: string) => void
  onAddLeadTime: (leadTime: string) => void
  /** The staged form, still there while it is being retired. */
  onUseOldForm: () => void
  /** Hands the file to the page, which crops, uploads and writes it back. */
  onPickImage: (lineIndex: number, file: File) => void
  onRemoveImage: (lineIndex: number, imageId: string) => void
  /** Reopens the crop, zoom and size controls for a picture already added. */
  onEditImage: (lineIndex: number, imageId: string) => void
  onSaveContact: (details: { name: string, email: string, phone: string }) => void
  onInsertLibraryEntry: (entry: CrmQuoteLineLibraryEntry) => void
  /** Saves the line at this index, plus its sublines, under the given name. */
  onSaveLibraryEntry: (name: string, lineIndex: number) => Promise<void>
  onCreate: () => void
  onClose: () => void
}) {
  const [isAccountPickerOpen, setIsAccountPickerOpen] = useState(false)
  const [leadTimeDraft, setLeadTimeDraft] = useState<string | null>(null)
  const [isServiceDialogOpen, setIsServiceDialogOpen] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)
  const [isEditingAccount, setIsEditingAccount] = useState(false)
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [libraryTarget, setLibraryTarget] = useState<{ index: number, name: string } | null>(null)
  const [isSavingLibrary, setIsSavingLibrary] = useState(false)

  function patch(changes: Partial<QuoteFormState>) {
    onFormChange({ ...form, ...changes })
  }

  const addedServices = useMemo(
    () => [
      ...form.additionalServices.map((item) => ({ item, kind: 'service' as const })),
      ...form.shippingServices.map((item) => ({ item, kind: 'delivery' as const })),
    ].filter(({ item }) => item.title.trim() && (Number(item.qty) || 0) > 0),
    [form.additionalServices, form.shippingServices],
  )

  const hasContact = Boolean(form.contactName.trim() && form.contactEmail.trim())
  const hasAccount = Boolean(form.dealerSourceId.trim())

  const missing = useMemo(() => {
    const problems: string[] = []

    if (!hasAccount) problems.push('an account')
    if (!hasContact) problems.push('a contact')
    if (!form.quoteNumber.trim()) problems.push('a quote number')
    if (!form.title.trim()) problems.push('a project name')
    if (!form.salesRep.trim()) problems.push('a sales rep')
    if (!form.opportunityDateInput.trim()) problems.push('a date')
    if (!form.leadTime.trim()) problems.push('a lead time')
    if (!form.projectType.trim()) problems.push('a project type')

    return problems
  }, [form, hasAccount, hasContact])

  function applyAccount(selection: QuoteAccountSelection) {
    onPickContact(selection.contact)
    onFormChange({
      ...form,
      dealerSourceId: selection.dealer.sourceId,
      companyName: String(selection.dealer.name ?? '').trim(),
      contactName: String(selection.contact.name ?? '').trim(),
      contactEmail: String(selection.contact.primaryEmail ?? '').trim(),
      contactPhone: String(selection.contact.phone ?? '').trim(),
      salesRep: form.salesRep.trim()
        || String(selection.dealer.salesRep ?? '').trim()
        || 'House',
      paymentTerms: String(selection.dealer.paymentTerms ?? '').trim() || form.paymentTerms,
    })
    setIsAccountPickerOpen(false)
  }

  function saveLeadTime() {
    const value = (leadTimeDraft ?? '').trim()

    if (!value) {
      return
    }

    // Chosen straight away as well as saved — adding one is how you pick it.
    onAddLeadTime(value)
    patch({ leadTime: value })
    setLeadTimeDraft(null)
  }

  function addService(kind: 'service' | 'delivery', item: QuoteServiceItemFormState) {
    patch(kind === 'service'
      ? { additionalServices: [...form.additionalServices, item] }
      : { shippingServices: [...form.shippingServices, item] })
  }

  function removeService(kind: 'service' | 'delivery', id: string) {
    patch(kind === 'service'
      ? { additionalServices: form.additionalServices.filter((entry) => entry.id !== id) }
      : { shippingServices: form.shippingServices.filter((entry) => entry.id !== id) })
  }

  const renderAddressBlock = () => (
    <Stack
      divider={<Divider flexItem orientation="vertical" sx={{ borderStyle: 'dashed', display: { xs: 'none', md: 'block' } }} />}
      sx={{ p: 3, gap: { xs: 3, md: 5 }, flexDirection: { xs: 'column', md: 'row' } }}
    >
      {/* The sender never changes, so the space it would have taken goes to the
          two facts that identify this quote. Arnold's own details still print
          on the PDF; there was never anything here to choose. */}
      <Stack sx={{ width: '100%' }}>
        <Typography variant="h6" sx={{ color: 'text.disabled', mb: 1 }}>Quote:</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            required
            fullWidth
            label="Quote number"
            value={form.quoteNumber}
            onChange={(event) => patch({ quoteNumber: event.target.value })}
            InputLabelProps={{ shrink: true }}
            helperText="Unique to this quote."
          />
          <TextField
            required
            fullWidth
            type="date"
            label="Date"
            value={form.opportunityDateInput}
            onChange={(event) => patch({ opportunityDateInput: event.target.value })}
            InputLabelProps={{ shrink: true }}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5 }}>
          {`${QUOTE_SENDER.name} · ${QUOTE_SENDER.address} · ${QUOTE_SENDER.phone}`}
        </Typography>
      </Stack>

      <Stack sx={{ width: '100%' }}>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ color: 'text.disabled', flexGrow: 1 }}>To:</Typography>
          {hasContact ? (
            <CheckCircleRoundedIcon sx={{ fontSize: 19, color: 'success.main', mr: 0.5 }} />
          ) : (
            <ErrorOutlineRoundedIcon sx={{ fontSize: 19, color: 'error.main', mr: 0.5 }} />
          )}
          <Tooltip title={hasContact ? 'Edit these details' : 'Choose an account and contact'}>
            <IconButton onClick={() => (hasContact ? setIsEditingAccount(true) : setIsAccountPickerOpen(true))}>
              {hasContact ? <EditRoundedIcon fontSize="small" /> : <AddRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>

        {hasAccount || hasContact ? (
          <Stack spacing={0.75}>
            <Typography variant="subtitle2">{form.companyName || '—'}</Typography>
            <Typography variant="body2">{form.contactName || 'No contact chosen'}</Typography>
            <Typography variant="body2">{form.contactEmail || 'No email on this contact'}</Typography>
            {form.contactPhone ? <Typography variant="body2">{form.contactPhone}</Typography> : null}
          </Stack>
        ) : (
          <Typography variant="caption" sx={{ color: 'error.main' }}>
            Choose the account and the contact this quote goes to.
          </Typography>
        )}
      </Stack>
    </Stack>
  )

  const renderHeaderFields = () => (
    <Box
      sx={{
        p: 3,
        gap: 2,
        display: 'grid',
        bgcolor: 'grey.200',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
      }}
    >
      <TextField
        required
        label="Project name"
        value={form.title}
        onChange={(event) => patch({ title: event.target.value })}
        InputLabelProps={{ shrink: true }}
      />

      <TextField
        select
        required
        label="Sales rep"
        value={form.salesRep}
        onChange={(event) => patch({ salesRep: event.target.value })}
        InputLabelProps={{ shrink: true }}
      >
        {salesRepOptions.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
      </TextField>

      {/* Lead times are a shared list rather than free text, so two quotes
          never say "8-10 weeks" and "8 to 10 weeks" for the same thing. New
          adds to the list everybody picks from. */}
      <TextField
        select
        required
        label="Lead time"
        value={leadTimeOptions.includes(form.leadTime) ? form.leadTime : ''}
        onChange={(event) => {
          if (event.target.value === ADD_LEAD_TIME) {
            setLeadTimeDraft('')
            return
          }

          patch({ leadTime: event.target.value })
        }}
        InputLabelProps={{ shrink: true }}
      >
        {leadTimeOptions.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
        <Divider sx={{ borderStyle: 'dashed' }} />
        <MenuItem value={ADD_LEAD_TIME} sx={{ color: 'primary.main', fontWeight: 700 }}>
          New lead time…
        </MenuItem>
      </TextField>

      {/* Project type belongs with the other header facts: it describes the
          job, not any one line in it. */}
      <TextField
        select
        required
        label="Project type"
        value={form.projectType}
        onChange={(event) => patch({ projectType: event.target.value })}
        InputLabelProps={{ shrink: true }}
      >
        {projectTypeOptions.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
      </TextField>
    </Box>
  )

  const renderServices = () => (
    <Box sx={{ p: 3, pt: 0 }}>
      <Typography variant="h6" sx={{ color: 'text.disabled', mb: 2 }}>Services &amp; delivery:</Typography>

      {addedServices.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Nothing added. Shop drawings, field measures and the delivery method all go here.
        </Typography>
      ) : (
        <Stack spacing={1} sx={{ mb: 2 }}>
          {addedServices.map(({ item, kind }) => (
            <Paper key={item.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2">{item.title}</Typography>
                  {item.description ? (
                    <Typography variant="caption" color="text.secondary">{item.description}</Typography>
                  ) : null}
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {money(serviceLineTotal(item))}
                </Typography>
                <IconButton size="small" color="error" onClick={() => removeService(kind, item.id)}>
                  <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      <Button
        size="small"
        startIcon={<AddRoundedIcon />}
        onClick={() => setIsServiceDialogOpen(true)}
      >
        Add service or delivery
      </Button>
    </Box>
  )

  return (
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        // Only the explicit Cancel or close button discards the draft. A stray
        // backdrop click on a form this long should not throw the work away.
        if (reason !== 'backdropClick' && !isSaving) {
          onClose()
        }
      }}
      maxWidth={false}
      fullWidth
      PaperProps={{ sx: { width: 'min(1200px, 96vw)', bgcolor: 'background.default' } }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 3, py: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {isReviewing ? 'Check the quote' : 'New quote'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {isReviewing
              ? 'This is what the customer receives. Go back to change anything.'
              : 'Everything on one page. Create opens the PDF before anything is saved.'}
          </Typography>
        </Box>
        {isReviewing ? null : (
          <Button size="small" color="inherit" onClick={onUseOldForm} disabled={isSaving}>
            Old form
          </Button>
        )}
        <IconButton onClick={onClose} disabled={isSaving}><CloseRoundedIcon /></IconButton>
      </Stack>

      <Box sx={{ px: 3, pb: 3, overflowY: 'auto' }}>
        {errorMessage ? <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert> : null}

        {isReviewing ? (
          <Card sx={{ borderRadius: 2 }}>{renderPreview()}</Card>
        ) : (
          <Card sx={{ borderRadius: 2 }}>
            {renderAddressBlock()}
            {renderHeaderFields()}
            <NewQuoteLines
              lines={form.lineItems}
              discountPercent={form.discountPercent}
              productTotal={pricing.productTotal}
              freightTotal={pricing.freightTotal}
              discountAmount={pricing.discountAmount}
              netTotal={pricing.netTotal}
              isUploadingImage={isUploadingImage}
              onChange={(lineItems) => patch({ lineItems })}
              onDiscountPercentChange={(discountPercent) => patch({ discountPercent })}
              onPickImage={onPickImage}
              onRemoveImage={onRemoveImage}
              onEditImage={onEditImage}
              onOpenLibrary={() => setIsLibraryOpen(true)}
              onSaveToLibrary={(index) => setLibraryTarget({
                index,
                // The bold product line is what the block would be looked up by,
                // so it is offered as the name rather than a blank field.
                name: form.lineItems[index]?.description.split('\n')[0] ?? '',
              })}
            />
            {renderServices()}
          </Card>
        )}

        <Stack direction="row" spacing={2} justifyContent="flex-end" sx={{ mt: 3 }}>
          {isReviewing ? (
            <>
              <Button size="large" color="inherit" variant="outlined" disabled={isSaving} onClick={() => setIsReviewing(false)}>
                Back to the form
              </Button>
              <Button size="large" variant="contained" disabled={isSaving} onClick={onCreate}>
                {isSaving ? 'Creating…' : 'Create quote'}
              </Button>
            </>
          ) : (
            <>
              {missing.length > 0 ? (
                <Typography variant="body2" color="error.main" sx={{ alignSelf: 'center', mr: 'auto' }}>
                  {`Still needs ${missing.join(', ')}.`}
                </Typography>
              ) : null}
              <Button size="large" color="inherit" variant="outlined" onClick={onClose}>Cancel</Button>
              <Button
                size="large"
                variant="contained"
                disabled={missing.length > 0}
                onClick={() => setIsReviewing(true)}
              >
                Create
              </Button>
            </>
          )}
        </Stack>
      </Box>

      {isAccountPickerOpen ? (
        <QuoteAccountDialog
          open
          dealers={dealers}
          contacts={contacts}
          isLoadingDealers={isLoadingDealers}
          isLoadingContacts={isLoadingContacts}
          selectedDealer={selectedDealer}
          onPickDealer={onPickDealer}
          onSelect={applyAccount}
          onAddDealer={onAddDealer}
          onAddContact={onAddContact}
          onClose={() => setIsAccountPickerOpen(false)}
        />
      ) : null}

      {isServiceDialogOpen ? (
        <QuoteServiceDialog
          open
          servicePresets={servicePresets}
          deliveryPresets={deliveryPresets}
          onAdd={addService}
          onClose={() => setIsServiceDialogOpen(false)}
        />
      ) : null}

      {isEditingAccount ? (
        <QuoteContactDialog
          open
          companyName={form.companyName}
          contactName={form.contactName}
          contactEmail={form.contactEmail}
          contactPhone={form.contactPhone}
          onSave={(details) => {
            patch({
              contactName: details.name,
              contactEmail: details.email,
              contactPhone: details.phone,
            })
            onSaveContact(details)
            setIsEditingAccount(false)
          }}
          onChangeAccount={() => {
            setIsEditingAccount(false)
            setIsAccountPickerOpen(true)
          }}
          onClose={() => setIsEditingAccount(false)}
        />
      ) : null}

      {isLibraryOpen ? (
        <QuoteLibraryDialog
          open
          entries={libraryEntries}
          isLoading={isLoadingLibrary}
          errorMessage={null}
          onInsert={onInsertLibraryEntry}
          onClose={() => setIsLibraryOpen(false)}
        />
      ) : null}

      <Dialog
        open={libraryTarget !== null}
        onClose={() => (isSavingLibrary ? undefined : setLibraryTarget(null))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Save to library</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={libraryTarget?.name ?? ''}
            onChange={(event) => setLibraryTarget((current) => (
              current ? { ...current, name: event.target.value } : current
            ))}
            helperText="This line and its sublines are saved together."
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={isSavingLibrary} onClick={() => setLibraryTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={isSavingLibrary || !libraryTarget?.name.trim()}
            onClick={() => {
              if (!libraryTarget) {
                return
              }

              setIsSavingLibrary(true)
              void onSaveLibraryEntry(libraryTarget.name.trim(), libraryTarget.index)
                .finally(() => {
                  setIsSavingLibrary(false)
                  setLibraryTarget(null)
                })
            }}
          >
            {isSavingLibrary ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={leadTimeDraft !== null} onClose={() => setLeadTimeDraft(null)} maxWidth="xs" fullWidth>
        <DialogTitle>New lead time</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Lead time"
            placeholder="12 to 14 weeks"
            value={leadTimeDraft ?? ''}
            onChange={(event) => setLeadTimeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                saveLeadTime()
              }
            }}
            helperText="Added to the list everyone picks from."
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setLeadTimeDraft(null)}>Cancel</Button>
          <Button variant="contained" disabled={!leadTimeDraft?.trim()} onClick={saveLeadTime}>Add</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}

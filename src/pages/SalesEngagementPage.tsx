import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import {
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  TablePagination,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  createCrmDealerChatMessage,
  fetchCrmDealerChats,
  fetchCrmDealerDetail,
  fetchCrmDealers,
  removeCrmDealerChatMessage,
  updateCrmDealerChatMessage,
  updateCrmContact,
  updateCrmDealer,
  type CrmContact,
  type CrmDealer,
  type CrmDealerChatMessage,
  type CrmDealerDetail,
} from '../features/crm/api'
import { useDebounceValue } from '../hooks/useDebounceValue'
import { formatDateTime } from '../lib/formatters'

type EngagementFilter = 'ready' | 'not_ready'
type EngagementStatus = EngagementFilter | 'none'
type AccountTypeBucket = 'dealer' | 'designer' | 'none'
type QuickViewTab = 'info' | 'contacts' | 'chat'

type DealerQuickEditState = {
  name: string
  website: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  phone: string
  phone2: string
  salesRep: string
}

type ContactQuickEditState = {
  name: string
  primaryEmail: string
  phone: string
  phone2: string
  phoneAlt: string
}

const engagementTabs: Array<{ value: EngagementFilter; label: string }> = [
  { value: 'ready', label: 'Ready' },
  { value: 'not_ready', label: 'Not Ready' },
]

const accountTypeOptions: Array<{ value: AccountTypeBucket; label: string }> = [
  { value: 'dealer', label: 'Dealer' },
  { value: 'designer', label: 'Designer' },
  { value: 'none', label: 'None' },
]

function formatOptional(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()
  return normalized || '-'
}

function formatAddressLine(parts: Array<string | null | undefined>) {
  const normalized = parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)

  return normalized.length > 0
    ? normalized.join(', ')
    : '-'
}

function normalizeWebsiteHref(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    return ''
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized
  }

  return `https://${normalized}`
}

function formatNumberList(values: Array<string | null | undefined>) {
  const normalizedValues = values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)

  return normalizedValues.length > 0
    ? normalizedValues.join(' · ')
    : '-'
}

function createDealerQuickEditState(dealer: CrmDealer | CrmDealerDetail): DealerQuickEditState {
  return {
    name: String(dealer.name ?? '').trim(),
    website: String(dealer.website ?? '').trim(),
    address: String((dealer as CrmDealerDetail).address ?? '').trim(),
    city: String(dealer.city ?? '').trim(),
    state: String(dealer.state ?? '').trim(),
    zip: String((dealer as CrmDealerDetail).zip ?? '').trim(),
    country: String(dealer.country ?? '').trim(),
    phone: String(dealer.phone ?? '').trim(),
    phone2: String((dealer as CrmDealerDetail).phone2 ?? '').trim(),
    salesRep: String(dealer.salesRep ?? '').trim(),
  }
}

function createContactQuickEditState(contact: CrmContact): ContactQuickEditState {
  return {
    name: String(contact.name ?? '').trim(),
    primaryEmail: String(contact.primaryEmail ?? '').trim(),
    phone: String(contact.phone ?? '').trim(),
    phone2: String(contact.phone2 ?? '').trim(),
    phoneAlt: String(contact.phoneAlt ?? '').trim(),
  }
}

function resolveDealerName(dealer: CrmDealer) {
  const normalizedName = formatOptional(dealer.name)
  return normalizedName !== '-'
    ? normalizedName
    : dealer.sourceId
}

function resolveAccountTypeBucket(dealer: CrmDealer): AccountTypeBucket {
  const rawType = String(dealer.accountType || dealer.accountClass || '').trim().toLowerCase()

  if (rawType === 'designer') {
    return 'designer'
  }

  if (rawType === 'dealer') {
    return 'dealer'
  }

  return 'none'
}

function formatAccountTypeLabel(typeBucket: AccountTypeBucket) {
  if (typeBucket === 'dealer') {
    return 'Dealer'
  }

  if (typeBucket === 'designer') {
    return 'Designer'
  }

  return 'None'
}

function normalizeEngagementStatus(value: string | null | undefined): EngagementStatus {
  const normalized = String(value ?? '').trim().toLowerCase()

  if (normalized === 'ready' || normalized === 'yes') {
    return 'ready'
  }

  if (
    normalized === 'not_ready'
    || normalized === 'not ready'
    || normalized === 'notready'
    || normalized === 'no'
    || normalized === 'engagement'
  ) {
    return 'not_ready'
  }

  return 'none'
}

function formatEngagementStatusLabel(status: EngagementStatus) {
  if (status === 'ready') {
    return 'Ready'
  }

  if (status === 'not_ready') {
    return 'Not Ready'
  }

  return 'Unknown'
}

function resolveStatusChipColor(status: EngagementStatus): 'success' | 'error' | 'default' {
  if (status === 'ready') {
    return 'success'
  }

  if (status === 'not_ready') {
    return 'error'
  }

  return 'default'
}

type DealerCardProps = {
  dealer: CrmDealer
  onOpenDealer: (dealer: CrmDealer, initialTab?: QuickViewTab) => void
}

function DealerCard({ dealer, onOpenDealer }: DealerCardProps) {
  const accountName = resolveDealerName(dealer)
  const accountType = resolveAccountTypeBucket(dealer)
  const engagementStatus = normalizeEngagementStatus(dealer.engagementReadinessStatus)
  const accountWebsite = String(dealer.website ?? '').trim()
  const accountWebsiteLabel = formatOptional(accountWebsite)
  const accountWebsiteHref = normalizeWebsiteHref(accountWebsite)
  const accountState = formatOptional(dealer.state)
  const accountNote = formatOptional(dealer.engagementReadinessNote)
  const contextCount = dealer.contactCountSource ?? 0
  const chatMessageCount = Math.max(0, Number(dealer.chatMessageCount ?? 0) || 0)
  const updatedAt = formatDateTime(dealer.lastImportedAt)
  const accountPictureUrl = String(dealer.pictureUrl ?? '').trim() || undefined

  const handleOpenCard = () => {
    onOpenDealer(dealer)
  }

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpenDealer(dealer)
    }
  }

  const handleOpenChat = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onOpenDealer(dealer, 'chat')
  }

  return (
    <Paper
      variant="outlined"
      role="button"
      tabIndex={0}
      onClick={handleOpenCard}
      onKeyDown={handleCardKeyDown}
      sx={{
        p: 1.15,
        borderRadius: 2,
        borderColor: (theme) => alpha(theme.palette.primary.main, 0.2),
        display: 'flex',
        flexDirection: 'column',
        gap: 0.8,
        minHeight: 208,
        cursor: 'pointer',
        transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: (theme) => theme.shadows[3],
          borderColor: (theme) => alpha(theme.palette.primary.main, 0.4),
        },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between" sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0, flex: 1 }}>
          <Avatar
            src={accountPictureUrl}
            alt={accountName}
            sx={{ width: 38, height: 38, fontSize: 14, fontWeight: 700 }}
            imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
          >
            {accountName.charAt(0).toUpperCase() || '?'}
          </Avatar>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
              {accountName}
            </Typography>
            {accountWebsiteHref ? (
              <Typography
                variant="caption"
                component="a"
                href={accountWebsiteHref}
                target="_blank"
                rel="noopener noreferrer"
                color="primary"
                sx={{
                  display: 'inline-block',
                  textDecoration: 'none',
                  '&:hover': {
                    textDecoration: 'underline',
                  },
                }}
                onClick={(event) => {
                  event.stopPropagation()
                }}
                onKeyDown={(event) => {
                  event.stopPropagation()
                }}
              >
                {accountWebsiteLabel}
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary" noWrap>
                {accountWebsiteLabel}
              </Typography>
            )}
          </Box>
        </Stack>

        <IconButton
          size="small"
          aria-label={`Open chat for ${accountName}`}
          onClick={handleOpenChat}
          sx={{
            width: 34,
            height: 34,
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
            border: (theme) => `1px solid ${alpha(theme.palette.primary.main, 0.28)}`,
            '&:hover': {
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14),
            },
          }}
        >
          <Badge
            color="primary"
            badgeContent={chatMessageCount}
            max={99}
            invisible={chatMessageCount <= 0}
            sx={{
              '& .MuiBadge-badge': {
                fontSize: 10,
                minWidth: 16,
                height: 16,
                px: 0.45,
              },
            }}
          >
            <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 20 }} />
          </Badge>
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={0.55} sx={{ flexWrap: 'wrap', rowGap: 0.55 }}>
        <Chip
          size="small"
          color={resolveStatusChipColor(engagementStatus)}
          label={formatEngagementStatusLabel(engagementStatus)}
        />
        <Chip size="small" variant="outlined" label={formatAccountTypeLabel(accountType)} />
        <Chip size="small" variant="outlined" label={accountState} />
      </Stack>

      <Paper
        variant="outlined"
        sx={{
          p: 0.8,
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.04),
          borderColor: (theme) => alpha(theme.palette.primary.main, 0.15),
          minHeight: 76,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
          Readiness note
        </Typography>
        <Typography
          variant="body2"
          sx={{
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {accountNote}
        </Typography>
      </Paper>

      <Stack direction="row" spacing={0.6} alignItems="center" justifyContent="space-between" sx={{ mt: 'auto' }}>
        <Typography variant="caption" color="text.secondary">
          Contacts {contextCount} · Updated {updatedAt}
        </Typography>
      </Stack>
    </Paper>
  )
}

export default function SalesEngagementPage() {
  const { appUser, firebaseUser } = useAuth()
  const [statusFilter, setStatusFilter] = useState<EngagementFilter>('ready')
  const [accountType, setAccountType] = useState<AccountTypeBucket>('dealer')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(24)
  const [quickViewDealer, setQuickViewDealer] = useState<CrmDealer | null>(null)
  const [quickViewTab, setQuickViewTab] = useState<QuickViewTab>('info')
  const [quickViewActionError, setQuickViewActionError] = useState<string | null>(null)
  const [isEditingDealer, setIsEditingDealer] = useState(false)
  const [dealerDraft, setDealerDraft] = useState<DealerQuickEditState | null>(null)
  const [isSavingDealer, setIsSavingDealer] = useState(false)
  const [editingContactSourceId, setEditingContactSourceId] = useState('')
  const [contactDraft, setContactDraft] = useState<ContactQuickEditState | null>(null)
  const [isSavingContact, setIsSavingContact] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [isSendingChat, setIsSendingChat] = useState(false)
  const [editingChatMessageId, setEditingChatMessageId] = useState('')
  const [chatEditDraft, setChatEditDraft] = useState('')
  const [isSavingChatEdit, setIsSavingChatEdit] = useState(false)
  const [deletingChatMessageId, setDeletingChatMessageId] = useState('')

  const search = useDebounceValue(searchInput)

  useEffect(() => {
    setPage(0)
  }, [statusFilter, accountType, search])

  const dealersQuery = useQuery({
    queryKey: ['crm', 'engagement-grid', statusFilter, accountType, search, page, rowsPerPage],
    queryFn: () => fetchCrmDealers({
      limit: rowsPerPage,
      offset: page * rowsPerPage,
      search: search || undefined,
      accountType,
      // Keep legacy bucket values so filtering works even before functions are redeployed.
      engagementBucket: statusFilter === 'ready' ? 'yes' : 'no',
    }),
    placeholderData: (previousData) => previousData,
    staleTime: 60 * 1000,
  })

  const quickViewDealerId = quickViewDealer?.sourceId ?? ''

  const quickViewDealerQuery = useQuery({
    queryKey: ['crm', 'engagement-quick-view', quickViewDealerId],
    queryFn: () => fetchCrmDealerDetail(quickViewDealerId, {
      contactLimit: 50,
      contactOffset: 0,
      includeArchivedContacts: false,
    }),
    enabled: Boolean(quickViewDealerId),
    staleTime: 60 * 1000,
  })

  const quickViewChatsQuery = useQuery({
    queryKey: ['crm', 'engagement-quick-view-chat', quickViewDealerId],
    queryFn: () => fetchCrmDealerChats(quickViewDealerId, {
      limit: 200,
      offset: 0,
    }),
    enabled: Boolean(quickViewDealerId),
    staleTime: 20 * 1000,
  })

  const dealers = dealersQuery.data?.dealers ?? []
  const totalAccounts = typeof dealersQuery.data?.total === 'number'
    ? dealersQuery.data.total
    : dealers.length

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(totalAccounts / rowsPerPage) - 1)

    if (page > maxPage) {
      setPage(maxPage)
    }
  }, [page, rowsPerPage, totalAccounts])

  const errorMessage = dealersQuery.error instanceof Error
    ? dealersQuery.error.message
    : null

  const isInitialLoading = dealersQuery.isLoading && !dealersQuery.data
  const isQuickViewLoading = quickViewDealerQuery.isLoading && !quickViewDealerQuery.data
  const quickViewErrorMessage = quickViewDealerQuery.error instanceof Error
    ? quickViewDealerQuery.error.message
    : null
  const quickViewChatErrorMessage = quickViewChatsQuery.error instanceof Error
    ? quickViewChatsQuery.error.message
    : null

  const pageSummaryText = useMemo(() => {
    if (totalAccounts === 0) {
      return '0 accounts'
    }

    const start = page * rowsPerPage + 1
    const end = Math.min(totalAccounts, (page + 1) * rowsPerPage)
    return `${start}-${end} of ${totalAccounts}`
  }, [page, rowsPerPage, totalAccounts])

  const handleOpenQuickView = (dealer: CrmDealer, initialTab: QuickViewTab = 'info') => {
    setQuickViewDealer(dealer)
    setQuickViewTab(initialTab)
    setQuickViewActionError(null)
    setIsEditingDealer(false)
    setDealerDraft(createDealerQuickEditState(dealer))
    setEditingContactSourceId('')
    setContactDraft(null)
    setChatDraft('')
    setEditingChatMessageId('')
    setChatEditDraft('')
    setDeletingChatMessageId('')
  }

  const handleCloseQuickView = () => {
    setQuickViewDealer(null)
    setQuickViewActionError(null)
    setIsEditingDealer(false)
    setDealerDraft(null)
    setEditingContactSourceId('')
    setContactDraft(null)
    setChatDraft('')
    setEditingChatMessageId('')
    setChatEditDraft('')
    setDeletingChatMessageId('')
  }

  const quickViewDealerRecord = quickViewDealerQuery.data?.dealer ?? quickViewDealer
  const quickViewContacts = quickViewDealerQuery.data?.contacts ?? []
  const quickViewMessages = quickViewChatsQuery.data?.messages ?? []
  const quickViewChatTotal = quickViewChatsQuery.data?.total ?? Math.max(0, Number(quickViewDealerRecord?.chatMessageCount ?? 0) || 0)
  const quickViewContactTotal = quickViewDealerQuery.data?.contactsTotal ?? quickViewDealer?.contactCountSource ?? 0
  const quickViewName = quickViewDealerRecord ? resolveDealerName(quickViewDealerRecord) : 'Account details'
  const quickViewStatus = normalizeEngagementStatus(quickViewDealerRecord?.engagementReadinessStatus)
  const quickViewAccountType = quickViewDealerRecord ? resolveAccountTypeBucket(quickViewDealerRecord) : 'none'
  const quickViewAccountId = formatOptional(quickViewDealerRecord?.sourceId)
  const quickViewState = formatOptional(quickViewDealerRecord?.state)
  const quickViewEmail = formatOptional(quickViewDealerRecord?.email || quickViewDealerRecord?.ownerEmail)
  const quickViewPhone = formatOptional(quickViewDealerRecord?.phone)
  const quickViewSalesRep = formatOptional(quickViewDealerRecord?.salesRep)
  const quickViewWebsite = formatOptional(quickViewDealerRecord?.website)
  const quickViewWebsiteHref = normalizeWebsiteHref(quickViewDealerRecord?.website)
  const quickViewAddress = formatAddressLine([
    (quickViewDealerRecord as CrmDealerDetail | null)?.address,
    quickViewDealerRecord?.city,
    quickViewDealerRecord?.state,
    (quickViewDealerRecord as CrmDealerDetail | null)?.zip,
    quickViewDealerRecord?.country,
  ])
  const quickViewNote = formatOptional(quickViewDealerRecord?.engagementReadinessNote)
  const quickViewUpdatedAt = formatDateTime(quickViewDealerRecord?.lastImportedAt ?? null)
  const combinedQuickViewErrorMessage = quickViewActionError || quickViewErrorMessage || quickViewChatErrorMessage
  const currentUserUid = String(appUser?.uid || firebaseUser?.uid || '').trim()
  const currentUserEmail = String(appUser?.email || firebaseUser?.email || '').trim().toLowerCase()
  const isCurrentUserAdmin = Boolean(appUser?.isApproved && appUser?.isAdmin)

  useEffect(() => {
    if (!quickViewDealerRecord || isEditingDealer) {
      return
    }

    setDealerDraft(createDealerQuickEditState(quickViewDealerRecord))
  }, [isEditingDealer, quickViewDealerRecord])

  const handleSaveDealer = async () => {
    if (!quickViewDealerId || !dealerDraft) {
      return
    }

    setQuickViewActionError(null)
    setIsSavingDealer(true)

    try {
      await updateCrmDealer(quickViewDealerId, {
        name: dealerDraft.name.trim() || null,
        website: dealerDraft.website.trim() || null,
        address: dealerDraft.address.trim() || null,
        city: dealerDraft.city.trim() || null,
        state: dealerDraft.state.trim() || null,
        zip: dealerDraft.zip.trim() || null,
        country: dealerDraft.country.trim() || null,
        phone: dealerDraft.phone.trim() || null,
        phone2: dealerDraft.phone2.trim() || null,
        salesRep: dealerDraft.salesRep.trim() || null,
      })

      await Promise.all([
        quickViewDealerQuery.refetch(),
        dealersQuery.refetch(),
      ])

      setIsEditingDealer(false)
    } catch (error) {
      setQuickViewActionError(error instanceof Error ? error.message : 'Failed to update account.')
    } finally {
      setIsSavingDealer(false)
    }
  }

  const handleStartContactEdit = (contact: CrmContact) => {
    setQuickViewActionError(null)
    setEditingContactSourceId(contact.sourceId)
    setContactDraft(createContactQuickEditState(contact))
  }

  const handleCancelContactEdit = () => {
    setEditingContactSourceId('')
    setContactDraft(null)
  }

  const handleSaveContact = async () => {
    if (!editingContactSourceId || !contactDraft) {
      return
    }

    setQuickViewActionError(null)
    setIsSavingContact(true)

    try {
      await updateCrmContact(editingContactSourceId, {
        name: contactDraft.name.trim() || null,
        primaryEmail: contactDraft.primaryEmail.trim() || null,
        phone: contactDraft.phone.trim() || null,
        phone2: contactDraft.phone2.trim() || null,
        phoneAlt: contactDraft.phoneAlt.trim() || null,
      })

      await Promise.all([
        quickViewDealerQuery.refetch(),
        dealersQuery.refetch(),
      ])

      setEditingContactSourceId('')
      setContactDraft(null)
    } catch (error) {
      setQuickViewActionError(error instanceof Error ? error.message : 'Failed to update contact.')
    } finally {
      setIsSavingContact(false)
    }
  }

  const handleSendChatMessage = async () => {
    const nextMessage = chatDraft.trim()

    if (!quickViewDealerId || !nextMessage) {
      return
    }

    setQuickViewActionError(null)
    setIsSendingChat(true)

    try {
      await createCrmDealerChatMessage(quickViewDealerId, nextMessage)
      setChatDraft('')

      await Promise.all([
        quickViewChatsQuery.refetch(),
        dealersQuery.refetch(),
      ])
    } catch (error) {
      setQuickViewActionError(error instanceof Error ? error.message : 'Failed to send message.')
    } finally {
      setIsSendingChat(false)
    }
  }

  const canManageChatMessage = (message: CrmDealerChatMessage) => {
    if (isCurrentUserAdmin) {
      return true
    }

    const createdByUid = String(message.createdByUid ?? '').trim()
    const createdByEmail = String(message.createdByEmail ?? '').trim().toLowerCase()

    return Boolean(
      (currentUserUid && createdByUid && currentUserUid === createdByUid)
      || (currentUserEmail && createdByEmail && currentUserEmail === createdByEmail),
    )
  }

  const handleStartChatMessageEdit = (message: CrmDealerChatMessage) => {
    setQuickViewActionError(null)
    setEditingChatMessageId(message.id)
    setChatEditDraft(String(message.message ?? '').trim())
  }

  const handleCancelChatMessageEdit = () => {
    setEditingChatMessageId('')
    setChatEditDraft('')
  }

  const handleSaveChatMessageEdit = async () => {
    const nextMessage = chatEditDraft.trim()

    if (!quickViewDealerId || !editingChatMessageId || !nextMessage) {
      return
    }

    setQuickViewActionError(null)
    setIsSavingChatEdit(true)

    try {
      await updateCrmDealerChatMessage(quickViewDealerId, editingChatMessageId, nextMessage)
      await quickViewChatsQuery.refetch()
      setEditingChatMessageId('')
      setChatEditDraft('')
    } catch (error) {
      setQuickViewActionError(error instanceof Error ? error.message : 'Failed to update chat message.')
    } finally {
      setIsSavingChatEdit(false)
    }
  }

  const handleDeleteChatMessage = async (messageId: string) => {
    if (!quickViewDealerId || !messageId) {
      return
    }

    if (!window.confirm('Delete this chat message?')) {
      return
    }

    setQuickViewActionError(null)
    setDeletingChatMessageId(messageId)

    try {
      await removeCrmDealerChatMessage(quickViewDealerId, messageId)

      if (editingChatMessageId === messageId) {
        setEditingChatMessageId('')
        setChatEditDraft('')
      }

      await Promise.all([
        quickViewChatsQuery.refetch(),
        dealersQuery.refetch(),
      ])
    } catch (error) {
      setQuickViewActionError(error instanceof Error ? error.message : 'Failed to delete chat message.')
    } finally {
      setDeletingChatMessageId('')
    }
  }

  return (
    <Stack spacing={1.25}>
      <Paper
        variant="outlined"
        sx={{
          p: 1.25,
          borderColor: (theme) => alpha(theme.palette.primary.main, 0.25),
          background: (theme) => `linear-gradient(145deg, ${alpha(theme.palette.primary.main, 0.07)} 0%, ${alpha(theme.palette.info.main, 0.05)} 45%, ${theme.palette.background.paper} 100%)`,
        }}
      >
        <Stack spacing={1}>
          <Tabs
            value={statusFilter}
            onChange={(_event, nextValue: EngagementFilter) => {
              setStatusFilter(nextValue)
            }}
            variant="fullWidth"
            sx={{
              minHeight: 38,
              '& .MuiTabs-indicator': {
                display: 'none',
              },
              '& .MuiTab-root': {
                minHeight: 38,
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: 1,
                color: 'text.secondary',
              },
              '& .MuiTab-root.Mui-selected': {
                bgcolor: 'background.paper',
                color: 'text.primary',
              },
            }}
          >
            {engagementTabs.map((tabEntry) => (
              <Tab key={tabEntry.value} value={tabEntry.value} label={tabEntry.label} />
            ))}
          </Tabs>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
            <FormControl size="small" sx={{ width: { xs: '100%', md: 180 } }}>
              <InputLabel id="engagement-account-type-filter">Type filter</InputLabel>
              <Select
                labelId="engagement-account-type-filter"
                label="Type filter"
                value={accountType}
                onChange={(event) => {
                  setAccountType(event.target.value as AccountTypeBucket)
                }}
              >
                {accountTypeOptions.map((optionEntry) => (
                  <MenuItem key={optionEntry.value} value={optionEntry.value}>
                    {optionEntry.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              size="small"
              label="Search accounts"
              placeholder="Account name, id, owner, state"
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value)
              }}
              sx={{ flex: 1 }}
            />

            <Chip
              size="small"
              color="primary"
              variant="filled"
              label={`Total ${totalAccounts}`}
              sx={{ width: { xs: 'fit-content', md: 'auto' }, fontWeight: 700 }}
            />
          </Stack>
        </Stack>
      </Paper>

      <StatusAlerts errorMessage={errorMessage} />
      <LoadingPanel loading={isInitialLoading} message="Loading accounts..." contained />

      {!isInitialLoading ? (
        <Paper variant="outlined" sx={{ p: 1.15, borderRadius: 2 }}>
          <Stack spacing={1}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="body2" color="text.secondary">
                Showing {pageSummaryText}
              </Typography>

              {dealersQuery.isFetching ? (
                <Typography variant="caption" color="text.secondary">Updating...</Typography>
              ) : null}
            </Stack>

            {dealers.length === 0 ? (
              <Typography color="text.secondary">No accounts found for this selection.</Typography>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'repeat(2, minmax(0, 1fr))',
                    xl: 'repeat(3, minmax(0, 1fr))',
                  },
                  gap: 1,
                }}
              >
                {dealers.map((dealer) => (
                  <DealerCard key={dealer.sourceId} dealer={dealer} onOpenDealer={handleOpenQuickView} />
                ))}
              </Box>
            )}

            <TablePagination
              component="div"
              count={totalAccounts}
              page={page}
              onPageChange={(_event, nextPage) => {
                setPage(nextPage)
              }}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(event) => {
                const nextRowsPerPage = Number.parseInt(event.target.value, 10)
                setRowsPerPage(Number.isFinite(nextRowsPerPage) ? nextRowsPerPage : 24)
                setPage(0)
              }}
              rowsPerPageOptions={[24, 48, 96]}
              labelRowsPerPage="Accounts per page"
            />
          </Stack>
        </Paper>
      ) : null}

      <Dialog
        fullWidth
        maxWidth="md"
        open={Boolean(quickViewDealer)}
        onClose={handleCloseQuickView}
        sx={{
          '& .MuiDialog-paper': {
            minHeight: {
              xs: 560,
              sm: 650,
            },
          },
        }}
      >
        <DialogTitle>{quickViewName}</DialogTitle>
        <DialogContent
          dividers
          sx={{
            minHeight: {
              xs: 420,
              sm: 500,
            },
          }}
        >
          <LoadingPanel loading={isQuickViewLoading} message="Loading account details..." contained />
          <StatusAlerts errorMessage={combinedQuickViewErrorMessage} />

          {!isQuickViewLoading && quickViewDealerRecord ? (
            <Stack
              spacing={1.15}
              sx={{
                minHeight: {
                  xs: 360,
                  sm: 440,
                },
              }}
            >
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                <Stack direction="row" spacing={0.7} sx={{ flexWrap: 'wrap' }}>
                  <Chip size="small" color={resolveStatusChipColor(quickViewStatus)} label={formatEngagementStatusLabel(quickViewStatus)} />
                  <Chip size="small" variant="outlined" label={formatAccountTypeLabel(quickViewAccountType)} />
                  <Chip size="small" variant="outlined" label={quickViewState} />
                </Stack>

                <Typography variant="caption" color="text.secondary">
                  Updated {quickViewUpdatedAt}
                </Typography>
              </Stack>

              <Tabs
                value={quickViewTab}
                onChange={(_event, nextTab: QuickViewTab) => {
                  setQuickViewTab(nextTab)
                  setQuickViewActionError(null)
                }}
                variant="fullWidth"
                sx={{
                  minHeight: 34,
                  '& .MuiTab-root': {
                    minHeight: 34,
                    textTransform: 'none',
                    fontWeight: 700,
                    fontSize: 12,
                  },
                }}
              >
                <Tab value="info" label="Info" />
                <Tab value="contacts" label={`Contacts (${quickViewContactTotal})`} />
                <Tab value="chat" label={`Chat (${quickViewChatTotal})`} />
              </Tabs>

              {quickViewTab === 'info' ? (
                <Stack
                  spacing={1}
                  sx={{
                    minHeight: {
                      xs: 280,
                      sm: 330,
                    },
                  }}
                >
                  <Stack direction="row" spacing={0.75} justifyContent="flex-end">
                    {isEditingDealer ? (
                      <>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<CloseRoundedIcon fontSize="small" />}
                          onClick={() => {
                            setIsEditingDealer(false)
                            setDealerDraft(quickViewDealerRecord ? createDealerQuickEditState(quickViewDealerRecord) : null)
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<SaveRoundedIcon fontSize="small" />}
                          onClick={handleSaveDealer}
                          disabled={isSavingDealer || !dealerDraft}
                        >
                          {isSavingDealer ? 'Saving...' : 'Save'}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<EditRoundedIcon fontSize="small" />}
                        onClick={() => {
                          setIsEditingDealer(true)
                          setDealerDraft(createDealerQuickEditState(quickViewDealerRecord))
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </Stack>

                  {!isEditingDealer ? (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                          xs: '1fr',
                          sm: 'repeat(2, minmax(0, 1fr))',
                        },
                        gap: 1,
                      }}
                    >
                      <Paper variant="outlined" sx={{ p: 0.9 }}>
                        <Typography variant="caption" color="text.secondary">Account ID</Typography>
                        <Typography variant="body2">{quickViewAccountId}</Typography>
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 0.9 }}>
                        <Typography variant="caption" color="text.secondary">Website</Typography>
                        {quickViewWebsiteHref ? (
                          <Typography
                            component="a"
                            href={quickViewWebsiteHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="body2"
                            color="primary"
                            sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                          >
                            {quickViewWebsite}
                          </Typography>
                        ) : (
                          <Typography variant="body2">{quickViewWebsite}</Typography>
                        )}
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 0.9 }}>
                        <Typography variant="caption" color="text.secondary">Address</Typography>
                        <Typography variant="body2">{quickViewAddress}</Typography>
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 0.9 }}>
                        <Typography variant="caption" color="text.secondary">Email</Typography>
                        <Typography variant="body2">{quickViewEmail}</Typography>
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 0.9 }}>
                        <Typography variant="caption" color="text.secondary">Numbers</Typography>
                        <Typography variant="body2">{formatNumberList([quickViewPhone, (quickViewDealerRecord as CrmDealerDetail | null)?.phone2])}</Typography>
                      </Paper>

                      <Paper variant="outlined" sx={{ p: 0.9 }}>
                        <Typography variant="caption" color="text.secondary">Sales rep</Typography>
                        <Typography variant="body2">{quickViewSalesRep}</Typography>
                      </Paper>
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                          xs: '1fr',
                          sm: 'repeat(2, minmax(0, 1fr))',
                        },
                        gap: 1,
                      }}
                    >
                      <TextField
                        size="small"
                        label="Account name"
                        value={dealerDraft?.name ?? ''}
                        onChange={(event) => {
                          setDealerDraft((current) => current ? { ...current, name: event.target.value } : current)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Website"
                        value={dealerDraft?.website ?? ''}
                        onChange={(event) => {
                          setDealerDraft((current) => current ? { ...current, website: event.target.value } : current)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Phone"
                        value={dealerDraft?.phone ?? ''}
                        onChange={(event) => {
                          setDealerDraft((current) => current ? { ...current, phone: event.target.value } : current)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Phone 2"
                        value={dealerDraft?.phone2 ?? ''}
                        onChange={(event) => {
                          setDealerDraft((current) => current ? { ...current, phone2: event.target.value } : current)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Sales rep"
                        value={dealerDraft?.salesRep ?? ''}
                        onChange={(event) => {
                          setDealerDraft((current) => current ? { ...current, salesRep: event.target.value } : current)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Address"
                        value={dealerDraft?.address ?? ''}
                        onChange={(event) => {
                          setDealerDraft((current) => current ? { ...current, address: event.target.value } : current)
                        }}
                      />
                      <TextField
                        size="small"
                        label="City"
                        value={dealerDraft?.city ?? ''}
                        onChange={(event) => {
                          setDealerDraft((current) => current ? { ...current, city: event.target.value } : current)
                        }}
                      />
                      <TextField
                        size="small"
                        label="State"
                        value={dealerDraft?.state ?? ''}
                        onChange={(event) => {
                          setDealerDraft((current) => current ? { ...current, state: event.target.value } : current)
                        }}
                      />
                      <TextField
                        size="small"
                        label="ZIP"
                        value={dealerDraft?.zip ?? ''}
                        onChange={(event) => {
                          setDealerDraft((current) => current ? { ...current, zip: event.target.value } : current)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Country"
                        value={dealerDraft?.country ?? ''}
                        onChange={(event) => {
                          setDealerDraft((current) => current ? { ...current, country: event.target.value } : current)
                        }}
                      />
                    </Box>
                  )}

                  <Paper
                    variant="outlined"
                    sx={{
                      p: 0.9,
                      bgcolor: (theme) => alpha(theme.palette.primary.main, 0.04),
                      borderColor: (theme) => alpha(theme.palette.primary.main, 0.15),
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                      Readiness note
                    </Typography>
                    <Typography variant="body2">{quickViewNote}</Typography>
                  </Paper>
                </Stack>
              ) : null}

              {quickViewTab === 'contacts' ? (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 0.9,
                    minHeight: {
                      xs: 280,
                      sm: 330,
                    },
                  }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                    Contacts ({quickViewContactTotal})
                  </Typography>

                  {quickViewContacts.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">No contacts found.</Typography>
                  ) : (
                    <Stack spacing={0.75}>
                      {quickViewContacts.slice(0, 25).map((contact) => {
                        const isEditingThisContact = editingContactSourceId === contact.sourceId

                        if (isEditingThisContact && contactDraft) {
                          return (
                            <Paper key={contact.sourceId} variant="outlined" sx={{ p: 0.75 }}>
                              <Stack spacing={0.65}>
                                <TextField
                                  size="small"
                                  label="Name"
                                  value={contactDraft.name}
                                  onChange={(event) => {
                                    setContactDraft((current) => current ? { ...current, name: event.target.value } : current)
                                  }}
                                />
                                <TextField
                                  size="small"
                                  label="Primary email"
                                  value={contactDraft.primaryEmail}
                                  onChange={(event) => {
                                    setContactDraft((current) => current ? { ...current, primaryEmail: event.target.value } : current)
                                  }}
                                />
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.65}>
                                  <TextField
                                    size="small"
                                    label="Phone"
                                    value={contactDraft.phone}
                                    onChange={(event) => {
                                      setContactDraft((current) => current ? { ...current, phone: event.target.value } : current)
                                    }}
                                  />
                                  <TextField
                                    size="small"
                                    label="Phone 2"
                                    value={contactDraft.phone2}
                                    onChange={(event) => {
                                      setContactDraft((current) => current ? { ...current, phone2: event.target.value } : current)
                                    }}
                                  />
                                  <TextField
                                    size="small"
                                    label="Phone alt"
                                    value={contactDraft.phoneAlt}
                                    onChange={(event) => {
                                      setContactDraft((current) => current ? { ...current, phoneAlt: event.target.value } : current)
                                    }}
                                  />
                                </Stack>

                                <Stack direction="row" spacing={0.6} justifyContent="flex-end">
                                  <Button size="small" variant="outlined" onClick={handleCancelContactEdit}>Cancel</Button>
                                  <Button size="small" variant="contained" onClick={handleSaveContact} disabled={isSavingContact}>
                                    {isSavingContact ? 'Saving...' : 'Save'}
                                  </Button>
                                </Stack>
                              </Stack>
                            </Paper>
                          )
                        }

                        const contactName = formatOptional(contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`)
                        const contactEmail = formatOptional(contact.primaryEmail || contact.secondaryEmail)
                        const contactNumbers = formatNumberList([contact.phone, contact.phone2, contact.phoneAlt])

                        return (
                          <Paper key={contact.sourceId} variant="outlined" sx={{ p: 0.75 }}>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                              <Stack spacing={0.2} sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{contactName}</Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{contactEmail}</Typography>
                                <Typography variant="caption" color="text.secondary">{contactNumbers}</Typography>
                              </Stack>

                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => {
                                  handleStartContactEdit(contact)
                                }}
                              >
                                Edit
                              </Button>
                            </Stack>
                          </Paper>
                        )
                      })}
                    </Stack>
                  )}
                </Paper>
              ) : null}

              {quickViewTab === 'chat' ? (
                <Stack
                  spacing={0.85}
                  sx={{
                    minHeight: {
                      xs: 280,
                      sm: 330,
                    },
                  }}
                >
                  <Paper variant="outlined" sx={{ p: 0.75, maxHeight: 280, overflowY: 'auto' }}>
                    <LoadingPanel loading={quickViewChatsQuery.isLoading && !quickViewChatsQuery.data} message="Loading chat..." contained />

                    {quickViewMessages.length === 0 && !quickViewChatsQuery.isLoading ? (
                      <Typography variant="body2" color="text.secondary">No chat messages yet.</Typography>
                    ) : (
                      <Stack spacing={0.7}>
                        {quickViewMessages.map((message) => {
                          const isEditingThisMessage = editingChatMessageId === message.id
                          const canManageMessage = canManageChatMessage(message)
                          const isDeletingThisMessage = deletingChatMessageId === message.id
                          const hasOtherDeletePending = Boolean(deletingChatMessageId && deletingChatMessageId !== message.id)
                          const editedAt = formatDateTime(message.updatedAt ?? null)
                          const showEditedTimestamp = Boolean(message.updatedAt && editedAt !== '-')

                          if (isEditingThisMessage && canManageMessage) {
                            return (
                              <Paper key={message.id} variant="outlined" sx={{ p: 0.7 }}>
                                <Stack spacing={0.7}>
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    Editing your message
                                  </Typography>
                                  <TextField
                                    size="small"
                                    multiline
                                    minRows={2}
                                    maxRows={6}
                                    value={chatEditDraft}
                                    onChange={(event) => {
                                      setChatEditDraft(event.target.value)
                                    }}
                                  />
                                  <Stack direction="row" spacing={0.6} justifyContent="flex-end">
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      onClick={handleCancelChatMessageEdit}
                                      disabled={isSavingChatEdit}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="small"
                                      variant="contained"
                                      onClick={handleSaveChatMessageEdit}
                                      disabled={isSavingChatEdit || !chatEditDraft.trim()}
                                    >
                                      {isSavingChatEdit ? 'Saving...' : 'Save'}
                                    </Button>
                                  </Stack>
                                </Stack>
                              </Paper>
                            )
                          }

                          return (
                            <Paper key={message.id} variant="outlined" sx={{ p: 0.7 }}>
                              <Stack spacing={0.45}>
                                <Stack direction="row" spacing={0.8} justifyContent="space-between" alignItems="flex-start">
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    {formatOptional(message.createdByName || message.createdByEmail)} · {formatDateTime(message.createdAt)}
                                    {showEditedTimestamp ? ` · Edited ${editedAt}` : ''}
                                  </Typography>

                                  {canManageMessage ? (
                                    <Stack direction="row" spacing={0.45}>
                                      <Button
                                        size="small"
                                        variant="text"
                                        onClick={() => {
                                          handleStartChatMessageEdit(message)
                                        }}
                                        disabled={isSavingChatEdit || isDeletingThisMessage || hasOtherDeletePending}
                                      >
                                        Edit
                                      </Button>
                                      <Button
                                        size="small"
                                        color="error"
                                        variant="text"
                                        onClick={() => {
                                          void handleDeleteChatMessage(message.id)
                                        }}
                                        disabled={isSavingChatEdit || Boolean(deletingChatMessageId)}
                                      >
                                        {isDeletingThisMessage ? 'Deleting...' : 'Delete'}
                                      </Button>
                                    </Stack>
                                  ) : null}
                                </Stack>

                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                                  {formatOptional(message.message)}
                                </Typography>
                              </Stack>
                            </Paper>
                          )
                        })}
                      </Stack>
                    )}
                  </Paper>

                  <TextField
                    label="Write update"
                    multiline
                    minRows={2}
                    maxRows={6}
                    value={chatDraft}
                    onChange={(event) => {
                      setChatDraft(event.target.value)
                    }}
                  />

                  <Stack direction="row" justifyContent="flex-end">
                    <Button
                      variant="contained"
                      onClick={handleSendChatMessage}
                      disabled={isSendingChat || !chatDraft.trim()}
                    >
                      {isSendingChat ? 'Sending...' : 'Send'}
                    </Button>
                  </Stack>
                </Stack>
              ) : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseQuickView}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

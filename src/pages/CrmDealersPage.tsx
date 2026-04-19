import ContactsRoundedIcon from '@mui/icons-material/ContactsRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FacebookRoundedIcon from '@mui/icons-material/FacebookRounded'
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded'
import LinkedInIcon from '@mui/icons-material/LinkedIn'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import PinterestIcon from '@mui/icons-material/Pinterest'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import TwitterIcon from '@mui/icons-material/Twitter'
import YouTubeIcon from '@mui/icons-material/YouTube'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Collapse,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, unstable_usePrompt, useBeforeUnload, useSearchParams } from 'react-router-dom'
import { StatusAlerts } from '../components/StatusAlerts'
import { useDataLoader } from '../hooks/useDataLoader'
import { useDebounceValue } from '../hooks/useDebounceValue'
import { formatDate, formatStatusLabel } from '../lib/formatters'
import {
  createCrmDealerContact,
  fetchCrmDealerDetail,
  fetchCrmDealers,
  fetchCrmOrders,
  removeCrmContact,
  updateCrmContact,
  updateCrmDealer,
  type CrmDealer,
  type CrmDealerDetailResponse,
  type CrmDealersResponse,
  type CrmOrder,
} from '../features/crm/api'

function formatSocialLabel(value: string) {
  const normalized = String(value)
    .trim()
    .replace(/[_-]+/g, ' ')

  if (!normalized) {
    return 'Link'
  }

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function resolveSocialVisual(platform: string, href: string) {
  const source = `${platform} ${href}`.toLowerCase()

  if (source.includes('facebook')) {
    return {
      icon: <FacebookRoundedIcon sx={{ fontSize: 16 }} />,
      foreground: '#1877f2',
      background: '#eaf2ff',
      hoverBackground: '#dbe9ff',
    }
  }

  if (source.includes('linkedin')) {
    return {
      icon: <LinkedInIcon sx={{ fontSize: 16 }} />,
      foreground: '#0a66c2',
      background: '#e8f2ff',
      hoverBackground: '#dbe9ff',
    }
  }

  if (source.includes('twitter') || source.includes('x.com')) {
    return {
      icon: <TwitterIcon sx={{ fontSize: 16 }} />,
      foreground: '#1d9bf0',
      background: '#eaf6ff',
      hoverBackground: '#daf0ff',
    }
  }

  if (source.includes('youtube') || source.includes('youtu.be')) {
    return {
      icon: <YouTubeIcon sx={{ fontSize: 16 }} />,
      foreground: '#ff0033',
      background: '#ffeaf0',
      hoverBackground: '#ffdbe6',
    }
  }

  if (source.includes('pinterest')) {
    return {
      icon: <PinterestIcon sx={{ fontSize: 16 }} />,
      foreground: '#bd081c',
      background: '#ffebed',
      hoverBackground: '#ffe0e4',
    }
  }

  return {
    icon: <LanguageRoundedIcon sx={{ fontSize: 16 }} />,
    foreground: '#0f4c81',
    background: '#eaf2fb',
    hoverBackground: '#ddeafb',
  }
}

function displayContactName(contact: CrmDealerDetailResponse['contacts'][number]) {
  if (contact.name) {
    return contact.name
  }

  const nameFromParts = [contact.firstName, contact.lastName]
    .filter((entry) => Boolean(entry && entry.trim()))
    .join(' ')

  return nameFromParts || 'Unnamed contact'
}

type DealerEmailDraft = {
  id: string
  value: string
}

type DealerSocialLinkDraft = {
  id: string
  platform: string
  url: string
}

const socialPlatformOptions = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'x', label: 'X / Twitter' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'website', label: 'Website' },
  { value: 'other', label: 'Other' },
] as const

function normalizeSocialPlatform(value: string) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

function resolveSocialPlatformChoice(value: string) {
  const normalized = normalizeSocialPlatform(value)

  if (!normalized) {
    return 'other'
  }

  if (socialPlatformOptions.some((entry) => entry.value === normalized)) {
    return normalized
  }

  if (normalized.startsWith('facebook')) {
    return 'facebook'
  }

  if (normalized.startsWith('instagram')) {
    return 'instagram'
  }

  if (normalized.startsWith('linkedin')) {
    return 'linkedin'
  }

  if (normalized === 'twitter' || normalized.startsWith('x')) {
    return 'x'
  }

  if (normalized.startsWith('youtube') || normalized.startsWith('youtu')) {
    return 'youtube'
  }

  if (normalized.startsWith('pinterest')) {
    return 'pinterest'
  }

  if (normalized.startsWith('tiktok')) {
    return 'tiktok'
  }

  if (normalized.startsWith('website') || normalized.startsWith('http')) {
    return 'website'
  }

  return 'other'
}

function createEmailRow(value = '', index = 0): DealerEmailDraft {
  return {
    id: `email-${index}-${Math.random().toString(36).slice(2, 9)}`,
    value,
  }
}

function createSocialLinkRow(platform = 'website', url = '', index = 0): DealerSocialLinkDraft {
  return {
    id: `social-${index}-${Math.random().toString(36).slice(2, 9)}`,
    platform: resolveSocialPlatformChoice(platform),
    url,
  }
}

type DealerFormState = {
  sourceId: string
  name: string
  owner: string
  ownerEmail: string
  salesRep: string
  phone: string
  phone2: string
  website: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  accountText: string
  pictureUrl: string
  emails: DealerEmailDraft[]
  socialLinks: DealerSocialLinkDraft[]
  isArchived: boolean
  isFavorite: boolean
}

type ContactFormState = {
  name: string
  firstName: string
  lastName: string
  primaryEmail: string
  secondaryEmail: string
  email3: string
  email4: string
  salesUnit: string
  phone: string
  phone2: string
  phoneAlt: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  gender: string
  contactTypeId: string
  photoUrl: string
  isArchived: boolean
}

function createDealerFormState(dealer: CrmDealerDetailResponse['dealer']): DealerFormState {
  const normalizedEmails = Array.isArray(dealer.emails)
    ? dealer.emails
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
    : []
  const fallbackEmails = [dealer.email, dealer.email2]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
  const emailRows = (normalizedEmails.length > 0 ? normalizedEmails : fallbackEmails)
    .map((value, index) => createEmailRow(value, index))

  const socialLinkRows = Object.entries(dealer.socialMediaLinks ?? {})
    .map(([platform, url], index) => {
      const href = String(url ?? '').trim()

      if (!href) {
        return null
      }

      return createSocialLinkRow(platform, href, index)
    })
    .filter((entry): entry is DealerSocialLinkDraft => Boolean(entry))

  return {
    sourceId: dealer.sourceId,
    name: dealer.name || '',
    owner: dealer.owner || '',
    ownerEmail: dealer.ownerEmail || '',
    salesRep: dealer.salesRep || '',
    phone: dealer.phone || '',
    phone2: dealer.phone2 || '',
    website: dealer.website || '',
    address: dealer.address || '',
    city: dealer.city || '',
    state: dealer.state || '',
    zip: dealer.zip || '',
    country: dealer.country || '',
    accountText: dealer.accountText || '',
    pictureUrl: dealer.pictureUrl || '',
    emails: emailRows.length > 0 ? emailRows : [createEmailRow('', 0)],
    socialLinks: socialLinkRows,
    isArchived: Boolean(dealer.isArchived),
    isFavorite: Boolean(dealer.isFavorite),
  }
}

function serializeDealerFormState(form: DealerFormState | null) {
  if (!form) {
    return ''
  }

  const normalizedEmails = form.emails
    .map((entry) => entry.value.trim())
    .filter(Boolean)

  const normalizedSocialLinks = form.socialLinks
    .map((entry) => ({
      platform: normalizeSocialPlatform(entry.platform),
      url: entry.url.trim(),
    }))
    .filter((entry) => Boolean(entry.platform && entry.url))
    .sort((left, right) => `${left.platform}:${left.url}`.localeCompare(`${right.platform}:${right.url}`))

  return JSON.stringify({
    sourceId: form.sourceId,
    name: form.name.trim(),
    owner: form.owner.trim(),
    ownerEmail: form.ownerEmail.trim(),
    salesRep: form.salesRep.trim(),
    phone: form.phone.trim(),
    phone2: form.phone2.trim(),
    website: form.website.trim(),
    address: form.address.trim(),
    city: form.city.trim(),
    state: form.state.trim(),
    zip: form.zip.trim(),
    country: form.country.trim(),
    accountText: form.accountText.trim(),
    pictureUrl: form.pictureUrl.trim(),
    emails: normalizedEmails,
    socialLinks: normalizedSocialLinks,
    isArchived: Boolean(form.isArchived),
    isFavorite: Boolean(form.isFavorite),
  })
}

function createEmptyContactFormState(): ContactFormState {
  return {
    name: '',
    firstName: '',
    lastName: '',
    primaryEmail: '',
    secondaryEmail: '',
    email3: '',
    email4: '',
    salesUnit: '',
    phone: '',
    phone2: '',
    phoneAlt: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    gender: '',
    contactTypeId: '',
    photoUrl: '',
    isArchived: false,
  }
}

function createContactFormState(contact: CrmDealerDetailResponse['contacts'][number]): ContactFormState {
  return {
    name: contact.name || '',
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    primaryEmail: contact.primaryEmail || '',
    secondaryEmail: contact.secondaryEmail || '',
    email3: contact.email3 || '',
    email4: contact.email4 || '',
    salesUnit: contact.salesUnit || '',
    phone: contact.phone || '',
    phone2: contact.phone2 || '',
    phoneAlt: contact.phoneAlt || '',
    address: contact.address || '',
    city: contact.city || '',
    state: contact.state || '',
    zip: contact.zip || '',
    country: contact.country || '',
    gender: contact.gender || '',
    contactTypeId: contact.contactTypeId || '',
    photoUrl: contact.photoUrl || '',
    isArchived: Boolean(contact.isArchived),
  }
}

export default function CrmDealersPage() {
  const [searchParams] = useSearchParams()

  const [dealers, setDealers] = useState<CrmDealer[]>([])
  const [dealersTotal, setDealersTotal] = useState(0)
  const [selectedDealerId, setSelectedDealerId] = useState('')
  const [dealerDetail, setDealerDetail] = useState<CrmDealerDetailResponse | null>(null)

  const [dealerOrders, setDealerOrders] = useState<CrmOrder[]>([])
  const [detailsTab, setDetailsTab] = useState<'contacts' | 'orders'>('contacts')
  const [isAccountInfoExpanded, setIsAccountInfoExpanded] = useState(true)

  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [isLoadingSalesData, setIsLoadingSalesData] = useState(false)

  const [salesDataError, setSalesDataError] = useState<string | null>(null)

  const [dealerPage, setDealerPage] = useState(0)
  const [dealerRowsPerPage, setDealerRowsPerPage] = useState(25)
  const [dealerSearchInput, setDealerSearchInput] = useState('')
  const dealerSearch = useDebounceValue(dealerSearchInput)

  const [contactSearchInput, setContactSearchInput] = useState('')
  const contactSearch = useDebounceValue(contactSearchInput)
  const [includeArchivedContacts, setIncludeArchivedContacts] = useState(false)
  const [contactPage, setContactPage] = useState(0)
  const [contactRowsPerPage, setContactRowsPerPage] = useState(25)

  const [dealerForm, setDealerForm] = useState<DealerFormState | null>(null)
  const [dealerFormSavedSnapshot, setDealerFormSavedSnapshot] = useState('')
  const [isSavingDealer, setIsSavingDealer] = useState(false)

  const dealerFormRef = useRef<DealerFormState | null>(null)
  const dealerFormSavedSnapshotRef = useRef('')

  const [contactEditorMode, setContactEditorMode] = useState<'create' | 'edit' | null>(null)
  const [editingContactSourceId, setEditingContactSourceId] = useState('')
  const [contactForm, setContactForm] = useState<ContactFormState>(createEmptyContactFormState())
  const [isSavingContact, setIsSavingContact] = useState(false)
  const [removingContactSourceId, setRemovingContactSourceId] = useState('')

  useEffect(() => {
    dealerFormRef.current = dealerForm
  }, [dealerForm])

  useEffect(() => {
    dealerFormSavedSnapshotRef.current = dealerFormSavedSnapshot
  }, [dealerFormSavedSnapshot])

  const requestedDealerId = useMemo(() => {
    return searchParams.get('dealerSourceId')?.trim() ?? ''
  }, [searchParams])

  useEffect(() => {
    if (requestedDealerId && requestedDealerId !== selectedDealerId) {
      setSelectedDealerId(requestedDealerId)
      setContactPage(0)
    }
  }, [requestedDealerId, selectedDealerId])

  useEffect(() => {
    setDealerPage(0)
  }, [dealerSearch])

  const { isLoading: isLoadingDealers, isRefreshing: isRefreshingDealers, errorMessage, setErrorMessage, load: loadDealers } = useDataLoader({
    fetcher: useCallback(() => fetchCrmDealers({
      limit: dealerRowsPerPage,
      offset: dealerPage * dealerRowsPerPage,
      search: dealerSearch || undefined,
    }), [dealerPage, dealerRowsPerPage, dealerSearch]),
    onSuccess: useCallback((response: CrmDealersResponse) => {
      const nextDealers = Array.isArray(response.dealers) ? response.dealers : []
      setDealers(nextDealers)
      setDealersTotal(Number(response.total ?? nextDealers.length))
      if (!selectedDealerId && nextDealers.length > 0) {
        setSelectedDealerId(nextDealers[0].sourceId)
      }
    }, [selectedDealerId]),
    onError: useCallback(() => {
      setDealers([])
      setDealersTotal(0)
    }, []),
    fallbackErrorMessage: 'Failed to load accounts.',
  })

  const loadDealerDetail = useCallback(async () => {
    if (!selectedDealerId) {
      setDealerDetail(null)
      setDealerForm(null)
      setDealerFormSavedSnapshot('')
      return
    }

    setErrorMessage(null)
    setIsLoadingDetail(true)

    try {
      const response = await fetchCrmDealerDetail(selectedDealerId, {
        includeArchivedContacts,
        contactSearch: contactSearch || undefined,
        contactOffset: contactPage * contactRowsPerPage,
        contactLimit: contactRowsPerPage,
      })

      setDealerDetail(response)

      const currentDealerForm = dealerFormRef.current
      const currentSavedSnapshot = dealerFormSavedSnapshotRef.current

      const shouldKeepUnsavedDraft = Boolean(
        currentDealerForm
        && currentDealerForm.sourceId === response.dealer.sourceId
        && serializeDealerFormState(currentDealerForm) !== currentSavedSnapshot,
      )

      if (!shouldKeepUnsavedDraft) {
        const nextDealerForm = createDealerFormState(response.dealer)
        setDealerForm(nextDealerForm)
        setDealerFormSavedSnapshot(serializeDealerFormState(nextDealerForm))
      }
    } catch (error) {
      setDealerDetail(null)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load account details.')
    } finally {
      setIsLoadingDetail(false)
    }
  }, [
    contactPage,
    contactRowsPerPage,
    contactSearch,
    includeArchivedContacts,
    selectedDealerId,
    setErrorMessage,
  ])

  const loadDealerSalesData = useCallback(async () => {
    if (!selectedDealerId) {
      setDealerOrders([])
      setSalesDataError(null)
      return
    }

    setSalesDataError(null)
    setIsLoadingSalesData(true)

    try {
      const ordersPayload = await fetchCrmOrders({ dealerSourceId: selectedDealerId, limit: 150 })
      setDealerOrders(Array.isArray(ordersPayload.orders) ? ordersPayload.orders : [])
    } catch (error) {
      setDealerOrders([])
      setSalesDataError(error instanceof Error ? error.message : 'Failed to load orders.')
    } finally {
      setIsLoadingSalesData(false)
    }
  }, [selectedDealerId])

  useEffect(() => {
    void loadDealerDetail()
  }, [loadDealerDetail])

  useEffect(() => {
    void loadDealerSalesData()
  }, [loadDealerSalesData])

  const selectedDealer = dealerDetail?.dealer ?? null
  const contactsPageLink = selectedDealerId
    ? `/admin/crm/contacts?dealerSourceId=${encodeURIComponent(selectedDealerId)}`
    : '/admin/crm/contacts'

  const orderRows = useMemo(() => {
    return [...dealerOrders]
      .sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      )
  }, [dealerOrders])

  const dealerFormSnapshot = useMemo(
    () => serializeDealerFormState(dealerForm),
    [dealerForm],
  )

  const hasUnsavedDealerChanges = Boolean(dealerForm)
    && dealerFormSnapshot !== dealerFormSavedSnapshot

  useBeforeUnload(useCallback((event) => {
    if (!hasUnsavedDealerChanges) {
      return
    }

    event.preventDefault()
    event.returnValue = ''
  }, [hasUnsavedDealerChanges]))

  unstable_usePrompt({
    when: hasUnsavedDealerChanges,
    message: 'You have unsaved dealership edits. Leave without saving?',
  })

  const confirmDiscardDealerChanges = useCallback(() => {
    if (!hasUnsavedDealerChanges) {
      return true
    }

    return window.confirm('You have unsaved dealership edits. Leave without saving?')
  }, [hasUnsavedDealerChanges])

  const setDealerTextField = useCallback((
    field: keyof Pick<
      DealerFormState,
      | 'name'
      | 'owner'
      | 'ownerEmail'
      | 'salesRep'
      | 'phone'
      | 'phone2'
      | 'website'
      | 'address'
      | 'city'
      | 'state'
      | 'zip'
      | 'country'
      | 'accountText'
      | 'pictureUrl'
    >,
    value: string,
  ) => {
    setDealerForm((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        [field]: value,
      }
    })
  }, [])

  const setDealerFlagField = useCallback((field: 'isArchived' | 'isFavorite', value: boolean) => {
    setDealerForm((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        [field]: value,
      }
    })
  }, [])

  const setDealerEmailAtIndex = useCallback((index: number, value: string) => {
    setDealerForm((current) => {
      if (!current) {
        return current
      }

      const nextEmails = current.emails.map((entry, entryIndex) => (
        entryIndex === index
          ? {
            ...entry,
            value,
          }
          : entry
      ))

      return {
        ...current,
        emails: nextEmails,
      }
    })
  }, [])

  const addDealerEmailField = useCallback(() => {
    setDealerForm((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        emails: [...current.emails, createEmailRow('', current.emails.length)],
      }
    })
  }, [])

  const removeDealerEmailField = useCallback((index: number) => {
    setDealerForm((current) => {
      if (!current) {
        return current
      }

      if (current.emails.length <= 1) {
        return {
          ...current,
          emails: [{
            ...current.emails[0],
            value: '',
          }],
        }
      }

      const nextEmails = current.emails.filter((_, entryIndex) => entryIndex !== index)

      return {
        ...current,
        emails: nextEmails,
      }
    })
  }, [])

  const setDealerSocialLinkAtIndex = useCallback((index: number, field: 'platform' | 'url', value: string) => {
    setDealerForm((current) => {
      if (!current) {
        return current
      }

      const nextSocialLinks = current.socialLinks.map((entry, entryIndex) => {
        if (entryIndex !== index) {
          return entry
        }

        if (field === 'platform') {
          return {
            ...entry,
            platform: resolveSocialPlatformChoice(value),
          }
        }

        return {
          ...entry,
          url: value,
        }
      })

      return {
        ...current,
        socialLinks: nextSocialLinks,
      }
    })
  }, [])

  const addDealerSocialLink = useCallback(() => {
    setDealerForm((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        socialLinks: [
          ...current.socialLinks,
          createSocialLinkRow('website', '', current.socialLinks.length),
        ],
      }
    })
  }, [])

  const removeDealerSocialLink = useCallback((index: number) => {
    setDealerForm((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        socialLinks: current.socialLinks.filter((_, entryIndex) => entryIndex !== index),
      }
    })
  }, [])

  const resetDealerForm = useCallback(() => {
    if (!selectedDealer) {
      return
    }

    const nextDealerForm = createDealerFormState(selectedDealer)

    setDealerForm(nextDealerForm)
    setDealerFormSavedSnapshot(serializeDealerFormState(nextDealerForm))
    setErrorMessage(null)
  }, [selectedDealer, setErrorMessage])

  const handleSelectDealer = useCallback((nextDealerId: string) => {
    if (!nextDealerId || nextDealerId === selectedDealerId) {
      return
    }

    if (!confirmDiscardDealerChanges()) {
      return
    }

    setSelectedDealerId(nextDealerId)
    setContactPage(0)
  }, [confirmDiscardDealerChanges, selectedDealerId])

  const setContactFormField = useCallback((field: keyof ContactFormState, value: string | boolean) => {
    setContactForm((current) => ({
      ...current,
      [field]: value,
    }))
  }, [])

  const openCreateContactEditor = useCallback(() => {
    setContactEditorMode('create')
    setEditingContactSourceId('')
    setContactForm(createEmptyContactFormState())
    setErrorMessage(null)
  }, [setErrorMessage])

  const openEditContactEditor = useCallback((contact: CrmDealerDetailResponse['contacts'][number]) => {
    setContactEditorMode('edit')
    setEditingContactSourceId(contact.sourceId)
    setContactForm(createContactFormState(contact))
    setErrorMessage(null)
  }, [setErrorMessage])

  const closeContactEditor = useCallback(() => {
    if (isSavingContact) {
      return
    }

    setContactEditorMode(null)
    setEditingContactSourceId('')
    setContactForm(createEmptyContactFormState())
  }, [isSavingContact])

  const handleSaveDealer = useCallback(async () => {
    if (!selectedDealerId || !dealerForm) {
      return
    }

    const normalizedEmails = dealerForm.emails
      .map((entry) => entry.value.trim())
      .filter(Boolean)

    if (normalizedEmails.length === 0) {
      setErrorMessage('At least one dealership email is required.')
      return
    }

    const socialMediaLinks = dealerForm.socialLinks
      .reduce<Record<string, string>>((nextLinks, entry) => {
        const url = entry.url.trim()

        if (!url) {
          return nextLinks
        }

        const baseKey = resolveSocialPlatformChoice(entry.platform)
        let candidateKey = baseKey
        let suffix = 2

        while (Object.prototype.hasOwnProperty.call(nextLinks, candidateKey)) {
          candidateKey = `${baseKey}_${suffix}`
          suffix += 1
        }

        nextLinks[candidateKey] = url
        return nextLinks
      }, {})

    setIsSavingDealer(true)
    setErrorMessage(null)

    try {
      await updateCrmDealer(selectedDealerId, {
        name: dealerForm.name.trim(),
        owner: dealerForm.owner.trim(),
        ownerEmail: dealerForm.ownerEmail.trim(),
        salesRep: dealerForm.salesRep.trim(),
        phone: dealerForm.phone.trim(),
        phone2: dealerForm.phone2.trim(),
        website: dealerForm.website.trim(),
        address: dealerForm.address.trim(),
        city: dealerForm.city.trim(),
        state: dealerForm.state.trim(),
        zip: dealerForm.zip.trim(),
        country: dealerForm.country.trim(),
        accountText: dealerForm.accountText,
        pictureUrl: dealerForm.pictureUrl.trim(),
        emails: normalizedEmails,
        socialMediaLinks: Object.keys(socialMediaLinks).length > 0 ? socialMediaLinks : null,
        isArchived: dealerForm.isArchived,
        isFavorite: dealerForm.isFavorite,
      })

      setDealerFormSavedSnapshot(serializeDealerFormState(dealerForm))

      await Promise.all([
        loadDealerDetail(),
        loadDealers(true),
      ])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update account.')
    } finally {
      setIsSavingDealer(false)
    }
  }, [dealerForm, loadDealerDetail, loadDealers, selectedDealerId, setErrorMessage])

  const handleSaveContact = useCallback(async () => {
    if (!contactEditorMode) {
      return
    }

    if (contactEditorMode === 'create' && !selectedDealerId) {
      return
    }

    if (contactEditorMode === 'edit' && !editingContactSourceId) {
      return
    }

    setIsSavingContact(true)
    setErrorMessage(null)

    try {
      const payload = {
        name: contactForm.name.trim() || undefined,
        firstName: contactForm.firstName,
        lastName: contactForm.lastName,
        primaryEmail: contactForm.primaryEmail,
        secondaryEmail: contactForm.secondaryEmail,
        email3: contactForm.email3,
        email4: contactForm.email4,
        salesUnit: contactForm.salesUnit,
        phone: contactForm.phone,
        phone2: contactForm.phone2,
        phoneAlt: contactForm.phoneAlt,
        address: contactForm.address,
        city: contactForm.city,
        state: contactForm.state,
        zip: contactForm.zip,
        country: contactForm.country,
        gender: contactForm.gender,
        contactTypeId: contactForm.contactTypeId,
        photoUrl: contactForm.photoUrl,
        isArchived: contactForm.isArchived,
      }

      if (contactEditorMode === 'create') {
        await createCrmDealerContact(selectedDealerId, payload)
      } else {
        await updateCrmContact(editingContactSourceId, payload)
      }

      setContactEditorMode(null)
      setEditingContactSourceId('')
      setContactForm(createEmptyContactFormState())

      await Promise.all([
        loadDealerDetail(),
        loadDealers(true),
      ])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save contact.')
    } finally {
      setIsSavingContact(false)
    }
  }, [
    contactEditorMode,
    contactForm,
    editingContactSourceId,
    loadDealerDetail,
    loadDealers,
    selectedDealerId,
    setErrorMessage,
  ])

  const handleRemoveContact = useCallback(async (contact: CrmDealerDetailResponse['contacts'][number]) => {
    const contactName = displayContactName(contact)

    if (!window.confirm(`Remove contact ${contactName}?`)) {
      return
    }

    setRemovingContactSourceId(contact.sourceId)
    setErrorMessage(null)

    try {
      await removeCrmContact(contact.sourceId)
      await Promise.all([
        loadDealerDetail(),
        loadDealers(true),
      ])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to remove contact.')
    } finally {
      setRemovingContactSourceId('')
    }
  }, [loadDealerDetail, loadDealers, setErrorMessage])

  return (
    <Stack spacing={2.5}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, md: 2.5 },
          borderColor: (theme) => alpha(theme.palette.primary.main, 0.28),
          background: (theme) => `linear-gradient(125deg, ${alpha(theme.palette.primary.main, 0.15)} 0%, ${alpha(theme.palette.info.main, 0.08)} 42%, ${alpha(theme.palette.background.paper, 0.98)} 100%)`,
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
        >
          <Stack spacing={1} sx={{ width: { xs: '100%', md: 'min(560px, 100%)' } }}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Accounts
            </Typography>
           

            <TextField
              size="small"
              label="Search accounts or emails"
              placeholder="Account name, account ID, owner or contact email"
              value={dealerSearchInput}
              onChange={(event) => {
                setDealerSearchInput(event.target.value)
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to={contactsPageLink} variant="outlined" startIcon={<ContactsRoundedIcon />}>
              Contacts
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={isLoadingDealers || isRefreshingDealers}
              onClick={() => {
                void loadDealers(true)
                void loadDealerDetail()
                void loadDealerSalesData()
              }}
            >
              {isRefreshingDealers ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <StatusAlerts errorMessage={errorMessage} />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            xl: 'minmax(280px, 320px) minmax(0, 1fr)',
          },
          gap: 2,
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderColor: (theme) => alpha(theme.palette.primary.main, 0.22),
            background: (theme) => `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.06)} 0%, ${theme.palette.background.paper} 36%)`,
          }}
        >
          <Stack spacing={1.25}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Account Names
            </Typography>

            <Divider />

            {isLoadingDealers ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 4 }}>
                <CircularProgress size={18} />
                <Typography color="text.secondary">Loading accounts...</Typography>
              </Stack>
            ) : dealers.length === 0 ? (
              <Typography color="text.secondary">No accounts found for this filter.</Typography>
            ) : (
              <Paper
                variant="outlined"
                sx={{
                  maxHeight: { xs: 320, xl: 640 },
                  overflow: 'auto',
                }}
              >
                <List disablePadding>
                  {dealers.map((dealer, index) => {
                    const isSelected = selectedDealerId === dealer.sourceId
                    const accountName = dealer.name || dealer.sourceId
                    const accountInitial = accountName.charAt(0).toUpperCase()
                    const accountLocation = [dealer.city, dealer.state].filter(Boolean).join(', ') || 'No location'

                    return (
                      <ListItemButton
                        key={dealer.sourceId}
                        selected={isSelected}
                        onClick={() => {
                          handleSelectDealer(dealer.sourceId)
                        }}
                        sx={{
                          py: 1,
                          px: 1,
                          gap: 1,
                          borderBottom: index < dealers.length - 1 ? '1px solid' : 'none',
                          borderColor: 'divider',
                          '&.Mui-selected': {
                            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14),
                            borderLeft: '3px solid',
                            borderColor: 'primary.main',
                          },
                          '&.Mui-selected:hover': {
                            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.2),
                          },
                        }}
                      >
                        <Avatar
                          src={dealer.pictureUrl || undefined}
                          alt={accountName}
                          sx={{ width: 32, height: 32, fontSize: 12, fontWeight: 700 }}
                          imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                        >
                          {accountInitial}
                        </Avatar>

                        <ListItemText
                          primary={accountName}
                          secondary={accountLocation}
                          primaryTypographyProps={{
                            fontSize: 14,
                            fontWeight: isSelected ? 700 : 500,
                          }}
                          secondaryTypographyProps={{
                            fontSize: 12,
                            color: 'text.secondary',
                          }}
                        />
                      </ListItemButton>
                    )
                  })}
                </List>
              </Paper>
            )}

            <TablePagination
              component="div"
              count={dealersTotal}
              page={dealerPage}
              onPageChange={(_event, nextPage) => {
                setDealerPage(nextPage)
              }}
              rowsPerPage={dealerRowsPerPage}
              onRowsPerPageChange={(event) => {
                setDealerRowsPerPage(Number(event.target.value))
                setDealerPage(0)
              }}
              rowsPerPageOptions={[25, 50, 100]}
            />
          </Stack>
        </Paper>

        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderColor: (theme) => alpha(theme.palette.primary.main, 0.22),
          }}
        >
          {!selectedDealerId ? (
            <Stack spacing={1} sx={{ py: 8 }} alignItems="center" justifyContent="center">
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Select an account
              </Typography>
              <Typography color="text.secondary">
                Choose an account name from the left list.
              </Typography>
            </Stack>
          ) : isLoadingDetail && !dealerDetail ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 6 }}>
              <CircularProgress size={18} />
              <Typography color="text.secondary">Loading account details...</Typography>
            </Stack>
          ) : selectedDealer ? (
            <Stack spacing={1.1}>
              <Paper
                variant="outlined"
                sx={{
                  p: 1,
                  borderColor: (theme) => alpha(theme.palette.primary.main, 0.24),
                  background: (theme) => `linear-gradient(120deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.background.paper, 0.9)} 80%)`,
                }}
              >
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                >
                  <Stack direction="row" spacing={1.25} alignItems="center">
                    <Avatar
                      src={selectedDealer.pictureUrl || undefined}
                      alt={selectedDealer.name || selectedDealer.sourceId}
                      sx={{ width: 44, height: 44, fontSize: 16 }}
                      imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                    >
                      {(selectedDealer.name || selectedDealer.sourceId).charAt(0).toUpperCase()}
                    </Avatar>

                    <Stack spacing={0.3}>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {selectedDealer.name || selectedDealer.sourceId}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        ID: {selectedDealer.sourceId}
                      </Typography>
                    </Stack>
                  </Stack>

                  <Stack
                    direction="row"
                    spacing={0.75}
                    alignItems="center"
                    sx={{
                      width: { xs: '100%', md: 'auto' },
                      justifyContent: { xs: 'space-between', md: 'flex-end' },
                    }}
                  >
                    <Stack direction="row" spacing={0.75}>
                      {selectedDealer.isArchived ? (
                        <Chip size="small" label="Archived" color="warning" variant="outlined" />
                      ) : null}
                      <Chip size="small" label={`Contacts: ${dealerDetail?.contactsTotal ?? 0}`} variant="outlined" />
                      {hasUnsavedDealerChanges ? (
                        <Chip size="small" label="Unsaved" color="warning" variant="outlined" />
                      ) : null}
                    </Stack>

                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!hasUnsavedDealerChanges || isSavingDealer}
                      onClick={resetDealerForm}
                    >
                      Reset
                    </Button>

                    <Button
                      size="small"
                      variant="contained"
                      disabled={!hasUnsavedDealerChanges || isSavingDealer || !dealerForm}
                      onClick={() => {
                        void handleSaveDealer()
                      }}
                    >
                      {isSavingDealer ? 'Saving...' : 'Save'}
                    </Button>

                    <Tooltip
                      title={isAccountInfoExpanded ? 'Collapse account info' : 'Expand account info'}
                      arrow
                    >
                      <IconButton
                        size="small"
                        onClick={() => {
                          setIsAccountInfoExpanded((current) => !current)
                        }}
                        aria-label={isAccountInfoExpanded ? 'Collapse account info' : 'Expand account info'}
                        sx={{
                          border: '1px solid',
                          borderColor: 'divider',
                          bgcolor: 'background.paper',
                          transition: 'transform 0.2s ease',
                          transform: isAccountInfoExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                      >
                        <ExpandMoreRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
              </Paper>

              <Collapse in={isAccountInfoExpanded} timeout="auto" unmountOnExit>
                {dealerForm ? (
                  <Stack spacing={1}>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                          xs: '1fr',
                          md: 'repeat(2, minmax(0, 1fr))',
                        },
                        gap: 0.7,
                      }}
                    >
                      <TextField
                        size="small"
                        label="Account name"
                        value={dealerForm.name}
                        onChange={(event) => {
                          setDealerTextField('name', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Owner"
                        value={dealerForm.owner}
                        onChange={(event) => {
                          setDealerTextField('owner', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Owner email"
                        value={dealerForm.ownerEmail}
                        onChange={(event) => {
                          setDealerTextField('ownerEmail', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Sales rep"
                        value={dealerForm.salesRep}
                        onChange={(event) => {
                          setDealerTextField('salesRep', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Primary phone"
                        value={dealerForm.phone}
                        onChange={(event) => {
                          setDealerTextField('phone', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Secondary phone"
                        value={dealerForm.phone2}
                        onChange={(event) => {
                          setDealerTextField('phone2', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Website"
                        value={dealerForm.website}
                        onChange={(event) => {
                          setDealerTextField('website', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Picture URL"
                        value={dealerForm.pictureUrl}
                        onChange={(event) => {
                          setDealerTextField('pictureUrl', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Address"
                        value={dealerForm.address}
                        onChange={(event) => {
                          setDealerTextField('address', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="City"
                        value={dealerForm.city}
                        onChange={(event) => {
                          setDealerTextField('city', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="State"
                        value={dealerForm.state}
                        onChange={(event) => {
                          setDealerTextField('state', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Zip"
                        value={dealerForm.zip}
                        onChange={(event) => {
                          setDealerTextField('zip', event.target.value)
                        }}
                      />
                      <TextField
                        size="small"
                        label="Country"
                        value={dealerForm.country}
                        onChange={(event) => {
                          setDealerTextField('country', event.target.value)
                        }}
                      />

                      <FormControl size="small">
                        <InputLabel id="dealer-archived-status-label">Archived</InputLabel>
                        <Select
                          labelId="dealer-archived-status-label"
                          label="Archived"
                          value={dealerForm.isArchived ? 'true' : 'false'}
                          onChange={(event) => {
                            setDealerFlagField('isArchived', event.target.value === 'true')
                          }}
                        >
                          <MenuItem value="false">No</MenuItem>
                          <MenuItem value="true">Yes</MenuItem>
                        </Select>
                      </FormControl>

                      <FormControl size="small">
                        <InputLabel id="dealer-favorite-status-label">Favorite</InputLabel>
                        <Select
                          labelId="dealer-favorite-status-label"
                          label="Favorite"
                          value={dealerForm.isFavorite ? 'true' : 'false'}
                          onChange={(event) => {
                            setDealerFlagField('isFavorite', event.target.value === 'true')
                          }}
                        >
                          <MenuItem value="false">No</MenuItem>
                          <MenuItem value="true">Yes</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>

                    <Box
                      sx={{
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 1,
                      }}
                    >
                      <Stack spacing={0.8}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          Dealership emails
                        </Typography>

                        {dealerForm.emails.map((entry, index) => (
                          <Stack
                            key={entry.id}
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={0.75}
                            alignItems={{ xs: 'stretch', sm: 'center' }}
                          >
                            <TextField
                              size="small"
                              fullWidth
                              label={index === 0 ? 'Primary email' : `Email ${index + 1}`}
                              value={entry.value}
                              onChange={(event) => {
                                setDealerEmailAtIndex(index, event.target.value)
                              }}
                            />
                            <Button
                              size="small"
                              color="inherit"
                              variant="outlined"
                              onClick={() => {
                                removeDealerEmailField(index)
                              }}
                            >
                              Remove
                            </Button>
                          </Stack>
                        ))}

                        <Button
                          size="small"
                          startIcon={<AddRoundedIcon fontSize="small" />}
                          onClick={addDealerEmailField}
                          sx={{ width: 'fit-content' }}
                        >
                          Add another email
                        </Button>
                      </Stack>
                    </Box>

                    <Box
                      sx={{
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 1,
                      }}
                    >
                      <Stack spacing={0.8}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          Social links
                        </Typography>

                        {dealerForm.socialLinks.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            No social links yet.
                          </Typography>
                        ) : null}

                        {dealerForm.socialLinks.map((entry, index) => {
                          const selectedPlatform = resolveSocialPlatformChoice(entry.platform)
                          const option = socialPlatformOptions.find((candidate) => candidate.value === selectedPlatform)
                          const platformLabel = option?.label || formatSocialLabel(entry.platform)
                          const iconVisual = resolveSocialVisual(entry.platform, entry.url)

                          return (
                            <Stack
                              key={entry.id}
                              direction={{ xs: 'column', md: 'row' }}
                              spacing={0.75}
                              alignItems={{ xs: 'stretch', md: 'center' }}
                            >
                              <Tooltip title={platformLabel} arrow>
                                <IconButton
                                  size="small"
                                  aria-label={platformLabel}
                                  sx={{
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    bgcolor: iconVisual.background,
                                    color: iconVisual.foreground,
                                  }}
                                >
                                  {iconVisual.icon}
                                </IconButton>
                              </Tooltip>

                              <FormControl size="small" sx={{ minWidth: 160 }}>
                                <InputLabel id={`dealer-social-platform-${entry.id}`}>Platform</InputLabel>
                                <Select
                                  labelId={`dealer-social-platform-${entry.id}`}
                                  label="Platform"
                                  value={selectedPlatform}
                                  onChange={(event) => {
                                    setDealerSocialLinkAtIndex(index, 'platform', event.target.value)
                                  }}
                                >
                                  {socialPlatformOptions.map((optionEntry) => (
                                    <MenuItem key={optionEntry.value} value={optionEntry.value}>
                                      {optionEntry.label}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </FormControl>

                              <TextField
                                size="small"
                                fullWidth
                                label={`${platformLabel} URL`}
                                value={entry.url}
                                onChange={(event) => {
                                  setDealerSocialLinkAtIndex(index, 'url', event.target.value)
                                }}
                              />

                              <IconButton
                                size="small"
                                color="error"
                                aria-label="Remove social link"
                                onClick={() => {
                                  removeDealerSocialLink(index)
                                }}
                                sx={{ border: '1px solid', borderColor: 'divider' }}
                              >
                                <DeleteOutlineRoundedIcon fontSize="small" />
                              </IconButton>
                            </Stack>
                          )
                        })}

                        <Button
                          size="small"
                          startIcon={<AddRoundedIcon fontSize="small" />}
                          onClick={addDealerSocialLink}
                          sx={{ width: 'fit-content' }}
                        >
                          Add social link
                        </Button>
                      </Stack>
                    </Box>

                    <TextField
                      size="small"
                      multiline
                      minRows={3}
                      label="Account notes"
                      value={dealerForm.accountText}
                      onChange={(event) => {
                        setDealerTextField('accountText', event.target.value)
                      }}
                    />
                  </Stack>
                ) : (
                  <Typography color="text.secondary" sx={{ py: 1 }}>
                    Account form is loading...
                  </Typography>
                )}
              </Collapse>

              <Divider />

              <Tabs
                value={detailsTab}
                onChange={(_event, nextValue: 'contacts' | 'orders') => {
                  setDetailsTab(nextValue)
                }}
                variant="scrollable"
                allowScrollButtonsMobile
                sx={{ mt: -0.5 }}
              >
                <Tab value="contacts" label={`Contacts (${dealerDetail?.contactsTotal ?? 0})`} />
                <Tab value="orders" label={`Orders (${dealerOrders.length})`} />
              </Tabs>

              {detailsTab === 'contacts' ? (
                <>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr',
                        md: '2fr 1fr auto',
                      },
                      gap: 1,
                      alignItems: 'center',
                    }}
                  >
                    <TextField
                      size="small"
                      label="Search contacts"
                      value={contactSearchInput}
                      onChange={(event) => {
                        setContactSearchInput(event.target.value)
                        setContactPage(0)
                      }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchRoundedIcon fontSize="small" />
                          </InputAdornment>
                        ),
                      }}
                    />

                    <FormControl size="small">
                      <InputLabel id="account-contact-archive-filter">Archived contacts</InputLabel>
                      <Select
                        labelId="account-contact-archive-filter"
                        value={includeArchivedContacts ? 'all' : 'active'}
                        label="Archived contacts"
                        onChange={(event) => {
                          setIncludeArchivedContacts(event.target.value === 'all')
                          setContactPage(0)
                        }}
                      >
                        <MenuItem value="active">Active only</MenuItem>
                        <MenuItem value="all">Include archived</MenuItem>
                      </Select>
                    </FormControl>

                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<AddRoundedIcon />}
                      onClick={openCreateContactEditor}
                      sx={{ minWidth: { md: 140 } }}
                    >
                      Add Contact
                    </Button>
                  </Box>

                  <TableContainer
                    sx={{
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                      maxHeight: { xs: 320, xl: 520 },
                    }}
                  >
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700, width: 72 }}>Img</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Contact</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Phone</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Location</TableCell>
                          <TableCell sx={{ fontWeight: 700, width: 220 }} align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(dealerDetail?.contacts ?? []).map((contact) => {
                          const contactName = displayContactName(contact)

                          return (
                            <TableRow key={contact.sourceId}>
                              <TableCell>
                                <Avatar
                                  src={contact.photoUrl || undefined}
                                  alt={contactName}
                                  sx={{ width: 34, height: 34, mx: 'auto', fontSize: 13 }}
                                  imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                                >
                                  {contactName.charAt(0).toUpperCase()}
                                </Avatar>
                              </TableCell>

                              <TableCell>
                                <Stack spacing={0.2}>
                                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {contactName}
                                  </Typography>
                                  {contact.isArchived ? (
                                    <Chip
                                      size="small"
                                      variant="outlined"
                                      color="warning"
                                      label="Archived"
                                      sx={{ width: 'fit-content' }}
                                    />
                                  ) : null}
                                </Stack>
                              </TableCell>
                              <TableCell>{contact.primaryEmail || contact.secondaryEmail || '-'}</TableCell>
                              <TableCell>{[contact.phone, contact.phone2, contact.phoneAlt].filter(Boolean).join(' / ') || '-'}</TableCell>
                              <TableCell>{[contact.city, contact.state, contact.country].filter(Boolean).join(', ') || '-'}</TableCell>
                              <TableCell align="right">
                                <Stack direction="row" spacing={0.75} justifyContent="flex-end">
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<EditRoundedIcon fontSize="small" />}
                                    onClick={() => {
                                      openEditContactEditor(contact)
                                    }}
                                  >
                                    Edit
                                  </Button>

                                  <Button
                                    size="small"
                                    color="error"
                                    variant="outlined"
                                    startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                                    disabled={removingContactSourceId === contact.sourceId || contact.isArchived}
                                    onClick={() => {
                                      void handleRemoveContact(contact)
                                    }}
                                  >
                                    {removingContactSourceId === contact.sourceId ? 'Removing...' : 'Remove'}
                                  </Button>
                                </Stack>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <TablePagination
                    component="div"
                    count={dealerDetail?.contactsTotal ?? 0}
                    page={contactPage}
                    onPageChange={(_event, nextPage) => {
                      setContactPage(nextPage)
                    }}
                    rowsPerPage={contactRowsPerPage}
                    onRowsPerPageChange={(event) => {
                      setContactRowsPerPage(Number(event.target.value))
                      setContactPage(0)
                    }}
                    rowsPerPageOptions={[10, 25, 50, 100]}
                  />
                </>
              ) : (
                <Stack spacing={1.25}>
                  {salesDataError ? <Alert severity="warning">{salesDataError}</Alert> : null}

                  {isLoadingSalesData ? (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
                      <CircularProgress size={18} />
                      <Typography color="text.secondary">Loading orders...</Typography>
                    </Stack>
                  ) : orderRows.length === 0 ? (
                    <Typography color="text.secondary" variant="body2">
                      No orders linked to this account yet.
                    </Typography>
                  ) : (
                    <TableContainer
                      sx={{
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        maxHeight: { xs: 320, xl: 560 },
                      }}
                    >
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700 }}>Order</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Due</TableCell>
                            <TableCell sx={{ fontWeight: 700 }} align="right">Progress</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {orderRows.map((order) => (
                            <TableRow key={order.id}>
                              <TableCell>
                                <Stack spacing={0.2}>
                                  <Stack direction="row" spacing={0.75} alignItems="center">
                                    <LocalShippingRoundedIcon fontSize="inherit" color="action" />
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {order.orderNumber || order.title}
                                    </Typography>
                                  </Stack>
                                  <Typography variant="caption" color="text.secondary">
                                    Updated {formatDate(order.updatedAt)}
                                  </Typography>
                                </Stack>
                              </TableCell>
                              <TableCell>{formatStatusLabel(order.status)}</TableCell>
                              <TableCell>{formatDate(order.dueDate)}</TableCell>
                              <TableCell align="right">{Math.round(order.progressPercent)}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Stack>
              )}
            </Stack>
          ) : (
            <Stack spacing={1} sx={{ py: 8 }} alignItems="center" justifyContent="center">
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Account not found
              </Typography>
              <Typography color="text.secondary">
                The selected account could not be loaded. Refresh and try again.
              </Typography>
            </Stack>
          )}
        </Paper>
      </Box>

      <Dialog open={contactEditorMode !== null} onClose={closeContactEditor} maxWidth="md" fullWidth>
        <DialogTitle>{contactEditorMode === 'create' ? 'Add Contact' : 'Edit Contact'}</DialogTitle>
        <DialogContent dividers>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                md: 'repeat(2, minmax(0, 1fr))',
              },
              gap: 1,
              pt: 0.5,
            }}
          >
            <TextField
              size="small"
              label="Contact name"
              value={contactForm.name}
              onChange={(event) => {
                setContactFormField('name', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="First name"
              value={contactForm.firstName}
              onChange={(event) => {
                setContactFormField('firstName', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Last name"
              value={contactForm.lastName}
              onChange={(event) => {
                setContactFormField('lastName', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Primary email"
              value={contactForm.primaryEmail}
              onChange={(event) => {
                setContactFormField('primaryEmail', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Secondary email"
              value={contactForm.secondaryEmail}
              onChange={(event) => {
                setContactFormField('secondaryEmail', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Email 3"
              value={contactForm.email3}
              onChange={(event) => {
                setContactFormField('email3', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Email 4"
              value={contactForm.email4}
              onChange={(event) => {
                setContactFormField('email4', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Sales unit"
              value={contactForm.salesUnit}
              onChange={(event) => {
                setContactFormField('salesUnit', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Phone"
              value={contactForm.phone}
              onChange={(event) => {
                setContactFormField('phone', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Phone 2"
              value={contactForm.phone2}
              onChange={(event) => {
                setContactFormField('phone2', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Phone Alt"
              value={contactForm.phoneAlt}
              onChange={(event) => {
                setContactFormField('phoneAlt', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Address"
              value={contactForm.address}
              onChange={(event) => {
                setContactFormField('address', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="City"
              value={contactForm.city}
              onChange={(event) => {
                setContactFormField('city', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="State"
              value={contactForm.state}
              onChange={(event) => {
                setContactFormField('state', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Zip"
              value={contactForm.zip}
              onChange={(event) => {
                setContactFormField('zip', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Country"
              value={contactForm.country}
              onChange={(event) => {
                setContactFormField('country', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Gender"
              value={contactForm.gender}
              onChange={(event) => {
                setContactFormField('gender', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Contact Type ID"
              value={contactForm.contactTypeId}
              onChange={(event) => {
                setContactFormField('contactTypeId', event.target.value)
              }}
            />
            <TextField
              size="small"
              label="Photo URL"
              value={contactForm.photoUrl}
              onChange={(event) => {
                setContactFormField('photoUrl', event.target.value)
              }}
            />
            <FormControl size="small">
              <InputLabel id="contact-archived-status-label">Archived</InputLabel>
              <Select
                labelId="contact-archived-status-label"
                label="Archived"
                value={contactForm.isArchived ? 'true' : 'false'}
                onChange={(event) => {
                  setContactFormField('isArchived', event.target.value === 'true')
                }}
              >
                <MenuItem value="false">No</MenuItem>
                <MenuItem value="true">Yes</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeContactEditor} disabled={isSavingContact}>Cancel</Button>
          <Button variant="contained" onClick={() => {
            void handleSaveContact()
          }} disabled={isSavingContact || contactEditorMode === null}>
            {isSavingContact
              ? 'Saving...'
              : (contactEditorMode === 'create' ? 'Create contact' : 'Save contact')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import MapRoundedIcon from '@mui/icons-material/MapRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import usaMap from '@svg-maps/usa'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { firebaseStorage } from '../auth/firebase'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  createCrmSalesRep,
  fetchCrmSalesReps,
  removeCrmSalesRep,
  updateCrmSalesRep,
  type CrmSalesRep,
} from '../features/crm/api'
import { resolveImageFileExtension, sanitizeStoragePathSegment } from '../lib/fileUtils'
import { QUERY_KEYS } from '../lib/queryKeys'

type SalesRepDialogMode = 'create' | 'edit' | null

type SalesRepFormState = {
  name: string
  companyName: string
  logoUrl: string
  email: string
  email2: string
  phone: string
  phone2: string
  states: string[]
}

type UsaMapLocation = {
  id: string
  name: string
  path: string
}

type UsaMapData = {
  label: string
  viewBox: string
  locations: UsaMapLocation[]
}

type StateLabelPosition = {
  x: number
  y: number
  area: number
}

const usaMapData = usaMap as unknown as UsaMapData

const repColorPalette = [
  '#17608f',
  '#2f7f5f',
  '#9a3c2f',
  '#7255a4',
  '#8a6f1e',
  '#9a4374',
  '#006d77',
  '#b85f19',
  '#3f7fbd',
  '#5a9367',
]

const stateNameByCode = new Map(
  usaMapData.locations
    .filter((location) => location.id.length === 2)
    .map((location) => [location.id.toUpperCase(), location.name] as const),
)

const stateLabelOffsetByCode: Record<string, { dx: number; dy: number }> = {
  FL: { dx: 22, dy: 24 },
  LA: { dx: 8, dy: 8 },
  MI: { dx: 0, dy: 14 },
  MA: { dx: 18, dy: -8 },
  RI: { dx: 24, dy: -2 },
  CT: { dx: 20, dy: 6 },
  NJ: { dx: 20, dy: 12 },
  DE: { dx: 24, dy: 18 },
  MD: { dx: 20, dy: 16 },
  VT: { dx: 10, dy: -14 },
  NH: { dx: 18, dy: -16 },
}

function createEmptySalesRepForm(): SalesRepFormState {
  return {
    name: '',
    companyName: '',
    logoUrl: '',
    email: '',
    email2: '',
    phone: '',
    phone2: '',
    states: [],
  }
}

function sortStateCodes(codes: string[]) {
  return [...new Set(codes.filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

function toStateLabel(stateCode: string) {
  const label = stateNameByCode.get(stateCode)

  return label ? `${stateCode} - ${label}` : stateCode
}

function resolveMapLabelTextColor(fillColor: string) {
  const rawHex = fillColor.replace('#', '')
  const normalizedHex = rawHex.length === 3
    ? rawHex.split('').map((character) => `${character}${character}`).join('')
    : rawHex

  if (!/^[0-9a-f]{6}$/i.test(normalizedHex)) {
    return '#18202b'
  }

  const red = Number.parseInt(normalizedHex.slice(0, 2), 16)
  const green = Number.parseInt(normalizedHex.slice(2, 4), 16)
  const blue = Number.parseInt(normalizedHex.slice(4, 6), 16)
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000

  return luminance < 145 ? '#ffffff' : '#18202b'
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default function SalesRepsPage() {
  const [salesReps, setSalesReps] = useState<CrmSalesRep[]>([])
  const [availableStates, setAvailableStates] = useState<string[]>([])

  const [selectedSalesRepId, setSelectedSalesRepId] = useState('')
  const [salesRepForm, setSalesRepForm] = useState<SalesRepFormState>(createEmptySalesRepForm)
  const [salesRepDialogMode, setSalesRepDialogMode] = useState<SalesRepDialogMode>(null)

  const [lookupQuery, setLookupQuery] = useState('')

  const [isSavingSalesRep, setIsSavingSalesRep] = useState(false)
  const [isUploadingSalesRepLogo, setIsUploadingSalesRepLogo] = useState(false)
  const [salesRepLogoUploadError, setSalesRepLogoUploadError] = useState<string | null>(null)
  const [deletingSalesRepId, setDeletingSalesRepId] = useState('')
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [stateLabelPositions, setStateLabelPositions] = useState<Record<string, StateLabelPosition>>({})

  const mapSvgRef = useRef<SVGSVGElement | null>(null)

  const queryClient = useQueryClient()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const salesRepsQuery = useQuery({
    queryKey: QUERY_KEYS.crmSalesReps,
    queryFn: () => fetchCrmSalesReps(),
    staleTime: 5 * 60 * 1000,
  })

  const isLoading = salesRepsQuery.isLoading
  const isRefreshing = salesRepsQuery.isFetching && !salesRepsQuery.isLoading

  useEffect(() => {
    const data = salesRepsQuery.data
    if (!data) return
    setSalesReps(Array.isArray(data.salesReps) ? data.salesReps : [])
    setAvailableStates(
      sortStateCodes(
        Array.isArray(data.availableStates)
          ? data.availableStates.map((value) => String(value ?? '').trim().toUpperCase())
          : [],
      ),
    )
  }, [salesRepsQuery.data])

  useEffect(() => {
    if (salesRepsQuery.error instanceof Error) {
      setErrorMessage(salesRepsQuery.error.message)
    }
  }, [salesRepsQuery.error])

  const isSalesRepDialogOpen = Boolean(salesRepDialogMode)

  const availableStateOptions = useMemo(() => {
    const statesFromReps = salesReps.flatMap((entry) => entry.states)

    return sortStateCodes([...availableStates, ...statesFromReps])
  }, [availableStates, salesReps])

  const stateOwnerByCode = useMemo(() => {
    const ownerMap = new Map<string, CrmSalesRep>()

    for (const salesRep of salesReps) {
      for (const stateCode of salesRep.states) {
        ownerMap.set(stateCode, salesRep)
      }
    }

    return ownerMap
  }, [salesReps])

  const repColorById = useMemo(() => {
    const colorMap = new Map<string, string>()

    for (const [index, salesRep] of salesReps.entries()) {
      colorMap.set(salesRep.id, repColorPalette[index % repColorPalette.length])
    }

    return colorMap
  }, [salesReps])

  const mapLegendEntries = useMemo(() => {
    return salesReps.map((salesRep) => ({
      id: salesRep.id,
      color: repColorById.get(salesRep.id) ?? '#6f8296',
      label: salesRep.companyName
        ? `${salesRep.name} (${salesRep.companyName})`
        : salesRep.name,
    }))
  }, [repColorById, salesReps])

  const normalizedLookupQuery = useMemo(
    () => lookupQuery.trim().toLowerCase(),
    [lookupQuery],
  )

  const territoryLookupResults = useMemo(() => {
    if (!normalizedLookupQuery) {
      return []
    }

    return availableStateOptions
      .map((stateCode) => {
        const stateName = stateNameByCode.get(stateCode) || stateCode
        const owner = stateOwnerByCode.get(stateCode) ?? null
        const haystack = [
          stateCode,
          stateName,
          owner?.name || '',
          owner?.companyName || '',
        ].join(' ').toLowerCase()

        return {
          stateCode,
          stateName,
          owner,
          isMatch: haystack.includes(normalizedLookupQuery),
        }
      })
      .filter((entry) => entry.isMatch)
      .slice(0, 12)
  }, [availableStateOptions, normalizedLookupQuery, stateOwnerByCode])

  const salesRepLookupResults = useMemo(() => {
    if (!normalizedLookupQuery) {
      return []
    }

    return salesReps
      .filter((salesRep) => {
        const stateNames = salesRep.states.map((stateCode) => stateNameByCode.get(stateCode) || '')
        const searchableFields = [
          salesRep.name,
          salesRep.companyName || '',
          salesRep.email || '',
          salesRep.email2 || '',
          salesRep.phone || '',
          salesRep.phone2 || '',
          ...salesRep.states,
          ...stateNames,
        ]

        return searchableFields.some((value) => value.toLowerCase().includes(normalizedLookupQuery))
      })
      .slice(0, 8)
  }, [normalizedLookupQuery, salesReps])

  const hasLookupQuery = Boolean(normalizedLookupQuery)

  const isStateAssignedToDifferentRep = useCallback((stateCode: string) => {
    const owner = stateOwnerByCode.get(stateCode)

    return Boolean(owner && owner.id !== selectedSalesRepId)
  }, [selectedSalesRepId, stateOwnerByCode])

  const openSalesRepDialogForEdit = useCallback((salesRep: CrmSalesRep) => {
    setSelectedSalesRepId(salesRep.id)
    setSalesRepForm({
      name: salesRep.name,
      companyName: salesRep.companyName || '',
      logoUrl: salesRep.logoUrl || '',
      email: salesRep.email || '',
      email2: salesRep.email2 || '',
      phone: salesRep.phone || '',
      phone2: salesRep.phone2 || '',
      states: sortStateCodes(salesRep.states),
    })
    setSalesRepDialogMode('edit')
    setSalesRepLogoUploadError(null)
    setErrorMessage(null)
    setSuccessMessage(null)
  }, [setErrorMessage])

  const resetSalesRepForm = useCallback(() => {
    setSelectedSalesRepId('')
    setSalesRepForm(createEmptySalesRepForm())
    setSalesRepLogoUploadError(null)
    setErrorMessage(null)
  }, [setErrorMessage])

  const handleOpenAddSalesRepDialog = useCallback(() => {
    resetSalesRepForm()
    setSalesRepDialogMode('create')
  }, [resetSalesRepForm])

  const handleCloseSalesRepDialog = useCallback(() => {
    if (isSavingSalesRep || isUploadingSalesRepLogo) {
      return
    }

    setSalesRepDialogMode(null)
    setSalesRepLogoUploadError(null)
  }, [isSavingSalesRep, isUploadingSalesRepLogo])

  const handleSalesRepLogoUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      setSalesRepLogoUploadError('Please upload an image file.')
      return
    }

    const maxUploadBytes = 10 * 1024 * 1024

    if (file.size > maxUploadBytes) {
      setSalesRepLogoUploadError('Image is too large. Maximum size is 10MB.')
      return
    }

    setSalesRepLogoUploadError(null)
    setErrorMessage(null)
    setIsUploadingSalesRepLogo(true)

    try {
      const repSegment = sanitizeStoragePathSegment(
        selectedSalesRepId || salesRepForm.name || salesRepForm.companyName || 'sales-rep',
        'sales-rep',
      )
      const fileBaseName = sanitizeStoragePathSegment(file.name.replace(/\.[^.]+$/, ''), 'logo')
      const fileExtension = resolveImageFileExtension(file)
      const objectPath = `crm/sales-rep-logos/${repSegment}/${Date.now()}-${fileBaseName}${fileExtension}`
      const uploadTarget = storageRef(firebaseStorage, objectPath)

      await uploadBytes(uploadTarget, file, {
        contentType: file.type || undefined,
        cacheControl: 'public,max-age=31536000',
      })

      const downloadUrl = await getDownloadURL(uploadTarget)
      setSalesRepForm((current) => ({
        ...current,
        logoUrl: downloadUrl,
      }))
    } catch (error) {
      setSalesRepLogoUploadError(error instanceof Error ? error.message : 'Failed to upload logo.')
    } finally {
      setIsUploadingSalesRepLogo(false)
    }
  }, [salesRepForm.companyName, salesRepForm.name, selectedSalesRepId, setErrorMessage])

  const handleSaveSalesRep = useCallback(async () => {
    const normalizedName = salesRepForm.name.trim()
    const normalizedCompanyName = salesRepForm.companyName.trim()
    const normalizedLogoUrl = salesRepForm.logoUrl.trim()
    const normalizedEmail = salesRepForm.email.trim()
    const normalizedEmail2 = salesRepForm.email2.trim()
    const normalizedPhone = salesRepForm.phone.trim()
    const normalizedPhone2 = salesRepForm.phone2.trim()
    const normalizedStates = sortStateCodes(salesRepForm.states)

    if (!normalizedName) {
      setErrorMessage('Sales rep name is required.')
      return
    }

    setIsSavingSalesRep(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      if (selectedSalesRepId) {
        await updateCrmSalesRep(selectedSalesRepId, {
          name: normalizedName,
          companyName: normalizedCompanyName || null,
          logoUrl: normalizedLogoUrl || null,
          email: normalizedEmail || null,
          email2: normalizedEmail2 || null,
          phone: normalizedPhone || null,
          phone2: normalizedPhone2 || null,
          states: normalizedStates,
        })
        setSuccessMessage('Sales rep updated successfully.')
      } else {
        const response = await createCrmSalesRep({
          name: normalizedName,
          companyName: normalizedCompanyName || null,
          logoUrl: normalizedLogoUrl || null,
          email: normalizedEmail || null,
          email2: normalizedEmail2 || null,
          phone: normalizedPhone || null,
          phone2: normalizedPhone2 || null,
          states: normalizedStates,
        })

        setSelectedSalesRepId(response.salesRep.id)
        setSuccessMessage('Sales rep added successfully.')
      }

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmSalesReps })
      setSalesRepDialogMode(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save sales rep.')
    } finally {
      setIsSavingSalesRep(false)
    }
  }, [queryClient, salesRepForm, selectedSalesRepId, setErrorMessage])

  const handleDeleteSalesRep = useCallback(async (salesRep: CrmSalesRep) => {
    const shouldDelete = window.confirm(`Delete sales rep "${salesRep.name}"?`)

    if (!shouldDelete) {
      return
    }

    setDeletingSalesRepId(salesRep.id)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      await removeCrmSalesRep(salesRep.id)

      if (selectedSalesRepId === salesRep.id) {
        setSelectedSalesRepId('')
        setSalesRepForm(createEmptySalesRepForm())
        setSalesRepLogoUploadError(null)
        setSalesRepDialogMode(null)
      }

      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmSalesReps })
      setSuccessMessage('Sales rep removed successfully.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to remove sales rep.')
    } finally {
      setDeletingSalesRepId('')
    }
  }, [queryClient, selectedSalesRepId, setErrorMessage])

  const measureMapLabelPositions = useCallback(() => {
    const svgElement = mapSvgRef.current

    if (!svgElement) {
      return
    }

    const nextPositions: Record<string, StateLabelPosition> = {}
    const statePathElements = svgElement.querySelectorAll<SVGPathElement>('path[data-state-code]')

    statePathElements.forEach((pathElement) => {
      const stateCode = pathElement.dataset.stateCode

      if (!stateCode) {
        return
      }

      const box = pathElement.getBBox()

      if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) {
        return
      }

      nextPositions[stateCode] = {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        area: box.width * box.height,
      }
    })

    setStateLabelPositions(nextPositions)
  }, [])

  useEffect(() => {
    if (isLoading) {
      return
    }

    measureMapLabelPositions()

    const handleResize = () => {
      measureMapLabelPositions()
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [isLoading, measureMapLabelPositions])

  useEffect(() => {
    if (isLoading) {
      return
    }

    measureMapLabelPositions()
  }, [isLoading, measureMapLabelPositions, salesReps.length, selectedSalesRepId])

  const handlePrintMap = useCallback(() => {
    const svgElement = mapSvgRef.current

    if (!svgElement) {
      setErrorMessage('Map is still loading. Please try again in a moment.')
      return
    }

    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.visibility = 'hidden'
    document.body.appendChild(iframe)

    const printWindow = iframe.contentWindow

    if (!printWindow) {
      iframe.remove()
      setErrorMessage('Unable to open print preview. Please try again.')
      return
    }

    const legendItemsHtml = [
      '<li><span class="swatch" style="background:#ffffff"></span><span>Unassigned</span></li>',
      ...mapLegendEntries.map((entry) => `<li><span class="swatch" style="background:${entry.color}"></span><span>${escapeHtml(entry.label)}</span></li>`),
    ].join('')

    const printDocument = printWindow.document

    printDocument.open()
    printDocument.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sales Territory Map</title>
    <style>
      @page {
        size: auto;
        margin: 8mm;
      }
      body {
        margin: 14px;
        color: #111827;
        font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif;
      }
      h1 {
        margin: 0 0 6px;
        font-size: 18px;
      }
      p {
        margin: 0 0 10px;
        color: #4b5563;
        font-size: 12px;
      }
      .map-wrapper {
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 8px;
        max-width: 860px;
        margin: 0 auto;
      }
      svg {
        width: 100%;
        height: auto;
        max-height: 150mm;
        display: block;
      }
      ul {
        margin: 10px auto 0;
        padding: 0;
        max-width: 860px;
        list-style: none;
        display: grid;
        gap: 5px 10px;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      }
      li {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
      }
      .swatch {
        width: 12px;
        height: 12px;
        border: 1px solid rgba(0,0,0,0.2);
        border-radius: 2px;
        flex: 0 0 12px;
      }
      @media print {
        body {
          margin: 0;
        }
      }
    </style>
  </head>
  <body>
    <h1>Sales Territory Map</h1>
    <p>Generated ${escapeHtml(new Date().toLocaleString())}</p>
    <div class="map-wrapper">${svgElement.outerHTML}</div>
    <ul>${legendItemsHtml}</ul>
  </body>
</html>`)
    printDocument.close()

    const cleanup = () => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe)
      }
    }

    printWindow.addEventListener('afterprint', cleanup, { once: true })

    window.setTimeout(() => {
      printWindow.focus()
      printWindow.print()
      window.setTimeout(cleanup, 1500)
    }, 50)
  }, [mapLegendEntries, setErrorMessage])

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
          alignItems={{ xs: 'stretch', md: 'center' }}
        >
          <Stack spacing={0.9} sx={{ width: { xs: '100%', md: 'min(620px, 100%)' } }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <MapRoundedIcon color="primary" />
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                Sales Reps
              </Typography>
            </Stack>

            <TextField
              size="small"
              label="Search rep or territory"
              placeholder="Name, company, email, phone, state code, or state name"
              value={lookupQuery}
              onChange={(event) => {
                setLookupQuery(event.target.value)
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

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddRoundedIcon fontSize="small" />}
              disabled={isSavingSalesRep || isUploadingSalesRepLogo}
              onClick={handleOpenAddSalesRepDialog}
            >
              Add sales rep
            </Button>

            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshRoundedIcon />}
              disabled={isLoading || isRefreshing || isSavingSalesRep}
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crmSalesReps })
              }}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <StatusAlerts errorMessage={errorMessage} successMessage={successMessage} />

      {isLoading ? (
        <LoadingPanel loading={isLoading} message="Loading sales reps..." size={18} />
      ) : (
        <>
          {hasLookupQuery ? (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Stack spacing={1}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Search results
                </Typography>

                {territoryLookupResults.length === 0 && salesRepLookupResults.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No rep or territory matches found.
                  </Typography>
                ) : null}

                {territoryLookupResults.length > 0 ? (
                  <Stack spacing={0.6}>
                    <Typography variant="caption" color="text.secondary">
                      Territories
                    </Typography>

                    {territoryLookupResults.map((entry) => (
                      <Paper key={`search-territory-${entry.stateCode}`} variant="outlined" sx={{ p: 0.75 }}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {entry.stateCode} - {entry.stateName}
                          </Typography>

                          <Stack direction="row" spacing={0.6} alignItems="center">
                            <Typography variant="caption" color="text.secondary">
                              {entry.owner
                                ? (entry.owner.companyName ? `${entry.owner.name} (${entry.owner.companyName})` : entry.owner.name)
                                : 'Unassigned'}
                            </Typography>

                            {entry.owner ? (
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => {
                                  if (entry.owner) {
                                    openSalesRepDialogForEdit(entry.owner)
                                  }
                                }}
                              >
                                Open
                              </Button>
                            ) : null}
                          </Stack>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                ) : null}

                {salesRepLookupResults.length > 0 ? (
                  <Stack spacing={0.6}>
                    <Typography variant="caption" color="text.secondary">
                      Sales reps
                    </Typography>

                    {salesRepLookupResults.map((salesRep) => {
                      const stateSummary = salesRep.states.length > 0
                        ? salesRep.states.join(', ')
                        : 'No territories yet'
                      const contactSummary = [salesRep.email, salesRep.email2, salesRep.phone, salesRep.phone2]
                        .map((value) => String(value ?? '').trim())
                        .filter(Boolean)
                        .join(' / ')

                      return (
                        <Paper key={`search-rep-${salesRep.id}`} variant="outlined" sx={{ p: 0.75 }}>
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                            <Stack spacing={0.2}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {salesRep.companyName
                                  ? `${salesRep.name} (${salesRep.companyName})`
                                  : salesRep.name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Territories: {stateSummary}
                              </Typography>
                              {contactSummary ? (
                                <Typography variant="caption" color="text.secondary">
                                  Contact: {contactSummary}
                                </Typography>
                              ) : null}
                            </Stack>

                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => {
                                openSalesRepDialogForEdit(salesRep)
                              }}
                            >
                              Open
                            </Button>
                          </Stack>
                        </Paper>
                      )
                    })}
                  </Stack>
                ) : null}
              </Stack>
            </Paper>
          ) : null}

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Current reps
              </Typography>

              {salesReps.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No sales reps yet.
                </Typography>
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
                  {salesReps.map((salesRep) => {
                    const isSelected = salesRep.id === selectedSalesRepId
                    const color = repColorById.get(salesRep.id) ?? '#6f8296'
                    const visibleStates = salesRep.states.slice(0, 8)
                    const hiddenStatesCount = Math.max(0, salesRep.states.length - visibleStates.length)
                    const emailsLine = [salesRep.email, salesRep.email2]
                      .map((value) => String(value ?? '').trim())
                      .filter(Boolean)
                      .join(' / ')
                    const phonesLine = [salesRep.phone, salesRep.phone2]
                      .map((value) => String(value ?? '').trim())
                      .filter(Boolean)
                      .join(' / ')

                    return (
                      <Paper
                        key={salesRep.id}
                        variant="outlined"
                        sx={{
                          p: 1,
                          borderColor: isSelected ? 'primary.main' : 'divider',
                          bgcolor: isSelected ? (theme) => alpha(theme.palette.primary.main, 0.06) : 'background.paper',
                        }}
                      >
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={0.75}
                          alignItems={{ xs: 'stretch', sm: 'center' }}
                          justifyContent="space-between"
                        >
                          <Stack direction="row" spacing={0.8} alignItems="center" minWidth={0}>
                            <Box
                              sx={{
                                width: 11,
                                height: 11,
                                borderRadius: '50%',
                                bgcolor: color,
                                border: '1px solid',
                                borderColor: 'rgba(0,0,0,0.14)',
                                flexShrink: 0,
                              }}
                            />
                            <Avatar
                              src={salesRep.logoUrl || undefined}
                              alt={salesRep.companyName || salesRep.name || 'Sales rep'}
                              sx={{ width: 30, height: 30, fontSize: 12, fontWeight: 700 }}
                            >
                              {(salesRep.companyName || salesRep.name || '?').charAt(0).toUpperCase()}
                            </Avatar>
                            <Stack spacing={0.05} minWidth={0}>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 700,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {salesRep.name}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {salesRep.companyName || 'No company name'}
                              </Typography>
                            </Stack>
                            <Chip size="small" label={`${salesRep.states.length} states`} variant="outlined" />
                          </Stack>

                          <Stack direction="row" spacing={0.5}>
                            <Button
                              size="small"
                              variant={isSelected ? 'contained' : 'outlined'}
                              onClick={() => {
                                openSalesRepDialogForEdit(salesRep)
                              }}
                            >
                              {isSelected ? 'Editing' : 'Edit'}
                            </Button>
                            <IconButton
                              size="small"
                              color="error"
                              aria-label={`Delete ${salesRep.name}`}
                              disabled={deletingSalesRepId === salesRep.id}
                              onClick={() => {
                                void handleDeleteSalesRep(salesRep)
                              }}
                            >
                              <DeleteOutlineRoundedIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        </Stack>

                        {emailsLine ? (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.6, display: 'block' }}>
                            Email: {emailsLine}
                          </Typography>
                        ) : null}

                        {phonesLine ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Phone: {phonesLine}
                          </Typography>
                        ) : null}

                        <Stack direction="row" flexWrap="wrap" gap={0.55} sx={{ mt: 0.8 }}>
                          {visibleStates.map((stateCode) => (
                            <Chip key={`${salesRep.id}-${stateCode}`} size="small" label={stateCode} />
                          ))}
                          {hiddenStatesCount > 0 ? (
                            <Chip size="small" variant="outlined" label={`+${hiddenStatesCount} more`} />
                          ) : null}
                        </Stack>
                      </Paper>
                    )
                  })}
                </Box>
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={1}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={0.8}
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                justifyContent="space-between"
              >
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Territory map
                </Typography>

                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PrintRoundedIcon fontSize="small" />}
                  onClick={handlePrintMap}
                >
                  Print map
                </Button>
              </Stack>

              <Typography variant="body2" color="text.secondary">
                White states are unassigned. Use Add/Edit sales rep to change territory assignments.
              </Typography>

              <Stack direction="row" flexWrap="wrap" gap={0.7}>
                <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mr: 0.5 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: '#ffffff',
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Unassigned
                  </Typography>
                </Stack>

                {mapLegendEntries.map((entry) => (
                  <Stack key={`legend-${entry.id}`} direction="row" spacing={0.6} alignItems="center" sx={{ mr: 0.75 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        border: '1px solid',
                        borderColor: 'rgba(0,0,0,0.14)',
                        bgcolor: entry.color,
                        borderRadius: 0.2,
                      }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {entry.label}
                    </Typography>
                  </Stack>
                ))}
              </Stack>

              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: { xs: 0.6, md: 0.85 },
                  bgcolor: (theme) => alpha(theme.palette.primary.main, 0.03),
                  overflowX: 'auto',
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <Box sx={{ width: '100%', maxWidth: 860, minWidth: { xs: 560, md: 700 } }}>
                  <svg
                    ref={mapSvgRef}
                    viewBox={usaMapData.viewBox}
                    role="img"
                    aria-label={usaMapData.label}
                    style={{
                      width: '100%',
                      height: 'auto',
                      display: 'block',
                    }}
                  >
                    {usaMapData.locations.map((location) => {
                      const stateCode = location.id.toUpperCase()
                      const stateOwner = stateOwnerByCode.get(stateCode)
                      const fillColor = stateOwner
                        ? (repColorById.get(stateOwner.id) ?? '#6f8296')
                        : '#ffffff'
                      const isSelectedRepState = Boolean(selectedSalesRepId && stateOwner?.id === selectedSalesRepId)
                      const labelPosition = stateLabelPositions[stateCode]
                      const labelOffset = stateLabelOffsetByCode[stateCode] || { dx: 0, dy: 0 }
                      const labelTextColor = resolveMapLabelTextColor(fillColor)
                      const labelStrokeColor = labelTextColor === '#ffffff' ? '#18202b' : '#ffffff'
                      const labelFontSize = labelPosition
                        ? (labelPosition.area < 150
                          ? 5.2
                          : (labelPosition.area < 380 ? 6.1 : 7.1))
                        : 6.5

                      return (
                        <g key={location.id}>
                          <path
                            data-state-code={stateCode}
                            d={location.path}
                            fill={fillColor}
                            stroke={isSelectedRepState ? '#18202b' : '#8a95a3'}
                            strokeWidth={isSelectedRepState ? 1.8 : 1.1}
                            style={{
                              cursor: 'default',
                              transition: 'fill 150ms ease, stroke 150ms ease',
                            }}
                          >
                            <title>
                              {`${location.name}: ${stateOwner
                                ? stateOwner.companyName
                                  ? `${stateOwner.name} (${stateOwner.companyName})`
                                  : stateOwner.name
                                : 'Unassigned'}`}
                            </title>
                          </path>

                          {labelPosition ? (
                            <text
                              x={labelPosition.x + labelOffset.dx}
                              y={labelPosition.y + labelOffset.dy}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontSize={labelFontSize}
                              fontWeight={700}
                              fill={labelTextColor}
                              stroke={labelStrokeColor}
                              strokeWidth={0.75}
                              paintOrder="stroke"
                              pointerEvents="none"
                              style={{ userSelect: 'none' }}
                            >
                              {stateCode}
                            </text>
                          ) : null}
                        </g>
                      )
                    })}
                  </svg>
                </Box>
              </Box>
            </Stack>
          </Paper>
        </>
      )}

      <Dialog
        open={isSalesRepDialogOpen}
        onClose={handleCloseSalesRepDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {salesRepDialogMode === 'edit' ? 'Edit sales rep' : 'Add sales rep'}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1} sx={{ pt: 0.5 }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  md: 'repeat(2, minmax(0, 1fr))',
                },
                gap: 0.8,
              }}
            >
              <TextField
                size="small"
                label="Rep name"
                placeholder="Enter full name"
                value={salesRepForm.name}
                onChange={(event) => {
                  setSalesRepForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }}
              />

              <TextField
                size="small"
                label="Company name"
                placeholder="Enter company name"
                value={salesRepForm.companyName}
                onChange={(event) => {
                  setSalesRepForm((current) => ({
                    ...current,
                    companyName: event.target.value,
                  }))
                }}
              />

              <TextField
                size="small"
                label="Primary email"
                placeholder="name@company.com"
                value={salesRepForm.email}
                onChange={(event) => {
                  setSalesRepForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }}
              />

              <TextField
                size="small"
                label="Secondary email"
                placeholder="optional"
                value={salesRepForm.email2}
                onChange={(event) => {
                  setSalesRepForm((current) => ({
                    ...current,
                    email2: event.target.value,
                  }))
                }}
              />

              <TextField
                size="small"
                label="Primary phone"
                placeholder="(555) 000-0000"
                value={salesRepForm.phone}
                onChange={(event) => {
                  setSalesRepForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }}
              />

              <TextField
                size="small"
                label="Secondary phone"
                placeholder="optional"
                value={salesRepForm.phone2}
                onChange={(event) => {
                  setSalesRepForm((current) => ({
                    ...current,
                    phone2: event.target.value,
                  }))
                }}
              />
            </Box>

            <Paper
              variant="outlined"
              sx={{
                p: 1,
                borderColor: 'divider',
                bgcolor: (theme) => alpha(theme.palette.background.default, 0.45),
              }}
            >
              <Stack spacing={0.75}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
                    <Avatar
                      src={salesRepForm.logoUrl || undefined}
                      alt={salesRepForm.companyName || salesRepForm.name || 'Sales rep logo'}
                      sx={{ width: 44, height: 44, fontSize: 15, fontWeight: 700 }}
                    >
                      {(salesRepForm.companyName || salesRepForm.name || '?').charAt(0).toUpperCase()}
                    </Avatar>

                    <Stack spacing={0.1} minWidth={0}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        Company logo
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Upload a logo image or paste a logo URL.
                      </Typography>
                      {salesRepLogoUploadError ? (
                        <Typography variant="caption" color="error.main">
                          {salesRepLogoUploadError}
                        </Typography>
                      ) : null}
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={0.6}>
                    <Button
                      size="small"
                      variant="outlined"
                      component="label"
                      disabled={isUploadingSalesRepLogo}
                    >
                      {isUploadingSalesRepLogo ? 'Uploading...' : 'Upload logo'}
                      <input
                        hidden
                        accept="image/*"
                        type="file"
                        onChange={handleSalesRepLogoUpload}
                      />
                    </Button>

                    <Button
                      size="small"
                      color="inherit"
                      variant="outlined"
                      disabled={isUploadingSalesRepLogo || !salesRepForm.logoUrl}
                      onClick={() => {
                        setSalesRepLogoUploadError(null)
                        setSalesRepForm((current) => ({
                          ...current,
                          logoUrl: '',
                        }))
                      }}
                    >
                      Remove
                    </Button>
                  </Stack>
                </Stack>

                <TextField
                  size="small"
                  label="Logo URL (optional)"
                  placeholder="https://..."
                  value={salesRepForm.logoUrl}
                  onChange={(event) => {
                    setSalesRepLogoUploadError(null)
                    setSalesRepForm((current) => ({
                      ...current,
                      logoUrl: event.target.value,
                    }))
                  }}
                />
              </Stack>
            </Paper>

            <Autocomplete
              multiple
              disableCloseOnSelect
              options={availableStateOptions}
              value={salesRepForm.states}
              onChange={(_event, value) => {
                setSalesRepForm((current) => ({
                  ...current,
                  states: sortStateCodes(value),
                }))
              }}
              getOptionDisabled={isStateAssignedToDifferentRep}
              getOptionLabel={toStateLabel}
              renderOption={(props, option) => {
                const owner = stateOwnerByCode.get(option)
                const assignedToDifferentRep = Boolean(owner && owner.id !== selectedSalesRepId)

                return (
                  <li {...props}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ width: '100%' }}>
                      <Typography variant="body2">{toStateLabel(option)}</Typography>
                      {assignedToDifferentRep ? (
                        <Typography variant="caption" color="text.secondary">
                          Assigned to {owner?.name}
                        </Typography>
                      ) : null}
                    </Stack>
                  </li>
                )
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  label="Assigned states"
                  placeholder="Pick states"
                />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseSalesRepDialog}
            disabled={isSavingSalesRep || isUploadingSalesRepLogo}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveRoundedIcon fontSize="small" />}
            disabled={isSavingSalesRep || isUploadingSalesRepLogo}
            onClick={() => {
              void handleSaveSalesRep()
            }}
          >
            {isSavingSalesRep ? 'Saving...' : (salesRepDialogMode === 'edit' ? 'Save changes' : 'Create rep')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

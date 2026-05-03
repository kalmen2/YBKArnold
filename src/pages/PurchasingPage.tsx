import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import AddAPhotoRoundedIcon from '@mui/icons-material/AddAPhotoRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useDebounceValue } from '../hooks/useDebounceValue'
import { formatCurrency, formatDate, formatDateTime } from '../lib/formatters'
import { QUERY_KEYS } from '../lib/queryKeys'
import {
  deletePurchasingItemPhoto,
  fetchPurchasingItemDetail,
  fetchPurchasingItemPhotos,
  fetchPurchasingItems,
  refreshPurchasingFromQuickBooks,
  runPurchasingAiSearch,
  uploadPurchasingItemPhoto,
  type PurchasingAiOption,
  type PurchasingAiPriceStatus,
  type PurchasingAiSearchResponse,
  type PurchasingItemSummary,
} from '../features/purchasing/api'

const PAGE_SIZE = 100

function fmtShipDays(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value} d`
}

function fmtQty(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value - Math.round(value)) < 0.001) return String(Math.round(value))
  return value.toFixed(2)
}

function fmtPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return formatCurrency(value, value < 1 ? 4 : 2)
}

function fileToBase64Payload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = String(reader.result ?? '')
      const base64 = result.includes(',')
        ? String(result.split(',').pop() ?? '').trim()
        : result.trim()

      if (!base64) {
        reject(new Error('Could not read selected image.'))
        return
      }

      resolve(base64)
    }

    reader.onerror = () => {
      reject(new Error('Could not read selected image.'))
    }

    reader.readAsDataURL(file)
  })
}

function getAiPriceStatusMeta(status: PurchasingAiPriceStatus) {
  if (status === 'green') {
    return {
      label: 'Cheaper',
      chipColor: 'success' as const,
      borderColor: 'success.light',
      backgroundColor: 'rgba(46, 125, 50, 0.08)',
    }
  }

  if (status === 'red') {
    return {
      label: 'Higher',
      chipColor: 'error' as const,
      borderColor: 'error.light',
      backgroundColor: 'rgba(211, 47, 47, 0.08)',
    }
  }

  return {
    label: 'Near Market',
    chipColor: 'warning' as const,
    borderColor: 'warning.light',
    backgroundColor: 'rgba(237, 108, 2, 0.08)',
  }
}

export default function PurchasingPage() {
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounceValue(searchInput, 300)
  const [isManualAiAssistEnabled, setIsManualAiAssistEnabled] = useState(false)
  const [manualAiAssistNonce, setManualAiAssistNonce] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null)
  const [expandedVendorKey, setExpandedVendorKey] = useState<string | null>(null)
  const [isManualRefreshRunning, setIsManualRefreshRunning] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [photoActionMessage, setPhotoActionMessage] = useState<string | null>(null)
  const [photoErrorMessage, setPhotoErrorMessage] = useState<string | null>(null)
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [deletingPhotoPath, setDeletingPhotoPath] = useState<string | null>(null)
  const [isPhotoPreviewOpen, setIsPhotoPreviewOpen] = useState(false)
  const [isAiSearchDialogOpen, setIsAiSearchDialogOpen] = useState(false)
  const [isAiSearchRunning, setIsAiSearchRunning] = useState(false)
  const [aiSearchError, setAiSearchError] = useState<string | null>(null)
  const [aiSearchResult, setAiSearchResult] = useState<PurchasingAiSearchResponse | null>(null)
  const photoUploadInputRef = useRef<HTMLInputElement | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { appUser } = useAuth()

  // Reset to page 1 whenever the search changes
  useEffect(() => {
    setPage(1)
    setIsManualAiAssistEnabled(false)
  }, [debouncedSearch])

  // Collapse vendor expansion when switching items
  useEffect(() => {
    setExpandedVendorKey(null)
  }, [selectedItemKey])

  useEffect(() => {
    setPhotoActionMessage(null)
    setPhotoErrorMessage(null)
    setDeletingPhotoPath(null)
    setIsPhotoPreviewOpen(false)
    setIsAiSearchDialogOpen(false)
    setAiSearchError(null)
    setAiSearchResult(null)
    setIsAiSearchRunning(false)
  }, [selectedItemKey])

  // Auto-dismiss QuickBooks refresh success/empty notices after 3 seconds.
  useEffect(() => {
    if (!refreshMessage) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setRefreshMessage(null)
    }, 3000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [refreshMessage])

  useEffect(() => {
    if (!photoActionMessage) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setPhotoActionMessage(null)
    }, 3000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [photoActionMessage])

  const isSearchSettled = debouncedSearch.trim() === searchInput.trim()
  const shouldUseAiAssist = Boolean(debouncedSearch.trim()) && isManualAiAssistEnabled && isSearchSettled

  const itemsQuery = useQuery({
    queryKey: QUERY_KEYS.purchasingItems(
      debouncedSearch,
      page,
      PAGE_SIZE,
      shouldUseAiAssist ? manualAiAssistNonce : 0,
    ),
    queryFn: () => fetchPurchasingItems({
      search: debouncedSearch,
      page,
      pageSize: PAGE_SIZE,
      aiAssist: shouldUseAiAssist,
    }),
    staleTime: 60_000,
  })

  const detailQuery = useQuery({
    queryKey: selectedItemKey
      ? QUERY_KEYS.purchasingItemDetail(selectedItemKey)
      : ['purchasing', 'item', 'none'],
    queryFn: () => fetchPurchasingItemDetail(selectedItemKey as string),
    enabled: Boolean(selectedItemKey),
    staleTime: 60_000,
  })

  const itemPhotosQuery = useQuery({
    queryKey: selectedItemKey
      ? QUERY_KEYS.purchasingItemPhotos(selectedItemKey)
      : ['purchasing', 'item-photos', 'none'],
    queryFn: () => fetchPurchasingItemPhotos(selectedItemKey as string),
    enabled: Boolean(selectedItemKey),
    staleTime: 60_000,
  })

  const items = itemsQuery.data?.items ?? []
  const totalCount = itemsQuery.data?.totalCount ?? 0
  const totalPages = itemsQuery.data?.totalPages ?? 1
  const aiAssistMeta = itemsQuery.data?.aiAssist ?? null
  const itemPhotos = itemPhotosQuery.data?.photos ?? []
  const primaryItemPhoto = itemPhotos[0] ?? null
  const syncMeta = itemsQuery.data?.sync ?? null
  const lastRefreshedLabel = syncMeta?.lastSuccessfulRefreshAt
    ? formatDateTime(syncMeta.lastSuccessfulRefreshAt)
    : 'Never'
  const refreshInProgress = isManualRefreshRunning
  const aiReferencePrice = detailQuery.data?.summary?.averagePrice ?? null
  const aiOptions = aiSearchResult?.options ?? []

  async function handleRefresh() {
    setRefreshMessage(null)
    setRefreshError(null)
    setIsManualRefreshRunning(true)

    try {
      const response = await refreshPurchasingFromQuickBooks()
      await queryClient.invalidateQueries({ queryKey: ['purchasing'] })

      const newLineCount = Number(response?.summary?.newTransactionCount ?? 0)
      const updatedLineCount = Number(response?.summary?.updatedTransactionCount ?? 0)

      if (newLineCount > 0 || updatedLineCount > 0) {
        setRefreshMessage(
          `QuickBooks imported successfully. ${newLineCount} new line${newLineCount === 1 ? '' : 's'}, ${updatedLineCount} updated.`,
        )
      } else {
        setRefreshMessage('Nothing left to import from QuickBooks.')
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'QuickBooks sync failed.'
      setRefreshError(message)
    } finally {
      setIsManualRefreshRunning(false)
    }
  }

  function selectItem(item: PurchasingItemSummary) {
    setSelectedItemKey(item.itemKey)
  }

  function toggleVendor(vendorKey: string) {
    setExpandedVendorKey((curr) => (curr === vendorKey ? null : vendorKey))
  }

  function runManualAiAssistSearch() {
    if (!searchInput.trim()) {
      return
    }

    if (page !== 1) {
      setPage(1)
    }

    setIsManualAiAssistEnabled(true)
    setManualAiAssistNonce((current) => current + 1)
  }

  function openPhotoPreview() {
    if (!primaryItemPhoto) {
      return
    }

    setIsPhotoPreviewOpen(true)
  }

  function closePhotoPreview() {
    setIsPhotoPreviewOpen(false)
  }

  function closeAiSearchDialog() {
    setIsAiSearchDialogOpen(false)
  }

  async function runAiSearchForCurrentItem() {
    if (!selectedItemKey || isAiSearchRunning) {
      return
    }

    setAiSearchError(null)
    setIsAiSearchRunning(true)

    try {
      const response = await runPurchasingAiSearch({
        key: selectedItemKey,
        itemName: detailQuery.data?.item?.itemRaw ?? selectedItemKey,
        referencePrice: Number.isFinite(Number(aiReferencePrice))
          ? Number(aiReferencePrice)
          : null,
      })
      setAiSearchResult(response)
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Could not run AI search right now.'
      setAiSearchError(message)
      setAiSearchResult(null)
    } finally {
      setIsAiSearchRunning(false)
    }
  }

  function openAiSearchDialog() {
    if (!selectedItemKey) {
      return
    }

    setIsAiSearchDialogOpen(true)
    void runAiSearchForCurrentItem()
  }

  function openPurchasingAiConfig() {
    navigate('/admin/ai-config', {
      state: {
        category: 'purchasing',
      },
    })
  }

  async function handleItemPhotoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!selectedItemKey || !file) {
      return
    }

    setPhotoActionMessage(null)
    setPhotoErrorMessage(null)

    if (!String(file.type ?? '').toLowerCase().startsWith('image/')) {
      setPhotoErrorMessage('Please choose an image file.')
      return
    }

    if (file.size > 8 * 1024 * 1024) {
      setPhotoErrorMessage('Image exceeds 8MB limit.')
      return
    }

    setIsUploadingPhoto(true)

    try {
      const imageBase64 = await fileToBase64Payload(file)

      await uploadPurchasingItemPhoto(selectedItemKey, {
        imageBase64,
        mimeType: file.type || 'image/jpeg',
      })
      await queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.purchasingItemPhotos(selectedItemKey),
      })
      setPhotoActionMessage('Picture saved.')
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Could not upload picture.'
      setPhotoErrorMessage(message)
    } finally {
      setIsUploadingPhoto(false)
    }
  }

  async function handleDeleteItemPhoto(path: string) {
    if (!selectedItemKey || !path) {
      return
    }

    setPhotoActionMessage(null)
    setPhotoErrorMessage(null)
    setDeletingPhotoPath(path)

    try {
      await deletePurchasingItemPhoto(selectedItemKey, path)
      await queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.purchasingItemPhotos(selectedItemKey),
      })
      setIsPhotoPreviewOpen(false)
      setPhotoActionMessage('Picture removed.')
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Could not delete picture.'
      setPhotoErrorMessage(message)
    } finally {
      setDeletingPhotoPath(null)
    }
  }

  return (
    <Box
      sx={{
        px: { xs: 1.25, md: 2 },
        pt: 0,
        pb: { xs: 1.5, md: 0 },
        height: { md: 'calc(100vh - 102px)' },
        boxSizing: 'border-box',
        overflow: { md: 'hidden' },
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: 'minmax(320px, 380px) 1fr' },
          alignItems: 'stretch',
          height: { md: '100%' },
          minHeight: 0,
        }}
      >
        {/* LEFT — items list */}
        <Box sx={{ pt: { md: 0 }, minHeight: 0, display: 'flex' }}>
          <Paper
            variant="outlined"
            sx={{
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              flex: 1,
            }}
          >
            <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Search item, description, vendor…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip
                        title={
                          !searchInput.trim()
                            ? 'Type to enable AI match'
                            : shouldUseAiAssist
                              ? 'Run AI match again'
                              : 'Run AI typo/similar match'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            onClick={runManualAiAssistSearch}
                            disabled={!searchInput.trim()}
                          >
                            <TravelExploreRoundedIcon
                              fontSize="small"
                              color={shouldUseAiAssist ? 'primary' : 'inherit'}
                            />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </InputAdornment>
                  ),
                }}
              />
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {itemsQuery.isLoading
                    ? 'Loading…'
                    : `${totalCount.toLocaleString()} item${totalCount === 1 ? '' : 's'}`}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Page {page} / {totalPages}
                </Typography>
              </Stack>
              {debouncedSearch.trim() && aiAssistMeta?.used && (
                <Typography
                  variant="caption"
                  color="primary.main"
                  sx={{ mt: 0.5, display: 'block' }}
                >
                  {aiAssistMeta.message || 'AI assisted this search.'}
                </Typography>
              )}
            </Box>

            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {itemsQuery.isLoading ? (
                <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
                  <CircularProgress size={24} />
                </Box>
              ) : itemsQuery.isError ? (
                <Box sx={{ p: 3 }}>
                  <Typography color="error" variant="body2">Failed to load items.</Typography>
                </Box>
              ) : items.length === 0 ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography color="text.secondary" variant="body2">No items match.</Typography>
                </Box>
              ) : (
                items.map((item) => {
                  const selected = item.itemKey === selectedItemKey
                  return (
                    <Box
                      key={item.itemKey}
                      onClick={() => selectItem(item)}
                      sx={{
                        px: 1.5,
                        py: 1,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        cursor: 'pointer',
                        bgcolor: selected ? 'action.selected' : 'transparent',
                        borderLeft: selected ? '3px solid' : '3px solid transparent',
                        borderLeftColor: selected ? 'primary.main' : 'transparent',
                        '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                      }}
                    >
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: 12,
                          wordBreak: 'break-all',
                          lineHeight: 1.25,
                        }}
                      >
                        {item.itemRaw}
                      </Typography>
                      {item.descriptions?.[0] && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            mt: 0.25,
                          }}
                        >
                          {item.descriptions[0]}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} alignItems="center">
                        <Typography variant="caption" fontWeight={600}>
                          {formatCurrency(item.totalSpent)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          · {item.vendorCount} vendor{item.vendorCount === 1 ? '' : 's'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          · {formatDate(item.lastPurchaseDate)}
                        </Typography>
                      </Stack>
                    </Box>
                  )
                })
              )}
            </Box>

            {totalPages > 1 && (
              <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'center' }}>
                <Pagination
                  count={totalPages}
                  page={page}
                  onChange={(_, p) => setPage(p)}
                  size="small"
                  siblingCount={0}
                  boundaryCount={1}
                />
              </Box>
            )}
          </Paper>
        </Box>

        {/* RIGHT — details panel */}
        <Box sx={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="flex-end"
            sx={{ mb: 1, flexShrink: 0 }}
          >
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Typography variant="caption" color="text.secondary">
                Last refreshed: {lastRefreshedLabel}
              </Typography>
              {refreshInProgress && (
                <Typography variant="caption" color="primary.main">
                  Refreshing...
                </Typography>
              )}
              <Tooltip title={refreshInProgress ? 'Refreshing QuickBooks Online...' : 'Refresh from QuickBooks Online'}>
                <span>
                  <IconButton onClick={handleRefresh} disabled={refreshInProgress}>
                    {refreshInProgress ? <CircularProgress size={18} /> : <RefreshRoundedIcon />}
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>

          {syncMeta?.truncated && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 1, flexShrink: 0 }}>
              Last refresh was truncated. Run refresh again if older bills are still missing.
            </Typography>
          )}

          {refreshMessage && (
            <Alert severity="success" sx={{ mb: 2, flexShrink: 0 }}>
              {refreshMessage}
            </Alert>
          )}
          {refreshError && (
            <Alert severity="error" sx={{ mb: 2, flexShrink: 0 }}>
              {refreshError}
            </Alert>
          )}
          {!refreshError && syncMeta?.lastErrorMessage && (
            <Alert severity="warning" sx={{ mb: 2, flexShrink: 0 }}>
              Last QuickBooks refresh error: {syncMeta.lastErrorMessage}
            </Alert>
          )}

          <Paper
            variant="outlined"
            sx={{
              p: { xs: 1.5, md: 2 },
              minHeight: 0,
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {!selectedItemKey ? (
                <Box sx={{ p: 6, textAlign: 'center' }}>
                  <Typography variant="body1" color="text.secondary">
                    Select an item from the list to see vendor pricing and history.
                  </Typography>
                </Box>
              ) : detailQuery.isLoading ? (
                <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
                  <CircularProgress />
                </Box>
              ) : detailQuery.isError || !detailQuery.data ? (
                <Typography color="error">Failed to load item details.</Typography>
              ) : (
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h6" fontWeight={700} sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {detailQuery.data.item.itemRaw}
                    </Typography>
                    {detailQuery.data.item.descriptions?.[0] && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {detailQuery.data.item.descriptions[0]}
                      </Typography>
                    )}
                  </Box>

                  <Box
                    sx={{
                      display: 'grid',
                      gap: 1.5,
                      gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' },
                      alignItems: 'stretch',
                    }}
                  >
                    <Box
                      sx={{
                        display: 'grid',
                        gap: 1.5,
                        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
                      }}
                    >
                      <Stat label="Total Spent" value={formatCurrency(detailQuery.data.summary.totalSpent)} />
                      <Stat label="Total Qty" value={fmtQty(detailQuery.data.summary.totalQty)} />
                      <Stat label="Vendors" value={String(detailQuery.data.summary.vendorCount)} />
                      <Stat label="Lowest $" value={fmtPrice(detailQuery.data.summary.lowestPrice)} />
                      <Stat label="Avg $" value={fmtPrice(detailQuery.data.summary.averagePrice)} />
                      <Stat label="Highest $" value={fmtPrice(detailQuery.data.summary.highestPrice)} />
                      <Stat label="Fast Ship" value={fmtShipDays(detailQuery.data.summary.fastestShipDays)} />
                      <Paper
                        variant="outlined"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (selectedItemKey) {
                            openAiSearchDialog()
                          }
                        }}
                        onKeyDown={(event) => {
                          if ((event.key === 'Enter' || event.key === ' ') && selectedItemKey) {
                            event.preventDefault()
                            openAiSearchDialog()
                          }
                        }}
                        sx={{
                          px: 1.5,
                          py: 1,
                          minWidth: 0,
                          width: '100%',
                          borderStyle: 'dashed',
                          cursor: selectedItemKey ? 'pointer' : 'not-allowed',
                          opacity: selectedItemKey ? 1 : 0.55,
                          bgcolor: selectedItemKey ? 'action.hover' : 'background.paper',
                          transition: 'background-color 140ms ease',
                          '&:hover': selectedItemKey ? { bgcolor: 'action.selected' } : undefined,
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                          <Box>
                            <Typography variant="caption" color="text.secondary">AI Supplier Search</Typography>
                            <Typography variant="subtitle2" fontWeight={700}>Open</Typography>
                          </Box>
                          {isAiSearchRunning
                            ? <CircularProgress size={18} />
                            : <TravelExploreRoundedIcon color="primary" fontSize="small" />}
                        </Stack>
                      </Paper>
                    </Box>
                    <Stack spacing={1.5} sx={{ height: { md: '100%' } }}>
                      <Paper
                        variant="outlined"
                        sx={{
                          minHeight: { xs: 200, md: '100%' },
                          height: { md: '100%' },
                          p: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 1,
                          overflow: 'hidden',
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography variant="subtitle2" fontWeight={700}>
                            Item Picture
                          </Typography>
                          <input
                            ref={photoUploadInputRef}
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={handleItemPhotoFileChange}
                          />
                          <Tooltip title={selectedItemKey ? 'Add picture' : 'Select an item first'}>
                            <span>
                              <IconButton
                                size="small"
                                disabled={!selectedItemKey || isUploadingPhoto}
                                onClick={() => photoUploadInputRef.current?.click()}
                              >
                                {isUploadingPhoto ? <CircularProgress size={16} /> : <AddAPhotoRoundedIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>

                        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
                          {!selectedItemKey ? (
                            <Stack alignItems="center" justifyContent="center" sx={{ flex: 1, minHeight: 0 }} spacing={0.5}>
                              <ImageOutlinedIcon color="disabled" />
                              <Typography variant="caption" color="text.secondary">
                                Select an item to add a picture
                              </Typography>
                            </Stack>
                          ) : itemPhotosQuery.isLoading ? (
                            <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ py: 1, flex: 1, minHeight: 0 }}>
                              <CircularProgress size={16} />
                              <Typography variant="caption" color="text.secondary">Loading picture...</Typography>
                            </Stack>
                          ) : itemPhotosQuery.isError ? (
                            <Stack alignItems="center" justifyContent="center" sx={{ flex: 1, minHeight: 0 }}>
                              <Typography variant="caption" color="error">Failed to load picture.</Typography>
                            </Stack>
                          ) : primaryItemPhoto ? (
                            <Box
                              role="button"
                              tabIndex={0}
                              onClick={openPhotoPreview}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  openPhotoPreview()
                                }
                              }}
                              sx={{
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1,
                                overflow: 'hidden',
                                position: 'relative',
                                flex: 1,
                                minHeight: 0,
                                height: '100%',
                                maxHeight: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                bgcolor: 'grey.100',
                                cursor: 'zoom-in',
                              }}
                            >
                              <Box
                                component="img"
                                src={primaryItemPhoto.url}
                                alt="Purchased item"
                                sx={{
                                  maxWidth: '100%',
                                  maxHeight: '100%',
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'contain',
                                  display: 'block',
                                }}
                              />
                              <IconButton
                                size="small"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleDeleteItemPhoto(primaryItemPhoto.path)
                                }}
                                disabled={deletingPhotoPath === primaryItemPhoto.path}
                                sx={{
                                  position: 'absolute',
                                  right: 6,
                                  top: 6,
                                  bgcolor: 'rgba(0,0,0,0.55)',
                                  color: 'common.white',
                                  '&:hover': { bgcolor: 'rgba(0,0,0,0.72)' },
                                }}
                              >
                                {deletingPhotoPath === primaryItemPhoto.path
                                  ? <CircularProgress size={14} sx={{ color: 'common.white' }} />
                                  : <DeleteOutlineRoundedIcon fontSize="small" />}
                              </IconButton>
                            </Box>
                          ) : (
                            <Stack alignItems="center" justifyContent="center" sx={{ flex: 1, minHeight: 0 }} spacing={0.5}>
                              <ImageOutlinedIcon color="disabled" />
                              <Typography variant="caption" color="text.secondary">
                                No picture saved yet
                              </Typography>
                            </Stack>
                          )}
                        </Box>

                        {photoActionMessage && (
                          <Typography variant="caption" color="success.main">
                            {photoActionMessage}
                          </Typography>
                        )}
                        {photoErrorMessage && (
                          <Typography variant="caption" color="error">
                            {photoErrorMessage}
                          </Typography>
                        )}
                      </Paper>

                    </Stack>
                  </Box>

                  <Box>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                      By vendor — click a row for full transaction history
                    </Typography>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ width: 28 }} />
                            <TableCell>Vendor</TableCell>
                            <TableCell align="right">Spent</TableCell>
                            <TableCell align="right">Qty</TableCell>
                            <TableCell align="right">Lowest $</TableCell>
                            <TableCell align="right">Avg $</TableCell>
                            <TableCell align="right">Highest $</TableCell>
                            <TableCell align="right">Fast</TableCell>
                            <TableCell align="right">Avg Ship</TableCell>
                            <TableCell align="right">Slow</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {detailQuery.data.vendors.map((v) => {
                            const isOpen = expandedVendorKey === v.vendorKey
                            const vendorTx = detailQuery.data.transactions.filter((tx) => tx.vendorKey === v.vendorKey)
                            return (
                              <VendorRowGroup
                                key={v.vendorKey}
                                vendor={v}
                                isOpen={isOpen}
                                onToggle={() => toggleVendor(v.vendorKey)}
                                transactions={vendorTx}
                              />
                            )
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                </Stack>
              )}
            </Box>
          </Paper>
        </Box>
      </Box>

      <Dialog
        open={isAiSearchDialogOpen}
        onClose={closeAiSearchDialog}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ pr: 6 }}>
          AI Exact Match Supplier Search
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Exact item only. U.S. supplier market.
          </Typography>
          <IconButton
            onClick={closeAiSearchDialog}
            aria-label="Close AI search"
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
            }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 1.5 }}>
          <Stack spacing={1.25}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ wordBreak: 'break-word' }}>
                  {aiSearchResult?.itemName ?? detailQuery.data?.item.itemRaw ?? selectedItemKey ?? 'Selected item'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Delivery target: {aiSearchResult?.deliveryLocation ?? 'United States (USA)'}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                {appUser?.isAdmin && (
                  <Button
                    size="small"
                    variant="text"
                    onClick={openPurchasingAiConfig}
                  >
                    Edit AI Rules
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    void runAiSearchForCurrentItem()
                  }}
                  disabled={!selectedItemKey || isAiSearchRunning}
                  startIcon={isAiSearchRunning ? <CircularProgress size={14} /> : <TravelExploreRoundedIcon fontSize="small" />}
                >
                  {isAiSearchRunning ? 'Searching...' : 'Run Search Again'}
                </Button>
              </Stack>
            </Stack>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" color="success" label="Green: cheaper than our price" />
              <Chip size="small" color="warning" label="Yellow: within allowed range" />
              <Chip size="small" color="error" label="Red: too high" />
            </Stack>

            <Typography variant="caption" color="text.secondary">
              Pricing rule: yellow allows up to 1% above our price, or up to 3% when our price is under $100.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              If a listing price cannot be read from preview text, the link still shows as "Price unavailable."
            </Typography>

            {aiSearchResult && (
              <Typography variant="caption" color="text.secondary">
                Scanned {aiSearchResult.candidatesScanned} listing candidates. Matched {aiSearchResult.matchedOptionCount} exact options.
                {Number.isFinite(Number(aiSearchResult.referencePrice)) && aiSearchResult.referencePrice
                  ? ` Internal reference price: ${formatCurrency(aiSearchResult.referencePrice)}`
                  : ''}
              </Typography>
            )}

            <Divider />

            {aiSearchError && (
              <Alert severity="error">
                {aiSearchError}
              </Alert>
            )}

            {!aiSearchError && isAiSearchRunning && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 1 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  AI is searching suppliers for exact-item matches...
                </Typography>
              </Stack>
            )}

            {!aiSearchError && !isAiSearchRunning && aiOptions.length === 0 && (
              <Alert severity="info">
                No exact-item suppliers were found for this item.
              </Alert>
            )}

            {!aiSearchError && !isAiSearchRunning && aiOptions.length > 0 && (
              <Stack spacing={1}>
                {aiOptions.map((option: PurchasingAiOption, index) => {
                  const statusMeta = getAiPriceStatusMeta(option.priceStatus)
                  const hasUnitPrice = typeof option.unitPrice === 'number'
                    && Number.isFinite(option.unitPrice)
                    && option.unitPrice > 0
                  const deltaPercentLabel = option.deltaPercent == null
                    ? null
                    : `${option.deltaPercent > 0 ? '+' : ''}${option.deltaPercent.toFixed(2)}%`
                  const priceChipLabel = hasUnitPrice && option.unitPrice != null
                    ? `${formatCurrency(option.unitPrice)}${deltaPercentLabel ? ` (${deltaPercentLabel})` : ''}`
                    : 'Price unavailable'

                  return (
                    <Accordion
                      key={`${option.url}-${index}`}
                      disableGutters
                      sx={{
                        border: '1px solid',
                        borderColor: statusMeta.borderColor,
                        bgcolor: statusMeta.backgroundColor,
                      }}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                        <Stack sx={{ width: '100%', minWidth: 0 }} spacing={0.5}>
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={0.75}
                            justifyContent="space-between"
                            alignItems={{ sm: 'center' }}
                          >
                            <Typography variant="subtitle2" fontWeight={700} sx={{ minWidth: 0, wordBreak: 'break-word' }}>
                              {option.vendorName}
                            </Typography>
                            <Stack direction="row" spacing={0.75}>
                              {hasUnitPrice && <Chip size="small" color={statusMeta.chipColor} label={statusMeta.label} />}
                              <Chip
                                size="small"
                                variant="outlined"
                                label={priceChipLabel}
                              />
                            </Stack>
                          </Stack>
                          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                            {option.productTitle}
                          </Typography>
                        </Stack>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Stack spacing={0.75}>
                          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                            Exact-match evidence: {option.exactMatchEvidence || 'Not provided'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                            U.S. shipping evidence: {option.shippingEvidence || 'Not provided'}
                          </Typography>
                          {option.notes && (
                            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                              Notes: {option.notes}
                            </Typography>
                          )}
                          <Stack direction="row" justifyContent="flex-end">
                            <Button
                              size="small"
                              variant="outlined"
                              component="a"
                              href={option.url}
                              target="_blank"
                              rel="noreferrer"
                              endIcon={<OpenInNewRoundedIcon fontSize="small" />}
                            >
                              Open Listing
                            </Button>
                          </Stack>
                        </Stack>
                      </AccordionDetails>
                    </Accordion>
                  )
                })}
              </Stack>
            )}
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(primaryItemPhoto) && isPhotoPreviewOpen}
        onClose={closePhotoPreview}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: 'auto',
            maxWidth: 'none',
            m: 1,
            bgcolor: 'transparent',
            boxShadow: 'none',
          },
        }}
      >
        <DialogContent
          sx={{
            p: 1,
            bgcolor: 'background.default',
            position: 'relative',
            borderRadius: 1,
          }}
        >
          <IconButton
            onClick={closePhotoPreview}
            aria-label="Close enlarged picture"
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              bgcolor: 'rgba(0,0,0,0.55)',
              color: 'common.white',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.72)' },
            }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>

          {primaryItemPhoto && (
            <Box
              component="img"
              src={primaryItemPhoto.url}
              alt="Purchased item enlarged"
              sx={{
                width: 'auto',
                height: 'auto',
                maxWidth: '95vw',
                maxHeight: '90vh',
                display: 'block',
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper variant="outlined" sx={{ px: 1.5, py: 1, minWidth: 0, width: '100%' }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="subtitle1" fontWeight={700}>{value}</Typography>
    </Paper>
  )
}

type VendorRowGroupProps = {
  vendor: import('../features/purchasing/api').PurchasingVendorBreakdown
  isOpen: boolean
  onToggle: () => void
  transactions: import('../features/purchasing/api').PurchasingTransaction[]
}

function VendorRowGroup({ vendor, isOpen, onToggle, transactions }: VendorRowGroupProps) {
  return (
    <>
      <TableRow
        hover
        onClick={onToggle}
        sx={{ cursor: 'pointer', bgcolor: isOpen ? 'action.selected' : undefined }}
      >
        <TableCell>
          <ChevronRightRoundedIcon
            fontSize="small"
            sx={{
              transition: 'transform 150ms',
              transform: isOpen ? 'rotate(90deg)' : 'none',
              color: 'text.secondary',
            }}
          />
        </TableCell>
        <TableCell>{vendor.vendorRaw}</TableCell>
        <TableCell align="right">{formatCurrency(vendor.totalSpent)}</TableCell>
        <TableCell align="right">{fmtQty(vendor.totalQty)}</TableCell>
        <TableCell align="right">{fmtPrice(vendor.lowestPrice)}</TableCell>
        <TableCell align="right">{fmtPrice(vendor.averagePrice)}</TableCell>
        <TableCell align="right">{fmtPrice(vendor.highestPrice)}</TableCell>
        <TableCell align="right">{fmtShipDays(vendor.fastestShipDays)}</TableCell>
        <TableCell align="right">{fmtShipDays(vendor.averageShipDays)}</TableCell>
        <TableCell align="right">{fmtShipDays(vendor.slowestShipDays)}</TableCell>
      </TableRow>
      {isOpen && (
        <TableRow>
          <TableCell colSpan={10} sx={{ bgcolor: 'background.default', py: 1 }}>
            {transactions.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                No transactions on file for this vendor.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>PO #</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell align="right">Cost</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell align="right">Ship Date</TableCell>
                      <TableCell align="right">Deliv Date</TableCell>
                      <TableCell align="right">Days</TableCell>
                      <TableCell>Memo</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id} hover>
                        <TableCell>{formatDate(tx.date)}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={tx.type}
                            color={
                              tx.type === 'Purchase Order'
                                ? 'info'
                                : tx.type === 'Item Receipt'
                                ? 'success'
                                : 'default'
                            }
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>{tx.poNumber ?? '—'}</TableCell>
                        <TableCell align="right">{fmtQty(tx.qty)}</TableCell>
                        <TableCell align="right">{fmtPrice(tx.unitCost)}</TableCell>
                        <TableCell align="right">{formatCurrency(tx.amount, 2)}</TableCell>
                        <TableCell align="right">{formatDate(tx.shipDate)}</TableCell>
                        <TableCell align="right">{formatDate(tx.delivDate)}</TableCell>
                        <TableCell align="right">{fmtShipDays(tx.shipDays)}</TableCell>
                        <TableCell sx={{ maxWidth: 240 }}>
                          <Typography variant="caption" color="text.secondary" noWrap title={tx.memo ?? ''}>
                            {tx.memo ?? '—'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

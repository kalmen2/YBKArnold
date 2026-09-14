import ContactsRoundedIcon from '@mui/icons-material/ContactsRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'
import FacebookRoundedIcon from '@mui/icons-material/FacebookRounded'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded'
import LinkedInIcon from '@mui/icons-material/LinkedIn'
import LocalOfferRoundedIcon from '@mui/icons-material/LocalOfferRounded'
import LocationOnRoundedIcon from '@mui/icons-material/LocationOnRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import PinterestIcon from '@mui/icons-material/Pinterest'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import SortRoundedIcon from '@mui/icons-material/SortRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import TwitterIcon from '@mui/icons-material/Twitter'
import YouTubeIcon from '@mui/icons-material/YouTube'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import {
  Avatar,
  Box,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Chip,
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
  Menu,
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
  LinearProgress,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link as RouterLink, unstable_usePrompt, useBeforeUnload, useSearchParams } from 'react-router-dom'
import { firebaseStorage } from '../auth/firebase'
import { useAuth } from '../auth/useAuth'
import { StatusAlerts } from '../components/StatusAlerts'
import { DealerOrdersTab } from '../features/crm/DealerOrdersTab'
import { DealerQuotesTab } from '../features/crm/DealerQuotesTab'
import { DealerTermsTab } from '../features/crm/DealerTermsTab'
import { useDataLoader } from '../hooks/useDataLoader'
import { useDebounceValue } from '../hooks/useDebounceValue'
import {
  createCrmDealerContact,
  createCrmDealerChatMessage,
  fetchCrmDealerDetail,
  fetchCrmDealerChats,
  fetchCrmChatUsers,
  fetchCrmDealers,
  fetchCrmOrders,
  fetchCrmQuotes,
  fetchCrmSalesReps,
  removeCrmDealerChatMessage,
  removeCrmContact,
  removeCrmDealer,
  updateCrmDealerChatMessage,
  updateCrmContact,
  updateCrmDealer,
  type CrmDealer,
  type CrmDealerDetailResponse,
  type CrmDealersResponse,
  type CrmOrder,
  type CrmQuote,
} from '../features/crm/api'
import { displayContactName } from '../features/crm/utils'
import { resolveImageFileExtension, sanitizeStoragePathSegment } from '../lib/fileUtils'
import { QUERY_KEYS } from '../lib/queryKeys'
import { ChatThread, type ChatThreadMessage, type ChatThreadSendPayload } from '../features/chat/ChatThread'
import { Chart, ChartSelect, useChart } from '../components/chart'

function resolveSocialVisual(platform: string, href: string) {
  const source = `${platform} ${href}`.toLowerCase()

  if (source.includes('facebook')) return { icon: <FacebookRoundedIcon sx={{ fontSize: 16 }} />, foreground: '#1877f2', background: '#eaf2ff' }
  if (source.includes('linkedin')) return { icon: <LinkedInIcon sx={{ fontSize: 16 }} />, foreground: '#0a66c2', background: '#e8f2ff' }
  if (source.includes('twitter') || source.includes('x.com')) return { icon: <TwitterIcon sx={{ fontSize: 16 }} />, foreground: '#1d9bf0', background: '#eaf6ff' }
  if (source.includes('youtube') || source.includes('youtu.be')) return { icon: <YouTubeIcon sx={{ fontSize: 16 }} />, foreground: '#ff0033', background: '#ffeaf0' }
  if (source.includes('pinterest')) return { icon: <PinterestIcon sx={{ fontSize: 16 }} />, foreground: '#bd081c', background: '#ffebed' }

  return { icon: <LanguageRoundedIcon sx={{ fontSize: 16 }} />, foreground: '#0f4c81', background: '#eaf2fb' }
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

function createSocialLinkRow(platform = 'website', url = '', index = 0): DealerSocialLinkDraft {
  return {
    id: `social-${index}-${Math.random().toString(36).slice(2, 9)}`,
    platform: resolveSocialPlatformChoice(platform),
    url,
  }
}

function normalizeUsStateCode(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toUpperCase()

  if (!normalized) {
    return ''
  }

  if (/^[A-Z]{2}$/.test(normalized)) {
    return normalized
  }

  const stateMatch = normalized.match(/\b([A-Z]{2})\b/)
  return stateMatch?.[1] || ''
}

function normalizeWebsiteHref(value: string | null | undefined) {
  const trimmedValue = String(value ?? '').trim()

  if (!trimmedValue) {
    return ''
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue
  }

  return `https://${trimmedValue}`
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function resolveMonthKey(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? '').trim())

  if (!Number.isFinite(timestamp)) {
    return ''
  }

  const date = new Date(timestamp)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(monthKey: string) {
  const timestamp = Date.parse(`${monthKey}-01T00:00:00.000Z`)

  if (!Number.isFinite(timestamp)) {
    return monthKey
  }

  return new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(timestamp))
}

type AccountOverviewPeriod = '3m' | '6m' | '12m' | 'all'
type AccountSortBy = 'name' | 'quote_count' | 'conversion_rate' | 'order_count' | 'quoted_value' | 'order_value'
type AccountSortDirection = 'asc' | 'desc'

const accountOverviewPeriodOptions = [
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: '12m', label: '12 months' },
  { value: 'all', label: 'All months' },
]

const accountSortOptions: Array<{
  value: AccountSortBy
  label: string
  defaultDirection: AccountSortDirection
}> = [
  { value: 'name', label: 'Account name', defaultDirection: 'asc' },
  { value: 'quote_count', label: 'Most quotes', defaultDirection: 'desc' },
  { value: 'conversion_rate', label: 'Highest conversion', defaultDirection: 'desc' },
  { value: 'order_count', label: 'Most orders', defaultDirection: 'desc' },
  { value: 'quoted_value', label: 'Highest quoted value', defaultDirection: 'desc' },
  { value: 'order_value', label: 'Highest order value', defaultDirection: 'desc' },
]

function resolveMonthDate(monthKey: string) {
  const timestamp = Date.parse(`${monthKey}-01T00:00:00.000Z`)
  return Number.isFinite(timestamp) ? new Date(timestamp) : null
}

function shiftUtcMonth(date: Date, offset: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1))
}

function formatMonthKeyFromDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function buildMonthRange(startDate: Date, endDate: Date) {
  const months: string[] = []
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1))
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1))

  while (cursor <= end) {
    months.push(formatMonthKeyFromDate(cursor))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  return months
}

function resolveOverviewMonthKeys(activityMonthKeys: string[], period: AccountOverviewPeriod) {
  const currentMonth = new Date()
  const todayMonth = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), 1))
  const activityDates = activityMonthKeys
    .map(resolveMonthDate)
    .filter((date): date is Date => Boolean(date))
    .sort((first, second) => first.getTime() - second.getTime())
  const endDate = activityDates.length > 0 && activityDates[activityDates.length - 1] > todayMonth
    ? activityDates[activityDates.length - 1]
    : todayMonth

  if (period === 'all') {
    const startDate = activityDates[0] ?? shiftUtcMonth(endDate, -5)
    return buildMonthRange(startDate, endDate)
  }

  const monthCount = Number(period.replace('m', ''))
  return buildMonthRange(shiftUtcMonth(endDate, -(monthCount - 1)), endDate)
}

type DealerFormState = {
  sourceId: string
  name: string
  quoteCompanyName: string
  accountType: string
  owner: string
  ownerEmail: string
  primaryEmail: string
  secondaryEmail: string
  salesRep: string
  paymentTerms: string
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
  socialLinks: DealerSocialLinkDraft[]
  isArchived: boolean
  isFavorite: boolean
}

function AccountStatsOverview({
  account,
  contactsTotal,
  quotes,
  orders,
  isLoadingQuotes,
  isLoadingOrders,
}: {
  account: DealerFormState
  contactsTotal: number
  quotes: CrmQuote[]
  orders: CrmOrder[]
  isLoadingQuotes: boolean
  isLoadingOrders: boolean
}) {
  const theme = useTheme()
  const [overviewPeriod, setOverviewPeriod] = useState<AccountOverviewPeriod>('6m')
  const accountTypeLabel = account.accountType === 'designer' ? 'Designer' : 'Dealer'
  const quoteTotal = quotes.reduce((total, quote) => total + (Number.isFinite(Number(quote.totalAmount)) ? Number(quote.totalAmount) : 0), 0)
  const orderTotal = orders.reduce((total, order) => total + (Number.isFinite(Number(order.orderValue)) ? Number(order.orderValue) : 0), 0)
  const convertedQuotes = quotes.filter((quote) => Boolean(quote.convertedAt || quote.convertedOrderId || quote.convertedOrderNumber)).length
  const quoteConversionRate = quotes.length > 0 ? (convertedQuotes / quotes.length) * 100 : 0
  const valueConversionRate = quoteTotal > 0 ? Math.min(100, (orderTotal / quoteTotal) * 100) : 0
  const activityMonthKeys = Array.from(new Set([
    ...quotes.map((quote) => resolveMonthKey(quote.acceptedAt || quote.sentAt || quote.opportunityDate || quote.createdAt || quote.updatedAt)),
    ...orders.map((order) => resolveMonthKey(order.poDate || order.createdAt || order.updatedAt)),
  ].filter(Boolean))).sort()
  const monthKeys = resolveOverviewMonthKeys(activityMonthKeys, overviewPeriod)
  const quoteValuesByMonth = new Map<string, number>()
  const orderValuesByMonth = new Map<string, number>()

  quotes.forEach((quote) => {
    const monthKey = resolveMonthKey(quote.acceptedAt || quote.sentAt || quote.opportunityDate || quote.createdAt || quote.updatedAt)
    const quoteValue = Number.isFinite(Number(quote.totalAmount)) ? Number(quote.totalAmount) : 0

    if (monthKey) {
      quoteValuesByMonth.set(monthKey, (quoteValuesByMonth.get(monthKey) ?? 0) + quoteValue)
    }
  })

  orders.forEach((order) => {
    const monthKey = resolveMonthKey(order.poDate || order.createdAt || order.updatedAt)
    const orderValue = Number.isFinite(Number(order.orderValue)) ? Number(order.orderValue) : 0

    if (monthKey) {
      orderValuesByMonth.set(monthKey, (orderValuesByMonth.get(monthKey) ?? 0) + orderValue)
    }
  })

  const monthTotals = monthKeys.map((monthKey) => {
    return {
      monthKey,
      quoteValue: quoteValuesByMonth.get(monthKey) ?? 0,
      orderValue: orderValuesByMonth.get(monthKey) ?? 0,
    }
  })
  const maxMonthlyValue = Math.max(
    0,
    ...monthTotals.map((month) => month.quoteValue),
    ...monthTotals.map((month) => month.orderValue),
  )
  const metricCards = [
    { label: 'Quote value', value: formatCompactCurrency(quoteTotal), icon: <LocalOfferRoundedIcon fontSize="small" /> },
    { label: 'Conversion rate', value: formatPercent(quoteConversionRate), icon: <ReceiptLongRoundedIcon fontSize="small" /> },
    { label: 'Contacts', value: formatCompactNumber(contactsTotal), icon: <ContactsRoundedIcon fontSize="small" /> },
  ]
  const chartOptions = useChart({
    colors: [theme.palette.success.main, theme.palette.warning.main],
    chart: {
      toolbar: { show: false },
    },
    stroke: {
      width: 3,
      curve: 'smooth',
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.22,
        opacityTo: 0.04,
        stops: [0, 100],
      },
    },
    markers: {
      size: 4,
      strokeWidth: 2,
      strokeColors: theme.palette.background.paper,
      hover: { size: 6 },
    },
    xaxis: {
      categories: monthTotals.map((month) => formatMonthLabel(month.monthKey)),
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      min: 0,
      max: maxMonthlyValue > 0 ? undefined : 1,
      tickAmount: 4,
      labels: {
        formatter: (value: number) => (maxMonthlyValue > 0 ? formatCompactCurrency(value) : ''),
      },
    },
    grid: {
      borderColor: alpha(theme.palette.grey[500], 0.16),
      strokeDashArray: 3,
    },
    tooltip: {
      shared: true,
      intersect: false,
      y: {
        formatter: (value: number) => formatCompactCurrency(value),
      },
    },
  })
  const chartSeries = [
    { name: 'Quotes', data: monthTotals.map((month) => Number(month.quoteValue.toFixed(2))) },
    { name: 'Orders', data: monthTotals.map((month) => Number(month.orderValue.toFixed(2))) },
  ]
  const radialOptions = useChart({
    colors: [theme.palette.success.main],
    chart: { sparkline: { enabled: true } },
    plotOptions: {
      radialBar: {
        hollow: { size: '64%' },
        track: { background: alpha(theme.palette.grey[500], 0.16) },
        dataLabels: {
          name: { show: false },
          value: {
            offsetY: 8,
            fontSize: '22px',
            fontWeight: 800,
            formatter: (value: number) => formatPercent(value),
          },
        },
      },
    },
    stroke: { lineCap: 'round' },
  })
  const conversionRows = [
    {
      label: 'Quotes converted to orders',
      value: quoteConversionRate,
      amount: `${convertedQuotes} of ${quotes.length}`,
    },
    {
      label: 'Order value against quoted value',
      value: valueConversionRate,
      amount: `${formatCompactCurrency(orderTotal)} of ${formatCompactCurrency(quoteTotal)}`,
    },
  ]

  return (
    <Stack spacing={1.5}>
      {(isLoadingQuotes || isLoadingOrders) ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">Loading account activity...</Typography>
        </Stack>
      ) : null}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
          gap: 1,
        }}
      >
        {metricCards.map((metric) => (
          <Paper key={metric.label} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <Avatar variant="rounded" sx={{ width: 38, height: 38, bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08), color: 'primary.main' }}>
                {metric.icon}
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                  {metric.label}
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.15 }} noWrap>
                  {metric.value}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        ))}
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.45fr) minmax(280px, 0.8fr)' },
          gap: 1.5,
        }}
      >
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardHeader
            title="Monthly value"
            subheader={`${accountTypeLabel} quote and order activity`}
            action={(
              <ChartSelect
                options={accountOverviewPeriodOptions}
                value={overviewPeriod}
                onChange={(newValue) => setOverviewPeriod(newValue as AccountOverviewPeriod)}
              />
            )}
            slotProps={{ title: { variant: 'subtitle2', fontWeight: 800 }, subheader: { variant: 'body2' } }}
          />
          <Chart
            type="area"
            series={chartSeries}
            options={chartOptions}
            slotProps={{ loading: { p: 2.5 } }}
            sx={{ px: 1, pt: 1, pb: 2, height: 300 }}
          />
        </Card>

        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardHeader
            title="Conversion"
            subheader="Quotes becoming orders"
            slotProps={{ title: { variant: 'subtitle2', fontWeight: 800 }, subheader: { variant: 'body2' } }}
          />
          <Stack spacing={2.25} sx={{ px: 3, pb: 3 }}>
            <Stack direction={{ xs: 'column', sm: 'row', lg: 'column' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center', lg: 'stretch' }}>
              <Box sx={{ mx: 'auto', width: 150, height: 150 }}>
                <Chart
                  type="radialBar"
                  series={[Math.round(quoteConversionRate)]}
                  options={radialOptions}
                  slotProps={{ loading: { p: 2 } }}
                  sx={{ height: 150 }}
                />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1 }}>
                  {formatPercent(quoteConversionRate)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                  {convertedQuotes} converted from {quotes.length} quote{quotes.length === 1 ? '' : 's'}
                </Typography>
              </Box>
            </Stack>
            {conversionRows.map((row) => (
              <Box key={row.label}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.label}</Typography>
                  <Typography variant="body2" color="text.secondary">{row.amount}</Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={Math.max(0, Math.min(100, row.value))}
                  sx={{
                    height: 8,
                    borderRadius: 999,
                    bgcolor: (progressTheme) => alpha(progressTheme.palette.grey[500], 0.16),
                  }}
                />
              </Box>
            ))}
          </Stack>
        </Card>
      </Box>
    </Stack>
  )
}

function AccountInformationFields({ account }: { account: DealerFormState }) {
  const displayValue = (value: string) => value.trim() || 'Not provided'
  const location = [account.address, account.city, account.state, account.zip, account.country]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(', ')
  const accountTypeLabel = account.accountType === 'designer' ? 'Designer' : 'Dealer'

  const detailGroups = [
    {
      title: 'Account setup',
      rows: [
        ['Account name', account.name],
        ['Quote company name', account.quoteCompanyName],
        ['Account type', accountTypeLabel],
        ['Sales representative', account.salesRep],
        ['Payment terms', account.paymentTerms],
      ],
    },
    {
      title: 'Primary contact',
      rows: [
        ['Owner', account.owner],
        ['Owner email', account.ownerEmail],
        ['Primary email', account.primaryEmail],
        ['Additional email', account.secondaryEmail],
        ['Primary phone', account.phone],
        ['Secondary phone', account.phone2],
      ],
    },
  ]

  return (
    <Stack spacing={1.25}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
          gap: 1.5,
        }}
      >
        {detailGroups.map((group) => (
          <Paper key={group.title} variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'background.paper' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              {group.title}
            </Typography>
            <Stack divider={<Divider flexItem />} sx={{ mt: 0.75 }}>
              {group.rows.map(([label, value]) => (
                <Box key={label} sx={{ py: 0.9, display: 'grid', gridTemplateColumns: 'minmax(120px, 0.8fr) minmax(0, 1.4fr)', gap: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>{label}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: value.trim() ? 600 : 400, color: value.trim() ? 'text.primary' : 'text.disabled', overflowWrap: 'anywhere' }}>
                    {displayValue(value)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
        ))}
      </Box>

      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Address and social links</Typography>
        <Box sx={{ mt: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Address</Typography>
            <Typography variant="body2" sx={{ mt: 0.25, fontWeight: location ? 600 : 400, color: location ? 'text.primary' : 'text.disabled' }}>
              {location || 'Not provided'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Classification</Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 0.5 }}>
              <Chip size="small" label={accountTypeLabel} color={account.accountType === 'designer' ? 'secondary' : 'primary'} variant="outlined" />
              {account.isFavorite ? <Chip size="small" icon={<StarRoundedIcon />} label="Favorite" variant="outlined" /> : null}
              {account.isArchived ? <Chip size="small" label="Archived" color="warning" variant="outlined" /> : null}
            </Stack>
          </Box>
        </Box>
        {account.socialLinks.length > 0 ? (
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1.25 }}>
            {account.socialLinks.map((entry) => (
              <Chip
                key={entry.id}
                size="small"
                clickable={Boolean(normalizeWebsiteHref(entry.url))}
                component={normalizeWebsiteHref(entry.url) ? 'a' : 'div'}
                href={normalizeWebsiteHref(entry.url) || undefined}
                target={normalizeWebsiteHref(entry.url) ? '_blank' : undefined}
                label={socialPlatformOptions.find((item) => item.value === resolveSocialPlatformChoice(entry.platform))?.label || 'Link'}
                variant="outlined"
              />
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.disabled" sx={{ mt: 1.25 }}>
            No social links.
          </Typography>
        )}
      </Paper>

      {account.accountText.trim() ? (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: (theme) => alpha(theme.palette.warning.main, 0.045) }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Account notes</Typography>
          <Typography variant="body2" sx={{ mt: 0.35, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{account.accountText}</Typography>
        </Paper>
      ) : null}
    </Stack>
  )
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
  const [primaryEmail = '', secondaryEmail = ''] = normalizedEmails.length > 0
    ? normalizedEmails
    : fallbackEmails

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
    quoteCompanyName: dealer.quoteCompanyName || dealer.name || '',
    accountType: dealer.accountType || dealer.accountClass || 'dealer',
    owner: dealer.owner || '',
    ownerEmail: dealer.ownerEmail || '',
    primaryEmail,
    secondaryEmail,
    salesRep: dealer.salesRep || '',
    paymentTerms: dealer.paymentTerms || '50% Deposit / 50% CBD',
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
    socialLinks: socialLinkRows,
    isArchived: Boolean(dealer.isArchived),
    isFavorite: Boolean(dealer.isFavorite),
  }
}

function serializeDealerFormState(form: DealerFormState | null) {
  if (!form) {
    return ''
  }

  const normalizedEmails = [form.primaryEmail, form.secondaryEmail]
    .map((value) => value.trim())
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
    quoteCompanyName: form.quoteCompanyName.trim(),
    accountType: form.accountType.trim(),
    owner: form.owner.trim(),
    ownerEmail: form.ownerEmail.trim(),
    primaryEmail: form.primaryEmail.trim(),
    secondaryEmail: form.secondaryEmail.trim(),
    salesRep: form.salesRep.trim(),
    paymentTerms: form.paymentTerms.trim(),
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
  const { appUser } = useAuth()
  const [searchParams] = useSearchParams()

  const [dealers, setDealers] = useState<CrmDealer[]>([])
  const [dealersTotal, setDealersTotal] = useState(0)
  const [selectedDealerId, setSelectedDealerId] = useState('')
  const [dealerDetail, setDealerDetail] = useState<CrmDealerDetailResponse | null>(null)

  const [dealerQuotes, setDealerQuotes] = useState<CrmQuote[]>([])
  const [dealerOrders, setDealerOrders] = useState<CrmOrder[]>([])
  const [detailsTab, setDetailsTab] = useState<'overview' | 'info' | 'contacts' | 'chat' | 'quotes' | 'orders' | 'terms'>('overview')
  const [isSendingDealerChat, setIsSendingDealerChat] = useState(false)

  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [isLoadingSalesData, setIsLoadingSalesData] = useState(false)
  const [isLoadingQuotesData, setIsLoadingQuotesData] = useState(false)

  const [salesDataError, setSalesDataError] = useState<string | null>(null)
  const [quotesDataError, setQuotesDataError] = useState<string | null>(null)

  const [dealerPage, setDealerPage] = useState(0)
  const [dealerRowsPerPage, setDealerRowsPerPage] = useState(25)
  const [dealerSearchInput, setDealerSearchInput] = useState('')
  const dealerSearch = useDebounceValue(dealerSearchInput)
  const [accountTypeFilter, setAccountTypeFilter] = useState<'all' | 'dealer' | 'designer' | 'none'>('all')
  const [dealerStateFilters, setDealerStateFilters] = useState<string[]>([])
  const [dealerSalesRepFilters, setDealerSalesRepFilters] = useState<string[]>([])
  const [filtersMenuAnchorEl, setFiltersMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [filtersMenuMode, setFiltersMenuMode] = useState<'root' | 'type' | 'state' | 'salesRep'>('root')
  const [accountSortBy, setAccountSortBy] = useState<AccountSortBy>('name')
  const [accountSortDirection, setAccountSortDirection] = useState<AccountSortDirection>('asc')
  const [sortMenuAnchorEl, setSortMenuAnchorEl] = useState<HTMLElement | null>(null)

  const [contactSearchInput, setContactSearchInput] = useState('')
  const contactSearch = useDebounceValue(contactSearchInput)
  const [includeArchivedContacts, setIncludeArchivedContacts] = useState(false)
  const [contactPage, setContactPage] = useState(0)
  const [contactRowsPerPage, setContactRowsPerPage] = useState(25)
  const desktopPanelsHeight = 'calc(100vh - 300px)'

  const [dealerForm, setDealerForm] = useState<DealerFormState | null>(null)
  const [dealerFormSavedSnapshot, setDealerFormSavedSnapshot] = useState('')
  const [isSavingDealer, setIsSavingDealer] = useState(false)
  const [isAccountEditing, setIsAccountEditing] = useState(false)
  const [isUploadingDealerPicture, setIsUploadingDealerPicture] = useState(false)
  const [dealerPictureUploadError, setDealerPictureUploadError] = useState<string | null>(null)

  const dealerFormRef = useRef<DealerFormState | null>(null)
  dealerFormRef.current = dealerForm
  const dealerFormSavedSnapshotRef = useRef('')
  dealerFormSavedSnapshotRef.current = dealerFormSavedSnapshot
  const selectedDealerIdRef = useRef(selectedDealerId)
  selectedDealerIdRef.current = selectedDealerId

  const [contactEditorMode, setContactEditorMode] = useState<'create' | 'edit' | null>(null)
  const [editingContactSourceId, setEditingContactSourceId] = useState('')
  const [contactForm, setContactForm] = useState<ContactFormState>(createEmptyContactFormState())
  const [isSavingContact, setIsSavingContact] = useState(false)
  const [removingContactSourceId, setRemovingContactSourceId] = useState('')
  const [isRemovingDealer, setIsRemovingDealer] = useState(false)
  const canRemoveDealer = appUser?.isAdmin === true || appUser?.isManager === true || appUser?.isSalesRep === true

  const salesRepsQuery = useQuery({
    queryKey: QUERY_KEYS.crmSalesReps,
    queryFn: () => fetchCrmSalesReps(),
    staleTime: 5 * 60 * 1000,
  })

  const dealerChatsQuery = useQuery({
    queryKey: ['crm', 'dealer-detail-chat', selectedDealerId],
    queryFn: () => fetchCrmDealerChats(selectedDealerId, {
      limit: 200,
      offset: 0,
    }),
    enabled: detailsTab === 'chat' && Boolean(selectedDealerId),
    staleTime: 20 * 1000,
  })

  const chatUsersQuery = useQuery({
    queryKey: ['crm', 'chat-users'],
    queryFn: () => fetchCrmChatUsers(),
    enabled: detailsTab === 'chat',
    staleTime: 2 * 60 * 1000,
  })

  const salesReps = useMemo(
    () => (Array.isArray(salesRepsQuery.data?.salesReps) ? salesRepsQuery.data.salesReps : []),
    [salesRepsQuery.data?.salesReps],
  )

  const availableDealerStateOptions = useMemo(() => {
    const optionSet = new Set<string>()

    const statesFromSalesReps = Array.isArray(salesRepsQuery.data?.availableStates)
      ? salesRepsQuery.data.availableStates
      : []

    statesFromSalesReps.forEach((stateCode) => {
      const normalizedStateCode = normalizeUsStateCode(stateCode)

      if (normalizedStateCode) {
        optionSet.add(normalizedStateCode)
      }
    })

    salesReps.forEach((salesRep) => {
      salesRep.states.forEach((stateCode) => {
        const normalizedStateCode = normalizeUsStateCode(stateCode)

        if (normalizedStateCode) {
          optionSet.add(normalizedStateCode)
        }
      })
    })

    dealers.forEach((dealer) => {
      const normalizedStateCode = normalizeUsStateCode(dealer.state)

      if (normalizedStateCode) {
        optionSet.add(normalizedStateCode)
      }
    })

    return [...optionSet].sort((left, right) => left.localeCompare(right))
  }, [dealers, salesReps, salesRepsQuery.data?.availableStates])

  const availableDealerSalesRepOptions = useMemo(() => {
    const optionSet = new Set<string>()

    salesReps.forEach((salesRep) => {
      const normalizedName = String(salesRep.name ?? '').trim()

      if (normalizedName) {
        optionSet.add(normalizedName)
      }
    })

    dealers.forEach((dealer) => {
      const normalizedName = String(dealer.salesRep ?? '').trim()

      if (normalizedName) {
        optionSet.add(normalizedName)
      }
    })

    return [...optionSet].sort((left, right) => left.localeCompare(right))
  }, [dealers, salesReps])

  const hasAdvancedFilters = accountTypeFilter !== 'all' || dealerStateFilters.length > 0 || dealerSalesRepFilters.length > 0
  const activeAccountSortOption = accountSortOptions.find((option) => option.value === accountSortBy) ?? accountSortOptions[0]
  const activeAccountSortDirectionLabel = accountSortBy === 'name'
    ? accountSortDirection === 'desc' ? 'Z to A' : 'A to Z'
    : accountSortDirection === 'desc' ? 'high to low' : 'low to high'
  const activeAccountSortLabel = `${activeAccountSortOption.label} ${activeAccountSortDirectionLabel}`

  useEffect(() => {
    const requestedDealerId = searchParams.get('dealerSourceId')?.trim() ?? ''
    if (requestedDealerId) {
      setSelectedDealerId(requestedDealerId)
      setContactPage(0)
    }
    if (searchParams.get('detailsTab') === 'chat') {
      setDetailsTab('chat')
    }
    // Intentionally excludes selectedDealerId: this effect seeds the selection from
    // the URL when navigating here (e.g. from the contacts page). It must NOT re-run
    // when the user clicks a different dealer, or the URL would override their click.
  }, [searchParams])

  useEffect(() => {
    setIsAccountEditing(false)
  }, [selectedDealerId])

  useEffect(() => {
    setDealerPictureUploadError(null)
  }, [selectedDealerId])

  useEffect(() => {
    setDealerQuotes([])
    setDealerOrders([])
    setQuotesDataError(null)
    setSalesDataError(null)
  }, [selectedDealerId])

  useEffect(() => {
    setDealerPage(0)
  }, [dealerSearch])

  useEffect(() => {
    setDealerPage(0)
  }, [accountSortBy, accountSortDirection, accountTypeFilter, dealerSalesRepFilters, dealerStateFilters])

  const { isLoading: isLoadingDealers, isRefreshing: isRefreshingDealers, errorMessage, setErrorMessage, load: loadDealers } = useDataLoader({
    fetcher: useCallback(() => fetchCrmDealers({
      limit: dealerRowsPerPage,
      offset: dealerPage * dealerRowsPerPage,
      search: dealerSearch || undefined,
      accountType: accountTypeFilter === 'all' ? undefined : accountTypeFilter,
      dealerStates: dealerStateFilters.length > 0 ? dealerStateFilters : undefined,
      salesReps: dealerSalesRepFilters.length > 0 ? dealerSalesRepFilters : undefined,
      sortBy: accountSortBy,
      sortDirection: accountSortDirection,
    }), [accountSortBy, accountSortDirection, accountTypeFilter, dealerPage, dealerRowsPerPage, dealerSalesRepFilters, dealerSearch, dealerStateFilters]),
    onSuccess: useCallback((response: CrmDealersResponse) => {
      const nextDealers = Array.isArray(response.dealers) ? response.dealers : []
      const normalizedTotal = typeof response.total === 'number' && Number.isFinite(response.total)
        ? Math.max(0, response.total)
        : null
      const normalizedOffset = typeof response.offset === 'number' && Number.isFinite(response.offset)
        ? Math.max(0, response.offset)
        : dealerPage * dealerRowsPerPage
      const visibleCount = normalizedOffset + nextDealers.length
      const effectiveTotal = normalizedTotal ?? (response.hasMore ? visibleCount + 1 : visibleCount)

      setDealers(nextDealers)
      setDealersTotal(effectiveTotal)
      setSelectedDealerId((current) => {
        if (!current && nextDealers.length > 0) {
          return nextDealers[0].sourceId
        }

        if (current && !nextDealers.some((dealer) => dealer.sourceId === current)) {
          return nextDealers[0]?.sourceId ?? ''
        }

        return current
      })
    }, [dealerPage, dealerRowsPerPage]),
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

    const fetchingForId = selectedDealerId
    setErrorMessage(null)
    setIsLoadingDetail(true)

    try {
      const response = await fetchCrmDealerDetail(selectedDealerId, {
        includeArchivedContacts,
        contactSearch: contactSearch || undefined,
        contactOffset: contactPage * contactRowsPerPage,
        contactLimit: contactRowsPerPage,
      })

      if (selectedDealerIdRef.current !== fetchingForId) {
        return
      }

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

      setIsLoadingDetail(false)
    } catch (error) {
      if (selectedDealerIdRef.current !== fetchingForId) {
        return
      }

      setDealerDetail(null)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load account details.')
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

    const fetchingForId = selectedDealerId
    setSalesDataError(null)
    setIsLoadingSalesData(true)

    try {
      const ordersPayload = await fetchCrmOrders({ dealerSourceId: selectedDealerId, limit: 150 })

      if (selectedDealerIdRef.current !== fetchingForId) {
        return
      }

      setDealerOrders(Array.isArray(ordersPayload.orders) ? ordersPayload.orders : [])
      setIsLoadingSalesData(false)
    } catch (error) {
      if (selectedDealerIdRef.current !== fetchingForId) {
        return
      }

      setDealerOrders([])
      setSalesDataError(error instanceof Error ? error.message : 'Failed to load orders.')
      setIsLoadingSalesData(false)
    }
  }, [selectedDealerId])

  const loadDealerQuotesData = useCallback(async () => {
    if (!selectedDealerId) {
      setDealerQuotes([])
      setQuotesDataError(null)
      return
    }

    const fetchingForId = selectedDealerId
    setQuotesDataError(null)
    setIsLoadingQuotesData(true)

    try {
      const quotesPayload = await fetchCrmQuotes({
        dealerSourceId: selectedDealerId,
        limit: 150,
        status: 'all',
        lifecycle: 'all',
      })

      if (selectedDealerIdRef.current !== fetchingForId) {
        return
      }

      setDealerQuotes(Array.isArray(quotesPayload.quotes) ? quotesPayload.quotes : [])
      setIsLoadingQuotesData(false)
    } catch (error) {
      if (selectedDealerIdRef.current !== fetchingForId) {
        return
      }

      setDealerQuotes([])
      setQuotesDataError(error instanceof Error ? error.message : 'Failed to load quotes.')
      setIsLoadingQuotesData(false)
    }
  }, [selectedDealerId])

  useEffect(() => {
    void loadDealerDetail()
  }, [loadDealerDetail])

  useEffect(() => {
    if (detailsTab === 'overview') {
      void loadDealerSalesData()
      void loadDealerQuotesData()
      return
    }

    if (detailsTab === 'orders') {
      void loadDealerSalesData()
      return
    }

    if (detailsTab === 'quotes') {
      void loadDealerQuotesData()
    }
  }, [detailsTab, loadDealerQuotesData, loadDealerSalesData])

  const selectedDealer = dealerDetail?.dealer ?? null
  const contactsPageLink = selectedDealerId
    ? `/sales?tab=contacts&dealerSourceId=${encodeURIComponent(selectedDealerId)}`
    : '/sales?tab=contacts'

  const dealerChatMessages = dealerChatsQuery.data?.messages ?? []
  const dealerChatTotal = dealerChatsQuery.data?.total ?? Math.max(0, Number(selectedDealer?.chatMessageCount ?? 0) || 0)
  const dealerChatErrorMessage = dealerChatsQuery.error instanceof Error
    ? dealerChatsQuery.error.message
    : chatUsersQuery.error instanceof Error
      ? chatUsersQuery.error.message
      : null
  const chatUsers = chatUsersQuery.data?.users ?? []
  const canManageDealerChat = Boolean(appUser?.uid)
  const currentUserUid = String(appUser?.uid ?? '').trim()
  const currentUserEmail = String(appUser?.email ?? '').trim().toLowerCase()
  const isCurrentUserAdmin = Boolean(appUser?.isApproved && appUser?.isAdmin)

  const orderRows = useMemo(
    () => [...dealerOrders].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [dealerOrders],
  )

  const canGoToNextDealerPage = (dealerPage + 1) * dealerRowsPerPage < dealersTotal

  const quoteRows = useMemo(
    () => [...dealerQuotes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [dealerQuotes],
  )

  const visibleDealerCounts = useMemo(() => {
    const counts = {
      all: dealersTotal,
      dealer: 0,
      designer: 0,
      none: 0,
    }

    dealers.forEach((dealer) => {
      const normalizedType = String(dealer.accountType || dealer.accountClass || '').trim().toLowerCase()

      if (normalizedType === 'designer') {
        counts.designer += 1
        return
      }

      if (normalizedType === 'dealer') {
        counts.dealer += 1
        return
      }

      counts.none += 1
    })

    return counts
  }, [dealers, dealersTotal])

  const selectedAccountName = selectedDealer?.name || selectedDealer?.sourceId || ''
  const selectedAccountTypeLabel = selectedDealer
    ? (String(selectedDealer.accountType || selectedDealer.accountClass || '').trim().toLowerCase() === 'designer' ? 'Designer' : 'Dealer')
    : ''
  const selectedAccountLocation = selectedDealer
    ? [selectedDealer.city, selectedDealer.state].map((value) => String(value ?? '').trim()).filter(Boolean).join(', ')
    : ''
  const selectedAccountPictureUrl = String(dealerForm?.pictureUrl || selectedDealer?.pictureUrl || '').trim() || undefined

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

  type DealerStringField =
    | 'name'
    | 'quoteCompanyName'
    | 'accountType'
    | 'owner'
    | 'ownerEmail'
    | 'primaryEmail'
    | 'secondaryEmail'
    | 'salesRep'
    | 'paymentTerms'
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

  const setDealerTextField = useCallback((field: DealerStringField, value: string) => {
    setDealerForm((current) => current ? { ...current, [field]: value } : current)
  }, [])

  const handleDealerPictureUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file) {
      return
    }

    if (!selectedDealerId) {
      setDealerPictureUploadError('Select an account before uploading a picture.')
      return
    }

    if (!file.type.startsWith('image/')) {
      setDealerPictureUploadError('Please upload an image file.')
      return
    }

    const maxUploadBytes = 10 * 1024 * 1024

    if (file.size > maxUploadBytes) {
      setDealerPictureUploadError('Image is too large. Maximum size is 10MB.')
      return
    }

    setDealerPictureUploadError(null)
    setErrorMessage(null)
    setIsUploadingDealerPicture(true)

    try {
      const dealerSegment = sanitizeStoragePathSegment(selectedDealerId, 'dealer')
      const fileBaseName = sanitizeStoragePathSegment(file.name.replace(/\.[^.]+$/, ''), 'picture')
      const fileExtension = resolveImageFileExtension(file)
      const objectPath = `crm/dealer-pictures/${dealerSegment}/${Date.now()}-${fileBaseName}${fileExtension}`
      const uploadTarget = storageRef(firebaseStorage, objectPath)

      await uploadBytes(uploadTarget, file, {
        contentType: file.type || undefined,
        cacheControl: 'public,max-age=31536000',
      })

      const downloadUrl = await getDownloadURL(uploadTarget)
      setDealerTextField('pictureUrl', downloadUrl)
    } catch (error) {
      setDealerPictureUploadError(error instanceof Error ? error.message : 'Failed to upload image to Firebase.')
    } finally {
      setIsUploadingDealerPicture(false)
    }
  }, [selectedDealerId, setDealerTextField, setErrorMessage])

  const setDealerSocialLinkAtIndex = useCallback((index: number, field: 'platform' | 'url', value: string) => {
    setDealerForm((current) => {
      if (!current) return current
      return {
        ...current,
        socialLinks: current.socialLinks.map((entry, i) => {
          if (i !== index) return entry
          return field === 'platform' ? { ...entry, platform: resolveSocialPlatformChoice(value) } : { ...entry, url: value }
        }),
      }
    })
  }, [])

  const addDealerSocialLink = useCallback(() => {
    setDealerForm((current) => current ? {
      ...current,
      socialLinks: [...current.socialLinks, createSocialLinkRow('website', '', current.socialLinks.length)],
    } : current)
  }, [])

  const removeDealerSocialLink = useCallback((index: number) => {
    setDealerForm((current) => current ? {
      ...current,
      socialLinks: current.socialLinks.filter((_, i) => i !== index),
    } : current)
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

  const cancelDealerEdit = useCallback(() => {
    if (!isAccountEditing || isSavingDealer) {
      return
    }

    if (hasUnsavedDealerChanges) {
      const shouldDiscard = window.confirm('Discard unsaved account edits?')

      if (!shouldDiscard) {
        return
      }

      resetDealerForm()
    }

    setIsAccountEditing(false)
  }, [hasUnsavedDealerChanges, isAccountEditing, isSavingDealer, resetDealerForm])

  const handleSelectDealer = useCallback((nextDealerId: string) => {
    if (!nextDealerId || nextDealerId === selectedDealerId) {
      return
    }

    if (!confirmDiscardDealerChanges()) {
      return
    }

    setSelectedDealerId(nextDealerId)
    setContactPage(0)
    setIsAccountEditing(false)
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

    const normalizedEmails = [dealerForm.primaryEmail, dealerForm.secondaryEmail]
      .map((value) => value.trim())
      .filter(Boolean)

    const normalizedAccountType = dealerForm.accountType.trim().toLowerCase()

    if (normalizedAccountType !== 'dealer' && normalizedAccountType !== 'designer') {
      setErrorMessage('Account type must be Dealer or Designer.')
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
        quoteCompanyName: dealerForm.quoteCompanyName.trim(),
        accountType: normalizedAccountType,
        owner: dealerForm.owner.trim(),
        ownerEmail: dealerForm.ownerEmail.trim(),
        salesRep: dealerForm.salesRep.trim(),
        paymentTerms: dealerForm.paymentTerms.trim(),
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
      setIsAccountEditing(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update account.')
    } finally {
      setIsSavingDealer(false)
    }
  }, [dealerForm, loadDealerDetail, loadDealers, selectedDealerId, setErrorMessage])

  const handleRemoveDealer = useCallback(async () => {
    if (!selectedDealerId || !selectedDealer) {
      return
    }

    const dealerLabel = selectedDealer.name || selectedDealer.sourceId

    if (!window.confirm(`Delete account ${dealerLabel}?`)) {
      return
    }

    const archiveContacts = window.confirm(
      'Also delete all contacts under this account? Press OK for yes, Cancel for account only.',
    )

    setIsRemovingDealer(true)
    setErrorMessage(null)

    try {
      await removeCrmDealer(selectedDealerId, {
        archiveContacts,
      })

      setDealerDetail(null)
      setDealerForm(null)
      setDealerFormSavedSnapshot('')
      setSelectedDealerId('')
      setIsAccountEditing(false)

      await loadDealers(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete dealer.')
    } finally {
      setIsRemovingDealer(false)
    }
  }, [loadDealers, selectedDealer, selectedDealerId, setErrorMessage])

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

    if (!window.confirm(`Delete contact ${contactName}?`)) {
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

  const canManageDealerChatMessage = useCallback((message: ChatThreadMessage) => {
    if (isCurrentUserAdmin) {
      return true
    }

    const createdByUid = String(message.createdByUid ?? '').trim()
    const createdByEmail = String(message.createdByEmail ?? '').trim().toLowerCase()

    return Boolean(
      (currentUserUid && createdByUid && currentUserUid === createdByUid)
      || (currentUserEmail && createdByEmail && currentUserEmail === createdByEmail),
    )
  }, [currentUserEmail, currentUserUid, isCurrentUserAdmin])

  const handleSendDealerChatMessage = useCallback(async (payload: ChatThreadSendPayload) => {
    if (!selectedDealerId || !payload.message) {
      return
    }

    if (!canManageDealerChat) {
      setErrorMessage('You do not have permission to post account chat messages.')
      return
    }

    setErrorMessage(null)
    setIsSendingDealerChat(true)

    try {
      await createCrmDealerChatMessage(selectedDealerId, {
        message: payload.message,
        mentionUserUids: payload.mentionUserUids,
        reminder: payload.reminder
          ? {
            dueDate: payload.reminder.dueDate,
            note: payload.reminder.note,
            targetUserUids: payload.reminder.targetUserUids,
          }
          : null,
      })

      await Promise.all([
        dealerChatsQuery.refetch(),
        loadDealerDetail(),
        loadDealers(true),
      ])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send account chat message.')
    } finally {
      setIsSendingDealerChat(false)
    }
  }, [
    canManageDealerChat,
    dealerChatsQuery,
    loadDealerDetail,
    loadDealers,
    selectedDealerId,
    setErrorMessage,
  ])

  const handleSaveDealerChatMessageEdit = useCallback(async (messageId: string, message: string) => {
    if (!selectedDealerId || !messageId || !message.trim()) {
      return
    }

    setErrorMessage(null)

    try {
      await updateCrmDealerChatMessage(selectedDealerId, messageId, message.trim())
      await Promise.all([
        dealerChatsQuery.refetch(),
        loadDealerDetail(),
        loadDealers(true),
      ])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update account chat message.')
    }
  }, [
    dealerChatsQuery,
    loadDealerDetail,
    loadDealers,
    selectedDealerId,
    setErrorMessage,
  ])

  const handleDeleteDealerChatMessage = useCallback(async (messageId: string) => {
    if (!selectedDealerId || !messageId) {
      return
    }

    setErrorMessage(null)

    try {
      await removeCrmDealerChatMessage(selectedDealerId, messageId)

      await Promise.all([
        dealerChatsQuery.refetch(),
        loadDealerDetail(),
        loadDealers(true),
      ])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete account chat message.')
    }
  }, [
    dealerChatsQuery,
    loadDealerDetail,
    loadDealers,
    selectedDealerId,
    setErrorMessage,
  ])

  const toggleDealerStateFilter = (stateCode: string) => {
    setDealerStateFilters((current) => {
      if (current.includes(stateCode)) {
        return current.filter((value) => value !== stateCode)
      }

      return [...current, stateCode].sort((left, right) => left.localeCompare(right))
    })
  }

  const toggleDealerSalesRepFilter = (salesRepName: string) => {
    setDealerSalesRepFilters((current) => {
      if (current.includes(salesRepName)) {
        return current.filter((value) => value !== salesRepName)
      }

      return [...current, salesRepName].sort((left, right) => left.localeCompare(right))
    })
  }

  return (
    <Stack spacing={2}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1, md: 1.25 },
          borderRadius: 2,
          borderColor: (theme) => alpha(theme.palette.grey[500], 0.18),
          bgcolor: 'background.paper',
          boxShadow: (theme) => `0 10px 28px ${alpha(theme.palette.grey[900], 0.04)}`,
        }}
      >
        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', lg: 'center' }}
        >
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ flexShrink: 0 }}
          >
            <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
              Accounts
            </Typography>
            <Chip size="small" label={dealersTotal.toLocaleString()} variant="outlined" />
            {hasAdvancedFilters ? (
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={`${(accountTypeFilter !== 'all' ? 1 : 0) + dealerStateFilters.length + dealerSalesRepFilters.length} filters`}
              />
            ) : null}

            <Menu
              anchorEl={filtersMenuAnchorEl}
              open={Boolean(filtersMenuAnchorEl)}
              onClose={() => {
                setFiltersMenuAnchorEl(null)
                setFiltersMenuMode('root')
              }}
              PaperProps={{
                sx: {
                  width: 320,
                  maxHeight: 460,
                },
              }}
            >
              <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Account filters
                </Typography>
                <Button
                  size="small"
                  onClick={() => {
                    setAccountTypeFilter('all')
                    setDealerStateFilters([])
                    setDealerSalesRepFilters([])
                  }}
                  disabled={!hasAdvancedFilters}
                >
                  Clear
                </Button>
              </Box>

              <Divider />

              {filtersMenuMode === 'root' ? (
                <>
                  <MenuItem
                    onClick={() => {
                      setFiltersMenuMode('type')
                    }}
                  >
                    <ListItemText
                      primary="By account type"
                      secondary={accountTypeFilter === 'all'
                        ? 'All accounts'
                        : accountTypeFilter === 'dealer'
                          ? 'Dealers'
                          : accountTypeFilter === 'designer'
                            ? 'Designers'
                            : 'Not set'}
                    />
                  </MenuItem>

                  <MenuItem
                    onClick={() => {
                      setFiltersMenuMode('state')
                    }}
                  >
                    <ListItemText
                      primary="By state"
                      secondary={dealerStateFilters.length > 0 ? `${dealerStateFilters.length} selected` : 'All states'}
                    />
                  </MenuItem>

                  <MenuItem
                    onClick={() => {
                      setFiltersMenuMode('salesRep')
                    }}
                  >
                    <ListItemText
                      primary="By sales rep"
                      secondary={dealerSalesRepFilters.length > 0 ? `${dealerSalesRepFilters.length} selected` : 'All sales reps'}
                    />
                  </MenuItem>
                </>
              ) : filtersMenuMode === 'type' ? (
                <>
                  <MenuItem
                    onClick={() => {
                      setFiltersMenuMode('root')
                    }}
                  >
                    <ListItemText primary="Back" secondary="Choose filter type" />
                  </MenuItem>

                  <Divider />

                  {([
                    ['all', 'All accounts', visibleDealerCounts.all],
                    ['dealer', 'Dealers', visibleDealerCounts.dealer],
                    ['designer', 'Designers', visibleDealerCounts.designer],
                    ['none', 'Not set', visibleDealerCounts.none],
                  ] as const).map(([value, label, count]) => (
                    <MenuItem
                      dense
                      key={`accounts-type-filter-${value}`}
                      selected={accountTypeFilter === value}
                      onClick={() => {
                        setAccountTypeFilter(value)
                      }}
                    >
                      <ListItemText primary={label} secondary={`${count} shown on this page`} />
                    </MenuItem>
                  ))}
                </>
              ) : filtersMenuMode === 'state' ? (
                <>
                  <MenuItem
                    onClick={() => {
                      setFiltersMenuMode('root')
                    }}
                  >
                    <ListItemText primary="Back" secondary="Choose filter type" />
                  </MenuItem>

                  <Divider />

                  <MenuItem
                    dense
                    selected={dealerStateFilters.length === 0}
                    onClick={() => {
                      setDealerStateFilters([])
                    }}
                  >
                    <ListItemText primary="All states" />
                  </MenuItem>

                  {availableDealerStateOptions.map((stateCode) => (
                    <MenuItem
                      dense
                      key={`accounts-state-filter-${stateCode}`}
                      onClick={() => {
                        toggleDealerStateFilter(stateCode)
                      }}
                    >
                      <Checkbox size="small" checked={dealerStateFilters.includes(stateCode)} sx={{ mr: 0.25 }} />
                      <ListItemText primary={stateCode} />
                    </MenuItem>
                  ))}
                </>
              ) : (
                <>
                  <MenuItem
                    onClick={() => {
                      setFiltersMenuMode('root')
                    }}
                  >
                    <ListItemText primary="Back" secondary="Choose filter type" />
                  </MenuItem>

                  <Divider />

                  <MenuItem
                    dense
                    selected={dealerSalesRepFilters.length === 0}
                    onClick={() => {
                      setDealerSalesRepFilters([])
                    }}
                  >
                    <ListItemText primary="All sales reps" />
                  </MenuItem>

                  {availableDealerSalesRepOptions.map((salesRepName) => (
                    <MenuItem
                      dense
                      key={`accounts-sales-rep-filter-${salesRepName}`}
                      onClick={() => {
                        toggleDealerSalesRepFilter(salesRepName)
                      }}
                    >
                      <Checkbox size="small" checked={dealerSalesRepFilters.includes(salesRepName)} sx={{ mr: 0.25 }} />
                      <ListItemText primary={salesRepName} />
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>

          </Stack>

          <Box
            sx={{
              flex: 1,
              display: 'flex',
              justifyContent: { xs: 'stretch', lg: 'center' },
              minWidth: 0,
            }}
          >
            <TextField
              size="small"
              label="Search"
              placeholder="Account name, account ID, owner or contact email"
              value={dealerSearchInput}
              sx={{ width: { xs: '100%', lg: 'min(560px, 100%)' } }}
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
          </Box>

          <Stack
            direction="row"
            spacing={0.75}
            sx={{
              width: { xs: '100%', lg: 'auto' },
              justifyContent: { xs: 'flex-end', lg: 'flex-start' },
              flexShrink: 0,
            }}
          >
            <Tooltip title={`Sorted by ${activeAccountSortLabel}`}>
              <Button
                variant={accountSortBy === 'name' && accountSortDirection === 'asc' ? 'outlined' : 'contained'}
                size="small"
                startIcon={<SortRoundedIcon />}
                onClick={(event) => {
                  setSortMenuAnchorEl(event.currentTarget)
                }}
              >
                Sort
              </Button>
            </Tooltip>
            <Menu
              anchorEl={sortMenuAnchorEl}
              open={Boolean(sortMenuAnchorEl)}
              onClose={() => {
                setSortMenuAnchorEl(null)
              }}
              PaperProps={{
                sx: {
                  width: 300,
                },
              }}
            >
              <Box sx={{ px: 1.5, py: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Sort accounts
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {activeAccountSortLabel}
                </Typography>
              </Box>

              <Divider />

              {accountSortOptions.map((option) => (
                <MenuItem
                  dense
                  key={`accounts-sort-${option.value}`}
                  selected={accountSortBy === option.value}
                  onClick={() => {
                    setAccountSortBy(option.value)
                    setAccountSortDirection(option.defaultDirection)
                    setSortMenuAnchorEl(null)
                  }}
                >
                  <ListItemText primary={option.label} secondary={option.defaultDirection === 'desc' ? 'Highest first' : 'A to Z'} />
                </MenuItem>
              ))}

              <Divider />

              <MenuItem
                dense
                selected={accountSortDirection === 'desc'}
                onClick={() => {
                  setAccountSortDirection('desc')
                }}
              >
                <ListItemText primary="Direction: high to low" />
              </MenuItem>
              <MenuItem
                dense
                selected={accountSortDirection === 'asc'}
                onClick={() => {
                  setAccountSortDirection('asc')
                }}
              >
                <ListItemText primary={accountSortBy === 'name' ? 'Direction: A to Z' : 'Direction: low to high'} />
              </MenuItem>
            </Menu>
            <Tooltip title={hasAdvancedFilters ? 'Filters active' : 'Open filters'}>
              <Button
                variant={hasAdvancedFilters ? 'contained' : 'outlined'}
                size="small"
                startIcon={<FilterListRoundedIcon />}
                onClick={(event) => {
                  setFiltersMenuMode('root')
                  setFiltersMenuAnchorEl(event.currentTarget)
                }}
              >
                Filters
              </Button>
            </Tooltip>
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
                void loadDealerQuotesData()
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
            p: 1,
            borderRadius: 2,
            borderColor: (theme) => alpha(theme.palette.grey[500], 0.18),
            bgcolor: (theme) => alpha(theme.palette.grey[500], 0.035),
            height: { xs: 'auto', xl: desktopPanelsHeight },
            overflow: { xs: 'visible', xl: 'hidden' },
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Stack spacing={1.25} sx={{ height: '100%', minHeight: 0 }}>
            <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between">
              <Box sx={{ px: 0.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Account Names
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {dealersTotal > 0 ? `${dealerPage * dealerRowsPerPage + 1}-${Math.min((dealerPage + 1) * dealerRowsPerPage, dealersTotal)}` : '0'} of {dealersTotal}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700 }}>
                  {activeAccountSortLabel}
                </Typography>
              </Box>

              <Tooltip title={hasAdvancedFilters ? 'More filters (active)' : 'More filters'}>
                <IconButton
                  size="small"
                  onClick={(event) => {
                    setFiltersMenuMode('root')
                    setFiltersMenuAnchorEl(event.currentTarget)
                  }}
                  sx={{
                    color: hasAdvancedFilters ? 'primary.main' : 'text.secondary',
                  }}
                >
                  <MoreVertRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>

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
                  flex: 1,
                  minHeight: 0,
                  maxHeight: { xs: 320, xl: 'none' },
                  overflow: 'auto',
                  borderRadius: 2,
                  borderColor: (theme) => alpha(theme.palette.grey[500], 0.16),
                  bgcolor: 'background.paper',
                }}
              >
                <List disablePadding sx={{ p: 0.5 }}>
                  {dealers.map((dealer, index) => {
                    const isSelected = selectedDealerId === dealer.sourceId
                    const accountName = dealer.name || dealer.sourceId
                    const accountInitial = accountName.charAt(0).toUpperCase()
                    const accountPictureUrl = String(dealer.pictureUrl ?? '').trim() || undefined
                    const accountLocation = [dealer.city, dealer.state].filter(Boolean).join(', ') || 'No location'
                    const accountType = String(dealer.accountType || dealer.accountClass || '').trim().toLowerCase()
                    const accountTypeLabel = accountType === 'designer' ? 'Designer' : accountType === 'dealer' ? 'Dealer' : 'Not set'
                    const salesRepLabel = String(dealer.salesRep ?? '').trim()
                    const rawQuoteCount = Number(dealer.quoteCount ?? 0)
                    const rawOrderCount = Number(dealer.orderCount ?? 0)
                    const rawQuoteConversionRate = Number(dealer.quoteConversionRate ?? 0)
                    const quoteCount = Number.isFinite(rawQuoteCount) ? Math.max(0, rawQuoteCount) : 0
                    const orderCount = Number.isFinite(rawOrderCount) ? Math.max(0, rawOrderCount) : 0
                    const quoteConversionRate = Number.isFinite(rawQuoteConversionRate) ? Math.max(0, rawQuoteConversionRate) : 0

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
                          mb: index < dealers.length - 1 ? 0.5 : 0,
                          border: '1px solid',
                          borderColor: isSelected ? 'primary.main' : 'transparent',
                          borderRadius: 1.5,
                          bgcolor: isSelected ? (theme) => alpha(theme.palette.primary.main, 0.08) : 'transparent',
                          '&.Mui-selected': {
                            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
                          },
                          '&.Mui-selected:hover': {
                            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
                          },
                          '&:hover': {
                            bgcolor: (theme) => alpha(theme.palette.grey[500], 0.08),
                          },
                        }}
                      >
                        <Avatar
                          src={accountPictureUrl}
                          alt={accountName}
                          sx={{ width: 38, height: 38, fontSize: 13, fontWeight: 800 }}
                          imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                        >
                          {accountInitial || '?'}
                        </Avatar>

                        <ListItemText
                          primary={accountName}
                          primaryTypographyProps={{
                            fontSize: 14,
                            fontWeight: isSelected ? 700 : 500,
                            noWrap: true,
                          }}
                          secondaryTypographyProps={{
                            component: 'div',
                            color: 'text.secondary',
                          }}
                          secondary={(
                            <Stack spacing={0.5} sx={{ mt: 0.35 }}>
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {accountLocation}
                              </Typography>
                              <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Chip size="small" label={accountTypeLabel} variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                                {salesRepLabel ? (
                                  <Chip size="small" label={salesRepLabel} sx={{ height: 20, fontSize: 11 }} />
                                ) : null}
                                <Chip
                                  size="small"
                                  label={`${formatCompactNumber(quoteCount)} quotes`}
                                  color={accountSortBy === 'quote_count' ? 'primary' : 'default'}
                                  variant={accountSortBy === 'quote_count' ? 'filled' : 'outlined'}
                                  sx={{ height: 20, fontSize: 11 }}
                                />
                                <Chip
                                  size="small"
                                  label={`${formatPercent(quoteConversionRate)} conv`}
                                  color={accountSortBy === 'conversion_rate' ? 'success' : 'default'}
                                  variant={accountSortBy === 'conversion_rate' ? 'filled' : 'outlined'}
                                  sx={{ height: 20, fontSize: 11 }}
                                />
                                <Chip
                                  size="small"
                                  label={`${formatCompactNumber(orderCount)} orders`}
                                  color={accountSortBy === 'order_count' ? 'warning' : 'default'}
                                  variant={accountSortBy === 'order_count' ? 'filled' : 'outlined'}
                                  sx={{ height: 20, fontSize: 11 }}
                                />
                              </Stack>
                            </Stack>
                          )}
                        />
                      </ListItemButton>
                    )
                  })}
                </List>
              </Paper>
            )}

            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ px: 0.5, pt: 0.25 }}>
              <FormControl size="small" sx={{ minWidth: 88 }}>
                <Select
                  value={String(dealerRowsPerPage)}
                  onChange={(event) => {
                    setDealerRowsPerPage(Number(event.target.value))
                    setDealerPage(0)
                  }}
                  sx={{
                    height: 32,
                    bgcolor: 'background.paper',
                    '& .MuiSelect-select': {
                      py: 0.5,
                      fontSize: 13,
                      fontWeight: 700,
                    },
                  }}
                >
                  {[25, 50, 100, 250].map((rowsPerPageOption) => (
                    <MenuItem key={rowsPerPageOption} value={rowsPerPageOption}>
                      {rowsPerPageOption}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Button
                size="small"
                variant="outlined"
                disabled={dealerPage === 0}
                onClick={() => {
                  setDealerPage((current) => Math.max(0, current - 1))
                }}
              >
                Previous
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={!canGoToNextDealerPage}
                onClick={() => {
                  setDealerPage((current) => current + 1)
                }}
              >
                Next
              </Button>
            </Stack>
          </Stack>
        </Paper>

        <Paper
          variant="outlined"
          sx={{
            p: { xs: 1.25, md: 1.5 },
            borderRadius: 2,
            borderColor: (theme) => alpha(theme.palette.grey[500], 0.18),
            bgcolor: 'background.paper',
            boxShadow: (theme) => `0 18px 45px ${alpha(theme.palette.grey[900], 0.05)}`,
            height: { xs: 'auto', xl: desktopPanelsHeight },
            overflow: { xs: 'visible', xl: 'auto' },
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
            <Stack spacing={1.5}>
              <Paper
                variant="outlined"
                sx={{
                  p: { xs: 1.5, md: 2 },
                  borderRadius: 2,
                  borderColor: (theme) => alpha(theme.palette.grey[500], 0.16),
                  bgcolor: (theme) => alpha(theme.palette.grey[500], 0.035),
                }}
              >
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1.5}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                    <Avatar
                      src={selectedAccountPictureUrl}
                      alt={selectedAccountName}
                      sx={{
                        width: 62,
                        height: 62,
                        fontSize: 22,
                        fontWeight: 800,
                        boxShadow: (theme) => `0 0 0 4px ${theme.palette.background.paper}`,
                      }}
                      imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                    >
                      {selectedAccountName.charAt(0).toUpperCase()}
                    </Avatar>

                    <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                      <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.12 }} noWrap>
                        {selectedAccountName}
                      </Typography>
                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip size="small" label={selectedAccountTypeLabel} color={selectedAccountTypeLabel === 'Designer' ? 'secondary' : 'primary'} variant="outlined" />
                        {selectedAccountLocation ? (
                          <Chip size="small" icon={<LocationOnRoundedIcon />} label={selectedAccountLocation} variant="outlined" />
                        ) : null}
                        {selectedDealer.isArchived ? (
                          <Chip size="small" label="Archived" color="warning" variant="outlined" />
                        ) : null}
                        {dealerForm?.isFavorite ? (
                          <Chip size="small" icon={<StarRoundedIcon />} label="Favorite" variant="outlined" />
                        ) : null}
                        {isAccountEditing && hasUnsavedDealerChanges ? (
                          <Chip size="small" label="Unsaved" color="warning" variant="outlined" />
                        ) : null}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
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
                    {isAccountEditing ? (
                      <>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={isSavingDealer}
                          onClick={cancelDealerEdit}
                        >
                          Cancel
                        </Button>

                        <Button
                          size="small"
                          variant="contained"
                          disabled={!hasUnsavedDealerChanges || isSavingDealer || isUploadingDealerPicture || !dealerForm}
                          onClick={() => {
                            void handleSaveDealer()
                          }}
                        >
                          {isSavingDealer ? 'Saving...' : 'Save'}
                        </Button>
                      </>
                    ) : (
                      <Stack direction="row" spacing={0.75}>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<EditRoundedIcon fontSize="small" />}
                          disabled={isLoadingDetail || !dealerForm || isRemovingDealer}
                          onClick={() => {
                            setDetailsTab('info')
                            setIsAccountEditing(true)
                          }}
                        >
                          Edit
                        </Button>

                        {canRemoveDealer ? (
                          <Button
                            size="small"
                            color="error"
                            variant="outlined"
                            startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                            disabled={isRemovingDealer}
                            onClick={() => {
                              void handleRemoveDealer()
                            }}
                          >
                            {isRemovingDealer ? 'Deleting...' : 'Delete'}
                          </Button>
                        ) : null}
                      </Stack>
                    )}
                  </Stack>
                </Stack>
              </Paper>

              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Tabs
                  value={detailsTab}
                  onChange={(_event, nextValue: 'overview' | 'info' | 'contacts' | 'chat' | 'quotes' | 'orders' | 'terms') => {
                    setDetailsTab(nextValue)
                  }}
                  variant="scrollable"
                  allowScrollButtonsMobile
                  sx={{
                    minHeight: 40,
                    '& .MuiTabs-flexContainer': {
                      gap: 0.5,
                    },
                    '& .MuiTab-root': {
                      minHeight: 40,
                      py: 0.5,
                      px: 1.25,
                      fontSize: 13,
                      lineHeight: 1.2,
                      textTransform: 'none',
                      borderRadius: '8px 8px 0 0',
                    },
                    '& .MuiTab-iconWrapper': {
                      mr: 0.5,
                    },
                  }}
                >
                  <Tab value="overview" icon={<ReceiptLongRoundedIcon fontSize="small" />} iconPosition="start" label="Overview" />
                  <Tab value="info" icon={<LanguageRoundedIcon fontSize="small" />} iconPosition="start" label="Information" />
                  <Tab value="contacts" icon={<ContactsRoundedIcon fontSize="small" />} iconPosition="start" label={`Contacts (${dealerDetail?.contactsTotal ?? 0})`} />
                  <Tab value="chat" icon={<EmailRoundedIcon fontSize="small" />} iconPosition="start" label={`Chat (${dealerChatTotal})`} />
                  <Tab value="quotes" icon={<LocalOfferRoundedIcon fontSize="small" />} iconPosition="start" label={`Quotes (${dealerQuotes.length})`} />
                  <Tab value="orders" icon={<ReceiptLongRoundedIcon fontSize="small" />} iconPosition="start" label={`Orders (${dealerOrders.length})`} />
                  <Tab value="terms" icon={<EditRoundedIcon fontSize="small" />} iconPosition="start" label="Terms" />
                </Tabs>
              </Box>

              {detailsTab === 'overview' ? (
                dealerForm ? (
                  <AccountStatsOverview
                    account={dealerForm}
                    contactsTotal={dealerDetail?.contactsTotal ?? 0}
                    quotes={quoteRows}
                    orders={orderRows}
                    isLoadingQuotes={isLoadingQuotesData}
                    isLoadingOrders={isLoadingSalesData}
                  />
                ) : (
                  <Typography color="text.secondary" sx={{ py: 1 }}>
                    Account overview is loading...
                  </Typography>
                )
              ) : detailsTab === 'info' ? (
                dealerForm ? (
                  isAccountEditing ? (
                  <Stack spacing={1}>
                    <Box>
                      <fieldset
                        disabled={isSavingDealer}
                        style={{
                          border: 0,
                          padding: 0,
                          margin: 0,
                          minInlineSize: 0,
                        }}
                      >
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
                          onChange={(e) => setDealerTextField('name', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="Quote company name"
                          value={dealerForm.quoteCompanyName}
                          onChange={(e) => setDealerTextField('quoteCompanyName', e.target.value)}
                          helperText={isAccountEditing ? 'Clean customer-facing name used on website-created quotes.' : undefined}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="Owner"
                          value={dealerForm.owner}
                          onChange={(e) => setDealerTextField('owner', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="Owner email"
                          value={dealerForm.ownerEmail}
                          onChange={(e) => setDealerTextField('ownerEmail', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="Primary email (optional)"
                          value={dealerForm.primaryEmail}
                          onChange={(e) => setDealerTextField('primaryEmail', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="Optional email"
                          value={dealerForm.secondaryEmail}
                          onChange={(e) => setDealerTextField('secondaryEmail', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="Sales rep"
                          value={dealerForm.salesRep}
                          onChange={(e) => setDealerTextField('salesRep', e.target.value)}
                          select={isAccountEditing}
                          InputProps={{ readOnly: !isAccountEditing }}
                        >
                          {isAccountEditing
                            ? [...new Set(['House', ...availableDealerSalesRepOptions])].map((salesRepName) => (
                                <MenuItem key={salesRepName} value={salesRepName}>{salesRepName}</MenuItem>
                              ))
                            : null}
                        </TextField>
                        <TextField
                          size="small"
                          label="Payment terms"
                          value={dealerForm.paymentTerms}
                          onChange={(e) => setDealerTextField('paymentTerms', e.target.value)}
                          helperText={isAccountEditing ? 'Automatically applied to new website-created quotes.' : undefined}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="Primary phone"
                          value={dealerForm.phone}
                          onChange={(e) => setDealerTextField('phone', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="Secondary phone"
                          value={dealerForm.phone2}
                          onChange={(e) => setDealerTextField('phone2', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="Website"
                          value={dealerForm.website}
                          onChange={(e) => setDealerTextField('website', e.target.value)}
                          InputProps={{
                            readOnly: !isAccountEditing,
                            endAdornment: normalizeWebsiteHref(dealerForm.website) ? (
                              <InputAdornment position="end">
                                <IconButton
                                  size="small"
                                  component="a"
                                  href={normalizeWebsiteHref(dealerForm.website)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label="Open website in new tab"
                                >
                                  <OpenInNewRoundedIcon fontSize="inherit" />
                                </IconButton>
                              </InputAdornment>
                            ) : undefined,
                          }}
                        />
                        <TextField
                          size="small"
                          label="Address"
                          value={dealerForm.address}
                          onChange={(e) => setDealerTextField('address', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="City"
                          value={dealerForm.city}
                          onChange={(e) => setDealerTextField('city', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="State"
                          value={dealerForm.state}
                          onChange={(e) => setDealerTextField('state', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="Zip"
                          value={dealerForm.zip}
                          onChange={(e) => setDealerTextField('zip', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />
                        <TextField
                          size="small"
                          label="Country"
                          value={dealerForm.country}
                          onChange={(e) => setDealerTextField('country', e.target.value)}
                          InputProps={{ readOnly: !isAccountEditing }}
                        />

                      </Box>

                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: {
                            xs: '1fr',
                            md: 'repeat(2, minmax(0, 1fr))',
                          },
                          gap: 0.7,
                          alignItems: 'start',
                        }}
                      >
                        <Box
                          sx={{
                            border: 1,
                            borderColor: 'divider',
                            borderRadius: 1,
                            p: 0.8,
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
                              const platformLabel = socialPlatformOptions.find((c) => c.value === selectedPlatform)!.label
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
                                      disabled={!isAccountEditing}
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
                                    InputProps={{ readOnly: !isAccountEditing }}
                                  />

                                  <IconButton
                                    size="small"
                                    color="error"
                                    aria-label="Remove social link"
                                    disabled={!isAccountEditing}
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
                              disabled={!isAccountEditing}
                              sx={{ width: 'fit-content' }}
                            >
                              Add social link
                            </Button>
                          </Stack>
                        </Box>

                        <Box
                          sx={{
                            border: 1,
                            borderColor: (theme) => alpha(theme.palette.warning.main, 0.55),
                            borderRadius: 1,
                            p: 0.8,
                          }}
                        >
                          <Stack spacing={0.6}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              Account notes
                            </Typography>
                            <Box
                              sx={{
                                display: 'grid',
                                gridTemplateColumns: {
                                  xs: '1fr',
                                  md: 'minmax(0, 1fr)',
                                },
                                gap: 0.7,
                              }}
                            >
                              <TextField
                                select
                                size="small"
                                label="Account type"
                                value={dealerForm.accountType}
                                disabled={!isAccountEditing}
                                onChange={(event) => {
                                  const nextType = event.target.value === 'designer' ? 'designer' : 'dealer'
                                  setDealerTextField('accountType', nextType)
                                }}
                              >
                                <MenuItem value="dealer">Dealer</MenuItem>
                                <MenuItem value="designer">Designer</MenuItem>
                              </TextField>
                            </Box>
                            <TextField
                              size="small"
                              multiline
                              minRows={2}
                              placeholder="Add account notes"
                              value={dealerForm.accountText}
                              onChange={(event) => {
                                setDealerTextField('accountText', event.target.value)
                              }}
                              InputProps={{ readOnly: !isAccountEditing }}
                              sx={{
                                '& .MuiInputBase-root': {
                                  fontSize: 13,
                                },
                              }}
                            />
                          </Stack>
                        </Box>
                      </Box>

                      <Box
                        sx={{
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          p: 0.8,
                        }}
                      >
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={1}
                          alignItems={{ xs: 'flex-start', sm: 'center' }}
                          justifyContent="space-between"
                        >
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Avatar
                              src={dealerForm.pictureUrl || undefined}
                              alt={dealerForm.name || dealerForm.sourceId}
                              sx={{ width: 42, height: 42, fontSize: 14 }}
                              imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                            >
                              {(dealerForm.name || dealerForm.sourceId || '?').charAt(0).toUpperCase()}
                            </Avatar>

                            <Stack spacing={0.15}>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                Account picture
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Upload to Firebase Storage.
                              </Typography>
                              {dealerPictureUploadError ? (
                                <Typography variant="caption" color="error.main">
                                  {dealerPictureUploadError}
                                </Typography>
                              ) : null}
                            </Stack>
                          </Stack>

                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.6}>
                            <Button
                              size="small"
                              variant="outlined"
                              component="label"
                              disabled={!isAccountEditing || isUploadingDealerPicture}
                            >
                              {isUploadingDealerPicture ? 'Uploading...' : (dealerForm.pictureUrl ? 'Change picture' : 'Upload picture')}
                              <input
                                hidden
                                accept="image/*"
                                type="file"
                                onChange={handleDealerPictureUpload}
                              />
                            </Button>

                            <Button
                              size="small"
                              color="inherit"
                              variant="outlined"
                              disabled={!isAccountEditing || isUploadingDealerPicture || !dealerForm.pictureUrl}
                              onClick={() => {
                                setDealerPictureUploadError(null)
                                setDealerTextField('pictureUrl', '')
                              }}
                            >
                              Remove picture
                            </Button>
                          </Stack>
                        </Stack>
                      </Box>
                      </Stack>
                    </fieldset>
                    </Box>
                  </Stack>
                  ) : (
                    <AccountInformationFields account={dealerForm} />
                  )
                ) : (
                  <Typography color="text.secondary" sx={{ py: 1 }}>
                    Account form is loading...
                  </Typography>
                )
              ) : detailsTab === 'contacts' ? (
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
                          const contactPhotoUrl = String(contact.photoUrl ?? '').trim() || undefined

                          return (
                            <TableRow key={contact.sourceId}>
                              <TableCell>
                                <Avatar
                                  src={contactPhotoUrl}
                                  alt={contactName}
                                  sx={{ width: 34, height: 34, mx: 'auto', fontSize: 13 }}
                                  imgProps={{ loading: 'lazy', referrerPolicy: 'no-referrer' }}
                                >
                                  {contactName.charAt(0).toUpperCase() || '?'}
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
                                    {removingContactSourceId === contact.sourceId ? 'Deleting...' : 'Delete'}
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
              ) : detailsTab === 'chat' ? (
                <ChatThread
                  messages={dealerChatMessages}
                  users={chatUsers}
                  currentUserUid={currentUserUid}
                  isLoading={dealerChatsQuery.isLoading}
                  isSending={isSendingDealerChat}
                  errorMessage={dealerChatErrorMessage}
                  canPost={canManageDealerChat}
                  canManageMessage={canManageDealerChatMessage}
                  maxHeight={{ xs: 320, xl: 520 }}
                  onSend={handleSendDealerChatMessage}
                  onEdit={handleSaveDealerChatMessageEdit}
                  onDelete={handleDeleteDealerChatMessage}
                />
              ) : detailsTab === 'quotes' ? (
                <DealerQuotesTab
                  isLoading={isLoadingQuotesData}
                  error={quotesDataError}
                  quotes={quoteRows}
                />
              ) : detailsTab === 'terms' ? (
                <DealerTermsTab dealerSourceId={selectedDealerId} />
              ) : (
                <DealerOrdersTab
                  isLoading={isLoadingSalesData}
                  error={salesDataError}
                  orders={orderRows}
                />
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
            <TextField size="small" label="Contact name" value={contactForm.name} onChange={(e) => setContactFormField('name', e.target.value)} />
            <TextField size="small" label="First name" value={contactForm.firstName} onChange={(e) => setContactFormField('firstName', e.target.value)} />
            <TextField size="small" label="Last name" value={contactForm.lastName} onChange={(e) => setContactFormField('lastName', e.target.value)} />
            <TextField size="small" label="Primary email" value={contactForm.primaryEmail} onChange={(e) => setContactFormField('primaryEmail', e.target.value)} />
            <TextField size="small" label="Secondary email" value={contactForm.secondaryEmail} onChange={(e) => setContactFormField('secondaryEmail', e.target.value)} />
            <TextField size="small" label="Email 3" value={contactForm.email3} onChange={(e) => setContactFormField('email3', e.target.value)} />
            <TextField size="small" label="Email 4" value={contactForm.email4} onChange={(e) => setContactFormField('email4', e.target.value)} />
            <TextField size="small" label="Sales unit" value={contactForm.salesUnit} onChange={(e) => setContactFormField('salesUnit', e.target.value)} />
            <TextField size="small" label="Phone" value={contactForm.phone} onChange={(e) => setContactFormField('phone', e.target.value)} />
            <TextField size="small" label="Phone 2" value={contactForm.phone2} onChange={(e) => setContactFormField('phone2', e.target.value)} />
            <TextField size="small" label="Phone Alt" value={contactForm.phoneAlt} onChange={(e) => setContactFormField('phoneAlt', e.target.value)} />
            <TextField size="small" label="Address" value={contactForm.address} onChange={(e) => setContactFormField('address', e.target.value)} />
            <TextField size="small" label="City" value={contactForm.city} onChange={(e) => setContactFormField('city', e.target.value)} />
            <TextField size="small" label="State" value={contactForm.state} onChange={(e) => setContactFormField('state', e.target.value)} />
            <TextField size="small" label="Zip" value={contactForm.zip} onChange={(e) => setContactFormField('zip', e.target.value)} />
            <TextField size="small" label="Country" value={contactForm.country} onChange={(e) => setContactFormField('country', e.target.value)} />
            <TextField size="small" label="Gender" value={contactForm.gender} onChange={(e) => setContactFormField('gender', e.target.value)} />
            <TextField size="small" label="Contact Type ID" value={contactForm.contactTypeId} onChange={(e) => setContactFormField('contactTypeId', e.target.value)} />
            <TextField size="small" label="Photo URL" value={contactForm.photoUrl} onChange={(e) => setContactFormField('photoUrl', e.target.value)} />
            <FormControl size="small">
              <InputLabel id="contact-archived-label">Archived</InputLabel>
              <Select labelId="contact-archived-label" label="Archived" value={contactForm.isArchived ? 'true' : 'false'} onChange={(e) => setContactFormField('isArchived', e.target.value === 'true')}>
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

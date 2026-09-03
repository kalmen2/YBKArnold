import {
  Document,
  Image,
  Page,
  PDFDownloadLink,
  PDFViewer,
  pdf,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import OpenWithRoundedIcon from '@mui/icons-material/OpenWithRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { fetchCrmDocumentTerms, type CrmDocumentTerm, type CrmQuote, type CrmQuoteLineImage, type CrmQuoteLineItem, type CrmQuotePrintSettings } from './api'
import { QUERY_KEYS } from '../../lib/queryKeys'
const defaultArnoldLogoUrl = '/arnold-quote-logo.png'
const defaultArnoldMarkUrl = '/arnold-quote-mark.png'

const DEFAULT_CUSTOMER_INFORMATION = `Purchase Orders can be sent to sales@arnoldcontract.us.
Arnold Contract requires full payment as a deposit for all change orders, replacements, and add-ons prior to processing.
All items are shipped F.O.B. Factory, Irvington NJ.
Custom-made and custom-finished furniture is non-cancelable and non-returnable. Please ensure specifications are correct before placing your order.
Arnold Contract reserves the right to correct clerical or pricing errors at any time.
It is the customer's responsibility to confirm that all furniture will fit into the designated elevator and building.
Crated and knocked-down units will be shipped and must be installed on-site by the customer's installer.
Lead times are based on the volume of orders in-house when the quotation and deposit are received and may change.
Arnold Contract will acknowledge receipt of your PO and confirm order details once processed.`

const STAIN_TO_MATCH_NOTICE = [
  'Stain to Match — Net $375.00. S.T.M. is available only on Arnold standard veneers: Cherry, Walnut, Mahogany, Oak, and Maple.',
  'Does not include reconstituted veneer, multi-step finishes, racking, glazing, matching laminate wood, or proprietary veneer.',
  'An additional up-charge may apply upon receipt and review of the sample by our Procurement Manager.',
]

const QUOTE_VALIDITY_NOTICE = 'Quoted prices are subject to change without notice. All pricing is valid for 30 days from the initial quote. (R0) Date'

const DEFAULT_ADDITIONAL_SERVICES = [
  ['custom-design', 'Custom Design Fee', 'Includes up to two rendering revisions with a lead time of two weeks. Additional revisions are billed separately.', 175],
  ['stain-match', 'Stain to Match', 'Available on Arnold standard veneers. See the customer information notice below for exclusions and conditions.', 375],
  ['paint-sample', 'Paint Sample', 'Paint sample includes one standard paint strike-off. Additional approval samples may incur an extra fee.', 375],
  ['field-verification', 'FIV — Field Verification & Measurement', 'Includes one-time field verification and measurement during regular business hours.', 850],
  ['shop-drawing', 'Shop Drawings', 'Includes up to two revisions with an estimated two-week lead time.', 250],
].map(([id, title, description, price]) => ({ id: String(id), title: String(title), description: String(description), price: 0, images: [], qty: null, unitPrice: Number(price), extPrice: 0 }))

const DEFAULT_SHIPPING_SERVICES = [
  ['blanket-delivery', 'Blanket-Wrapped Dock Delivery', 'Dedicated truck delivery to a local warehouse dock. Customer team unloads the truck.'],
  ['common-carrier', 'Crated & Shipped via Common Carrier', 'Delivered crated to a warehouse dock by common carrier. Customer team unloads the truck.'],
  ['delivery-installation', 'Delivery & Installation', 'Site conditions, access, working hours, and carry-up requirements must be confirmed before scheduling.'],
].map(([id, title, description]) => ({ id, title, description, price: null, images: [] }))
  .map((service) => ({ ...service, qty: null, unitPrice: null, extPrice: null }))

// eslint-disable-next-line react-refresh/only-export-components
export const DEFAULT_QUOTE_PRINT_SETTINGS: CrmQuotePrintSettings = {
  id: 'default',
  logoUrl: defaultArnoldLogoUrl,
  logoName: 'Arnold Contract',
  companyName: 'Arnold Contract',
  addressLines: [],
  phone: null,
  email: null,
  website: null,
  headerText: null,
  footerText: 'Thank you for the opportunity to quote this project.',
  accentColor: '#0f4c81',
  showPaymentTerms: true,
  showLeadTime: true,
  showFreight: true,
  customerInformation: DEFAULT_CUSTOMER_INFORMATION,
  projectManagers: 'Misha Patel, Jose Gonzalez',
  depositRequestBody: 'To begin processing this order, please send the 50% Product Net deposit shown above at your earliest convenience.',
  depositRequestTerms: 'Color samples and shop drawings must be received and approved when required. Delays in receiving required approvals may affect the stated lead time.\n\nCustom orders are final and cannot be returned, exchanged, or refunded.',
  orderConfirmationRequestedInfo: 'Please send the control sample to the address below:\n\nArnold Kolax Furniture Inc.\nAttn: Misha Patel (Ack # {ack})\n120 Coit Street, Irvington, NJ 07111',
  orderConfirmationNotes: 'Thank you for your order. We appreciate your business and look forward to working with you.',
  orderConfirmationTerms: 'Lead times begin after final approved shop drawings and finish samples are received.',
  updatedAt: null,
  updatedByEmail: null,
}

const money = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '-'
  const amount = Number(value)
  return Number.isFinite(amount)
    ? amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
    : '-'
}

const optionalMoney = (value: number | null | undefined) => value === null || value === undefined ? '' : money(value)

const additionalServiceKey = (value: string | null | undefined) => {
  const normalized = String(value || '').toLowerCase()
  if (normalized.includes('custom design')) return 'custom-design'
  if (normalized.includes('stain to match')) return 'stain-match'
  if (normalized.includes('paint sample')) return 'paint-sample'
  if (normalized.includes('field verification') || /\bfiv\b/.test(normalized)) return 'field-verification'
  if (normalized.includes('shop drawing')) return 'shop-drawing'
  return normalized.replace(/[^a-z0-9]+/g, '-')
}

const hydrateAdditionalServices = (items: CrmQuote['additionalServices']) => {
  const sourceItems = (Array.isArray(items) ? items : [])
    .filter((service) => service.id !== 'demolition' && !/demolition/i.test(String(service.title || '')))
  const matchedKeys = new Set<string>()
  const defaults = DEFAULT_ADDITIONAL_SERVICES.map((standard) => {
    const key = additionalServiceKey(standard.title)
    const existing = sourceItems.find((service) => additionalServiceKey(service.title) === key)
    if (!existing) return standard
    matchedKeys.add(key)
    const qty = existing.qty === null || existing.qty === undefined ? null : Number(existing.qty)
    const existingUnitPrice = Number(existing.unitPrice)
    const unitPrice = existing.unitPrice !== null && existing.unitPrice !== undefined
      && Number.isFinite(existingUnitPrice) && existingUnitPrice > 0
      ? existingUnitPrice
      : standard.unitPrice
    const extPrice = qty !== null && Number.isFinite(qty)
      ? Number((qty * Number(unitPrice)).toFixed(2))
      : 0
    return {
      ...standard,
      ...existing,
      title: standard.title,
      description: existing.description || standard.description,
      qty,
      unitPrice,
      extPrice,
      price: extPrice,
    }
  })
  return [...defaults, ...sourceItems.filter((service) => !matchedKeys.has(additionalServiceKey(service.title)))]
}

const resolveServiceExtPrice = (service: {
  qty?: number | null
  unitPrice?: number | null
  extPrice?: number | null
  price?: number | null
}) => {
  const hasExtPrice = service.extPrice !== null && service.extPrice !== undefined
  const extPrice = Number(service.extPrice)
  if (hasExtPrice && Number.isFinite(extPrice)) return Number(extPrice.toFixed(2))

  const hasQty = service.qty !== null && service.qty !== undefined
  const hasUnitPrice = service.unitPrice !== null && service.unitPrice !== undefined
  const qty = Number(service.qty)
  const unitPrice = Number(service.unitPrice)
  if (hasQty && hasUnitPrice && Number.isFinite(qty) && Number.isFinite(unitPrice)) {
    return Number((qty * unitPrice).toFixed(2))
  }

  const hasLegacyPrice = service.price !== null && service.price !== undefined
  const legacyPrice = Number(service.price)
  if (hasLegacyPrice && Number.isFinite(legacyPrice)) return Number(legacyPrice.toFixed(2))

  return null
}

const resolvePdfImageUri = (rawUrl: string | null | undefined) => {
  const sourceUrl = String(rawUrl || '').trim()

  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    return sourceUrl
  }

  let parsedUrl

  try {
    parsedUrl = new URL(sourceUrl)
  } catch {
    return sourceUrl
  }

  if (String(parsedUrl.hostname || '').toLowerCase() !== 'firebasestorage.googleapis.com') {
    return sourceUrl
  }

  const appOrigin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : ''
  const proxyPath = `/api/crm/quote-image-proxy?url=${encodeURIComponent(sourceUrl)}`

  return appOrigin ? `${appOrigin}${proxyPath}` : proxyPath
}

const plain = (value: unknown, fallback = '-') => String(value ?? '').trim() || fallback

function formatQuoteDate(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  const dateOnlyMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (dateOnlyMatch) {
    return `${dateOnlyMatch[2]}/${dateOnlyMatch[3]}/${dateOnlyMatch[1]}`
  }

  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return normalized || '-'

  return parsed.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })
}

function splitLineItems(lineItems: CrmQuoteLineItem[]) {
  const mainLineIds = new Set(lineItems.filter((lineItem) => !lineItem.parentLineId).map((lineItem) => lineItem.id).filter(Boolean))
  const mainLineItems = lineItems.filter((lineItem) => !lineItem.parentLineId || !mainLineIds.has(lineItem.parentLineId))

  return mainLineItems.flatMap((lineItem, lineItemIndex) => {
    const sublineDescriptions = lineItems
      .filter((candidate) => candidate.parentLineId === lineItem.id)
      .map((candidate) => ({
        detail: plain(candidate.detailLabel, ''),
        description: plain(candidate.description, ''),
      }))
      .filter((candidate) => candidate.detail || candidate.description)
    const description = plain(lineItem.description, '').replace(/\r\n?/g, '\n')
    const visualLines = description.split('\n')
    const chunks: string[] = []
    for (let index = 0; index < visualLines.length; index += 12) {
      chunks.push(visualLines.slice(index, index + 12).join('\n'))
    }
    if (chunks.length === 0) chunks.push('')

    return chunks.map((chunk, index) => ({
      ...lineItem,
      id: `${lineItem.id || lineItem.itemNumber}-${index}`,
      sourceLineId: lineItem.id,
      displayItemNumber: lineItemIndex + 1,
      description: index === 0 ? chunk : `(continued)\n${chunk}`,
      detailLabel: index === 0 ? lineItem.detailLabel : null,
      sublineDescriptions: index === 0 ? sublineDescriptions : [],
      images: index === 0 ? lineItem.images : [],
      qty: index === 0 ? lineItem.qty : null,
      unitPrice: index === 0 ? lineItem.unitPrice : null,
      extPrice: index === 0 ? lineItem.extPrice : null,
      continuation: index > 0,
    }))
  })
}

const estimateHelveticaTextWidth = (value: string) => Array.from(value).reduce((width, character) => {
  if (character === ' ') return width + 2.5
  if (/[ilI.,'`!|:;]/.test(character)) return width + 2.2
  if (/[MW@%&]/.test(character)) return width + 7.5
  if (/[A-Z0-9]/.test(character)) return width + 5.7
  return width + 4.6
}, 0)

const detailColumnWidth = (values: string[]) => {
  const longestLineWidth = values
    .flatMap((value) => value.replace(/\r\n?/g, '\n').split('\n'))
    .reduce((longest, value) => Math.max(longest, estimateHelveticaTextWidth(value)), 0)

  return Math.min(Math.max(longestLineWidth + 2, 32), 210)
}

const hasImages = (items: Array<{ images?: CrmQuoteLineItem['images'] }>) => items.some((item) => (item.images || []).length > 0)

const imageHeight = (images: CrmQuoteLineItem['images'], landscapeHeight: number, portraitHeight: number) => (
  (() => {
    const heights = (images || []).map((image) => {
      const isPortrait = image.shape === 'portrait'
        || Number(image.height || 0) > Number(image.width || 0) * 1.15
      const sizeMultiplier = image.displaySize === 'small' ? 0.72 : image.displaySize === 'large' ? 1.28 : 1
      return Math.round((isPortrait ? portraitHeight : landscapeHeight) * sizeMultiplier)
    })
    return heights.length > 0 ? Math.max(...heights) : landscapeHeight
  })()
)

const resolveProductImageMetrics = (
  image: {
    width?: number | null
    height?: number | null
    shape?: 'square' | 'landscape' | 'wide' | 'portrait' | null
    displaySize?: 'small' | 'medium' | 'large' | null
  },
  imageCount: number,
) => {
  const sizeScale = image.displaySize === 'small'
    ? 0.62
    : image.displaySize === 'large'
      ? 1.45
      : 1
  const baseWidth = imageCount > 1 ? 94 : 126
  const width = Math.max(72, Math.round(baseWidth * sizeScale))

  const inferredPortrait = image.shape === 'portrait'
    || Number(image.height || 0) > Number(image.width || 0) * 1.15
  const inferredWide = image.shape === 'wide'
  const inferredSquare = image.shape === 'square'
  const heightMultiplier = inferredPortrait
    ? 1.18
    : inferredWide
      ? 0.56
      : inferredSquare
        ? 0.88
        : 0.68

  return {
    width,
    height: Math.max(56, Math.round(width * heightMultiplier)),
  }
}

// The usable Description-cell width on the letter-size product table. Keep the
// picture layout inside this cell; Qty, Unit Price, and Ext are never available
// to the placement tool.
const PDF_PRODUCT_LAYOUT_WIDTH = 327
const PDF_PRODUCT_LAYOUT_GAP = 7
const PDF_PRODUCT_LAYOUT_MIN_TEXT_WIDTH = 112
const PDF_PRODUCT_LAYOUT_MIN_IMAGE_WIDTH = 48
const PDF_PRODUCT_LAYOUT_HEIGHT = 150

const resolveProductImageAspect = (image: CrmQuoteLineImage) => {
  const width = Number(image.width || 0)
  const height = Number(image.height || 0)
  if (width > 0 && height > 0) return width / height
  if (image.shape === 'portrait') return 4 / 5
  if (image.shape === 'wide') return 16 / 9
  if (image.shape === 'square') return 1
  return 4 / 3
}

const resolveProductImagePlacements = (images: CrmQuoteLineImage[]) => images.slice(0, 2).map((image) => {
  const metrics = resolveProductImageMetrics(image, images.length)
  const layout = normalizePictureLayout(image, image.pdfLayout || defaultPictureLayout(image))
  const width = layout.width || metrics.width
  const height = width / resolveProductImageAspect(image)
  return {
    image,
    width,
    height,
    x: layout.x,
    y: 0,
  }
})

function createStyles(accentColor: string) {
  return StyleSheet.create({
    page: {
      paddingTop: 154,
      paddingBottom: 56,
      paddingHorizontal: 28,
      fontFamily: 'Helvetica',
      fontSize: 9,
      color: '#172033',
    },
    header: {
      position: 'absolute',
      top: 16,
      left: 18,
      right: 28,
      height: 126,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: accentColor,
      paddingBottom: 8,
    },
    companyBlock: { width: 166, alignItems: 'center', justifyContent: 'center', paddingRight: 8, paddingBottom: 15 },
    logo: { width: 72, height: 72, objectFit: 'contain' },
    brandBlock: { paddingHorizontal: 5, paddingBottom: 15, flexGrow: 1, flexShrink: 1, flexBasis: 0, justifyContent: 'center', alignItems: 'center' },
    brandName: { marginBottom: 7, fontSize: 18, fontWeight: 700, letterSpacing: 0.25 },
    brandArnold: { color: '#b1161b' },
    brandContract: { color: '#151515' },
    brandEstimate: { fontSize: 21, fontWeight: 700, color: accentColor, letterSpacing: 1.5 },
    headerContactBar: { position: 'absolute', left: 0, right: 0, bottom: 5, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
    headerContactText: { fontSize: 7.1, lineHeight: 1.2, color: accentColor, fontWeight: 700, textAlign: 'center', letterSpacing: 0.1 },
    quoteInfoBox: { width: 192, marginBottom: 15, borderWidth: 1, borderColor: accentColor, borderRadius: 3, overflow: 'hidden' },
    quoteInfoRow: { flexDirection: 'row', minHeight: 20, borderTopWidth: 1, borderTopColor: '#d8e0ea', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 7 },
    quoteInfoRowFirst: { borderTopWidth: 0 },
    quoteInfoLabel: { width: 66, fontSize: 7.2, color: '#334155', fontWeight: 700, textTransform: 'uppercase' },
    quoteInfoValue: { flexGrow: 1, flexShrink: 1, flexBasis: 0, fontSize: 8.5, lineHeight: 1.15, fontWeight: 700, textAlign: 'right' },
    customerBlock: {
      flexDirection: 'row',
      backgroundColor: '#f8fafc',
      borderWidth: 1,
      borderColor: '#d8e0ea',
      borderRadius: 3,
      marginBottom: 12,
    },
    customerGroup: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingVertical: 8, paddingHorizontal: 9 },
    customerGroupWide: { flexGrow: 1.2, flexShrink: 1, flexBasis: 0, paddingVertical: 8, paddingHorizontal: 9 },
    customerGroupDivider: { borderLeftWidth: 1, borderLeftColor: '#d8e0ea' },
    label: { fontSize: 7.5, color: '#334155', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 },
    value: { fontSize: 9, lineHeight: 1.2, marginBottom: 5 },
    contactLine: { fontSize: 8, color: '#344155', lineHeight: 1.25, marginBottom: 2 },
    sectionTitleFirst: { paddingVertical: 5, paddingHorizontal: 6, backgroundColor: '#eef2f7', borderWidth: 1, borderColor: '#cbd5e1', fontSize: 10, fontWeight: 700, color: accentColor },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: accentColor,
      color: '#ffffff',
      paddingVertical: 5,
      paddingHorizontal: 4,
      fontWeight: 700,
    },
    row: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: '#d8e0ea',
      paddingVertical: 6,
      paddingHorizontal: 4,
      minHeight: 34,
      alignItems: 'stretch',
    },
    itemColumn: { width: 30, paddingRight: 5 },
    descriptionColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 7, overflow: 'hidden' },
    descriptionBody: { flexDirection: 'row', alignItems: 'flex-start', position: 'relative' },
    descriptionContent: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    descriptionText: { lineHeight: 1.15 },
    descriptionFlowText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, lineHeight: 1.15 },
    descriptionHeading: { fontWeight: 700, color: '#172033', lineHeight: 1.15 },
    descriptionLine: { flexDirection: 'row', alignItems: 'flex-start' },
    descriptionLineDetail: { flexShrink: 0, color: '#26384a' },
    descriptionLineBody: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    descriptionFieldText: { lineHeight: 0.62 },
    descriptionLineBodyPaired: { marginLeft: 12 },
    descriptionLineAfterHeading: { marginTop: 2 },
    descriptionSubline: { marginTop: 2.5 },
    descriptionMediaRail: { marginLeft: 7, flexShrink: 0 },
    descriptionMediaBox: { borderWidth: 1, borderColor: '#d8e0ea', borderRadius: 2, overflow: 'hidden', backgroundColor: '#ffffff' },
    descriptionMediaBoxSpaced: { marginTop: 4 },
    descriptionMediaImage: { width: '100%', objectFit: 'contain' },
    descriptionPositionedImage: { position: 'absolute', borderWidth: 1, borderColor: '#d8e0ea', borderRadius: 2, overflow: 'hidden', backgroundColor: '#ffffff' },
    qtyColumn: { width: 38, textAlign: 'right', paddingRight: 6 },
    unitColumn: { width: 70, textAlign: 'right', paddingRight: 6 },
    extColumn: { width: 76, textAlign: 'right' },
    centeredCell: { alignSelf: 'center' },
    topAlignedCell: { alignSelf: 'flex-start', paddingTop: 1 },
    totals: { marginTop: 14, marginLeft: 'auto', width: 250, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#d8e0ea', borderRadius: 3, paddingHorizontal: 10, paddingVertical: 6 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderColor: '#e2e8f0' },
    grandTotal: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: accentColor, paddingTop: 7, paddingBottom: 3, marginTop: 3, fontSize: 14, fontWeight: 700, color: accentColor },
    terms: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#cbd5e1', paddingTop: 8 },
    validityNotice: { marginBottom: 8, paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: '#efc8ca', color: '#a11218', fontSize: 8.5, lineHeight: 1.4 },
    validityText: { color: '#a11218', fontSize: 8.5, lineHeight: 1.4, marginBottom: 5 },
    termItem: { flexGrow: 1 },
    sectionTitle: { marginTop: 12, paddingVertical: 5, paddingHorizontal: 6, backgroundColor: '#eef2f7', borderWidth: 1, borderColor: '#cbd5e1', fontSize: 10, fontWeight: 700, color: accentColor },
    serviceRow: { flexDirection: 'row', borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#d8e0ea', padding: 6, minHeight: 34 },
    serviceHeader: { flexDirection: 'row', backgroundColor: accentColor, color: '#ffffff', paddingVertical: 5, paddingHorizontal: 6, fontWeight: 700 },
    serviceHeaderImages: { width: 104, paddingRight: 6 },
    serviceHeaderText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 8 },
    serviceHeaderQty: { width: 46, textAlign: 'right', paddingRight: 5 },
    serviceHeaderUnit: { width: 74, textAlign: 'right', paddingRight: 5 },
    serviceHeaderExt: { width: 74, textAlign: 'right' },
    serviceHeaderPrice: { width: 72, textAlign: 'right' },
    serviceText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 8 },
    serviceName: { fontWeight: 700, marginBottom: 2 },
    serviceDescription: { fontSize: 8, lineHeight: 1.25, color: '#344155' },
    serviceImages: { width: 104, flexDirection: 'row', gap: 4, paddingRight: 6 },
    serviceImage: { flexGrow: 1, flexShrink: 1, flexBasis: 0, objectFit: 'contain' },
    serviceQty: { width: 46, textAlign: 'right', paddingRight: 5 },
    serviceUnit: { width: 74, textAlign: 'right', paddingRight: 5 },
    serviceExt: { width: 74, textAlign: 'right', fontWeight: 700 },
    servicePrice: { width: 72, textAlign: 'right', fontWeight: 700 },
    customerInfo: { marginTop: 'auto', backgroundColor: '#fffdfb', borderWidth: 1, borderColor: '#e7c8ca', borderRadius: 3, paddingVertical: 9, paddingHorizontal: 10 },
    customerInfoTitle: { color: '#b1161b', fontSize: 10.5, fontWeight: 700, marginBottom: 7, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.6 },
    customerInfoColumns: { flexDirection: 'row', gap: 12 },
    customerInfoColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    customerInfoLine: { color: '#a11218', fontSize: 8.2, lineHeight: 1.4, marginBottom: 4 },
    stainNoticeLine: { color: '#a11218', fontSize: 8.2, lineHeight: 1.4, marginBottom: 3 },
    footer: {
      position: 'absolute',
      bottom: 18,
      left: 28,
      right: 28,
      borderTopWidth: 1,
      borderTopColor: accentColor,
      paddingTop: 5,
      flexDirection: 'row',
      justifyContent: 'space-between',
      color: '#64748b',
      fontSize: 7,
    },
  })
}

export function NativeQuotePdfDocument({
  quote,
  settings,
  quoteTerms,
  pictureLayoutMode = false,
}: {
  quote: CrmQuote
  settings: CrmQuotePrintSettings
  quoteTerms?: CrmDocumentTerm[]
  pictureLayoutMode?: boolean
}) {
  const configuredCustomerInformation = quoteTerms
    ?.filter((term) => term.documentType === 'quote' && (term.appliesToDealer ?? term.isDefault))
    .map((term) => `${term.title}: ${term.body}`)
    .join('\n')
  const resolvedSettings = {
    ...DEFAULT_QUOTE_PRINT_SETTINGS,
    ...settings,
    logoUrl: !settings.logoUrl || settings.logoUrl === defaultArnoldLogoUrl ? defaultArnoldMarkUrl : settings.logoUrl,
    customerInformation: quoteTerms === undefined
      ? settings.customerInformation || DEFAULT_CUSTOMER_INFORMATION
      : configuredCustomerInformation || '',
  }
  const styles = createStyles(resolvedSettings.accentColor)
  const rows = splitLineItems(Array.isArray(quote.lineItems) ? quote.lineItems : [])
  const sourceLineIndexById = new Map((quote.lineItems || []).map((lineItem, lineIndex) => [lineItem.id, lineIndex]))
  const additionalServices = hydrateAdditionalServices(quote.additionalServices)
  const shippingServices = Array.isArray(quote.shippingServices) ? quote.shippingServices : DEFAULT_SHIPPING_SERVICES
  const additionalServicesHaveImages = hasImages(additionalServices)
  const shippingServicesHaveImages = hasImages(shippingServices)
  const servicesTotal = additionalServices.reduce((sum, item) => sum + Number(resolveServiceExtPrice(item) || 0), 0)
  const shippingTotal = shippingServices.reduce((sum, item) => sum + Number(resolveServiceExtPrice(item) || 0), 0)
  const subtotal = quote.subtotal ?? rows.reduce((sum, row) => sum + Number(row.extPrice || 0), 0) + servicesTotal
  const discountAmount = Number(quote.discountAmount || 0)
  const discountFreightAmount = Number(quote.discountFreightAmount || 0)
  const productDiscountAmount = Number((discountAmount - discountFreightAmount).toFixed(2))
  const grossSubtotal = Number((Number(subtotal || 0) + productDiscountAmount).toFixed(2))
  const freight = quote.freight ?? shippingTotal
  const isListPriceTotal = quote.totalPriceType === 'list'
  const displayedTotal = isListPriceTotal
    ? Number((grossSubtotal + Number(freight || 0)).toFixed(2))
    : (quote.totalAmount ?? subtotal + Number(freight || 0))
  const customerInfoLines = resolvedSettings.customerInformation.split('\n').map((line) => line.trim()).filter(Boolean)
  const customerInfoMiddle = Math.ceil(customerInfoLines.length / 2)
  const customerInfoColumns = [customerInfoLines.slice(0, customerInfoMiddle), customerInfoLines.slice(customerInfoMiddle)].filter((column) => column.length > 0)

  return (
    <Document title={`Estimate ${plain(quote.quoteNumber, quote.id)}`} author={resolvedSettings.companyName}>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View style={styles.companyBlock}>
            {resolvedSettings.logoUrl ? <Image src={resolvePdfImageUri(resolvedSettings.logoUrl)} style={styles.logo} /> : null}
          </View>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}><Text style={styles.brandArnold}>Arnold </Text><Text style={styles.brandContract}>Contract</Text></Text>
            <Text style={styles.brandEstimate}>ESTIMATE</Text>
          </View>
          <View style={styles.quoteInfoBox}>
            <View style={[styles.quoteInfoRow, styles.quoteInfoRowFirst]}><Text style={styles.quoteInfoLabel}>Quote Number</Text><Text style={styles.quoteInfoValue}>{plain(quote.quoteNumber)}</Text></View>
            <View style={styles.quoteInfoRow}><Text style={styles.quoteInfoLabel}>Date</Text><Text style={styles.quoteInfoValue}>{formatQuoteDate(quote.opportunityDate)}</Text></View>
            <View style={styles.quoteInfoRow}><Text style={styles.quoteInfoLabel}>Project</Text><Text style={styles.quoteInfoValue}>{plain(quote.title)}</Text></View>
          </View>
          <View style={styles.headerContactBar}>
            <Text style={styles.headerContactText}>866-425-6529   |   ArnoldContract.us   |   120 Coit Street, Irvington, New Jersey 07111</Text>
          </View>
        </View>

        <View style={styles.customerBlock} wrap={false}>
          <View style={styles.customerGroupWide}>
            <Text style={styles.label}>Dealer Account</Text>
            <Text style={styles.value}>{plain(quote.companyName || quote.dealerName)}</Text>
            <Text style={styles.label}>Contact</Text>
            <Text style={styles.value}>{plain(quote.contactName)}</Text>
            {quote.contactEmail ? <Text style={styles.contactLine}>{quote.contactEmail}</Text> : null}
            {quote.contactPhone ? <Text style={styles.contactLine}>{quote.contactPhone}</Text> : null}
          </View>
          <View style={[styles.customerGroup, styles.customerGroupDivider]}>
            <Text style={styles.label}>Sales Representative</Text>
            <Text style={styles.value}>{plain(quote.salesRep)}</Text>
            <Text style={styles.label}>Project Type</Text>
            <Text style={styles.value}>{plain(quote.projectType)}</Text>
          </View>
          <View style={[styles.customerGroupWide, styles.customerGroupDivider]}>
            {resolvedSettings.showLeadTime ? <><Text style={styles.label}>Lead Time</Text><Text style={styles.value}>{plain(quote.leadTime)}</Text></> : null}
            {resolvedSettings.showPaymentTerms ? <><Text style={styles.label}>Payment Terms</Text><Text style={styles.value}>{plain(quote.paymentTerms)}</Text></> : null}
          </View>
        </View>

        {rows.length > 0 ? (
          <View minPresenceAhead={48}>
            <Text style={styles.sectionTitleFirst}>Products</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.itemColumn}>Item</Text>
              <Text style={styles.descriptionColumn}>Description</Text>
              <Text style={styles.qtyColumn}>Qty</Text>
              <Text style={styles.unitColumn}>Unit Price</Text>
              <Text style={styles.extColumn}>Ext</Text>
            </View>
          </View>
        ) : null}

        {rows.map((lineItem, index) => {
          const lineImages = (lineItem.images || []).slice(0, 2)
          const usesCustomImageLayout = lineImages.some((image) => image.pdfLayout)
          const usesInlinePictureLayout = lineImages.length > 0 && (pictureLayoutMode || usesCustomImageLayout)
          const imagePlacements = usesInlinePictureLayout ? resolveProductImagePlacements(lineImages) : []
          const primaryPlacement = imagePlacements[0]
          const pictureRailWidth = imagePlacements.length > 0 ? Math.max(...imagePlacements.map((placement) => placement.width)) : 0
          const pictureX = primaryPlacement ? Math.min(primaryPlacement.x, PDF_PRODUCT_LAYOUT_WIDTH - pictureRailWidth) : 0
          const sourceLineIndex = sourceLineIndexById.get(lineItem.sourceLineId) ?? index
          const pictureOnLeft = primaryPlacement
            ? pictureX < (PDF_PRODUCT_LAYOUT_WIDTH - pictureRailWidth) / 2
            : false
          const description = plain(lineItem.description, '')
          const [heading = '', ...detailLines] = description.split('\n')
          const hasMainDescriptionLine = Boolean(lineItem.detailLabel || detailLines.length > 0)
          const sharedDetailWidth = detailColumnWidth([
            lineItem.detailLabel && detailLines.length > 0 ? lineItem.detailLabel : '',
            ...lineItem.sublineDescriptions
              .filter((subline) => subline.detail && subline.description)
              .map((subline) => subline.detail),
          ])
          const renderFieldLines = (value: string) => value
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((fieldLine, fieldLineIndex) => (
              <Text key={`${fieldLineIndex}-${fieldLine}`} style={styles.descriptionFieldText}>
                {fieldLine || ' '}
              </Text>
            ))
          const renderStructuredDescription = () => lineItem.continuation ? (
            <Text style={styles.descriptionText}>{description}</Text>
          ) : (
            <View style={styles.descriptionContent}>
              {heading ? <Text style={styles.descriptionHeading}>{heading}</Text> : null}
              {(lineItem.detailLabel || detailLines.length > 0) ? (
                <View style={[styles.descriptionLine, heading ? styles.descriptionLineAfterHeading : {}]}>
                  {lineItem.detailLabel && detailLines.length > 0 ? (
                    <>
                      <View style={[styles.descriptionLineDetail, { width: sharedDetailWidth }]}>{renderFieldLines(lineItem.detailLabel)}</View>
                      <View style={[styles.descriptionLineBody, styles.descriptionLineBodyPaired]}>{renderFieldLines(detailLines.join('\n'))}</View>
                    </>
                  ) : (
                    <View style={styles.descriptionLineBody}>{renderFieldLines(plain(lineItem.detailLabel || detailLines.join('\n'), ''))}</View>
                  )}
                </View>
              ) : null}
              {lineItem.sublineDescriptions.map((subline, sublineIndex) => (
                <View
                  key={`${subline.detail}-${sublineIndex}`}
                  style={[styles.descriptionLine, heading || hasMainDescriptionLine || sublineIndex > 0 ? styles.descriptionSubline : {}]}
                >
                  {subline.detail && subline.description ? (
                    <>
                      <View style={[styles.descriptionLineDetail, { width: sharedDetailWidth }]}>{renderFieldLines(subline.detail)}</View>
                      <View style={[styles.descriptionLineBody, styles.descriptionLineBodyPaired]}>{renderFieldLines(subline.description)}</View>
                    </>
                  ) : (
                    <View style={styles.descriptionLineBody}>{renderFieldLines(subline.detail || subline.description)}</View>
                  )}
                </View>
              ))}
            </View>
          )
          const pictureRail = primaryPlacement ? (
            <View
              style={[
                styles.descriptionMediaRail,
                { width: pictureRailWidth },
                pictureOnLeft
                  ? { marginLeft: pictureX, marginRight: PDF_PRODUCT_LAYOUT_GAP }
                  : { marginLeft: PDF_PRODUCT_LAYOUT_GAP, marginRight: Math.max(0, PDF_PRODUCT_LAYOUT_WIDTH - pictureX - pictureRailWidth) },
              ]}
            >
              {imagePlacements.map((placement, imageIndex) => (
                <View
                  key={placement.image.id}
                  style={[
                    styles.descriptionMediaBox,
                    imageIndex > 0 ? styles.descriptionMediaBoxSpaced : {},
                    { width: placement.width, height: placement.height, alignSelf: 'center' },
                  ]}
                >
                  {pictureLayoutMode ? (
                    <Text style={{ fontSize: 1, lineHeight: 1, color: '#ffffff' }}>{`__AP${sourceLineIndex}_${imageIndex}__`}</Text>
                  ) : (
                    <Image src={resolvePdfImageUri(placement.image.url)} cache={false} style={[styles.descriptionMediaImage, { height: '100%' }]} />
                  )}
                </View>
              ))}
            </View>
          ) : null

          return (
          <View key={lineItem.id || `${lineItem.itemNumber}-${index}`} style={[styles.row, index % 2 === 1 ? { backgroundColor: '#fbfdff' } : {}]} wrap={false}>
            <Text style={[styles.itemColumn, styles.topAlignedCell]}>{lineItem.continuation ? '' : lineItem.displayItemNumber}</Text>
            <View style={styles.descriptionColumn}>
              {usesInlinePictureLayout ? (
                <>
                  <View style={styles.descriptionBody}>
                    {pictureOnLeft ? pictureRail : null}
                    {renderStructuredDescription()}
                    {!pictureOnLeft ? pictureRail : null}
                  </View>
                  {pictureLayoutMode ? <Text style={{ fontSize: 1, lineHeight: 1, color: '#ffffff' }}>{`__APE${sourceLineIndex}_0__`}</Text> : null}
                </>
              ) : (
                <View style={styles.descriptionBody}>
                {renderStructuredDescription()}
                {!pictureLayoutMode && lineImages.length > 0 ? (
                  <View style={styles.descriptionMediaRail}>
                    {lineImages.map((image, imageIndex) => {
                      const metrics = resolveProductImageMetrics(image, lineImages.length)

                      return (
                        <View
                          key={image.id}
                          style={imageIndex > 0
                            ? [
                              styles.descriptionMediaBox,
                              styles.descriptionMediaBoxSpaced,
                              { width: metrics.width, height: metrics.height },
                            ]
                            : [
                              styles.descriptionMediaBox,
                              { width: metrics.width, height: metrics.height },
                            ]}
                        >
                          <Image src={resolvePdfImageUri(image.url)} cache={false} style={styles.descriptionMediaImage} />
                        </View>
                      )
                    })}
                  </View>
                ) : null}
                </View>
              )}
            </View>
            <Text style={[styles.qtyColumn, styles.topAlignedCell]}>{plain(lineItem.qty, '')}</Text>
            <Text style={[styles.unitColumn, styles.topAlignedCell]}>{optionalMoney(lineItem.unitPrice)}</Text>
            <Text style={[styles.extColumn, styles.topAlignedCell]}>{optionalMoney(lineItem.extPrice)}</Text>
          </View>
          )
        })}

        {additionalServices.length > 0 ? (
          <View minPresenceAhead={40}>
            <Text style={styles.sectionTitle}>Additional Services</Text>
            <View style={styles.serviceHeader}>
              {additionalServicesHaveImages ? <Text style={styles.serviceHeaderImages}>Picture</Text> : null}
              <Text style={styles.serviceHeaderText}>Service &amp; Description</Text>
              <Text style={styles.serviceHeaderQty}>Qty</Text>
              <Text style={styles.serviceHeaderUnit}>Unit Price</Text>
              <Text style={styles.serviceHeaderExt}>Ext</Text>
            </View>
          </View>
        ) : null}
        {additionalServices.map((service) => (
          <View key={service.id} style={styles.serviceRow} wrap={false}>
            {additionalServicesHaveImages ? (
              <View style={styles.serviceImages}>
                {(service.images || []).slice(0, 2).map((image) => <Image key={image.id} src={resolvePdfImageUri(image.url)} cache={false} style={[styles.serviceImage, { height: imageHeight([image], 68, 96) }]} />)}
              </View>
            ) : null}
            <View style={styles.serviceText}>
              <Text style={styles.serviceName}>{service.title}</Text>
              {service.description ? <Text style={styles.serviceDescription}>{service.description}</Text> : null}
            </View>
            <Text style={[styles.serviceQty, styles.centeredCell]}>{plain(service.qty, '')}</Text>
            <Text style={[styles.serviceUnit, styles.centeredCell]}>{optionalMoney(service.unitPrice)}</Text>
            <Text style={[styles.serviceExt, styles.centeredCell]}>{optionalMoney(resolveServiceExtPrice(service))}</Text>
          </View>
        ))}

        {resolvedSettings.showFreight && shippingServices.length > 0 ? (
          <View minPresenceAhead={40}>
            <Text style={styles.sectionTitle}>Freight, Delivery &amp; Installation</Text>
            <View style={styles.serviceHeader}>
              {shippingServicesHaveImages ? <Text style={styles.serviceHeaderImages}>Picture</Text> : null}
              <Text style={styles.serviceHeaderText}>Service &amp; Description</Text>
              <Text style={styles.serviceHeaderPrice}>Price</Text>
            </View>
          </View>
        ) : null}
        {resolvedSettings.showFreight ? shippingServices.map((service) => (
          <View key={service.id} style={styles.serviceRow} wrap={false}>
            {shippingServicesHaveImages ? (
              <View style={styles.serviceImages}>
                {(service.images || []).slice(0, 2).map((image) => <Image key={image.id} src={resolvePdfImageUri(image.url)} cache={false} style={[styles.serviceImage, { height: imageHeight([image], 68, 96) }]} />)}
              </View>
            ) : null}
            <View style={styles.serviceText}>
              <Text style={styles.serviceName}>{service.title}</Text>
              {service.description ? <Text style={styles.serviceDescription}>{service.description}</Text> : null}
            </View>
            <Text style={[styles.servicePrice, styles.centeredCell]}>{optionalMoney(resolveServiceExtPrice(service))}</Text>
          </View>
        )) : null}

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}><Text>Subtotal</Text><Text>{money(grossSubtotal)}</Text></View>
          {resolvedSettings.showFreight ? <View style={styles.totalRow}><Text>{quote.freightDescription || 'Freight'}</Text><Text>{money(freight)}</Text></View> : null}
          {discountAmount > 0 ? <View style={styles.totalRow}><Text>Discount ({Number(quote.discountPercent || 0).toFixed(2).replace(/\.?0+$/, '')}% - {quote.discountScope === 'products_and_freight' ? 'Products + Freight' : 'Products Only'})</Text><Text>-{money(discountAmount)}</Text></View> : null}
          <View style={styles.grandTotal}><Text>{isListPriceTotal ? 'List Price Total' : 'Net Price Total'}</Text><Text>{money(displayedTotal)}</Text></View>
        </View>

        {quote.notes ? <View style={styles.terms} wrap={false}><View style={styles.termItem}><Text style={styles.label}>Notes</Text><Text>{quote.notes}</Text></View></View> : null}

        {resolvedSettings.customerInformation ? (
          <View style={styles.customerInfo} wrap={false}>
            <Text style={styles.customerInfoTitle}>Customer Information</Text>
            {quoteTerms === undefined ? <View style={styles.validityNotice}>
              <Text style={styles.validityText}>{QUOTE_VALIDITY_NOTICE}</Text>
              {STAIN_TO_MATCH_NOTICE.map((line) => <Text key={line} style={styles.stainNoticeLine}>• {line}</Text>)}
            </View> : null}
            <View style={styles.customerInfoColumns}>
              {customerInfoColumns.map((column, columnIndex) => (
                <View key={`customer-info-${columnIndex}`} style={styles.customerInfoColumn}>
                  {column.map((line, lineIndex) => <Text key={`${line}-${lineIndex}`} style={styles.customerInfoLine}>• {line}</Text>)}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>{resolvedSettings.footerText || ''}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

type QuotePicturePdfLayout = NonNullable<CrmQuoteLineImage['pdfLayout']>

const PDF_LAYOUT_RENDER_SCALE = 1.35

function defaultPictureLayout(image: CrmQuoteLineImage): QuotePicturePdfLayout {
  const width = image.displaySize === 'small' ? 78 : image.displaySize === 'large' ? 170 : 118
  return { x: PDF_PRODUCT_LAYOUT_WIDTH - width - 6, y: 0, width }
}

function normalizePictureLayout(image: CrmQuoteLineImage, layout: QuotePicturePdfLayout): QuotePicturePdfLayout {
  const aspect = resolveProductImageAspect(image)
  const maximumWidth = Math.max(
    PDF_PRODUCT_LAYOUT_MIN_IMAGE_WIDTH,
    Math.min(300, PDF_PRODUCT_LAYOUT_HEIGHT * aspect, PDF_PRODUCT_LAYOUT_WIDTH - PDF_PRODUCT_LAYOUT_GAP - PDF_PRODUCT_LAYOUT_MIN_TEXT_WIDTH),
  )
  const width = Math.min(maximumWidth, Math.max(PDF_PRODUCT_LAYOUT_MIN_IMAGE_WIDTH, Number(layout.width) || 118))
  const maximumX = PDF_PRODUCT_LAYOUT_WIDTH - width
  const requestedX = Number(layout.x)
  return {
    x: Math.min(maximumX, Math.max(0, Number.isFinite(requestedX) ? requestedX : maximumX - 6)),
    y: 0,
    width,
  }
}

type RenderedLayoutPage = {
  pageNumber: number
  imageUrl: string
  width: number
  height: number
  anchors: Record<string, { x: number; y: number; layoutX: number; height?: number }>
}

export const QuotePdfPictureLayoutDialog = memo(function QuotePdfPictureLayoutDialog({
  open,
  quote,
  settings,
  onCancel,
  onSave,
  embedded = false,
  hideEmbeddedActions = false,
}: {
  open: boolean
  quote: CrmQuote | null
  settings: CrmQuotePrintSettings
  onCancel: () => void
  onSave: (layouts: Array<{ lineIndex: number; imageId: string; layout: QuotePicturePdfLayout }>) => void
  embedded?: boolean
  hideEmbeddedActions?: boolean
}) {
  // A layout save updates only pdfLayout. Do not treat that as a new quote and
  // throw away the rendered pages the user is currently positioning pictures on.
  const quoteContentKey = useMemo(() => JSON.stringify({
    id: quote?.id,
    quoteNumber: quote?.quoteNumber,
    title: quote?.title,
    lineItems: (quote?.lineItems || []).map((lineItem) => ({
      id: lineItem.id,
      parentLineId: lineItem.parentLineId,
      detailLabel: lineItem.detailLabel,
      description: lineItem.description,
      qty: lineItem.qty,
      unitPrice: lineItem.unitPrice,
      extPrice: lineItem.extPrice,
      images: (lineItem.images || []).map((image) => ({ id: image.id, url: image.url, width: image.width, height: image.height, shape: image.shape })),
    })),
  }), [quote])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pdfLayout changes are intentionally local until a content change.
  const renderQuote = useMemo(() => quote, [quoteContentKey])
  const pictures = useMemo(() => (renderQuote?.lineItems || []).flatMap((lineItem, lineIndex) => (
    (lineItem.images || []).map((image, imageIndex) => ({ lineIndex, imageIndex, image }))
  )), [renderQuote])
  const pictureKey = useMemo(() => pictures.map(({ image }) => `${image.id}:${image.url}`).join('|'), [pictures])
  const [layouts, setLayouts] = useState<Record<string, QuotePicturePdfLayout>>({})
  const layoutsRef = useRef<Record<string, QuotePicturePdfLayout>>({})
  const [pages, setPages] = useState<RenderedLayoutPage[]>([])
  const [isRendering, setIsRendering] = useState(false)
  const [renderError, setRenderError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [layoutRenderVersion, setLayoutRenderVersion] = useState(0)
  const latestPdfBlobRef = useRef<Blob | null>(null)
  const layoutRenderTimerRef = useRef<number | null>(null)
  const interactionRef = useRef<{
    mode: 'move' | 'resize'
    image: CrmQuoteLineImage
    clientX: number
    clientY: number
    scale: number
    layout: QuotePicturePdfLayout
  } | null>(null)

  const updateLayouts = useCallback((next: Record<string, QuotePicturePdfLayout>) => {
    layoutsRef.current = next
    setLayouts(next)
  }, [])

  useEffect(() => {
    if (!open) return
    const next = Object.fromEntries(pictures.map(({ image }) => [
      image.id,
      normalizePictureLayout(image, image.pdfLayout || defaultPictureLayout(image)),
    ]))
    const resetTimer = window.setTimeout(() => {
      updateLayouts(next)
      setPages([])
      setRenderError('')
      latestPdfBlobRef.current = null
    }, 0)
    return () => window.clearTimeout(resetTimer)
  }, [open, pictureKey, pictures, updateLayouts])

  useEffect(() => {
    if (!open || !renderQuote) return
    let cancelled = false

    const renderActualPdf = async () => {
      setIsRendering(true)
      setRenderError('')
      try {
        const renderedLayouts = Object.fromEntries(pictures.map(({ image }) => [
          image.id,
          normalizePictureLayout(image, layoutsRef.current[image.id] || image.pdfLayout || defaultPictureLayout(image)),
        ]))
        const previewQuote: CrmQuote = {
          ...renderQuote,
          lineItems: (renderQuote.lineItems || []).map((lineItem) => ({
            ...lineItem,
            images: (lineItem.images || []).map((image) => ({
              ...image,
              pdfLayout: renderedLayouts[image.id] || image.pdfLayout || defaultPictureLayout(image),
            })),
          })),
        }
        const blob = await pdf(<NativeQuotePdfDocument quote={previewQuote} settings={settings} pictureLayoutMode={pictures.length > 0} />).toBlob()
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const pdfDocument = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise
        const renderedPages: RenderedLayoutPage[] = []
        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const page = await pdfDocument.getPage(pageNumber)
          const viewport = page.getViewport({ scale: PDF_LAYOUT_RENDER_SCALE })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Could not render the estimate page.')
          await page.render({ canvas, canvasContext: context, viewport }).promise
          const textContent = await page.getTextContent()
          const anchors: Record<string, { x: number; y: number; layoutX: number; height?: number }> = {}
          textContent.items.forEach((item) => {
            if (!('str' in item)) return
            const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])

            const endMarkerMatch = item.str.match(/__APE(\d+)_(\d+)__/)
            if (endMarkerMatch) {
              const sourceLineIndex = Number(endMarkerMatch[1])
              const imageIndex = Number(endMarkerMatch[2])
              const targetPicture = pictures.find((picture) => picture.lineIndex === sourceLineIndex && picture.imageIndex === imageIndex)
              const existingAnchor = targetPicture ? anchors[targetPicture.image.id] : null
              if (existingAnchor) existingAnchor.height = Math.max(PDF_LAYOUT_RENDER_SCALE, y - existingAnchor.y + PDF_LAYOUT_RENDER_SCALE)
              return
            }

            const markerMatch = item.str.match(/__AP(\d+)_(\d+)__/)
            if (!markerMatch) return
            const sourceLineIndex = Number(markerMatch[1])
            const imageIndex = Number(markerMatch[2])
            const targetPicture = pictures.find((picture) => picture.lineIndex === sourceLineIndex && picture.imageIndex === imageIndex)
            if (!targetPicture) return
            const imageId = targetPicture.image.id
            anchors[imageId] = {
              x,
              y: y - PDF_LAYOUT_RENDER_SCALE,
              layoutX: renderedLayouts[imageId]?.x || 0,
            }
          })

          renderedPages.push({
            pageNumber,
            imageUrl: canvas.toDataURL('image/png'),
            width: viewport.width,
            height: viewport.height,
            anchors,
          })
        }

        if (!cancelled) {
          latestPdfBlobRef.current = blob
          setPages(renderedPages)
        }
      } catch (error) {
        if (!cancelled) setRenderError(error instanceof Error ? error.message : 'Could not render the actual estimate PDF.')
      } finally {
        if (!cancelled) setIsRendering(false)
      }
    }

    void renderActualPdf()
    return () => { cancelled = true }
  }, [layoutRenderVersion, open, pictureKey, pictures, renderQuote, settings])

  const startInteraction = (mode: 'move' | 'resize', image: CrmQuoteLineImage, scale: number, event: ReactPointerEvent<HTMLElement>) => {
    const layout = layoutsRef.current[image.id]
    if (!layout) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    interactionRef.current = { mode, image, clientX: event.clientX, clientY: event.clientY, scale, layout }
  }

  const continueInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current
    if (!interaction) return
    const dx = (event.clientX - interaction.clientX) / interaction.scale
    const dy = (event.clientY - interaction.clientY) / interaction.scale
    const aspect = resolveProductImageAspect(interaction.image)
    const nextLayout = interaction.mode === 'move'
      ? { ...interaction.layout, x: interaction.layout.x + dx }
      : { ...interaction.layout, width: interaction.layout.width + Math.max(dx, dy * aspect) }
    updateLayouts({
      ...layoutsRef.current,
      [interaction.image.id]: normalizePictureLayout(interaction.image, nextLayout),
    })
  }

  const savePictureLayouts = useCallback((nextLayouts = layoutsRef.current) => {
    onSave(pictures.map(({ lineIndex, image }) => ({
      lineIndex,
      imageId: image.id,
      layout: normalizePictureLayout(image, nextLayouts[image.id] || defaultPictureLayout(image)),
    })))
  }, [onSave, pictures])

  const finishInteraction = useCallback(() => {
    if (!interactionRef.current) return
    interactionRef.current = null
    savePictureLayouts()
    if (layoutRenderTimerRef.current !== null) window.clearTimeout(layoutRenderTimerRef.current)
    layoutRenderTimerRef.current = window.setTimeout(() => {
      layoutRenderTimerRef.current = null
      setLayoutRenderVersion((version) => version + 1)
    }, 350)
  }, [savePictureLayouts])

  useEffect(() => () => {
    if (layoutRenderTimerRef.current !== null) window.clearTimeout(layoutRenderTimerRef.current)
  }, [])

  const resetPictureLayouts = useCallback(() => {
    const next = Object.fromEntries(pictures.map(({ image }) => [
      image.id,
      normalizePictureLayout(image, defaultPictureLayout(image)),
    ]))
    updateLayouts(next)
    savePictureLayouts(next)
    setLayoutRenderVersion((version) => version + 1)
  }, [pictures, savePictureLayouts, updateLayouts])

  const handlePrint = useCallback(() => {
    const blob = latestPdfBlobRef.current
    if (!blob) return
    const blobUrl = URL.createObjectURL(blob)
    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.width = '1px'
    frame.style.height = '1px'
    frame.style.border = '0'
    frame.src = blobUrl
    frame.onload = () => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      window.setTimeout(() => {
        frame.remove()
        URL.revokeObjectURL(blobUrl)
      }, 60_000)
    }
    document.body.appendChild(frame)
  }, [])

  const handleDownload = useCallback(() => {
    const blob = latestPdfBlobRef.current
    if (!blob) return
    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `Estimate-${plain(quote?.quoteNumber, quote?.id || 'quote').replace(/[^a-z0-9._-]+/gi, '-')}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000)
  }, [quote?.id, quote?.quoteNumber])

  if (!quote) return null

  const workspace = (
    <>
      <Box sx={{ position: 'sticky', top: 0, zIndex: 5, px: 2, py: 1, bgcolor: '#eef5fb', borderBottom: '1px solid #b8cadc' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Alert severity="info" icon={<OpenWithRoundedIcon />} sx={{ py: 0, flex: 1 }}>
              {pictures.length
                ? 'Drag a picture left or right within Description; drag its red corner to resize it.'
                : 'This is the PDF used for printing.'}
          </Alert>
          <Stack direction="row" spacing={0.25}>
            <Tooltip title="Zoom out"><span><IconButton size="small" aria-label="Zoom out" disabled={zoom <= 0.75} onClick={() => setZoom((current) => Math.max(0.75, current - 0.25))}><ZoomOutRoundedIcon /></IconButton></span></Tooltip>
            <Tooltip title="Zoom in"><span><IconButton size="small" aria-label="Zoom in" disabled={zoom >= 1.75} onClick={() => setZoom((current) => Math.min(1.75, current + 0.25))}><ZoomInRoundedIcon /></IconButton></span></Tooltip>
            <Tooltip title="Print PDF"><span><IconButton size="small" aria-label="Print PDF" disabled={isRendering || pages.length === 0} onClick={handlePrint}><PrintRoundedIcon /></IconButton></span></Tooltip>
            <Tooltip title="Download PDF"><span><IconButton size="small" aria-label="Download PDF" disabled={isRendering || pages.length === 0} onClick={handleDownload}><DownloadRoundedIcon /></IconButton></span></Tooltip>
          </Stack>
        </Stack>
      </Box>
      {isRendering && pages.length === 0 ? (
        <Stack alignItems="center" spacing={1.5} sx={{ py: 8, color: '#fff' }}><CircularProgress color="inherit" /><Typography>Rendering the actual estimate…</Typography></Stack>
      ) : renderError && pages.length === 0 ? (
        <Alert severity="error" sx={{ m: 2 }}>{renderError}</Alert>
      ) : (
        <Stack spacing={2.5} alignItems="center" sx={{ p: 2.5, position: 'relative' }}>
          {isRendering ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ position: 'sticky', top: 68, zIndex: 6, px: 1.5, py: 0.75, borderRadius: 1, bgcolor: 'rgba(255,255,255,.96)', boxShadow: 2 }}>
              <CircularProgress size={18} />
              <Typography variant="caption" fontWeight={700}>Updating text layout…</Typography>
            </Stack>
          ) : null}
          {renderError ? <Alert severity="warning" sx={{ width: 'min(100%, 720px)' }}>{renderError}</Alert> : null}
          {pages.map((page) => (
            <Box key={page.pageNumber} sx={{ position: 'relative', width: page.width * zoom, height: page.height * zoom, bgcolor: '#fff', boxShadow: '0 8px 28px rgba(0,0,0,.38)' }}>
              <Box component="img" src={page.imageUrl} alt={`Estimate page ${page.pageNumber}`} sx={{ display: 'block', width: '100%', height: '100%', pointerEvents: 'none' }} />
              {pictures.map(({ image, imageIndex, lineIndex }) => {
                if (imageIndex > 0) return null
                const anchor = page.anchors[image.id]
                const layout = layouts[image.id]
                if (!anchor || !layout) return null
                const scale = page.width / 612 * zoom
                const linePictures = pictures
                  .filter((picture) => picture.lineIndex === lineIndex)
                  .map((picture) => {
                    const pictureLayout = layouts[picture.image.id] || normalizePictureLayout(picture.image, picture.image.pdfLayout || defaultPictureLayout(picture.image))
                    return {
                      ...picture,
                      layout: pictureLayout,
                      height: pictureLayout.width / resolveProductImageAspect(picture.image),
                    }
                  })
                const pictureRailWidth = Math.max(...linePictures.map((picture) => picture.layout.width))
                const pictureRailHeight = linePictures.reduce((total, picture, pictureIndex) => total + picture.height + (pictureIndex > 0 ? 4 : 0), 0)
                const pictureX = Math.min(layout.x, PDF_PRODUCT_LAYOUT_WIDTH - pictureRailWidth)
                const sourceLine = quote.lineItems?.find((lineItem) => (lineItem.images || []).some((lineImage) => lineImage.id === image.id))
                const childLines = sourceLine?.id
                  ? (quote.lineItems || []).filter((lineItem) => lineItem.parentLineId === sourceLine.id)
                  : []
                const [heading = '', ...mainDetailLines] = String(sourceLine?.description || '')
                  .replace(/\r\n?/g, '\n')
                  .split('\n')
                const descriptionRows = [
                  {
                    detail: String(sourceLine?.detailLabel || '').trim(),
                    description: mainDetailLines.join('\n').trim(),
                  },
                  ...childLines.map((lineItem) => ({
                    detail: String(lineItem.detailLabel || '').trim(),
                    description: String(lineItem.description || '').trim(),
                  })),
                ].filter((row) => row.detail || row.description)
                const pairedDetails = descriptionRows
                  .filter((row) => row.detail && row.description)
                  .map((row) => row.detail)
                const detailColumnWidth = pairedDetails.length
                  ? Math.min(42, Math.max(12, ...pairedDetails.map((detail) => detail.length + 1)))
                  : 0
                const pictureOnLeft = pictureX < (PDF_PRODUCT_LAYOUT_WIDTH - pictureRailWidth) / 2
                const descriptionLeft = anchor.x * zoom - anchor.layoutX * scale
                const trailingSpace = Math.max(0, PDF_PRODUCT_LAYOUT_WIDTH - pictureX - pictureRailWidth)

                return (
                  <Box
                    key={image.id}
                    sx={{
                      position: 'absolute',
                      left: descriptionLeft,
                      top: anchor.y * zoom,
                      width: PDF_PRODUCT_LAYOUT_WIDTH * scale,
                      minHeight: Math.max(pictureRailHeight * scale, (anchor.height || 0) * zoom),
                      bgcolor: '#fff',
                      color: '#172033',
                      fontFamily: 'Arial, sans-serif',
                      fontSize: 9 * scale,
                      lineHeight: 1.15,
                      display: 'flow-root',
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      aria-label={image.name || 'Quote picture'}
                      onPointerDown={(event) => startInteraction('move', image, scale, event)}
                      onPointerMove={continueInteraction}
                      onPointerUp={finishInteraction}
                      onPointerCancel={finishInteraction}
                      sx={{
                        position: 'relative',
                        float: pictureOnLeft ? 'left' : 'right',
                        ml: `${(pictureOnLeft ? pictureX : PDF_PRODUCT_LAYOUT_GAP) * scale}px`,
                        mr: `${(pictureOnLeft ? PDF_PRODUCT_LAYOUT_GAP : trailingSpace) * scale}px`,
                        width: pictureRailWidth * scale,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: `${4 * scale}px`,
                        cursor: 'grab',
                        touchAction: 'none',
                        userSelect: 'none',
                        '&:active': { cursor: 'grabbing' },
                      }}
                    >
                      {linePictures.map((picture) => (
                        <Box
                          key={picture.image.id}
                          sx={{
                            position: 'relative',
                            width: picture.layout.width * scale,
                            height: picture.height * scale,
                            border: '2px solid #b1161b',
                            borderRadius: 0.5,
                            bgcolor: '#fff',
                            boxShadow: '0 4px 14px rgba(0,0,0,.25)',
                          }}
                        >
                          <Box component="img" src={picture.image.url} alt={picture.image.name || 'Quote picture'} draggable={false} sx={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain', pointerEvents: 'none' }} />
                          <Box aria-label={`Resize ${picture.image.name || 'quote picture'}`} onPointerDown={(event) => startInteraction('resize', picture.image, scale, event)} sx={{ position: 'absolute', right: -8, bottom: -8, width: 20, height: 20, borderRadius: '50%', bgcolor: '#b1161b', border: '3px solid #fff', boxShadow: '0 1px 5px rgba(0,0,0,.35)', cursor: 'nwse-resize' }} />
                        </Box>
                      ))}
                    </Box>
                    {heading ? (
                      <Box component="div" sx={{ fontWeight: 700, lineHeight: 1.15, mb: descriptionRows.length ? 0.45 : 0, overflowWrap: 'anywhere' }}>
                        {heading}
                      </Box>
                    ) : null}
                    {descriptionRows.map((row, rowIndex) => (
                      <Box
                        key={`${row.detail}-${row.description}-${rowIndex}`}
                        component="div"
                        sx={{
                          mt: rowIndex > 0 || heading ? 0.35 : 0,
                          minHeight: `${10.4 * scale}px`,
                          overflowWrap: 'anywhere',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {row.detail && row.description ? (
                          <>
                            <Box component="span" sx={{ display: 'inline-block', width: `${detailColumnWidth}ch`, pr: 0.8, verticalAlign: 'top', color: '#26384a' }}>
                              {row.detail}
                            </Box>
                            <Box component="span">{row.description}</Box>
                          </>
                        ) : (
                          row.detail || row.description
                        )}
                      </Box>
                    ))}
                  </Box>
                )
              })}
            </Box>
          ))}
        </Stack>
      )}
    </>
  )

  const actions = (
    <>
        {pictures.length ? <Button onClick={resetPictureLayouts}>Reset All</Button> : null}
        <Box sx={{ flex: 1 }} />
        {!embedded ? <Button onClick={onCancel}>Cancel</Button> : null}
    </>
  )

  if (embedded) {
    return <Box sx={{ bgcolor: '#525659', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}><Box sx={{ maxHeight: '72vh', overflow: 'auto' }}>{workspace}</Box>{hideEmbeddedActions ? null : <Stack direction="row" spacing={1} sx={{ px: 1.5, py: 1, bgcolor: '#fff' }}>{actions}</Stack>}</Box>
  }

  return (
    <Dialog open={open} onClose={onCancel} fullScreen>
      <DialogTitle sx={{ py: 1.2 }}><Stack direction="row" alignItems="center" justifyContent="space-between"><Box>Actual Estimate PDF — Arrange Pictures</Box><IconButton onClick={onCancel}><CloseRoundedIcon /></IconButton></Stack></DialogTitle>
      <DialogContent dividers sx={{ p: 0, bgcolor: '#525659' }}>{workspace}</DialogContent>
      <DialogActions>{actions}</DialogActions>
    </Dialog>
  )
})

export const QuotePdfPreviewDialog = memo(function QuotePdfPreviewDialog({
  open,
  quote,
  settings,
  onClose,
}: {
  open: boolean
  quote: CrmQuote | null
  settings: CrmQuotePrintSettings
  onClose: () => void
}) {
  const [isOpeningPrint, setIsOpeningPrint] = useState(false)
  const printBlobUrlRef = useRef<string | null>(null)
  const termsQuery = useQuery({
    queryKey: QUERY_KEYS.crmDocumentTerms(quote?.dealerSourceId || ''),
    queryFn: () => fetchCrmDocumentTerms(quote?.dealerSourceId),
    enabled: Boolean(open && quote),
  })
  const quoteTerms = useMemo(
    () => termsQuery.data?.terms.filter((term) => term.documentType === 'quote'),
    [termsQuery.data?.terms],
  )

  const document = useMemo(
    () => (quote ? <NativeQuotePdfDocument quote={quote} settings={settings} quoteTerms={quoteTerms} /> : null),
    [quote, quoteTerms, settings],
  )

  const fileName = useMemo(
    () => (quote ? `Estimate-${plain(quote.quoteNumber, quote.id).replace(/[^a-z0-9._-]+/gi, '-')}.pdf` : 'Estimate.pdf'),
    [quote],
  )

  const revokePrintBlobUrl = useCallback(() => {
    if (printBlobUrlRef.current) {
      URL.revokeObjectURL(printBlobUrlRef.current)
      printBlobUrlRef.current = null
    }
  }, [])

  useEffect(() => () => {
    revokePrintBlobUrl()
  }, [revokePrintBlobUrl])

  const handleClose = useCallback(() => {
    revokePrintBlobUrl()
    onClose()
  }, [onClose, revokePrintBlobUrl])

  const handleOpenToPrint = useCallback(async () => {
    if (!document) {
      return
    }

    setIsOpeningPrint(true)
    try {
      const blob = await pdf(document).toBlob()
      revokePrintBlobUrl()
      const blobUrl = URL.createObjectURL(blob)
      printBlobUrlRef.current = blobUrl
      window.open(blobUrl, '_blank', 'noopener,noreferrer')
    } finally {
      setIsOpeningPrint(false)
    }
  }, [document, revokePrintBlobUrl])

  if (!quote || !document) return null

  return (
    <Dialog open={open} onClose={handleClose} fullScreen>
      <DialogTitle sx={{ py: 1.2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>Estimate PDF Preview</Box>
          <IconButton onClick={handleClose}><CloseRoundedIcon /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, bgcolor: '#525659' }}>
        <PDFViewer width="100%" height="100%" showToolbar>
          {document}
        </PDFViewer>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
        <PDFDownloadLink document={document} fileName={fileName} style={{ textDecoration: 'none' }}>
          {({ loading }) => (
            <Button component="span" variant="outlined" disabled={loading}>
              {loading ? 'Preparing PDF…' : 'Save PDF'}
            </Button>
          )}
        </PDFDownloadLink>
        <Button
          variant="contained"
          startIcon={<OpenInNewRoundedIcon />}
          disabled={isOpeningPrint}
          onClick={() => {
            void handleOpenToPrint()
          }}
        >
          {isOpeningPrint ? 'Preparing PDF…' : 'Open to Print'}
        </Button>
      </DialogActions>
    </Dialog>
  )
})

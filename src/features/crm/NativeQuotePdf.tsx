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
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack } from '@mui/material'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CrmQuote, CrmQuoteLineItem, CrmQuotePrintSettings } from './api'
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

function splitLineItems(lineItems: CrmQuoteLineItem[]) {
  return lineItems.flatMap((lineItem, lineItemIndex) => {
    const description = plain(lineItem.description, '').replace(/\r\n?/g, '\n')
    const visualLines = description.split('\n').flatMap((sourceLine) => {
      if (!sourceLine) return ['']
      const wrappedLines: string[] = []
      let remaining = sourceLine
      while (remaining.length > 64) {
        let splitAt = remaining.lastIndexOf(' ', 64)
        if (splitAt < 38) splitAt = 64
        wrappedLines.push(remaining.slice(0, splitAt).trim())
        remaining = remaining.slice(splitAt).trimStart()
      }
      wrappedLines.push(remaining)
      return wrappedLines
    })
    const chunks: string[] = []
    for (let index = 0; index < visualLines.length; index += 12) {
      chunks.push(visualLines.slice(index, index + 12).join('\n'))
    }
    if (chunks.length === 0) chunks.push('')

    return chunks.map((chunk, index) => ({
      ...lineItem,
      id: `${lineItem.id || lineItem.itemNumber}-${index}`,
      displayItemNumber: lineItemIndex + 1,
      description: index === 0 ? chunk : `(continued)\n${chunk}`,
      images: index === 0 ? lineItem.images : [],
      qty: index === 0 ? lineItem.qty : null,
      unitPrice: index === 0 ? lineItem.unitPrice : null,
      extPrice: index === 0 ? lineItem.extPrice : null,
      continuation: index > 0,
    }))
  })
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

function createStyles(accentColor: string) {
  return StyleSheet.create({
    page: {
      paddingTop: 138,
      paddingBottom: 56,
      paddingHorizontal: 28,
      fontFamily: 'Helvetica',
      fontSize: 9,
      color: '#172033',
    },
    header: {
      position: 'absolute',
      top: 22,
      left: 18,
      right: 28,
      height: 104,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: accentColor,
      paddingBottom: 8,
    },
    logo: { width: 84, height: 84, objectFit: 'contain' },
    brandBlock: { paddingLeft: 9, flexGrow: 1, flexShrink: 1, flexBasis: 0, justifyContent: 'center', alignItems: 'center' },
    brandName: { fontSize: 22, fontWeight: 700, letterSpacing: 0.3 },
    brandArnold: { color: '#151515' },
    brandContract: { color: '#b1161b' },
    brandQuote: { marginBottom: 5, fontSize: 17, fontWeight: 700, color: '#172033', letterSpacing: 1.2 },
    quoteInfoBox: { width: 192, borderWidth: 1, borderColor: accentColor, borderRadius: 3, overflow: 'hidden' },
    quoteInfoRow: { flexDirection: 'row', minHeight: 20, borderTopWidth: 1, borderTopColor: '#d8e0ea', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 7 },
    quoteInfoRowFirst: { borderTopWidth: 0 },
    quoteInfoLabel: { width: 52, fontSize: 7.4, color: '#334155', fontWeight: 700, textTransform: 'uppercase' },
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
    descriptionColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 7 },
    descriptionBody: { flexDirection: 'row', alignItems: 'flex-start' },
    descriptionText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, lineHeight: 1.35 },
    descriptionMediaRail: { marginLeft: 7, flexShrink: 0 },
    descriptionMediaBox: { borderWidth: 1, borderColor: '#d8e0ea', borderRadius: 2, overflow: 'hidden', backgroundColor: '#ffffff' },
    descriptionMediaBoxSpaced: { marginTop: 4 },
    descriptionMediaImage: { width: '100%', objectFit: 'contain' },
    qtyColumn: { width: 38, textAlign: 'right', paddingRight: 6 },
    unitColumn: { width: 70, textAlign: 'right', paddingRight: 6 },
    extColumn: { width: 76, textAlign: 'right' },
    centeredCell: { alignSelf: 'center' },
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
}: {
  quote: CrmQuote
  settings: CrmQuotePrintSettings
}) {
  const resolvedSettings = {
    ...DEFAULT_QUOTE_PRINT_SETTINGS,
    ...settings,
    logoUrl: !settings.logoUrl || settings.logoUrl === defaultArnoldLogoUrl ? defaultArnoldMarkUrl : settings.logoUrl,
    customerInformation: settings.customerInformation || DEFAULT_CUSTOMER_INFORMATION,
  }
  const styles = createStyles(resolvedSettings.accentColor)
  const rows = splitLineItems(Array.isArray(quote.lineItems) ? quote.lineItems : [])
  const additionalServices = hydrateAdditionalServices(quote.additionalServices)
  const shippingServices = Array.isArray(quote.shippingServices) ? quote.shippingServices : DEFAULT_SHIPPING_SERVICES
  const additionalServicesHaveImages = hasImages(additionalServices)
  const shippingServicesHaveImages = hasImages(shippingServices)
  const servicesTotal = additionalServices.reduce((sum, item) => sum + Number(resolveServiceExtPrice(item) || 0), 0)
  const shippingTotal = shippingServices.reduce((sum, item) => sum + Number(resolveServiceExtPrice(item) || 0), 0)
  const subtotal = quote.subtotal ?? rows.reduce((sum, row) => sum + Number(row.extPrice || 0), 0) + servicesTotal
  const freight = quote.freight ?? shippingTotal
  const customerInfoLines = resolvedSettings.customerInformation.split('\n').map((line) => line.trim()).filter(Boolean)
  const customerInfoMiddle = Math.ceil(customerInfoLines.length / 2)
  const customerInfoColumns = [customerInfoLines.slice(0, customerInfoMiddle), customerInfoLines.slice(customerInfoMiddle)].filter((column) => column.length > 0)

  return (
    <Document title={`Quote ${plain(quote.quoteNumber, quote.id)}`} author={resolvedSettings.companyName}>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header} fixed>
          {resolvedSettings.logoUrl ? <Image src={resolvePdfImageUri(resolvedSettings.logoUrl)} style={styles.logo} /> : null}
          <View style={styles.brandBlock}>
            <Text style={styles.brandQuote}>QUOTE</Text>
            <Text style={styles.brandName}><Text style={styles.brandArnold}>Arnold </Text><Text style={styles.brandContract}>Contract</Text></Text>
          </View>
          <View style={styles.quoteInfoBox}>
            <View style={[styles.quoteInfoRow, styles.quoteInfoRowFirst]}><Text style={styles.quoteInfoLabel}>Quote #</Text><Text style={styles.quoteInfoValue}>{plain(quote.quoteNumber)}</Text></View>
            <View style={styles.quoteInfoRow}><Text style={styles.quoteInfoLabel}>Date</Text><Text style={styles.quoteInfoValue}>{plain(quote.opportunityDate)?.slice(0, 10)}</Text></View>
            <View style={styles.quoteInfoRow}><Text style={styles.quoteInfoLabel}>Project</Text><Text style={styles.quoteInfoValue}>{plain(quote.title)}</Text></View>
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

        {rows.map((lineItem, index) => (
          <View key={lineItem.id || `${lineItem.itemNumber}-${index}`} style={[styles.row, index % 2 === 1 ? { backgroundColor: '#fbfdff' } : {}]} wrap={false}>
            <Text style={[styles.itemColumn, styles.centeredCell]}>{lineItem.continuation ? '' : lineItem.displayItemNumber}</Text>
            <View style={styles.descriptionColumn}>
              <View style={styles.descriptionBody}>
                <Text style={styles.descriptionText}>{plain(lineItem.description, '')}</Text>
                {(lineItem.images || []).length > 0 ? (
                  <View style={styles.descriptionMediaRail}>
                    {(lineItem.images || []).slice(0, 2).map((image, imageIndex) => {
                      const metrics = resolveProductImageMetrics(image, (lineItem.images || []).length)

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
            </View>
            <Text style={[styles.qtyColumn, styles.centeredCell]}>{plain(lineItem.qty, '')}</Text>
            <Text style={[styles.unitColumn, styles.centeredCell]}>{optionalMoney(lineItem.unitPrice)}</Text>
            <Text style={[styles.extColumn, styles.centeredCell]}>{optionalMoney(lineItem.extPrice)}</Text>
          </View>
        ))}

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
          <View style={styles.totalRow}><Text>Subtotal</Text><Text>{money(subtotal)}</Text></View>
          {resolvedSettings.showFreight ? <View style={styles.totalRow}><Text>{quote.freightDescription || 'Freight'}</Text><Text>{money(freight)}</Text></View> : null}
          <View style={styles.grandTotal}><Text>Total</Text><Text>{money(quote.totalAmount ?? subtotal + Number(freight || 0))}</Text></View>
        </View>

        {quote.notes ? <View style={styles.terms} wrap={false}><View style={styles.termItem}><Text style={styles.label}>Notes</Text><Text>{quote.notes}</Text></View></View> : null}

        {resolvedSettings.customerInformation ? (
          <View style={styles.customerInfo} wrap={false}>
            <Text style={styles.customerInfoTitle}>Customer Information</Text>
            <View style={styles.validityNotice}>
              <Text style={styles.validityText}>{QUOTE_VALIDITY_NOTICE}</Text>
              {STAIN_TO_MATCH_NOTICE.map((line) => <Text key={line} style={styles.stainNoticeLine}>• {line}</Text>)}
            </View>
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

  const document = useMemo(
    () => (quote ? <NativeQuotePdfDocument quote={quote} settings={settings} /> : null),
    [quote, settings],
  )

  const fileName = useMemo(
    () => (quote ? `Quote-${plain(quote.quoteNumber, quote.id).replace(/[^a-z0-9._-]+/gi, '-')}.pdf` : 'Quote.pdf'),
    [quote?.id, quote?.quoteNumber],
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
          <Box>Quote PDF Preview</Box>
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

import {
  Document,
  Image,
  Page,
  PDFDownloadLink,
  PDFViewer,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack } from '@mui/material'
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

const DEFAULT_ADDITIONAL_SERVICES = [
  ['custom-design', 'Custom Design Fee', 'Includes up to two rendering revisions with a lead time of two weeks. Additional revisions are billed separately.'],
  ['stain-match', 'Stain to Match', 'Stain matching is available on Arnold standard wood veneers and includes standard strike-offs.'],
  ['paint-sample', 'Paint Sample', 'Paint sample includes one standard paint strike-off. Additional approval samples may incur an extra fee.'],
  ['field-verification', 'Field Verification & Measurement', 'Includes one-time field verification and measurement during regular business hours.'],
  ['shop-drawing', 'Shop Drawing', 'Includes up to two revisions with an estimated two-week lead time.'],
  ['demolition', 'Demolition and Disposal of Existing Furniture', 'Demolition and disposal must be coordinated with delivery and installation. Unforeseen conditions may result in extra charges.'],
].map(([id, title, description]) => ({ id, title, description, price: null, images: [] }))

const DEFAULT_SHIPPING_SERVICES = [
  ['blanket-delivery', 'Blanket-Wrapped Dock Delivery', 'Dedicated truck delivery to a local warehouse dock. Customer team unloads the truck.'],
  ['common-carrier', 'Crated & Shipped via Common Carrier', 'Delivered crated to a warehouse dock by common carrier. Customer team unloads the truck.'],
  ['delivery-installation', 'Delivery & Installation', 'Site conditions, access, working hours, and carry-up requirements must be confirmed before scheduling.'],
].map(([id, title, description]) => ({ id, title, description, price: null, images: [] }))

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

const plain = (value: unknown, fallback = '-') => String(value ?? '').trim() || fallback

function splitLineItems(lineItems: CrmQuoteLineItem[]) {
  return lineItems.flatMap((lineItem) => {
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
  (images || []).some((image) => Number(image.height || 0) > Number(image.width || 0) * 1.15)
    ? portraitHeight
    : landscapeHeight
)

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
    brandBlock: { paddingLeft: 9, flexGrow: 1 },
    brandName: { fontSize: 22, fontWeight: 700, letterSpacing: 0.3 },
    brandArnold: { color: '#151515' },
    brandContract: { color: '#b1161b' },
    brandQuote: { marginTop: 5, fontSize: 17, fontWeight: 700, color: '#172033', letterSpacing: 1.2 },
    quoteInfoBox: { width: 192, borderWidth: 1, borderColor: accentColor, borderRadius: 3, overflow: 'hidden' },
    quoteInfoTitle: { backgroundColor: accentColor, color: '#ffffff', fontSize: 11, fontWeight: 700, paddingVertical: 4, paddingHorizontal: 7 },
    quoteInfoRow: { flexDirection: 'row', minHeight: 20, borderTopWidth: 1, borderTopColor: '#d8e0ea', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 7 },
    quoteInfoLabel: { width: 52, fontSize: 7, color: '#64748b', textTransform: 'uppercase' },
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
    label: { fontSize: 7, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 },
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
    imageColumn: { width: 104, flexDirection: 'row', gap: 4, paddingRight: 6 },
    lineImage: { flexGrow: 1, flexShrink: 1, flexBasis: 0, objectFit: 'contain' },
    itemColumn: { width: 30, paddingRight: 5 },
    descriptionColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 7, lineHeight: 1.35 },
    qtyColumn: { width: 38, textAlign: 'right', paddingRight: 6 },
    unitColumn: { width: 70, textAlign: 'right', paddingRight: 6 },
    extColumn: { width: 76, textAlign: 'right' },
    centeredCell: { alignSelf: 'center' },
    totals: { marginTop: 14, marginLeft: 'auto', width: 250, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#d8e0ea', borderRadius: 3, paddingHorizontal: 10, paddingVertical: 6 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderColor: '#e2e8f0' },
    grandTotal: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: accentColor, paddingTop: 7, paddingBottom: 3, marginTop: 3, fontSize: 14, fontWeight: 700, color: accentColor },
    terms: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#cbd5e1', paddingTop: 8 },
    termItem: { flexGrow: 1 },
    sectionTitle: { marginTop: 12, paddingVertical: 5, paddingHorizontal: 6, backgroundColor: '#eef2f7', borderWidth: 1, borderColor: '#cbd5e1', fontSize: 10, fontWeight: 700, color: accentColor },
    serviceRow: { flexDirection: 'row', borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#d8e0ea', padding: 6, minHeight: 34 },
    serviceHeader: { flexDirection: 'row', backgroundColor: accentColor, color: '#ffffff', paddingVertical: 5, paddingHorizontal: 6, fontWeight: 700 },
    serviceHeaderImages: { width: 104, paddingRight: 6 },
    serviceHeaderText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 8 },
    serviceHeaderPrice: { width: 72, textAlign: 'right' },
    serviceText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 8 },
    serviceName: { fontWeight: 700, marginBottom: 2 },
    serviceDescription: { fontSize: 8, lineHeight: 1.25, color: '#344155' },
    serviceImages: { width: 104, flexDirection: 'row', gap: 4, paddingRight: 6 },
    serviceImage: { flexGrow: 1, flexShrink: 1, flexBasis: 0, objectFit: 'contain' },
    servicePrice: { width: 72, textAlign: 'right', fontWeight: 700 },
    customerInfo: { marginTop: 14, backgroundColor: '#fff7f7', borderWidth: 1, borderColor: '#efc8ca', borderRadius: 3, paddingVertical: 8, paddingHorizontal: 10 },
    customerInfoTitle: { color: '#b1161b', fontSize: 9, fontWeight: 700, marginBottom: 6 },
    customerInfoColumns: { flexDirection: 'row', gap: 12 },
    customerInfoColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    customerInfoLine: { color: '#344155', fontSize: 7.4, lineHeight: 1.35, marginBottom: 4 },
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
  const additionalServices = Array.isArray(quote.additionalServices) ? quote.additionalServices : DEFAULT_ADDITIONAL_SERVICES
  const shippingServices = Array.isArray(quote.shippingServices) ? quote.shippingServices : DEFAULT_SHIPPING_SERVICES
  const productHasImages = hasImages(rows)
  const additionalServicesHaveImages = hasImages(additionalServices)
  const shippingServicesHaveImages = hasImages(shippingServices)
  const servicesTotal = additionalServices.reduce((sum, item) => sum + Number(item.price || 0), 0)
  const shippingTotal = shippingServices.reduce((sum, item) => sum + Number(item.price || 0), 0)
  const subtotal = quote.subtotal ?? rows.reduce((sum, row) => sum + Number(row.extPrice || 0), 0) + servicesTotal
  const freight = quote.freight ?? shippingTotal
  const customerInfoLines = resolvedSettings.customerInformation.split('\n').map((line) => line.trim()).filter(Boolean)
  const customerInfoMiddle = Math.ceil(customerInfoLines.length / 2)
  const customerInfoColumns = [customerInfoLines.slice(0, customerInfoMiddle), customerInfoLines.slice(customerInfoMiddle)].filter((column) => column.length > 0)

  return (
    <Document title={`Quote ${plain(quote.quoteNumber, quote.id)}`} author={resolvedSettings.companyName}>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header} fixed>
          {resolvedSettings.logoUrl ? <Image src={resolvedSettings.logoUrl} style={styles.logo} /> : null}
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}><Text style={styles.brandArnold}>Arnold </Text><Text style={styles.brandContract}>Contract</Text></Text>
            <Text style={styles.brandQuote}>QUOTE</Text>
          </View>
          <View style={styles.quoteInfoBox}>
            <Text style={styles.quoteInfoTitle}>QUOTE</Text>
            <View style={styles.quoteInfoRow}><Text style={styles.quoteInfoLabel}>Number</Text><Text style={styles.quoteInfoValue}>{plain(quote.quoteNumber)}</Text></View>
            <View style={styles.quoteInfoRow}><Text style={styles.quoteInfoLabel}>Date</Text><Text style={styles.quoteInfoValue}>{plain(quote.opportunityDate)?.slice(0, 10)}</Text></View>
            <View style={styles.quoteInfoRow}><Text style={styles.quoteInfoLabel}>Project</Text><Text style={styles.quoteInfoValue}>{plain(quote.title)}</Text></View>
          </View>
        </View>

        <View style={styles.customerBlock} wrap={false}>
          <View style={styles.customerGroupWide}>
            <Text style={styles.label}>Prepared For</Text>
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
              {productHasImages ? <Text style={styles.imageColumn}>Picture</Text> : null}
              <Text style={styles.itemColumn}>Item</Text>
              <Text style={styles.descriptionColumn}>Description</Text>
              <Text style={styles.qtyColumn}>Qty</Text>
              <Text style={styles.unitColumn}>Unit Price</Text>
              <Text style={styles.extColumn}>Extended</Text>
            </View>
          </View>
        ) : null}

        {rows.map((lineItem, index) => (
          <View key={lineItem.id || `${lineItem.itemNumber}-${index}`} style={[styles.row, index % 2 === 1 ? { backgroundColor: '#fbfdff' } : {}]} wrap={false}>
            {productHasImages ? (
              <View style={styles.imageColumn}>
                {(lineItem.images || []).slice(0, 2).map((image) => (
                  <Image key={image.id} src={image.url} style={[styles.lineImage, { height: imageHeight([image], 82, 116) }]} />
                ))}
              </View>
            ) : null}
            <Text style={[styles.itemColumn, styles.centeredCell]}>{lineItem.continuation ? '' : lineItem.itemNumber || index + 1}</Text>
            <Text style={styles.descriptionColumn}>{plain(lineItem.description, '')}</Text>
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
              <Text style={styles.serviceHeaderPrice}>Price</Text>
            </View>
          </View>
        ) : null}
        {additionalServices.map((service) => (
          <View key={service.id} style={styles.serviceRow} wrap={false}>
            {additionalServicesHaveImages ? (
              <View style={styles.serviceImages}>
                {(service.images || []).slice(0, 2).map((image) => <Image key={image.id} src={image.url} style={[styles.serviceImage, { height: imageHeight([image], 68, 96) }]} />)}
              </View>
            ) : null}
            <View style={styles.serviceText}>
              <Text style={styles.serviceName}>{service.title}</Text>
              {service.description ? <Text style={styles.serviceDescription}>{service.description}</Text> : null}
            </View>
            <Text style={[styles.servicePrice, styles.centeredCell]}>{optionalMoney(service.price)}</Text>
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
                {(service.images || []).slice(0, 2).map((image) => <Image key={image.id} src={image.url} style={[styles.serviceImage, { height: imageHeight([image], 68, 96) }]} />)}
              </View>
            ) : null}
            <View style={styles.serviceText}>
              <Text style={styles.serviceName}>{service.title}</Text>
              {service.description ? <Text style={styles.serviceDescription}>{service.description}</Text> : null}
            </View>
            <Text style={[styles.servicePrice, styles.centeredCell]}>{optionalMoney(service.price)}</Text>
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

export function QuotePdfPreviewDialog({
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
  if (!quote) return null

  const document = <NativeQuotePdfDocument quote={quote} settings={settings} />
  const fileName = `Quote-${plain(quote.quoteNumber, quote.id).replace(/[^a-z0-9._-]+/gi, '-')}.pdf`

  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <DialogTitle sx={{ py: 1.2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>Quote PDF Preview</Box>
          <IconButton onClick={onClose}><CloseRoundedIcon /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, bgcolor: '#525659' }}>
        <PDFViewer width="100%" height="100%" showToolbar>
          {document}
        </PDFViewer>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <PDFDownloadLink document={document} fileName={fileName} style={{ textDecoration: 'none' }}>
          {({ loading }) => (
            <Button component="span" variant="outlined" disabled={loading}>
              {loading ? 'Preparing PDF…' : 'Save PDF'}
            </Button>
          )}
        </PDFDownloadLink>
        <PDFDownloadLink document={document} fileName={fileName} style={{ textDecoration: 'none' }}>
          {({ url, loading }) => (
            <Button
              component="span"
              variant="contained"
              startIcon={<OpenInNewRoundedIcon />}
              disabled={loading || !url}
              onClick={() => {
                if (url) window.open(url, '_blank', 'noopener,noreferrer')
              }}
            >
              Open to Print
            </Button>
          )}
        </PDFDownloadLink>
      </DialogActions>
    </Dialog>
  )
}

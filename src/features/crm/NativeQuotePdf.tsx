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

const plain = (value: unknown, fallback = '-') => String(value ?? '').trim() || fallback

function splitLineItems(lineItems: CrmQuoteLineItem[]) {
  return lineItems.flatMap((lineItem) => {
    const description = plain(lineItem.description, '')
    const chunkLength = 650

    if (description.length <= chunkLength) {
      return [lineItem]
    }

    const chunks: string[] = []
    let remaining = description

    while (remaining.length > chunkLength) {
      let splitAt = remaining.lastIndexOf(' ', chunkLength)
      if (splitAt < chunkLength * 0.6) splitAt = chunkLength
      chunks.push(remaining.slice(0, splitAt).trim())
      remaining = remaining.slice(splitAt).trim()
    }
    if (remaining) chunks.push(remaining)

    return chunks.map((chunk, index) => ({
      ...lineItem,
      id: `${lineItem.id || lineItem.itemNumber}-${index}`,
      description: index === 0 ? chunk : `${chunk} (continued)`,
      images: index === 0 ? lineItem.images : [],
      qty: index === 0 ? lineItem.qty : null,
      unitPrice: index === 0 ? lineItem.unitPrice : null,
      extPrice: index === 0 ? lineItem.extPrice : null,
    }))
  })
}

function createStyles(accentColor: string) {
  return StyleSheet.create({
    page: {
      paddingTop: 132,
      paddingBottom: 56,
      paddingHorizontal: 28,
      fontFamily: 'Helvetica',
      fontSize: 9,
      color: '#172033',
    },
    header: {
      position: 'absolute',
      top: 22,
      left: 28,
      right: 28,
      height: 98,
      flexDirection: 'row',
      borderBottomWidth: 2,
      borderBottomColor: accentColor,
      paddingBottom: 8,
    },
    logo: { width: 174, height: 82, objectFit: 'contain' },
    quoteTitle: { position: 'absolute', top: 9, left: 185, right: 185, fontSize: 24, fontWeight: 700, color: accentColor, textAlign: 'center' },
    quoteHeader: { width: 190, marginLeft: 'auto', alignItems: 'flex-end', paddingTop: 33 },
    quoteMeta: { fontSize: 10, marginBottom: 4, fontWeight: 700 },
    customerBlock: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: '#cbd5e1',
      marginBottom: 12,
      paddingBottom: 5,
    },
    customerColumn: { width: '50%', paddingVertical: 4, paddingRight: 14 },
    customerColumnRight: { width: '50%', paddingVertical: 4, paddingLeft: 14 },
    label: { fontSize: 7, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 },
    value: { fontSize: 9, marginBottom: 5 },
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
    },
    imageColumn: { width: 138, flexDirection: 'row', gap: 4, paddingRight: 5 },
    lineImage: { flexGrow: 1, height: 82, objectFit: 'contain' },
    itemColumn: { width: 30, paddingRight: 4 },
    descriptionColumn: { flexGrow: 1, paddingRight: 5, lineHeight: 1.25 },
    qtyColumn: { width: 35, textAlign: 'right', paddingRight: 4 },
    unitColumn: { width: 62, textAlign: 'right', paddingRight: 4 },
    extColumn: { width: 68, textAlign: 'right' },
    totals: { marginTop: 10, marginLeft: 'auto', width: 230 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderColor: '#e2e8f0' },
    grandTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, fontSize: 12, fontWeight: 700, color: accentColor },
    terms: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#cbd5e1', paddingTop: 8 },
    termItem: { flexGrow: 1 },
    sectionTitle: { marginTop: 12, paddingVertical: 5, paddingHorizontal: 6, backgroundColor: '#eef2f7', borderWidth: 1, borderColor: '#cbd5e1', fontSize: 10, fontWeight: 700, color: accentColor },
    serviceRow: { flexDirection: 'row', borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#d8e0ea', padding: 6, minHeight: 34 },
    serviceText: { flexGrow: 1, paddingRight: 8 },
    serviceName: { fontWeight: 700, marginBottom: 2 },
    serviceDescription: { fontSize: 8, lineHeight: 1.25, color: '#344155' },
    serviceImages: { width: 122, flexDirection: 'row', gap: 4, paddingRight: 6 },
    serviceImage: { flexGrow: 1, height: 70, objectFit: 'contain' },
    servicePrice: { width: 72, textAlign: 'right', fontWeight: 700 },
    customerInfo: { marginTop: 14, borderTopWidth: 1, borderTopColor: accentColor, paddingTop: 7 },
    customerInfoTitle: { textAlign: 'center', color: '#c1121f', fontWeight: 700, marginBottom: 4 },
    customerInfoLine: { textAlign: 'center', color: '#c1121f', fontSize: 7, lineHeight: 1.25, marginBottom: 2 },
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
    logoUrl: settings.logoUrl || defaultArnoldLogoUrl,
    customerInformation: settings.customerInformation || DEFAULT_CUSTOMER_INFORMATION,
  }
  const styles = createStyles(resolvedSettings.accentColor)
  const rows = splitLineItems(Array.isArray(quote.lineItems) ? quote.lineItems : [])
  const additionalServices = Array.isArray(quote.additionalServices) ? quote.additionalServices : DEFAULT_ADDITIONAL_SERVICES
  const shippingServices = Array.isArray(quote.shippingServices) ? quote.shippingServices : DEFAULT_SHIPPING_SERVICES
  const servicesTotal = additionalServices.reduce((sum, item) => sum + Number(item.price || 0), 0)
  const shippingTotal = shippingServices.reduce((sum, item) => sum + Number(item.price || 0), 0)
  const subtotal = quote.subtotal ?? rows.reduce((sum, row) => sum + Number(row.extPrice || 0), 0) + servicesTotal
  const freight = quote.freight ?? shippingTotal

  return (
    <Document title={`Quote ${plain(quote.quoteNumber, quote.id)}`} author={resolvedSettings.companyName}>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header} fixed>
          {resolvedSettings.logoUrl ? <Image src={resolvedSettings.logoUrl} style={styles.logo} /> : null}
          <Text style={styles.quoteTitle}>QUOTE</Text>
          <View style={styles.quoteHeader}>
            <Text style={styles.quoteMeta}>No. {plain(quote.quoteNumber)}</Text>
            <Text style={styles.quoteMeta}>Date {plain(quote.opportunityDate)?.slice(0, 10)}</Text>
            <Text style={styles.quoteMeta}>{plain(quote.title)}</Text>
          </View>
        </View>

        <View style={styles.customerBlock} wrap={false}>
          <View style={styles.customerColumn}>
            <Text style={styles.label}>Prepared For</Text>
            <Text style={styles.value}>{plain(quote.companyName || quote.dealerName)}</Text>
            <Text style={styles.label}>Contact</Text>
            <Text style={styles.value}>{plain(quote.contactName)}</Text>
            <Text>{plain(quote.contactEmail, '')}</Text>
            <Text>{plain(quote.contactPhone, '')}</Text>
          </View>
          <View style={styles.customerColumnRight}>
            <Text style={styles.label}>Sales Representative</Text>
            <Text style={styles.value}>{plain(quote.salesRep)}</Text>
            <Text style={styles.label}>Project</Text>
            <Text style={styles.value}>{plain(quote.title)}</Text>
            <Text style={styles.label}>Project Type</Text>
            <Text style={styles.value}>{plain(quote.projectType)}</Text>
            {resolvedSettings.showLeadTime ? <><Text style={styles.label}>Lead Time</Text><Text style={styles.value}>{plain(quote.leadTime)}</Text></> : null}
            {resolvedSettings.showPaymentTerms ? <><Text style={styles.label}>Payment Terms</Text><Text style={styles.value}>{plain(quote.paymentTerms)}</Text></> : null}
          </View>
        </View>

        <View style={styles.tableHeader} fixed>
          <Text style={styles.imageColumn}>Picture</Text>
          <Text style={styles.itemColumn}>Item</Text>
          <Text style={styles.descriptionColumn}>Description</Text>
          <Text style={styles.qtyColumn}>Qty</Text>
          <Text style={styles.unitColumn}>Unit</Text>
          <Text style={styles.extColumn}>Extended</Text>
        </View>

        {rows.map((lineItem, index) => (
          <View key={lineItem.id || `${lineItem.itemNumber}-${index}`} style={styles.row} wrap={false}>
            <View style={styles.imageColumn}>
              {(lineItem.images || []).slice(0, 2).map((image) => (
                <Image key={image.id} src={image.url} style={styles.lineImage} />
              ))}
            </View>
            <Text style={styles.itemColumn}>{lineItem.itemNumber || index + 1}</Text>
            <Text style={styles.descriptionColumn}>{plain(lineItem.description, '')}</Text>
            <Text style={styles.qtyColumn}>{plain(lineItem.qty, '')}</Text>
            <Text style={styles.unitColumn}>{money(lineItem.unitPrice)}</Text>
            <Text style={styles.extColumn}>{money(lineItem.extPrice)}</Text>
          </View>
        ))}

        {additionalServices.length > 0 ? <Text style={styles.sectionTitle}>Additional Services</Text> : null}
        {additionalServices.map((service) => (
          <View key={service.id} style={styles.serviceRow} wrap={false}>
            <View style={styles.serviceText}>
              <Text style={styles.serviceName}>{service.title}</Text>
              {service.description ? <Text style={styles.serviceDescription}>{service.description}</Text> : null}
            </View>
            <View style={styles.serviceImages}>
              {(service.images || []).slice(0, 2).map((image) => <Image key={image.id} src={image.url} style={styles.serviceImage} />)}
            </View>
            <Text style={styles.servicePrice}>{money(service.price)}</Text>
          </View>
        ))}

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}><Text>Subtotal</Text><Text>{money(subtotal)}</Text></View>
        </View>

        {resolvedSettings.showFreight && shippingServices.length > 0 ? <Text style={styles.sectionTitle}>Freight, Delivery &amp; Installation</Text> : null}
        {resolvedSettings.showFreight ? shippingServices.map((service) => (
          <View key={service.id} style={styles.serviceRow} wrap={false}>
            <View style={styles.serviceText}>
              <Text style={styles.serviceName}>{service.title}</Text>
              {service.description ? <Text style={styles.serviceDescription}>{service.description}</Text> : null}
            </View>
            <View style={styles.serviceImages}>
              {(service.images || []).slice(0, 2).map((image) => <Image key={image.id} src={image.url} style={styles.serviceImage} />)}
            </View>
            <Text style={styles.servicePrice}>{money(service.price)}</Text>
          </View>
        )) : null}

        <View style={styles.totals} wrap={false}>
          {resolvedSettings.showFreight ? <View style={styles.totalRow}><Text>{quote.freightDescription || 'Freight'}</Text><Text>{money(freight)}</Text></View> : null}
          <View style={styles.grandTotal}><Text>Total</Text><Text>{money(quote.totalAmount ?? subtotal + Number(freight || 0))}</Text></View>
        </View>

        {quote.notes ? <View style={styles.terms} wrap={false}><View style={styles.termItem}><Text style={styles.label}>Notes</Text><Text>{quote.notes}</Text></View></View> : null}

        {resolvedSettings.customerInformation ? (
          <View style={styles.customerInfo}>
            <Text style={styles.customerInfoTitle}>Customer Information</Text>
            {resolvedSettings.customerInformation.split('\n').filter(Boolean).map((line) => (
              <Text key={line} style={styles.customerInfoLine}>* {line}</Text>
            ))}
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

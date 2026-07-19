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

// eslint-disable-next-line react-refresh/only-export-components
export const DEFAULT_QUOTE_PRINT_SETTINGS: CrmQuotePrintSettings = {
  id: 'default',
  logoUrl: null,
  logoName: null,
  companyName: 'Arnold Contract',
  addressLines: [],
  phone: null,
  email: null,
  website: null,
  headerText: 'Quotation',
  footerText: 'Thank you for the opportunity to quote this project.',
  accentColor: '#0f4c81',
  showPaymentTerms: true,
  showLeadTime: true,
  showFreight: true,
  updatedAt: null,
  updatedByEmail: null,
}

const money = (value: number | null | undefined) => {
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
      paddingTop: 118,
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
      height: 84,
      flexDirection: 'row',
      borderBottomWidth: 2,
      borderBottomColor: accentColor,
      paddingBottom: 8,
    },
    logo: { width: 104, height: 56, objectFit: 'contain', marginRight: 12 },
    company: { flexGrow: 1 },
    companyName: { fontSize: 17, fontWeight: 700, color: accentColor, marginBottom: 3 },
    companyLine: { fontSize: 8, color: '#526075', marginBottom: 1 },
    quoteHeader: { width: 170, alignItems: 'flex-end' },
    quoteTitle: { fontSize: 20, fontWeight: 700, color: accentColor, marginBottom: 5 },
    quoteMeta: { fontSize: 9, marginBottom: 2 },
    customerBlock: {
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: '#cbd5e1',
      borderRadius: 3,
      marginBottom: 12,
    },
    customerColumn: { width: '50%', padding: 8 },
    customerColumnRight: { width: '50%', padding: 8, borderLeftWidth: 1, borderLeftColor: '#cbd5e1' },
    label: { fontSize: 7, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 },
    value: { fontSize: 9, marginBottom: 5 },
    headerText: { fontSize: 9, lineHeight: 1.35, marginBottom: 10, color: '#344155' },
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
    terms: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#cbd5e1', paddingTop: 8, flexDirection: 'row', gap: 18 },
    termItem: { flexGrow: 1 },
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
  const resolvedSettings = { ...DEFAULT_QUOTE_PRINT_SETTINGS, ...settings }
  const styles = createStyles(resolvedSettings.accentColor)
  const rows = splitLineItems(Array.isArray(quote.lineItems) ? quote.lineItems : [])
  const subtotal = quote.subtotal ?? rows.reduce((sum, row) => sum + Number(row.extPrice || 0), 0)
  const freight = Number(quote.freight || 0)

  return (
    <Document title={`Quote ${plain(quote.quoteNumber, quote.id)}`} author={resolvedSettings.companyName}>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header} fixed>
          {resolvedSettings.logoUrl ? <Image src={resolvedSettings.logoUrl} style={styles.logo} /> : null}
          <View style={styles.company}>
            <Text style={styles.companyName}>{resolvedSettings.companyName}</Text>
            {resolvedSettings.addressLines.map((line) => <Text key={line} style={styles.companyLine}>{line}</Text>)}
            {[resolvedSettings.phone, resolvedSettings.email, resolvedSettings.website].filter(Boolean).map((line) => (
              <Text key={line} style={styles.companyLine}>{line}</Text>
            ))}
          </View>
          <View style={styles.quoteHeader}>
            <Text style={styles.quoteTitle}>QUOTE</Text>
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
            <Text>{plain(quote.projectType)}</Text>
          </View>
        </View>

        {resolvedSettings.headerText ? <Text style={styles.headerText}>{resolvedSettings.headerText}</Text> : null}

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

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}><Text>Subtotal</Text><Text>{money(subtotal)}</Text></View>
          {resolvedSettings.showFreight ? (
            <View style={styles.totalRow}><Text>{quote.freightDescription || 'Freight'}</Text><Text>{money(freight)}</Text></View>
          ) : null}
          <View style={styles.grandTotal}><Text>Total</Text><Text>{money(quote.totalAmount ?? subtotal + freight)}</Text></View>
        </View>

        <View style={styles.terms} wrap={false}>
          {resolvedSettings.showLeadTime ? <View style={styles.termItem}><Text style={styles.label}>Lead Time</Text><Text>{plain(quote.leadTime)}</Text></View> : null}
          {resolvedSettings.showPaymentTerms ? <View style={styles.termItem}><Text style={styles.label}>Payment Terms</Text><Text>{plain(quote.paymentTerms)}</Text></View> : null}
          {quote.notes ? <View style={styles.termItem}><Text style={styles.label}>Notes</Text><Text>{quote.notes}</Text></View> : null}
        </View>

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

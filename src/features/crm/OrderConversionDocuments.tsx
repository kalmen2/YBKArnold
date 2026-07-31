/* eslint-disable react-refresh/only-export-components */
import { Document, Image, Page, Rect, StyleSheet, Svg, Text, View, pdf } from '@react-pdf/renderer'
import type { CrmQuotePrintSettings } from './api'

export type OrderDocumentLine = {
  id: string
  description: string
  qty: number | null
  unitPrice: number | null
  extPrice: number
  category: 'product' | 'additional' | 'freight'
}

export type OrderDocumentData = {
  changeVersion?: number | null
  documentDate: string
  companyName: string
  contactName: string
  contactEmail: string
  contactPhone: string
  description: string
  poNumber: string
  projectName: string
  acknowledgmentNumber: string
  leadTime: string
  freightType: string
  shipTo: string
  productGross?: number
  discountPercent?: number | null
  discountAmount?: number
  productNet: number
  freightGross?: number
  freightDiscountAmount?: number
  freightNet: number
  grandTotal: number
  depositRequired: boolean
  depositPercent: number | null
  lines: OrderDocumentLine[]
  salesRep?: string
  poDate?: string
  acknowledgmentDate?: string
  estimatedReadyDate?: string
}

const styles = StyleSheet.create({
  page: { paddingTop: 92, paddingBottom: 48, paddingHorizontal: 38, fontFamily: 'Helvetica', fontSize: 9, color: '#15283b' },
  brand: { fontSize: 15.5, fontFamily: 'Helvetica-Bold', color: '#b51f2e' },
  logo: { width: 42, height: 42, objectFit: 'contain' },
  brandContract: { color: '#101820' },
  brandContact: { marginTop: 5, fontSize: 7.2, color: '#607284', textAlign: 'center' },
  headerBlock: { position: 'absolute', top: 14, left: 38, right: 38, alignItems: 'center' },
  header: { alignItems: 'center', width: '100%' },
  logoArea: { position: 'absolute', left: 0, top: 2, alignItems: 'flex-start' },
  brandArea: { alignItems: 'center' },
  brandName: { fontSize: 15.5, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  title: { marginTop: 4, fontSize: 17, color: '#0f4c81', fontFamily: 'Helvetica-Bold', letterSpacing: 0.45, textAlign: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: 8 },
  referenceBox: { width: '40%', paddingVertical: 6, paddingHorizontal: 9, backgroundColor: '#f3f6f8', borderLeftWidth: 3, borderLeftColor: '#0f4c81' },
  referenceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2.5 },
  referenceLabel: { fontSize: 6.5, color: '#66788a', textTransform: 'uppercase' },
  referenceValue: { fontSize: 7.8, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  rule: { height: 2.5, width: '100%', backgroundColor: '#0f4c81', marginTop: 6 },
  infoPanel: { marginTop: 8, flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 11, backgroundColor: '#f7f9fb', borderBottomWidth: 1, borderColor: '#d5dee6' },
  infoColumn: { width: '50%', paddingRight: 10 },
  infoColumnRight: { width: '50%', paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: '#d5dee6' },
  infoRow: { flexDirection: 'row', marginBottom: 3.5, lineHeight: 1.18 },
  label: { width: 72, fontSize: 7, color: '#66788a', textTransform: 'uppercase' },
  value: { flex: 1, fontSize: 8.2, fontFamily: 'Helvetica-Bold' },
  depositBanner: { width: '60%', marginRight: 8, paddingVertical: 11, paddingHorizontal: 10, textAlign: 'center', fontSize: 10.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.7, justifyContent: 'center' },
  depositRequired: { backgroundColor: '#f9ecee', color: '#a9192d', borderLeftWidth: 4, borderLeftColor: '#b51f2e' },
  depositNotRequired: { backgroundColor: '#eef4f8', color: '#0f4c81', borderLeftWidth: 4, borderLeftColor: '#0f4c81' },
  sectionTitle: { marginTop: 12, marginBottom: 6, fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: '#0f4c81' },
  tableHead: { flexDirection: 'row', backgroundColor: '#0f4c81', color: '#fff', padding: 6 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#dbe3ea', padding: 6 },
  desc: { width: '55%', paddingRight: 7 }, qty: { width: '10%', textAlign: 'right', paddingRight: 5 }, unit: { width: '17.5%', textAlign: 'right', paddingRight: 8 }, money: { width: '17.5%', textAlign: 'right' },
  totals: { marginTop: 8, marginLeft: '54%', backgroundColor: '#f7f9fb', borderTopWidth: 2, borderTopColor: '#0f4c81' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4.5, paddingHorizontal: 9, borderBottomWidth: 1, borderBottomColor: '#dbe3ea', fontSize: 9.2 },
  grandTotalRow: { fontFamily: 'Helvetica-Bold', color: '#0f4c81', fontSize: 10 },
  depositTotalRow: { fontFamily: 'Helvetica-Bold', color: '#b51f2e', fontSize: 10 },
  nextSteps: { marginTop: 11, paddingVertical: 9, paddingHorizontal: 12, borderLeftWidth: 3, borderLeftColor: '#0f4c81', backgroundColor: '#f7f9fb' },
  nextStepsTitle: { fontSize: 9.5, color: '#0f4c81', fontFamily: 'Helvetica-Bold', marginBottom: 5 },
  nextStepsText: { fontSize: 8.7, color: '#334a5f', lineHeight: 1.4 },
  managers: { marginTop: 10, textAlign: 'center', fontSize: 8, color: '#607284' },
  footer: { position: 'absolute', bottom: 24, left: 38, right: 38, borderTopWidth: 1, borderColor: '#d8e0e7', paddingTop: 7, textAlign: 'center', color: '#607284', fontSize: 7.5 },
  workOrderSummary: { marginTop: 10, flexDirection: 'row', alignItems: 'stretch', backgroundColor: '#f7f9fb', borderBottomWidth: 1, borderColor: '#d5dee6' },
  workOrderSummaryInfo: { width: '58%', paddingVertical: 10, paddingHorizontal: 12 },
  workOrderLabel: { width: 92, fontSize: 7, color: '#66788a', textTransform: 'uppercase' },
  workOrderBarcodeArea: { width: '42%', paddingVertical: 8, paddingHorizontal: 12, borderLeftWidth: 1, borderLeftColor: '#d5dee6', alignItems: 'center', justifyContent: 'center' },
  workOrderBarcodeLabel: { fontSize: 6.5, color: '#66788a', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  workOrderBarcodeText: { marginTop: 3, fontSize: 8.5, fontFamily: 'Helvetica-Bold', letterSpacing: 1.2, textAlign: 'center' },
  workOrderDescription: { marginTop: 9, paddingVertical: 8, paddingHorizontal: 11, borderLeftWidth: 3, borderLeftColor: '#0f4c81', backgroundColor: '#f7f9fb' },
  workOrderDescriptionLabel: { fontSize: 6.5, color: '#66788a', textTransform: 'uppercase', marginBottom: 3 },
  workOrderDescriptionValue: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', lineHeight: 1.3 },
  workOrderDesc: { width: '84%', paddingRight: 8 },
  workOrderQty: { width: '16%', textAlign: 'right' },
  invoiceDue: { width: '60%', marginRight: 8, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: '#f9ecee', borderLeftWidth: 4, borderLeftColor: '#b51f2e', justifyContent: 'center' },
  invoiceDueLabel: { fontSize: 7, color: '#7d2a35', textTransform: 'uppercase', letterSpacing: 0.7 },
  invoiceDueAmount: { marginTop: 3, fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#b51f2e' },
  invoiceNote: { marginTop: 12, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: '#f7f9fb', borderLeftWidth: 3, borderLeftColor: '#0f4c81', color: '#334a5f', fontSize: 8.7, lineHeight: 1.4 },
})

const bolStyles = StyleSheet.create({
  page: { paddingTop: 26, paddingBottom: 24, paddingHorizontal: 32, fontFamily: 'Helvetica', fontSize: 6.5, color: '#111' },
  border: { borderWidth: 0.8, borderColor: '#111' },
  title: { height: 17, borderBottomWidth: 0.8, borderColor: '#111', fontFamily: 'Helvetica-Bold', fontSize: 12, textAlign: 'center', paddingTop: 2 },
  subtitle: { height: 15, borderBottomWidth: 0.8, borderColor: '#111', fontSize: 7.5, textAlign: 'center', paddingTop: 3 },
  received: { height: 17, borderBottomWidth: 0.8, borderColor: '#111', fontSize: 6.7, paddingHorizontal: 3, paddingTop: 4 },
  fromRow: { height: 30, flexDirection: 'row', borderBottomWidth: 0.8, borderColor: '#111' },
  darkLabel: { backgroundColor: '#858585', color: '#fff', fontFamily: 'Helvetica-Bold', textAlign: 'center', paddingTop: 9 },
  fromValue: { flex: 1, paddingHorizontal: 5, paddingTop: 5, fontFamily: 'Helvetica-Bold', fontSize: 8.2 },
  legalIntro: { height: 74, paddingHorizontal: 3, paddingVertical: 3, borderBottomWidth: 0.8, borderColor: '#111', fontSize: 5.25, lineHeight: 1.24, textAlign: 'justify' },
  certification: { marginTop: 3, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  partiesRow: { height: 78, flexDirection: 'row', borderBottomWidth: 0.8, borderColor: '#111' },
  partyBox: { width: '40%', borderRightWidth: 0.8, borderColor: '#111' },
  partyHeader: { height: 18, backgroundColor: '#858585', color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 8.5, paddingHorizontal: 10, paddingTop: 4 },
  partyValue: { paddingHorizontal: 8, paddingTop: 6, fontSize: 7.3, lineHeight: 1.28 },
  freightBox: { width: '20%' },
  freightRow: { height: 19.5, flexDirection: 'row', borderBottomWidth: 0.8, borderColor: '#111' },
  freightCheck: { width: 24, borderRightWidth: 0.8, borderColor: '#111', textAlign: 'center', paddingTop: 5, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  freightLabel: { flex: 1, paddingLeft: 4, paddingTop: 5, fontFamily: 'Helvetica-Oblique', fontSize: 7 },
  refsRow: { height: 36, flexDirection: 'row', borderBottomWidth: 0.8, borderColor: '#111' },
  refCell: { borderRightWidth: 0.8, borderColor: '#111' },
  refHeader: { height: 18, backgroundColor: '#858585', color: '#fff', fontFamily: 'Helvetica-Bold', textAlign: 'center', paddingTop: 5 },
  refValue: { flex: 1, textAlign: 'center', paddingHorizontal: 2, paddingTop: 2.5, fontSize: 5.7, lineHeight: 1.08 },
  detailsRow: { height: 285, flexDirection: 'row', borderBottomWidth: 0.8, borderColor: '#111' },
  itemsArea: { width: '64%', borderRightWidth: 0.8, borderColor: '#111' },
  itemHeader: { height: 18, flexDirection: 'row', backgroundColor: '#858585', color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 7.2 },
  itemHeaderCell: { paddingTop: 5, textAlign: 'center', borderRightWidth: 0.8, borderColor: '#111' },
  itemRow: { minHeight: 25, flexDirection: 'row', borderBottomWidth: 0.45, borderColor: '#aaa', fontSize: 6.5 },
  itemCell: { paddingHorizontal: 3, paddingVertical: 4, borderRightWidth: 0.45, borderColor: '#aaa' },
  termsArea: { width: '36%' },
  termsBlock: { paddingHorizontal: 4, paddingVertical: 4, borderBottomWidth: 0.8, borderColor: '#111', fontSize: 5.55, lineHeight: 1.18 },
  signatureLine: { marginHorizontal: 10, marginTop: 16, borderBottomWidth: 0.45, borderColor: '#777' },
  signatureCaption: { marginTop: 3, textAlign: 'center', fontSize: 5.5 },
  bottomNotes: { height: 57, flexDirection: 'row' },
  valueNote: { width: '64%', padding: 3, borderRightWidth: 0.8, borderColor: '#111', fontSize: 5.45, lineHeight: 1.25 },
  fobNote: { width: '36%', padding: 3, fontSize: 5.2, fontFamily: 'Helvetica-Bold', textAlign: 'center', lineHeight: 1.22 },
  cancellation: { marginTop: 5, color: '#e01818', fontSize: 7.2, textAlign: 'center', lineHeight: 1.35 },
  signatures: { marginTop: 17, flexDirection: 'row', paddingHorizontal: 3 },
  company: { width: '34%', fontFamily: 'Times-Roman', fontSize: 9.5, lineHeight: 1.45 },
  signArea: { width: '66%', paddingLeft: 14, paddingTop: 1 },
  signRow: { height: 27, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 0.8, borderColor: '#111', fontSize: 7.2 },
  signLabel: { width: 75, paddingBottom: 2 },
  signDate: { marginLeft: 'auto', width: 48, paddingBottom: 2 },
})

const money = (value: number) => `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Header({ settings, title = 'Order Confirmation' }: { settings: CrmQuotePrintSettings; title?: string }) {
  return <View style={styles.headerBlock} fixed>
    <View style={styles.header}>
      <View style={styles.logoArea}>
        {settings.logoUrl ? <Image style={styles.logo} src={settings.logoUrl} /> : <Text style={styles.brand}>A</Text>}
      </View>
      <View style={styles.brandArea}>
        <Text style={styles.brandName}>
          <Text style={styles.brand}>Arnold </Text>
          <Text style={styles.brandContract}>Contract</Text>
        </Text>
        <Text style={styles.title}>{title}</Text>
      </View>
    </View>
    <Text style={styles.brandContact}>866-425-6529   |   ArnoldContract.us   |   120 Coit Street, Irvington, New Jersey 07111</Text>
    <View style={[styles.rule, { backgroundColor: settings.accentColor || '#0f4c81' }]} />
  </View>
}

const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const

function normalizeBarcodeText(value: string) {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, '-')
    .slice(0, 48) || 'ORDER'
}

function Barcode({ value, showText = true }: { value: string; showText?: boolean }) {
  const normalized = normalizeBarcodeText(value)
  const dataValues = [...normalized].map((character) => character.charCodeAt(0) - 32)
  const checksum = (104 + dataValues.reduce((sum, code, index) => sum + code * (index + 1), 0)) % 103
  const encodedValues = [104, ...dataValues, checksum, 106]
  let cursor = 0
  const bars: Array<{ x: number; width: number }> = []

  for (const code of encodedValues) {
    const pattern = CODE128_PATTERNS[code]
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index])
      if (index % 2 === 0) {
        bars.push({ x: cursor, width })
      }
      cursor += width
    }
  }

  return (
    <View>
      <Svg width={180} height={34} viewBox={`0 0 ${cursor} 34`}>
        {bars.map((bar, index) => (
          <Rect key={`${bar.x}-${index}`} x={bar.x} y={0} width={bar.width} height={34} fill="#101820" />
        ))}
      </Svg>
      {showText ? <Text style={styles.workOrderBarcodeText}>{normalized}</Text> : null}
    </View>
  )
}

function Metadata({ data }: { data: OrderDocumentData }) {
  const customerRows = [
    ['Company', data.companyName],
    ['Contact', data.contactName],
    ['Phone', data.contactPhone],
    ['Email', data.contactEmail],
  ]
  const orderRows = [
    ['Project', data.projectName],
    ['Description', data.description || data.projectName],
    ['Ship To', data.shipTo],
    ['Lead Time', data.leadTime],
    ['Freight', data.freightType],
  ]
  const renderRows = (rows: string[][]) => rows.map(([label, value]) => (
    <View key={label} style={styles.infoRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value || '-'}</Text>
    </View>
  ))

  return <View style={styles.infoPanel} wrap={false}>
    <View style={styles.infoColumn}>{renderRows(customerRows)}</View>
    <View style={styles.infoColumnRight}>{renderRows(orderRows)}</View>
  </View>
}

function Lines({ data }: { data: OrderDocumentData }) {
  const depositPercent = data.depositRequired ? Number(data.depositPercent || 50) : 0
  const depositAmount = data.depositRequired
    ? Number(data.productNet || 0) * (depositPercent / 100)
    : 0

  return <>
    <Text style={styles.sectionTitle}>Order Details</Text>
    <View style={styles.tableHead}><Text style={styles.desc}>Description</Text><Text style={styles.qty}>Qty</Text><Text style={styles.unit}>Unit</Text><Text style={styles.money}>Extended</Text></View>
    {data.lines.length > 0
      ? data.lines.map((line) => <View key={`${line.category}-${line.id}`} style={styles.tableRow} wrap={false}><Text style={styles.desc}>{line.description}</Text><Text style={styles.qty}>{line.qty ?? '-'}</Text><Text style={styles.unit}>{line.unitPrice == null ? '-' : money(line.unitPrice)}</Text><Text style={styles.money}>{money(line.extPrice)}</Text></View>)
      : <View style={styles.tableRow}><Text style={styles.desc}>Order details are not available for this order.</Text><Text style={styles.qty}>-</Text><Text style={styles.unit}>-</Text><Text style={styles.money}>-</Text></View>}
    <View style={styles.totals} wrap={false}>
      {Number(data.discountAmount || 0) > 0 ? <>
        <View style={styles.totalRow}><Text>Product Subtotal</Text><Text>{money(data.productGross ?? data.productNet + Number(data.discountAmount || 0))}</Text></View>
        <View style={styles.totalRow}><Text>Discount ({Number(data.discountPercent || 0).toFixed(2).replace(/\.?0+$/, '')}%)</Text><Text>-{money(Number(data.discountAmount || 0))}</Text></View>
      </> : null}
      <View style={styles.totalRow}><Text>Order Total</Text><Text>{money(data.productNet)}</Text></View>
      {Number(data.freightDiscountAmount || 0) > 0 ? <>
        <View style={styles.totalRow}><Text>Freight Subtotal</Text><Text>{money(data.freightGross ?? data.freightNet + Number(data.freightDiscountAmount || 0))}</Text></View>
        <View style={styles.totalRow}><Text>Freight Discount</Text><Text>-{money(Number(data.freightDiscountAmount || 0))}</Text></View>
      </> : null}
      <View style={styles.totalRow}><Text>Freight Total</Text><Text>{money(data.freightNet)}</Text></View>
      <View style={[styles.totalRow, styles.grandTotalRow]}><Text>Grand Total</Text><Text>{money(data.grandTotal)}</Text></View>
      {data.depositRequired ? <View style={[styles.totalRow, styles.depositTotalRow]}><Text>{Number(depositPercent.toFixed(2))}% Deposit Required</Text><Text>{money(depositAmount)}</Text></View> : null}
    </View>
  </>
}

export function ProformaInvoiceDocument({ data, settings }: { data: OrderDocumentData; settings: CrmQuotePrintSettings }) {
  const depositPercent = data.depositRequired ? Number(data.depositPercent || 50) : 0
  const balanceDueNow = data.depositRequired
    ? Number(data.productNet || 0) * (depositPercent / 100)
    : Number(data.grandTotal || 0)

  return (
    <Document title={`Proforma Invoice ${data.acknowledgmentNumber}`}>
      <Page size="LETTER" style={styles.page} wrap>
        <Header settings={settings} title="Proforma Invoice" />
        <View style={styles.summaryRow} wrap={false}>
          <View style={styles.invoiceDue}>
            <Text style={styles.invoiceDueLabel}>Balance Due Now</Text>
            <Text style={styles.invoiceDueAmount}>{money(balanceDueNow)}</Text>
          </View>
          <View style={styles.referenceBox}>
            <View style={styles.referenceRow}><Text style={styles.referenceLabel}>Invoice Date</Text><Text style={styles.referenceValue}>{data.documentDate || '-'}</Text></View>
            <View style={styles.referenceRow}><Text style={styles.referenceLabel}>P.O. Number</Text><Text style={styles.referenceValue}>{data.poNumber || '-'}</Text></View>
            <View style={styles.referenceRow}><Text style={styles.referenceLabel}>Acknowledgment</Text><Text style={styles.referenceValue}>{data.acknowledgmentNumber || '-'}</Text></View>
          </View>
        </View>
        <Metadata data={data} />
        <Lines data={data} />
        <View style={styles.invoiceNote} wrap={false}>
          <Text>
            {data.depositRequired
              ? `This proforma invoice requests a ${Number(depositPercent.toFixed(2))}% deposit on the product total. Freight is shown in the order balance and is not included in the deposit calculation.`
              : 'No deposit is required. The full order balance is due now.'}
          </Text>
        </View>
        <Text style={styles.footer} fixed>Arnold Contract | 120 Coit Street, Irvington, NJ 07111 | 866-425-6529</Text>
      </Page>
    </Document>
  )
}

export function OrderDocument({ data, settings }: { data: OrderDocumentData; settings: CrmQuotePrintSettings }) {
  const title = 'Order Confirmation'
  const depositPercent = data.depositRequired ? Number(data.depositPercent || 0) : null
  const depositLabel = data.depositRequired
    ? `${Number(depositPercent?.toFixed(2))}% DEPOSIT REQUIRED`
    : 'NO DEPOSIT REQUIRED'
  const depositInstructions = data.depositRequired
    ? settings.depositRequestBody.replace(/\b\d+(?:\.\d+)?%/g, `${Number(depositPercent?.toFixed(2))}%`)
    : 'No deposit is required for this order.'
  return <Document title={`${title} ${data.acknowledgmentNumber}`}>
    <Page size="LETTER" style={styles.page} wrap>
      <Header settings={settings} />
      <View style={styles.summaryRow} wrap={false}>
        <View style={[styles.depositBanner, data.depositRequired ? styles.depositRequired : styles.depositNotRequired]}><Text>{depositLabel}</Text></View>
        <View style={styles.referenceBox}>
          <View style={styles.referenceRow}><Text style={styles.referenceLabel}>Date</Text><Text style={styles.referenceValue}>{data.documentDate || '-'}</Text></View>
          <View style={styles.referenceRow}><Text style={styles.referenceLabel}>P.O. Number</Text><Text style={styles.referenceValue}>{data.poNumber || '-'}</Text></View>
          <View style={styles.referenceRow}><Text style={styles.referenceLabel}>Acknowledgment</Text><Text style={styles.referenceValue}>{data.acknowledgmentNumber || '-'}</Text></View>
        </View>
      </View>
      <Metadata data={data} />
      <Lines data={data} />
      <View wrap={false}>
        <View style={styles.nextSteps}>
          <Text style={styles.nextStepsTitle}>{data.depositRequired ? 'Deposit and Processing Terms and Conditions' : 'Processing Terms and Conditions'}</Text>
          <Text style={styles.nextStepsText}>{depositInstructions}{`\n\n`}{settings.orderConfirmationTerms}{`\n\n`}{settings.depositRequestTerms}</Text>
        </View>
        <Text style={styles.managers}>Project Managers: {settings.projectManagers}</Text>
      </View>
      <Text style={styles.footer} fixed>Arnold Contract | 120 Coit Street, Irvington, NJ 07111 | 866-425-6529</Text>
    </Page>
  </Document>
}

export function ChangeOrderDocument({
  data,
  settings,
  version,
}: {
  data: OrderDocumentData
  settings: CrmQuotePrintSettings
  version: number
}) {
  return (
    <Document title={`Change Order V${version} ${data.acknowledgmentNumber}`}>
      <Page size="LETTER" style={styles.page} wrap>
        <Header settings={settings} title={`Change Order — Version ${version}`} />
        <View style={styles.summaryRow} wrap={false}>
          <View style={[styles.depositBanner, styles.depositNotRequired]}>
            <Text>CUSTOMER APPROVAL REQUIRED</Text>
          </View>
          <View style={styles.referenceBox}>
            <View style={styles.referenceRow}><Text style={styles.referenceLabel}>Date</Text><Text style={styles.referenceValue}>{data.documentDate || '-'}</Text></View>
            <View style={styles.referenceRow}><Text style={styles.referenceLabel}>P.O. Number</Text><Text style={styles.referenceValue}>{data.poNumber || '-'}</Text></View>
            <View style={styles.referenceRow}><Text style={styles.referenceLabel}>Acknowledgment</Text><Text style={styles.referenceValue}>{data.acknowledgmentNumber || '-'}</Text></View>
          </View>
        </View>
        <Metadata data={data} />
        <Lines data={{ ...data, depositRequired: false, depositPercent: null }} />
        <View style={styles.nextSteps} wrap={false}>
          <Text style={styles.nextStepsTitle}>Change Order Approval</Text>
          <Text style={styles.nextStepsText}>
            This document replaces the prior order details only after it is signed by the customer and accepted by Arnold Contract. Production paperwork will remain on hold until the customer-signed change order is uploaded.
          </Text>
        </View>
        <Text style={styles.footer} fixed>Arnold Contract | 120 Coit Street, Irvington, NJ 07111 | 866-425-6529</Text>
      </Page>
    </Document>
  )
}

function WorkOrderDetails({ data }: { data: OrderDocumentData }) {
  const productionLines = data.lines.filter((line) => line.category !== 'freight')

  return (
    <>
      <View style={styles.workOrderSummary} wrap={false}>
        <View style={styles.workOrderSummaryInfo}>
          <View style={styles.infoRow}>
            <Text style={styles.workOrderLabel}>Company</Text>
            <Text style={styles.value}>{data.companyName || '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.workOrderLabel}>Project</Text>
            <Text style={styles.value}>{data.projectName || '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.workOrderLabel}>Acknowledgment</Text>
            <Text style={styles.value}>{data.acknowledgmentNumber || '-'}</Text>
          </View>
        </View>
        <View style={styles.workOrderBarcodeArea}>
          <Barcode value={data.acknowledgmentNumber} showText={false} />
        </View>
      </View>

      <View style={styles.workOrderDescription} wrap={false}>
        <Text style={styles.workOrderDescriptionLabel}>Project Description</Text>
        <Text style={styles.workOrderDescriptionValue}>{data.description || data.projectName || '-'}</Text>
      </View>

      <Text style={styles.sectionTitle}>Work Order Details</Text>
      <View style={styles.tableHead}>
        <Text style={styles.workOrderDesc}>Description</Text>
        <Text style={styles.workOrderQty}>Quantity</Text>
      </View>
      {productionLines.length > 0
        ? productionLines.map((line) => (
          <View key={`${line.category}-${line.id}`} style={styles.tableRow} wrap={false}>
            <Text style={styles.workOrderDesc}>{line.description}</Text>
            <Text style={styles.workOrderQty}>{line.qty ?? '-'}</Text>
          </View>
        ))
        : (
          <View style={styles.tableRow}>
            <Text style={styles.workOrderDesc}>Order details are not available for this order.</Text>
            <Text style={styles.workOrderQty}>-</Text>
          </View>
        )}
    </>
  )
}

export function WorkOrderDocument({ data, settings }: { data: OrderDocumentData; settings: CrmQuotePrintSettings }) {
  const title = Number(data.changeVersion || 0) > 0
    ? `Work Order — Change Version ${Number(data.changeVersion)}`
    : 'Work Order'

  return (
    <Document title={`Work Order ${data.acknowledgmentNumber}`}>
      <Page size="LETTER" style={styles.page} wrap>
        <Header settings={settings} title={title} />
        <WorkOrderDetails data={data} />
        <Text style={styles.footer} fixed>Arnold Contract | 120 Coit Street, Irvington, NJ 07111 | 866-425-6529</Text>
      </Page>
    </Document>
  )
}

function bolDate(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized) return '-'

  const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!dateOnly) return normalized

  return `${Number(dateOnly[2])}/${Number(dateOnly[3])}/${dateOnly[1]}`
}

function bolAddress(data: OrderDocumentData) {
  return [data.companyName, data.contactName, data.contactPhone, data.contactEmail]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n') || '-'
}

function resolveFreightSelection(data: OrderDocumentData) {
  const freight = String(data.freightType || '').toLowerCase()
  if (/third|3rd/.test(freight)) return '3rd Party'
  if (/collect/.test(freight)) return 'Frt Collected'
  if (/government|gov[\s'.-]*t/.test(freight)) return "Gov't Rates"
  if (/prepaid/.test(freight)) return 'Frt Prepaid'
  return ''
}

export function BillOfLadingDocument({ data }: { data: OrderDocumentData }) {
  const freightSelection = resolveFreightSelection(data)
  const productLines = data.lines.filter((line) => line.category !== 'freight')
  const soldTo = bolAddress(data)
  const freightLabels = ['Frt Collected', 'Frt Prepaid', '3rd Party', "Gov't Rates"]

  return (
    <Document title={`Bill of Lading ${data.acknowledgmentNumber}`}>
      <Page size={{ width: 612, height: 792 }} style={bolStyles.page}>
        <View style={bolStyles.border}>
          <Text style={bolStyles.title}>STRAIGHT BILL OF LADING - SHORT FORM</Text>
          <Text style={bolStyles.subtitle}>ORIGINAL - NOT NEGOTIABLE</Text>
          <Text style={bolStyles.received}>RECEIVED, subject to the classification and tariffs in effect on the date of the issue of this Bill of Lading</Text>
          <View style={bolStyles.fromRow}>
            <Text style={[bolStyles.darkLabel, { width: 54 }]}>Date</Text>
            <Text style={{ width: 122, paddingTop: 9, paddingHorizontal: 5 }}>{bolDate(data.documentDate)}</Text>
            <Text style={[bolStyles.darkLabel, { width: 88 }]}>From</Text>
            <Text style={bolStyles.fromValue}>Arnold Kolax Furniture, Inc.     Irvington, NJ 07111</Text>
          </View>
          <View style={bolStyles.legalIntro}>
            <Text>The property described below in apparent good order, except as noted (contents and condition of contents of packages unknown), marked, consigned, and destined as indicated below, which said carrier (the word carrier being understood throughout this contract as meaning any person or corporation in possession of the property under the contract) agrees to carry to its usual place of delivery at said destination, if on its route, otherwise to deliver to another carrier on the route to said destination.</Text>
            <Text>It is mutually agreed, as to each carrier of all or any said property over all or any portion of said route to destination, and as to each party at any time interested in all or any of said property, that every service to be performed hereunder shall be subject to all the terms and conditions of the United Domestic Straight Bill of Lading set forth (1) in Uniform Freight Classification in effect on the date hereof, if this is a rail or rail-water shipment, or (2) in the applicable motor carrier classification or tariff if this is a motor carrier shipment.</Text>
            <Text style={bolStyles.certification}>Shipper hereby certifies that he is familiar with all the terms and conditions of said bill of lading, including those on the back thereof, set forth in the classification or tariff which governs the transportation of this shipment, and the said terms and conditions are hereby agreed to by the shipper and accepted for himself and his assigns.</Text>
          </View>
          <View style={bolStyles.partiesRow}>
            <View style={bolStyles.partyBox}>
              <Text style={bolStyles.partyHeader}>Sold To</Text>
              <Text style={bolStyles.partyValue}>{soldTo}</Text>
            </View>
            <View style={bolStyles.partyBox}>
              <Text style={bolStyles.partyHeader}>Ship To</Text>
              <Text style={bolStyles.partyValue}>{data.shipTo || '-'}</Text>
            </View>
            <View style={bolStyles.freightBox}>
              {freightLabels.map((label) => (
                <View key={label} style={bolStyles.freightRow}>
                  <Text style={bolStyles.freightCheck}>{freightSelection === label ? 'X' : ''}</Text>
                  <Text style={bolStyles.freightLabel}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={bolStyles.refsRow}>
            {[
              ['Rep', data.salesRep, 52],
              ['Cust. PO Date', bolDate(data.poDate || data.documentDate), 66],
              ['Cust. PO #', data.poNumber, 100],
              ['Ack Date', bolDate(data.acknowledgmentDate || data.documentDate), 60],
              ['ACK #', data.acknowledgmentNumber, 55],
              ['Estimated Ready Date', bolDate(data.estimatedReadyDate), 110],
              ['Ship Via', data.freightType, 105],
            ].map(([label, value, width]) => (
              <View key={String(label)} style={[bolStyles.refCell, { width: Number(width) }]}>
                <Text style={bolStyles.refHeader}>{label}</Text>
                <Text style={bolStyles.refValue}>{String(value || '-')}</Text>
              </View>
            ))}
          </View>
          <View style={bolStyles.detailsRow}>
            <View style={bolStyles.itemsArea}>
              <View style={bolStyles.itemHeader}>
                <Text style={[bolStyles.itemHeaderCell, { width: 40 }]}>Qty</Text>
                <Text style={[bolStyles.itemHeaderCell, { width: 78 }]}>Item</Text>
                <Text style={[bolStyles.itemHeaderCell, { flex: 1, borderRightWidth: 0 }]}>Description</Text>
              </View>
              {(productLines.length ? productLines : [{ id: '-', qty: null, description: 'Order details are not available.', category: 'product' as const, unitPrice: null, extPrice: 0 }]).map((line) => (
                <View key={`${line.category}-${line.id}`} style={bolStyles.itemRow}>
                  <Text style={[bolStyles.itemCell, { width: 40, textAlign: 'center' }]}>{line.qty ?? '-'}</Text>
                  <Text style={[bolStyles.itemCell, { width: 78 }]}>{line.id || '-'}</Text>
                  <Text style={[bolStyles.itemCell, { flex: 1, borderRightWidth: 0 }]}>{line.description}</Text>
                </View>
              ))}
            </View>
            <View style={bolStyles.termsArea}>
              <View style={[bolStyles.termsBlock, { height: 113 }]}>
                <Text>Subject to Section 7 of Conditions of applicable bill of lading, if this shipment is to be delivered to the consignee without recourse on the consignor, the consignor shall sign the following statement:</Text>
                <Text style={{ marginTop: 5 }}>The carrier shall not make delivery of this shipment without payment of freight and other lawful charges.</Text>
                <View style={[bolStyles.signatureLine, { marginTop: 10 }]} />
                <Text style={bolStyles.signatureCaption}>(Signature of consignor)</Text>
              </View>
              <View style={[bolStyles.termsBlock, { height: 51 }]}>
                <Text>If charges are to be prepaid, write or stamp here "To be prepaid"</Text>
                <View style={[bolStyles.signatureLine, { marginTop: 18 }]} />
              </View>
              <View style={[bolStyles.termsBlock, { height: 81 }]}>
                <Text>Received $______________________________</Text>
                <Text>to apply in prepayment of the charges on the property described hereon.</Text>
                <Text style={{ marginTop: 16 }}>Per _________________________________</Text>
                <Text>(Agent or Cashier)</Text>
              </View>
              <View style={[bolStyles.termsBlock, { height: 40, borderBottomWidth: 0 }]}>
                <Text>Charges Advanced:</Text>
                <Text style={{ marginTop: 9 }}>$ __________________________________</Text>
              </View>
            </View>
          </View>
          <View style={bolStyles.bottomNotes}>
            <View style={bolStyles.valueNote}>
              <Text>*If the shipment moves between two ports by a carrier by water, the law requires that the bill of lading shall state whether it is a carrier's or shipper's weight.</Text>
              <Text>NOTE - Where the rate is dependent on value, shippers are required to state specifically in writing the agreed or declared value of the property.</Text>
              <Text>The agreed or declared value of the property is hereby specifically stated by the shipper to be not exceeding __________________________.</Text>
            </View>
            <View style={bolStyles.fobNote}>
              <Text>+Shipper's imprint in lieu of stamp: not a part of Bill of Lading approved by the Interstate Commerce Commission.</Text>
              <Text>ALL GOODS SOLD F.O.B. IRVINGTON, N.J. PRODUCING POINT. THE TRANSPORTATION COMPANY IS YOUR AGENT AND ALL DAMAGE CLAIMS MUST BE REPORTED TO THEM IMMEDIATELY UPON RECEIPT OF MERCHANDISE. ALL MERCHANDISE SHIPPED BLANKET WRAPPED EXCEPT IN AREAS NOT SERVICED BY OUR LOCAL CARRIER, TO THOSE ITEMS A CRATING CHARGE WILL BE ADDED.</Text>
            </View>
          </View>
        </View>
        <Text style={bolStyles.cancellation}>PLEASE NOTE: CUSTOM MADE AND CUSTOM FINISHED FURNITURE CANNOT BE CANCELLED OR RETURNED.{`\n`}RETURN WITHOUT AUTHORIZATION NUMBER WILL NOT BE ACCEPTED.</Text>
        <View style={bolStyles.signatures}>
          <Text style={bolStyles.company}>ARNOLD KOLAX FURNITURE, INC{`\n`}120 COIT STREET{`\n`}IRVINGTON{`\n`}973-375-8101</Text>
          <View style={bolStyles.signArea}>
            <View style={bolStyles.signRow}><Text style={bolStyles.signLabel}>CARRIER{`\n`}SIGNATURE</Text><Text style={bolStyles.signDate}>DATE</Text></View>
            <View style={bolStyles.signRow}><Text style={bolStyles.signLabel}>CUSTOMER{`\n`}SIGNATURE</Text><Text style={bolStyles.signDate}>DATE</Text></View>
          </View>
        </View>
      </Page>
    </Document>
  )
}

async function resolveArnoldMarkUrl() {
  const markPath = '/arnold-quote-mark.png'

  if (typeof window === 'undefined') {
    return markPath
  }

  const absoluteUrl = `${window.location.origin}${markPath}`

  try {
    const response = await fetch(absoluteUrl, { cache: 'force-cache' })
    if (!response.ok) return absoluteUrl
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || absoluteUrl))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return absoluteUrl
  }
}

async function normalizeDocumentSettings(settings: CrmQuotePrintSettings) {
  return {
    ...settings,
    logoUrl: await resolveArnoldMarkUrl(),
  }
}

export async function buildOrderDocumentBlob(data: OrderDocumentData, settings: CrmQuotePrintSettings) {
  const normalizedSettings = await normalizeDocumentSettings(settings)
  return pdf(<OrderDocument data={data} settings={normalizedSettings} />).toBlob()
}

export async function buildWorkOrderDocumentBlob(data: OrderDocumentData, settings: CrmQuotePrintSettings) {
  const normalizedSettings = await normalizeDocumentSettings(settings)
  return pdf(<WorkOrderDocument data={data} settings={normalizedSettings} />).toBlob()
}

export async function buildProformaInvoiceBlob(data: OrderDocumentData, settings: CrmQuotePrintSettings) {
  const normalizedSettings = await normalizeDocumentSettings(settings)
  return pdf(<ProformaInvoiceDocument data={data} settings={normalizedSettings} />).toBlob()
}

export async function buildBillOfLadingBlob(data: OrderDocumentData) {
  return pdf(<BillOfLadingDocument data={data} />).toBlob()
}

export async function buildChangeOrderDocumentBlob(
  data: OrderDocumentData,
  settings: CrmQuotePrintSettings,
  version: number,
) {
  const normalizedSettings = await normalizeDocumentSettings(settings)
  return pdf(
    <ChangeOrderDocument data={data} settings={normalizedSettings} version={version} />,
  ).toBlob()
}

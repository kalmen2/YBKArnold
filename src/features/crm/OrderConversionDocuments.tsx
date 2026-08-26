/* eslint-disable react-refresh/only-export-components */
import { Document, Image, Page, Rect, StyleSheet, Svg, Text, View, pdf } from '@react-pdf/renderer'
import type { CrmDocumentTerm, CrmDocumentType, CrmQuotePrintSettings } from './api'

export type OrderDocumentTerms = Partial<Record<CrmDocumentType, CrmDocumentTerm[]>>

export function groupOrderDocumentTerms(terms: CrmDocumentTerm[]) {
  return terms
    .filter((term) => term.appliesToDealer ?? term.isDefault)
    .reduce<OrderDocumentTerms>((grouped, term) => {
      grouped[term.documentType] = [...(grouped[term.documentType] || []), term]
      return grouped
    }, {})
}

export type OrderDocumentLine = {
  id: string
  parentLineId?: string | null
  detailLabel?: string | null
  description: string
  qty: number | null
  unitPrice: number | null
  extPrice: number
  category: 'product' | 'additional' | 'freight'
}

function orderLineDocumentText(line: OrderDocumentLine) {
  return [line.detailLabel, line.description]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join('\n')
}

function mergeOrderDocumentSublines(lines: OrderDocumentLine[]) {
  const mainLineIds = new Set(lines.filter((line) => !line.parentLineId).map((line) => line.id))

  return lines
    .filter((line) => !line.parentLineId || !mainLineIds.has(line.parentLineId))
    .map((line) => {
      const sublines = lines
        .filter((candidate) => candidate.parentLineId === line.id)
        .map((candidate) => ({
          detailLabel: String(candidate.detailLabel ?? '').trim(),
          description: String(candidate.description ?? '').trim(),
        }))
        .filter((candidate) => candidate.detailLabel || candidate.description)

      return {
        ...line,
        sublines,
      }
    })
}

const estimateOrderDocumentTextWidth = (value: string) => Array.from(value).reduce((width, character) => {
  if (character === ' ') return width + 2.5
  if (/[ilI.,'`!|:;]/.test(character)) return width + 2.2
  if (/[MW@%&]/.test(character)) return width + 7.5
  if (/[A-Z0-9]/.test(character)) return width + 5.7
  return width + 4.6
}, 0)

function orderDocumentDetailColumnWidth(labels: string[]) {
  const longestLabel = labels
    .flatMap((label) => label.replace(/\r\n?/g, '\n').split('\n'))
    .reduce((longest, label) => Math.max(longest, estimateOrderDocumentTextWidth(label)), 0)

  return Math.min(Math.max(longestLabel + 4, 40), 116)
}

function lineRequiresControlSample(line: Pick<OrderDocumentLine, 'description'>) {
  return /\b(?:stain\s+to\s+match|paint\s+sample)\b/i.test(String(line.description ?? ''))
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
  shipmentDate?: string
  carrier?: string
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
  achBox: { marginTop: 8, borderWidth: 1, borderColor: '#cbd6df', backgroundColor: '#f7f9fb' },
  achHeader: { paddingVertical: 5, paddingHorizontal: 10, backgroundColor: '#0f4c81', color: '#fff' },
  achTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', letterSpacing: 0.35, textTransform: 'uppercase' },
  achContent: { flexDirection: 'row', height: 76 },
  achInstructions: { width: '53%', paddingVertical: 7, paddingHorizontal: 10 },
  achIntro: { fontSize: 7.4, color: '#334a5f', lineHeight: 1.3, marginBottom: 4 },
  achBulletRow: { flexDirection: 'row', marginBottom: 1.6 },
  achBullet: { width: 10, color: '#b51f2e', fontFamily: 'Helvetica-Bold' },
  achBulletText: { flex: 1, fontSize: 7.2, color: '#15283b' },
  achBankDetails: { width: '47%', paddingVertical: 7, paddingHorizontal: 10, borderLeftWidth: 1, borderLeftColor: '#cbd6df', backgroundColor: '#fff' },
  achBankRow: { flexDirection: 'row', marginBottom: 2.3, lineHeight: 1.15 },
  achBankLabel: { width: 58, fontSize: 6.4, color: '#66788a', textTransform: 'uppercase' },
  achBankValue: { flex: 1, fontSize: 7.2, fontFamily: 'Helvetica-Bold', color: '#15283b' },
  orderConfirmationBottom: { marginTop: 'auto', paddingTop: 10 },
  depositBanner: { width: '60%', marginRight: 8, paddingVertical: 11, paddingHorizontal: 10, textAlign: 'center', fontSize: 10.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.7, justifyContent: 'center' },
  depositRequired: { backgroundColor: '#f9ecee', color: '#a9192d', borderLeftWidth: 4, borderLeftColor: '#b51f2e' },
  depositNotRequired: { backgroundColor: '#eef4f8', color: '#0f4c81', borderLeftWidth: 4, borderLeftColor: '#0f4c81' },
  sectionTitle: { marginTop: 12, marginBottom: 6, fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: '#0f4c81' },
  tableHead: { flexDirection: 'row', backgroundColor: '#0f4c81', color: '#fff', padding: 6 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#dbe3ea', padding: 6 },
  sublineRow: { paddingLeft: 14, backgroundColor: '#fbfdff' },
  item: { width: '7%', textAlign: 'center', paddingRight: 4 }, desc: { width: '48%', paddingRight: 7 }, qty: { width: '10%', textAlign: 'right', paddingRight: 5 }, unit: { width: '17.5%', textAlign: 'right', paddingRight: 8 }, money: { width: '17.5%', textAlign: 'right' },
  lineDescriptionHeading: { fontFamily: 'Helvetica-Bold', fontSize: 9.6, color: '#172033' },
  lineDescriptionDetailRow: { flexDirection: 'row' },
  lineDescriptionFirstDetailRow: { marginTop: 4 },
  lineDescriptionDetailLabel: { flexShrink: 0, paddingRight: 9, color: '#26384a' },
  lineDescriptionDetailBody: { color: '#15283b' },
  lineDescriptionSampleNotice: { color: '#b51f2e', marginTop: 1 },
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
  page: { paddingTop: 92, paddingBottom: 26, paddingHorizontal: 38, fontFamily: 'Helvetica', fontSize: 6.5, color: '#15283b' },
  original: { marginTop: 1, marginBottom: 6, color: '#b51f2e', fontFamily: 'Helvetica-Bold', fontSize: 7.3, letterSpacing: 0.7, textAlign: 'center' },
  identityRow: { minHeight: 37, flexDirection: 'row', borderWidth: 1, borderColor: '#cbd6df', backgroundColor: '#f7f9fb' },
  identityCell: { paddingHorizontal: 7, paddingVertical: 5, borderRightWidth: 1, borderRightColor: '#cbd6df' },
  identityLabel: { color: '#66788a', fontSize: 5.7, textTransform: 'uppercase', letterSpacing: 0.45 },
  identityValue: { marginTop: 3, fontFamily: 'Helvetica-Bold', fontSize: 7.4, lineHeight: 1.15 },
  partiesRow: { minHeight: 72, flexDirection: 'row', marginTop: 6, borderWidth: 1, borderColor: '#cbd6df' },
  partyBox: { width: '50%' },
  partyBoxRight: { width: '50%', borderLeftWidth: 1, borderLeftColor: '#cbd6df' },
  partyHeader: { height: 18, backgroundColor: '#0f4c81', color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 7.4, paddingHorizontal: 8, paddingTop: 5, textTransform: 'uppercase', letterSpacing: 0.35 },
  partyValue: { paddingHorizontal: 8, paddingVertical: 6, fontSize: 7, lineHeight: 1.3 },
  refsRow: { minHeight: 38, flexDirection: 'row', marginTop: 6, borderWidth: 1, borderColor: '#cbd6df' },
  refCell: { paddingHorizontal: 5, paddingVertical: 5, borderRightWidth: 1, borderRightColor: '#cbd6df' },
  refHeader: { color: '#66788a', fontSize: 5.4, textTransform: 'uppercase', letterSpacing: 0.25 },
  refValue: { marginTop: 4, fontFamily: 'Helvetica-Bold', fontSize: 6.6, lineHeight: 1.12 },
  freightRow: { minHeight: 34, flexDirection: 'row', alignItems: 'stretch', marginTop: 5, borderWidth: 1, borderColor: '#cbd6df', backgroundColor: '#f7f9fb' },
  freightCell: { paddingHorizontal: 6, paddingVertical: 5, borderRightWidth: 1, borderRightColor: '#cbd6df' },
  freightValue: { marginTop: 3, fontFamily: 'Helvetica-Bold', color: '#0f4c81', fontSize: 6.8 },
  sectionTitle: { marginTop: 8, paddingVertical: 5, paddingHorizontal: 7, backgroundColor: '#0f4c81', color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 7.2, textTransform: 'uppercase', letterSpacing: 0.4 },
  itemsTable: { minHeight: 245, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#cbd6df' },
  itemHeader: { height: 19, flexDirection: 'row', backgroundColor: '#e8eef3', color: '#334a5f', fontFamily: 'Helvetica-Bold', fontSize: 5.8 },
  itemHeaderCell: { paddingTop: 5.5, textAlign: 'center', borderRightWidth: 1, borderRightColor: '#cbd6df', textTransform: 'uppercase' },
  itemRow: { minHeight: 25, flexDirection: 'row', borderTopWidth: 0.6, borderTopColor: '#dbe3ea', fontSize: 6.25 },
  itemCell: { paddingHorizontal: 4, paddingVertical: 4, borderRightWidth: 0.6, borderRightColor: '#dbe3ea', lineHeight: 1.22 },
  itemSummary: { minHeight: 27, flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#cbd6df', backgroundColor: '#f7f9fb' },
  itemSummaryCell: { paddingHorizontal: 5, paddingVertical: 5, borderRightWidth: 1, borderRightColor: '#cbd6df' },
  customNotice: { marginTop: 6, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: '#f9ecee', borderLeftWidth: 4, borderLeftColor: '#b51f2e' },
  customNoticeTitle: { color: '#a9192d', fontFamily: 'Helvetica-Bold', fontSize: 7.2, textTransform: 'uppercase', letterSpacing: 0.3 },
  customNoticeText: { marginTop: 3, color: '#5b2730', fontSize: 6.2, lineHeight: 1.28 },
  signatures: { marginTop: 7, flexDirection: 'row', borderWidth: 1, borderColor: '#cbd6df' },
  signatureBox: { width: '33.333%', minHeight: 74, paddingHorizontal: 7, paddingVertical: 6, borderRightWidth: 1, borderRightColor: '#cbd6df' },
  signatureTitle: { fontFamily: 'Helvetica-Bold', color: '#0f4c81', fontSize: 6.7, textTransform: 'uppercase' },
  signatureHelp: { marginTop: 2, minHeight: 15, color: '#66788a', fontSize: 5.2, lineHeight: 1.15 },
  signatureLine: { marginTop: 13, borderBottomWidth: 0.65, borderBottomColor: '#607284' },
  signatureCaption: { marginTop: 2, fontSize: 5.1, color: '#607284' },
  signatureMeta: { marginTop: 7, flexDirection: 'row', fontSize: 5.2, color: '#607284' },
  terms: { marginTop: 7, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: '#cbd6df', backgroundColor: '#f7f9fb' },
  termsTitle: { marginBottom: 4, fontFamily: 'Helvetica-Bold', color: '#0f4c81', fontSize: 6.8, textTransform: 'uppercase', letterSpacing: 0.35 },
  termsColumns: { flexDirection: 'row' },
  termsColumn: { width: '50%', paddingRight: 6 },
  termsColumnRight: { width: '50%', paddingLeft: 6, borderLeftWidth: 1, borderLeftColor: '#d5dee6' },
  term: { marginBottom: 3, fontSize: 4.85, lineHeight: 1.22, textAlign: 'justify' },
  termLabel: { fontFamily: 'Helvetica-Bold' },
  nonRecourse: { marginTop: 3, paddingTop: 3, borderTopWidth: 0.6, borderTopColor: '#d5dee6', fontSize: 4.85, lineHeight: 1.22 },
  bottomBlock: { marginTop: 'auto', backgroundColor: '#fff' },
  footer: { position: 'absolute', left: 38, right: 38, bottom: 20, textAlign: 'center', color: '#607284', fontSize: 5.2 },
})

const money = (value: number) => `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function termsForDocument(terms: OrderDocumentTerms | undefined, documentType: CrmDocumentType) {
  return Array.isArray(terms?.[documentType]) ? terms[documentType] || [] : []
}

function termText(term: CrmDocumentTerm) {
  return `${term.title.toUpperCase()}. ${term.body}`
}

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

function AchRemittanceInformation() {
  const remittanceDetails = [
    'Customer name',
    'Acknowledgment number',
    'Invoice number',
    'Any additional information needed for processing',
  ]
  const bankDetails = [
    ['Bank', 'JPMorgan Chase Bank, N.A.'],
    ['Address', '270 Park Avenue, New York, NY 10017'],
    ['Telephone', '1 (800) 935-9935'],
    ['Routing #', '021000021'],
    ['Account #', '2908362951'],
  ]

  return <View style={styles.achBox} wrap={false}>
    <View style={styles.achHeader}>
      <Text style={styles.achTitle}>ACH Remittance Information</Text>
    </View>
    <View style={styles.achContent}>
      <View style={styles.achInstructions}>
        <Text style={styles.achIntro}>
          To ensure prompt and accurate payment processing, please send a remittance notification to Arnold Contract that includes:
        </Text>
        {remittanceDetails.map((detail) => <View key={detail} style={styles.achBulletRow}>
          <Text style={styles.achBullet}>-</Text>
          <Text style={styles.achBulletText}>{detail}</Text>
        </View>)}
      </View>
      <View style={styles.achBankDetails}>
        {bankDetails.map(([label, value]) => <View key={label} style={styles.achBankRow}>
          <Text style={styles.achBankLabel}>{label}</Text>
          <Text style={styles.achBankValue}>{value}</Text>
        </View>)}
      </View>
    </View>
  </View>
}

function Lines({ data }: { data: OrderDocumentData }) {
  const lines = mergeOrderDocumentSublines(data.lines)
  const depositPercent = data.depositRequired ? Number(data.depositPercent || 50) : 0
  const depositAmount = data.depositRequired
    ? Number(data.productNet || 0) * (depositPercent / 100)
    : 0

  return <>
    <Text style={styles.sectionTitle}>Order Details</Text>
    <View style={styles.tableHead}><Text style={styles.item}>Item</Text><Text style={styles.desc}>Description</Text><Text style={styles.qty}>Qty</Text><Text style={styles.unit}>Unit</Text><Text style={styles.money}>Extended</Text></View>
    {lines.length > 0
      ? lines.map((line, index) => <View key={`${line.category}-${line.id}`} style={styles.tableRow} wrap={false}>
        <Text style={styles.item}>{index + 1}</Text>
        <View style={styles.desc}>
          <OrderLineDescription line={line} />
        </View>
        <Text style={styles.qty}>{line.qty ?? '-'}</Text>
        <Text style={styles.unit}>{line.unitPrice == null ? '-' : money(line.unitPrice)}</Text>
        <Text style={styles.money}>{money(line.extPrice)}</Text>
      </View>)
      : <View style={styles.tableRow}><Text style={styles.item}>-</Text><Text style={styles.desc}>Order details are not available for this order.</Text><Text style={styles.qty}>-</Text><Text style={styles.unit}>-</Text><Text style={styles.money}>-</Text></View>}
    <View style={styles.totals} wrap={false}>
      {Number(data.discountAmount || 0) > 0 ? <>
        <View style={styles.totalRow}><Text>Product Subtotal</Text><Text>{money(data.productGross ?? data.productNet + Number(data.discountAmount || 0))}</Text></View>
        <View style={styles.totalRow}><Text>Discount ({Number(data.discountPercent || 0).toFixed(2).replace(/\.?0+$/, '')}%)</Text><Text>-{money(Number(data.discountAmount || 0))}</Text></View>
      </> : null}
      <View style={styles.totalRow}><Text>Order Total</Text><Text>{money(data.productNet)}</Text></View>
      {data.depositRequired ? <View style={[styles.totalRow, styles.depositTotalRow]}><Text>{Number(depositPercent.toFixed(2))}% Deposit Required</Text><Text>{money(depositAmount)}</Text></View> : null}
      {Number(data.freightDiscountAmount || 0) > 0 ? <>
        <View style={styles.totalRow}><Text>Freight Subtotal</Text><Text>{money(data.freightGross ?? data.freightNet + Number(data.freightDiscountAmount || 0))}</Text></View>
        <View style={styles.totalRow}><Text>Freight Discount</Text><Text>-{money(Number(data.freightDiscountAmount || 0))}</Text></View>
      </> : null}
      <View style={styles.totalRow}><Text>Freight Total</Text><Text>{money(data.freightNet)}</Text></View>
      <View style={[styles.totalRow, styles.grandTotalRow]}><Text>Grand Total</Text><Text>{money(data.grandTotal)}</Text></View>
    </View>
  </>
}

function OrderLineDescription({ line }: { line: ReturnType<typeof mergeOrderDocumentSublines>[number] }) {
  const description = String(line.description ?? '').replace(/\r\n?/g, '\n')
  const [heading = '', ...detailLines] = description.split('\n')
  const details = detailLines.join('\n')
  const detailLabel = String(line.detailLabel ?? '').trim()
  const detailRows = [
    { label: detailLabel, body: details },
    ...line.sublines.map((subline) => ({
      label: subline.detailLabel,
      body: subline.description,
    })),
  ].filter((row) => row.label || row.body)
  const detailColumnWidth = orderDocumentDetailColumnWidth(
    detailRows.filter((row) => row.label && row.body).map((row) => row.label),
  )

  return <View>
    {heading ? <Text style={styles.lineDescriptionHeading}>{heading}</Text> : null}
    {detailRows.map((row, index) => (
      <View key={`${row.label}-${row.body}-${index}`} style={[
        styles.lineDescriptionDetailRow,
        ...(index === 0 && heading ? [styles.lineDescriptionFirstDetailRow] : []),
      ]}>
        {row.label && row.body ? <>
          <Text style={[styles.lineDescriptionDetailLabel, { width: detailColumnWidth }]}>{row.label}</Text>
          <Text style={[styles.lineDescriptionDetailBody, { width: 248 - detailColumnWidth }]}>{row.body}</Text>
        </> : <Text style={styles.lineDescriptionDetailBody}>{row.label || row.body}</Text>}
      </View>
    ))}
    {lineRequiresControlSample(line) ? <Text style={styles.lineDescriptionSampleNotice}>
      Control sample required: Please send the control sample to Arnold Contract and clearly mark the package with your acknowledgement number.
    </Text> : null}
  </View>
}

export function ProformaInvoiceDocument({ data, settings, terms }: { data: OrderDocumentData; settings: CrmQuotePrintSettings; terms?: OrderDocumentTerms }) {
  const depositPercent = data.depositRequired ? Number(data.depositPercent || 50) : 0
  const balanceDueNow = data.depositRequired
    ? Number(data.productNet || 0) * (depositPercent / 100)
    : Number(data.grandTotal || 0)
  const documentTerms = termsForDocument(terms, 'proforma_invoice')

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
        {documentTerms.length ? (
          <View style={styles.nextSteps} wrap={false}>
            <Text style={styles.nextStepsTitle}>Terms and Conditions</Text>
            <Text style={styles.nextStepsText}>{documentTerms.map(termText).join('\n\n')}</Text>
          </View>
        ) : null}
        <Text style={styles.footer} fixed>Arnold Contract | 120 Coit Street, Irvington, NJ 07111 | 866-425-6529</Text>
      </Page>
    </Document>
  )
}

export function OrderDocument({ data, settings, terms }: { data: OrderDocumentData; settings: CrmQuotePrintSettings; terms?: OrderDocumentTerms }) {
  const title = 'Order Confirmation'
  const depositPercent = data.depositRequired ? Number(data.depositPercent || 0) : null
  const depositLabel = data.depositRequired
    ? `${Number(depositPercent?.toFixed(2))}% DEPOSIT REQUIRED`
    : 'NO DEPOSIT REQUIRED'
  const depositInstructions = data.depositRequired
    ? settings.depositRequestBody.replace(/\b\d+(?:\.\d+)?%/g, `${Number(depositPercent?.toFixed(2))}%`)
    : 'No deposit is required for this order.'
  const configuredTerms = termsForDocument(terms, 'order_confirmation')
  const conditionsText = terms
    ? configuredTerms.map(termText).join('\n\n')
    : `${settings.orderConfirmationTerms}\n\n${settings.depositRequestTerms}`
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
      <View style={styles.orderConfirmationBottom}>
        <View wrap={false}>
          <AchRemittanceInformation />
          <View style={styles.nextSteps}>
            <Text style={styles.nextStepsTitle}>{data.depositRequired ? 'Deposit and Processing Terms and Conditions' : 'Processing Terms and Conditions'}</Text>
            <Text style={styles.nextStepsText}>{depositInstructions}{`\n\n`}{conditionsText}</Text>
          </View>
          <Text style={styles.managers}>Project Managers: {settings.projectManagers}</Text>
        </View>
      </View>
      <Text style={styles.footer} fixed>Arnold Contract | 120 Coit Street, Irvington, NJ 07111 | 866-425-6529</Text>
    </Page>
  </Document>
}

export function ChangeOrderDocument({
  data,
  settings,
  terms,
  version,
}: {
  data: OrderDocumentData
  settings: CrmQuotePrintSettings
  terms?: OrderDocumentTerms
  version: number
}) {
  const configuredTerms = termsForDocument(terms, 'change_order')
  const approvalText = terms
    ? configuredTerms.map(termText).join('\n\n')
    : 'This document replaces the prior order details only after it is signed by the customer and accepted by Arnold Contract. Production paperwork will remain on hold until the customer-signed change order is uploaded.'
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
        {approvalText ? <View style={styles.nextSteps} wrap={false}>
          <Text style={styles.nextStepsTitle}>Change Order Approval</Text>
          <Text style={styles.nextStepsText}>{approvalText}</Text>
        </View> : null}
        <Text style={styles.footer} fixed>Arnold Contract | 120 Coit Street, Irvington, NJ 07111 | 866-425-6529</Text>
      </Page>
    </Document>
  )
}

function WorkOrderDetails({ data }: { data: OrderDocumentData }) {
  const productionLines = mergeOrderDocumentSublines(data.lines.filter((line) => line.category !== 'freight'))

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
            <Text style={styles.workOrderDesc}>{orderLineDocumentText(line)}</Text>
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

export function WorkOrderDocument({ data, settings, terms }: { data: OrderDocumentData; settings: CrmQuotePrintSettings; terms?: OrderDocumentTerms }) {
  const title = Number(data.changeVersion || 0) > 0
    ? `Work Order — Change Version ${Number(data.changeVersion)}`
    : 'Work Order'
  const documentTerms = termsForDocument(terms, 'work_order')

  return (
    <Document title={`Work Order ${data.acknowledgmentNumber}`}>
      <Page size="LETTER" style={styles.page} wrap>
        <Header settings={settings} title={title} />
        <WorkOrderDetails data={data} />
        {documentTerms.length ? (
          <View style={styles.nextSteps} wrap={false}>
            <Text style={styles.nextStepsTitle}>Terms and Conditions</Text>
            <Text style={styles.nextStepsText}>{documentTerms.map(termText).join('\n\n')}</Text>
          </View>
        ) : null}
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

export function BillOfLadingDocument({ data, settings, terms }: { data: OrderDocumentData; settings: CrmQuotePrintSettings; terms?: OrderDocumentTerms }) {
  const productLines = mergeOrderDocumentSublines(data.lines.filter((line) => line.category !== 'freight'))
  const soldTo = bolAddress(data)
  const fallbackLines: OrderDocumentLine[] = [{
    id: '-',
    qty: null,
    description: 'Order details are not available.',
    category: 'product',
    unitPrice: null,
    extPrice: 0,
  }]
  const shipmentLines = productLines.length ? productLines : fallbackLines
  const pageLineGroups: OrderDocumentLine[][] = []
  const configuredTerms = termsForDocument(terms, 'bill_of_lading')

  if (shipmentLines.length <= 4) {
    pageLineGroups.push(shipmentLines)
  } else {
    pageLineGroups.push(shipmentLines.slice(0, 6))
    let remainingLines = shipmentLines.slice(6)

    while (remainingLines.length > 6) {
      const intermediateCount = Math.min(10, remainingLines.length)
      pageLineGroups.push(remainingLines.slice(0, intermediateCount))
      remainingLines = remainingLines.slice(intermediateCount)
    }

    // Do not pull item lines forward onto the signature/terms page merely to
    // avoid a terms-only page. Item pages should fill in their natural order.
    // An empty final group intentionally creates a dedicated closing page.
    pageLineGroups.push(remainingLines.length ? remainingLines : [])
  }

  // Signatures and configurable BOL terms need their own closing page. Keeping
  // this content in a non-wrapping block below shipment rows can leave
  // react-pdf repeatedly trying to fit an impossible layout.
  if (configuredTerms.length > 0 && pageLineGroups.at(-1)?.length) {
    pageLineGroups.push([])
  }

  return (
    <Document title={`Bill of Lading ${data.acknowledgmentNumber}`}>
      {pageLineGroups.map((pageLines, pageIndex) => {
        const isFirstPage = pageIndex === 0
        const isLastPage = pageIndex === pageLineGroups.length - 1
        const lineNumberOffset = pageLineGroups
          .slice(0, pageIndex)
          .reduce((sum, lines) => sum + lines.length, 0)

        return <Page key={`bol-page-${pageIndex + 1}`} size="LETTER" style={bolStyles.page} wrap>
        <Header settings={settings} title="Bill of Lading" />
        <Text style={bolStyles.original}>
          {isFirstPage
            ? 'ORIGINAL - NOT NEGOTIABLE'
            : 'BOL - CONTINUED'}
        </Text>

        {isFirstPage ? <>
        <View style={bolStyles.identityRow} wrap={false}>
          <View style={[bolStyles.identityCell, { width: '30%' }]}>
            <Text style={bolStyles.identityLabel}>Date</Text>
            <Text style={bolStyles.identityValue}>{bolDate(data.shipmentDate || data.documentDate)}</Text>
          </View>
          <View style={[bolStyles.identityCell, { width: '70%', borderRightWidth: 0 }]}>
            <Text style={bolStyles.identityLabel}>From</Text>
            <Text style={bolStyles.identityValue}>Arnold Contract{`\n`}120 Coit Street, Irvington, NJ 07111{`\n`}866-425-6529  |  ArnoldContract.us</Text>
          </View>
        </View>

        <View style={bolStyles.partiesRow} wrap={false}>
          <View style={bolStyles.partyBox}>
            <Text style={bolStyles.partyHeader}>Sold To</Text>
            <Text style={bolStyles.partyValue}>{soldTo}</Text>
          </View>
          <View style={bolStyles.partyBoxRight}>
            <Text style={bolStyles.partyHeader}>Shipped To</Text>
            <Text style={bolStyles.partyValue}>{data.shipTo || '-'}</Text>
          </View>
        </View>

        <View style={bolStyles.refsRow} wrap={false}>
          {[
            ['Customer PO Date', bolDate(data.poDate || data.documentDate), '18%'],
            ['Customer PO Number', data.poNumber, '20%'],
            ['Acknowledgment Number', data.acknowledgmentNumber, '20%'],
            ['Acknowledgment Date', bolDate(data.acknowledgmentDate || data.documentDate), '18%'],
            ['Ship Via / Carrier', data.carrier || data.freightType, '24%'],
          ].map(([label, value, width], index, entries) => (
            <View key={String(label)} style={[bolStyles.refCell, { width: String(width), borderRightWidth: index === entries.length - 1 ? 0 : 1 }]}>
              <Text style={bolStyles.refHeader}>{label}</Text>
              <Text style={bolStyles.refValue}>{String(value || '-')}</Text>
            </View>
          ))}
        </View>
        </> : null}

        {pageLines.length ? <>
          <Text style={bolStyles.sectionTitle}>{isFirstPage ? 'Shipment Items' : 'Shipment Items - Continued'}</Text>
          <View
            style={[
              bolStyles.itemsTable,
              pageLineGroups.length === 1
                ? { minHeight: 145 }
                : !isLastPage
                  ? { flexGrow: 1 }
                  : {},
            ]}
          >
            <View style={bolStyles.itemHeader} fixed>
              <Text style={[bolStyles.itemHeaderCell, { width: '8%' }]}>Line</Text>
              <Text style={[bolStyles.itemHeaderCell, { width: '12%' }]}>Quantity</Text>
              <Text style={[bolStyles.itemHeaderCell, { width: '80%', borderRightWidth: 0 }]}>Item Description</Text>
            </View>
            {pageLines.map((line, lineIndex) => (
              <View
                key={`${line.category}-${line.id}`}
                style={[
                  bolStyles.itemRow,
                  (lineNumberOffset + lineIndex) % 2 === 1 ? { backgroundColor: '#f3f6f8' } : {},
                ]}
                wrap={false}
              >
                <Text style={[bolStyles.itemCell, { width: '8%', textAlign: 'center' }]}>{lineNumberOffset + lineIndex + 1}</Text>
                <Text style={[bolStyles.itemCell, { width: '12%', textAlign: 'center' }]}>{line.qty ?? '-'}</Text>
                <Text style={[bolStyles.itemCell, { width: '80%', borderRightWidth: 0 }]}>{orderLineDocumentText(line)}</Text>
              </View>
            ))}
          </View>
        </> : null}

        {isLastPage ? <View style={bolStyles.bottomBlock}>
        <View style={bolStyles.signatures} wrap={false}>
          {[
            ['Carrier Signature', ''],
            ['Customer Signature', ''],
          ].map(([title, help], index) => (
            <View key={title} style={[bolStyles.signatureBox, { width: '50%', borderRightWidth: index === 1 ? 0 : 1 }]}>
              <Text style={bolStyles.signatureTitle}>{title}</Text>
              <Text style={bolStyles.signatureHelp}>{help}</Text>
              <View style={bolStyles.signatureLine} />
              <Text style={bolStyles.signatureCaption}>Printed name and signature</Text>
              <View style={bolStyles.signatureMeta}>
                <Text style={{ width: '58%' }}>Date: ____________</Text>
                <Text style={{ width: '42%' }}>Time: ________</Text>
              </View>
            </View>
          ))}
        </View>

        {configuredTerms.length ? <View style={bolStyles.terms}>
          <Text style={bolStyles.termsTitle}>Bill of Lading Terms and Notices</Text>
          <View style={bolStyles.termsColumns}>
            <View style={bolStyles.termsColumn}>
              {(configuredTerms.length ? configuredTerms.slice(0, Math.ceil(configuredTerms.length / 2)) : []).map((term) => (
                <Text key={term.id} style={bolStyles.term}><Text style={bolStyles.termLabel}>{term.title.toUpperCase()}. </Text>{term.body}</Text>
              ))}
            </View>
            <View style={bolStyles.termsColumnRight}>
              {(configuredTerms.length ? configuredTerms.slice(Math.ceil(configuredTerms.length / 2)) : []).map((term) => (
                <Text key={term.id} style={bolStyles.term}><Text style={bolStyles.termLabel}>{term.title.toUpperCase()}. </Text>{term.body}</Text>
              ))}
            </View>
          </View>
        </View> : null}

        </View> : null}

        <Text style={bolStyles.footer}>Arnold Contract  |  120 Coit Street, Irvington, NJ 07111  |  866-425-6529  |  ArnoldContract.us  |  Page {pageIndex + 1} of {pageLineGroups.length}</Text>
      </Page>
      })}
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

export async function buildOrderDocumentBlob(data: OrderDocumentData, settings: CrmQuotePrintSettings, terms?: OrderDocumentTerms) {
  const normalizedSettings = await normalizeDocumentSettings(settings)
  return pdf(<OrderDocument data={data} settings={normalizedSettings} terms={terms} />).toBlob()
}

export async function buildWorkOrderDocumentBlob(data: OrderDocumentData, settings: CrmQuotePrintSettings, terms?: OrderDocumentTerms) {
  const normalizedSettings = await normalizeDocumentSettings(settings)
  return pdf(<WorkOrderDocument data={data} settings={normalizedSettings} terms={terms} />).toBlob()
}

export async function buildProformaInvoiceBlob(data: OrderDocumentData, settings: CrmQuotePrintSettings, terms?: OrderDocumentTerms) {
  const normalizedSettings = await normalizeDocumentSettings(settings)
  return pdf(<ProformaInvoiceDocument data={data} settings={normalizedSettings} terms={terms} />).toBlob()
}

export async function buildBillOfLadingBlob(data: OrderDocumentData, settings: CrmQuotePrintSettings, terms?: OrderDocumentTerms) {
  const normalizedSettings = await normalizeDocumentSettings(settings)
  return pdf(<BillOfLadingDocument data={data} settings={normalizedSettings} terms={terms} />).toBlob()
}

export async function buildChangeOrderDocumentBlob(
  data: OrderDocumentData,
  settings: CrmQuotePrintSettings,
  version: number,
  terms?: OrderDocumentTerms,
) {
  const normalizedSettings = await normalizeDocumentSettings(settings)
  return pdf(
    <ChangeOrderDocument data={data} settings={normalizedSettings} version={version} terms={terms} />,
  ).toBlob()
}

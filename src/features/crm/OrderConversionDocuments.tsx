import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'
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
  documentDate: string
  companyName: string
  contactName: string
  poNumber: string
  projectName: string
  acknowledgmentNumber: string
  leadTime: string
  freightType: string
  shipTo: string
  productNet: number
  freightNet: number
  grandTotal: number
  depositRequired: boolean
  depositPercent: number | null
  lines: OrderDocumentLine[]
}

const styles = StyleSheet.create({
  page: { paddingTop: 82, paddingBottom: 48, paddingHorizontal: 38, fontFamily: 'Helvetica', fontSize: 9, color: '#15283b' },
  brand: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#b51f2e' },
  logo: { width: 145, height: 37, objectFit: 'contain', objectPosition: 'left top' },
  brandContract: { color: '#101820' },
  brandContact: { marginTop: 3, fontSize: 6.8, color: '#607284', lineHeight: 1.25 },
  headerBlock: { position: 'absolute', top: 22, left: 38, right: 38 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandArea: { width: '58%' },
  titleArea: { width: '42%', paddingLeft: 10 },
  title: { fontSize: 14, color: '#0f4c81', fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  summaryRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: 8 },
  referenceBox: { width: '40%', paddingVertical: 6, paddingHorizontal: 9, backgroundColor: '#f3f6f8', borderLeftWidth: 3, borderLeftColor: '#0f4c81' },
  referenceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2.5 },
  referenceLabel: { fontSize: 6.5, color: '#66788a', textTransform: 'uppercase' },
  referenceValue: { fontSize: 7.8, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  rule: { height: 2.5, backgroundColor: '#0f4c81', marginTop: 6 },
  infoPanel: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: '#f7f9fb', borderBottomWidth: 1, borderColor: '#d5dee6' },
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
  orderTotal: { marginTop: 8, marginLeft: '58%', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, paddingHorizontal: 9, backgroundColor: '#eef4f8', borderTopWidth: 2, borderTopColor: '#0f4c81', fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#0f4c81' },
  nextSteps: { marginTop: 11, paddingVertical: 9, paddingHorizontal: 12, borderLeftWidth: 3, borderLeftColor: '#0f4c81', backgroundColor: '#f7f9fb' },
  nextStepsTitle: { fontSize: 9.5, color: '#0f4c81', fontFamily: 'Helvetica-Bold', marginBottom: 5 },
  nextStepsText: { fontSize: 8.7, color: '#334a5f', lineHeight: 1.4 },
  managers: { marginTop: 10, textAlign: 'center', fontSize: 8, color: '#607284' },
  footer: { position: 'absolute', bottom: 24, left: 38, right: 38, borderTopWidth: 1, borderColor: '#d8e0e7', paddingTop: 7, textAlign: 'center', color: '#607284', fontSize: 7.5 },
})

const money = (value: number) => `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Header({ settings }: { settings: CrmQuotePrintSettings }) {
  const address = (settings.addressLines.length ? settings.addressLines : ['120 Coit Street, Irvington, NJ 07111']).filter(Boolean).join(', ')
  return <View style={styles.headerBlock} fixed>
    <View style={styles.header}>
      <View style={styles.brandArea}>
        {settings.logoUrl ? <Image style={styles.logo} src={settings.logoUrl} /> : <Text style={styles.brand}>Arnold <Text style={styles.brandContract}>Contract</Text></Text>}
        <Text style={styles.brandContact}>{[settings.phone || '866-425-6529', settings.website || 'ArnoldContract.us'].filter(Boolean).join(' | ')}{`\n`}{address}</Text>
      </View>
      <View style={styles.titleArea}><Text style={styles.title}>Order Confirmation</Text></View>
    </View>
    <View style={[styles.rule, { backgroundColor: settings.accentColor || '#0f4c81' }]} />
  </View>
}

function Metadata({ data }: { data: OrderDocumentData }) {
  const rows = [['Company', data.companyName], ['Contact', data.contactName], ['Ship To', data.shipTo || '-'], ['Lead Time', data.leadTime || '-'], ['Freight', data.freightType || '-']]
  return <View style={styles.infoPanel} wrap={false}>{rows.map(([label, value]) => <View key={label} style={styles.infoRow}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value || '-'}</Text></View>)}</View>
}

function Lines({ data }: { data: OrderDocumentData }) {
  return <>
    <Text style={styles.sectionTitle}>Order Details</Text>
    <View style={styles.tableHead}><Text style={styles.desc}>Description</Text><Text style={styles.qty}>Qty</Text><Text style={styles.unit}>Unit</Text><Text style={styles.money}>Extended</Text></View>
    {data.lines.map((line) => <View key={`${line.category}-${line.id}`} style={styles.tableRow} wrap={false}><Text style={styles.desc}>{line.description}</Text><Text style={styles.qty}>{line.qty ?? '-'}</Text><Text style={styles.unit}>{line.unitPrice == null ? '-' : money(line.unitPrice)}</Text><Text style={styles.money}>{money(line.extPrice)}</Text></View>)}
    <View style={styles.orderTotal} wrap={false}><Text>Order Total</Text><Text>{money(data.grandTotal)}</Text></View>
  </>
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

export async function buildOrderDocumentBlob(data: OrderDocumentData, settings: CrmQuotePrintSettings) {
  const normalizedSettings = {
    ...settings,
    logoUrl: settings.logoUrl && settings.logoUrl.startsWith('/') && typeof window !== 'undefined'
      ? `${window.location.origin}${settings.logoUrl}`
      : settings.logoUrl,
  }
  return pdf(<OrderDocument data={data} settings={normalizedSettings} />).toBlob()
}

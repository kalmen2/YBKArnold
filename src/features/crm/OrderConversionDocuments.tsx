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

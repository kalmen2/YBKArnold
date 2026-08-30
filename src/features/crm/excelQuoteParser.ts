import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import type { CrmExcelQuoteImportSummary, CrmQuoteLineItem, CrmExcelQuoteSyncInput } from './api'

export type ParsedExcelQuoteLineImage = {
  mainLineIndex: number
  sourceRow: number
  file: File
}

export type ParsedExcelQuoteSync = CrmExcelQuoteSyncInput & {
  importSummary: CrmExcelQuoteImportSummary
  embeddedLineImages: ParsedExcelQuoteLineImage[]
}

const supportedQuoteSyncExtensions = new Set([
  'xls',
  'xlsx',
  'xlsm',
  'ods',
  'csv',
])

const ROW_QUOTE_NUMBER = 2
const COL_QUOTE_NUMBER = 8
const ROW_QUOTE_NUMBER_FALLBACK = 1
const quoteNumberHeaderAliases = new Set(['quoteno', 'quotenumber'])
const ROW_PROJECT_NAME = 3
const COL_PROJECT_NAME = 8
const COL_PROJECT_NAME_FALLBACK = 6

const ROW_DATE = 6
const ROW_COMPANY = 7
const ROW_CONTACT_NAME = 8
const ROW_CONTACT_EMAIL = 9
const ROW_CONTACT_PHONE = 10
const ROW_SALES_REP = 11
const ROW_LEAD_TIME = 12
const ROW_PAYMENT_TERMS = 13
const COL_LABEL_VALUE = 3

const ROW_LINE_ITEMS_START = 18
const COL_ITEM = 1
const COL_DESCRIPTION = 2
const COL_QTY = 7
const COL_UNIT_PRICE = 8
const COL_EXT_PRICE = 9
const COL_TOTAL_LABEL = 7

type LineItemLayout = {
  lineItemsStartRow: number
  colItem: number
  colDescription: number
  colQty: number
  colUnitPrice: number
  colExtPrice: number
  colTotalLabel: number
}

const subtotalLabelSet = new Set([
  'sub net total',
  'subnet total',
  'sub list total',
  'sublist total',
  'sub total',
  'subtotal',
])

const defaultLineItemLayout: LineItemLayout = {
  lineItemsStartRow: ROW_LINE_ITEMS_START,
  colItem: COL_ITEM,
  colDescription: COL_DESCRIPTION,
  colQty: COL_QTY,
  colUnitPrice: COL_UNIT_PRICE,
  colExtPrice: COL_EXT_PRICE,
  colTotalLabel: COL_TOTAL_LABEL,
}

function getCell(rows: unknown[][], row: number, col: number): unknown {
  const rowValues = rows[row - 1]

  if (!Array.isArray(rowValues)) {
    return null
  }

  return rowValues[col - 1] ?? null
}

function toTrimmedText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value).trim()
}

function toOptionalText(value: unknown): string | undefined {
  const normalized = toTrimmedText(value)
  return normalized || undefined
}

function normalizeCellText(rows: unknown[][], row: number, col: number): string {
  return toTrimmedText(getCell(rows, row, col))
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeHeaderText(value: unknown): string {
  return toTrimmedText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function isAnyHeaderMatch(label: string, expectedLabels: string[]): boolean {
  return expectedLabels.some((expected) => label === expected)
}

function resolveNumericColumnOffset(
  rows: unknown[][],
  headerRow: number,
  columns: { qty: number; unitPrice: number; extPrice: number },
): number {
  let bestOffset = 0
  let bestScore = -1
  const lastRow = Math.min(rows.length, headerRow + 90)

  for (let offset = 0; offset <= 2; offset += 1) {
    let score = 0

    for (let row = headerRow + 1; row <= lastRow; row += 1) {
      const qty = toNumberOrNull(getCell(rows, row, columns.qty + offset))
      const unitPrice = toNumberOrNull(getCell(rows, row, columns.unitPrice + offset))
      const extPrice = toNumberOrNull(getCell(rows, row, columns.extPrice + offset))

      if (extPrice !== null) score += 3
      if (unitPrice !== null) score += 2
      if (qty !== null) score += 1
      if (qty !== null && unitPrice !== null && extPrice !== null) score += 4
    }

    if (score > bestScore) {
      bestOffset = offset
      bestScore = score
    }
  }

  return bestOffset
}

function findLineItemLayout(rows: unknown[][]): LineItemLayout {
  let bestMatch: {
    row: number
    colItem?: number
    colDescription?: number
    colQty?: number
    colUnitPrice?: number
    colExtPrice?: number
    score: number
  } | null = null

  const maxRowToScan = Math.min(rows.length, 80)

  for (let row = 1; row <= maxRowToScan; row += 1) {
    const rowValues = rows[row - 1]

    if (!Array.isArray(rowValues) || rowValues.length === 0) {
      continue
    }

    let colItem: number | undefined
    let colDescription: number | undefined
    let colQty: number | undefined
    let colUnitPrice: number | undefined
    let colExtPrice: number | undefined

    for (let col = 1; col <= rowValues.length; col += 1) {
      const label = normalizeHeaderText(getCell(rows, row, col))

      if (!label) {
        continue
      }

      if (!colItem && isAnyHeaderMatch(label, ['item', 'lineitem', 'lineno', 'number'])) {
        colItem = col
        continue
      }

      if (!colDescription && isAnyHeaderMatch(label, ['description', 'desc', 'itemdescription'])) {
        colDescription = col
        continue
      }

      if (!colQty && isAnyHeaderMatch(label, ['qty', 'quantity'])) {
        colQty = col
        continue
      }

      if (!colUnitPrice && isAnyHeaderMatch(label, ['unitprice', 'unitnetprice', 'unitlistprice', 'netprice', 'listprice', 'price'])) {
        colUnitPrice = col
        continue
      }

      if (!colExtPrice && isAnyHeaderMatch(label, ['extprice', 'extnetprice', 'extlistprice', 'extendedprice', 'extendednetprice', 'extendedlistprice', 'totalprice', 'totalnetprice', 'totallistprice', 'linetotal'])) {
        colExtPrice = col
      }
    }

    const score = [colItem, colDescription, colQty, colUnitPrice, colExtPrice]
      .filter((value) => typeof value === 'number').length

    if (
      colItem
      && colDescription
      && colQty
      && colUnitPrice
      && colExtPrice
      && (!bestMatch || score > bestMatch.score)
    ) {
      bestMatch = {
        row,
        colItem,
        colDescription,
        colQty,
        colUnitPrice,
        colExtPrice,
        score,
      }
    }
  }

  if (!bestMatch || !bestMatch.colItem || !bestMatch.colDescription || !bestMatch.colQty || !bestMatch.colUnitPrice || !bestMatch.colExtPrice) {
    return defaultLineItemLayout
  }

  const numericColumnOffset = resolveNumericColumnOffset(rows, bestMatch.row, {
    qty: bestMatch.colQty,
    unitPrice: bestMatch.colUnitPrice,
    extPrice: bestMatch.colExtPrice,
  })

  return {
    lineItemsStartRow: bestMatch.row + 1,
    colItem: bestMatch.colItem,
    colDescription: bestMatch.colDescription,
    colQty: bestMatch.colQty + numericColumnOffset,
    colUnitPrice: bestMatch.colUnitPrice + numericColumnOffset,
    colExtPrice: bestMatch.colExtPrice + numericColumnOffset,
    colTotalLabel: bestMatch.colQty,
  }
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const normalized = toTrimmedText(value)

  if (!normalized) {
    return null
  }

  const cleaned = normalized.replace(/[,$\s]/g, '')

  if (!cleaned) {
    return null
  }

  const parsed = Number(cleaned)

  return Number.isFinite(parsed) ? parsed : null
}

function toIsoDateFromParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function toIsoDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDateFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate()) || undefined
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)

    if (parsed && parsed.y && parsed.m && parsed.d) {
      return toIsoDateFromParts(parsed.y, parsed.m, parsed.d) || undefined
    }
  }

  const normalized = toTrimmedText(value)

  if (!normalized) {
    return undefined
  }

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }

  const parsedDate = new Date(normalized)

  if (Number.isNaN(parsedDate.getTime())) {
    return undefined
  }

  return toIsoDateFromParts(
    parsedDate.getFullYear(),
    parsedDate.getMonth() + 1,
    parsedDate.getDate(),
  ) || undefined
}

function isSubtotalRow(rows: unknown[][], row: number, layout: LineItemLayout): boolean {
  const totalLabel = normalizeCellText(rows, row, layout.colTotalLabel)

  if (subtotalLabelSet.has(totalLabel)) {
    return true
  }

  const itemLabel = normalizeCellText(rows, row, layout.colItem)

  return subtotalLabelSet.has(itemLabel)
}

type ParsedLineItems = {
  lineItems: CrmQuoteLineItem[]
  mainLineRows: number[]
  pairedSublineCount: number
  singleColumnSublineCount: number
}

function buildLineItems(rows: unknown[][], layout: LineItemLayout): ParsedLineItems {
  const lineItems: CrmQuoteLineItem[] = []
  const mainLineRows: number[] = []
  let pairedSublineCount = 0
  let singleColumnSublineCount = 0
  const lastRow = rows.length

  const pricedRows: number[] = []

  for (let row = layout.lineItemsStartRow; row <= lastRow; row += 1) {
    if (isSubtotalRow(rows, row, layout)) break

    const extPrice = toNumberOrNull(getCell(rows, row, layout.colExtPrice))
    const qty = toNumberOrNull(getCell(rows, row, layout.colQty))

    if (extPrice !== null && qty !== 0) {
      pricedRows.push(row)
    }
  }

  pricedRows.forEach((row, mainLineIndex) => {
    const extPriceCell = getCell(rows, row, layout.colExtPrice)
    const extPrice = toNumberOrNull(extPriceCell)
    const qtyCell = getCell(rows, row, layout.colQty)
    const unitPriceCell = getCell(rows, row, layout.colUnitPrice)
    const qty = toNumberOrNull(qtyCell)
    const parentId = `excel-row-${row}`

    lineItems.push({
      id: parentId,
      // Workbook references such as 1.1 are source references, not the quote's
      // display sequence. The application numbers main lines in order.
      itemNumber: mainLineIndex + 1,
      description: toOptionalText(getCell(rows, row, layout.colDescription)) || null,
      qty,
      unitPrice: toNumberOrNull(unitPriceCell),
      extPrice,
    })
    mainLineRows.push(row)

    const nextMainLineRow = pricedRows[mainLineIndex + 1] ?? (lastRow + 1)
    for (let detailRow = row + 1; detailRow < nextMainLineRow; detailRow += 1) {
      if (isSubtotalRow(rows, detailRow, layout)) break

      const left = toOptionalText(getCell(rows, detailRow, layout.colDescription)) || ''
      const right = toOptionalText(getCell(rows, detailRow, layout.colDescription + 1)) || ''

      if (!left && !right) continue

      if (left && right) {
        pairedSublineCount += 1
        lineItems.push({
          id: `excel-row-${detailRow}`,
          parentLineId: parentId,
          itemNumber: mainLineIndex + 1,
          detailLabel: left,
          description: right,
          qty: null,
          unitPrice: null,
          extPrice: null,
        })
      } else {
        singleColumnSublineCount += 1
        lineItems.push({
          id: `excel-row-${detailRow}`,
          parentLineId: parentId,
          itemNumber: mainLineIndex + 1,
          detailLabel: null,
          description: left || right,
          qty: null,
          unitPrice: null,
          extPrice: null,
        })
      }
    }
  })

  return { lineItems, mainLineRows, pairedSublineCount, singleColumnSublineCount }
}

function findSubtotal(rows: unknown[][], layout: LineItemLayout): { found: boolean; subtotal: number } {
  const lastRow = rows.length

  for (let row = layout.lineItemsStartRow; row <= lastRow; row += 1) {
    const rowValues = rows[row - 1]
    if (!Array.isArray(rowValues)) {
      continue
    }

    const subtotalColumnIndex = rowValues.findIndex((value) => subtotalLabelSet.has(
      toTrimmedText(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(),
    ))

    if (subtotalColumnIndex < 0) {
      continue
    }

    const extPrice = rowValues
      .slice(subtotalColumnIndex + 1)
      .map(toNumberOrNull)
      .filter((value): value is number => value !== null)
      .at(-1) ?? null

    if (extPrice !== null) {
      return {
        found: true,
        subtotal: extPrice,
      }
    }
  }

  for (let row = layout.lineItemsStartRow; row <= lastRow; row += 1) {
    const labelText = normalizeCellText(rows, row, layout.colItem)

    if (labelText !== 'sub net total') {
      continue
    }

    for (let col = layout.colExtPrice; col >= layout.colDescription; col -= 1) {
      const value = toNumberOrNull(getCell(rows, row, col))

      if (value !== null) {
        return {
          found: true,
          subtotal: value,
        }
      }
    }
  }

  return {
    found: false,
    subtotal: 0,
  }
}

function isFreightDescriptionRow(rows: unknown[][], row: number, layout: LineItemLayout): boolean {
  const descriptionText = normalizeCellText(rows, row, layout.colDescription)
  return descriptionText.includes('freight description')
}

function findFreightInfo(rows: unknown[][], layout: LineItemLayout): {
  found: boolean
  freight: number
  freightDescription: string | undefined
} {
  const lastRow = rows.length
  let freightSectionRow = 0

  for (let row = layout.lineItemsStartRow; row <= lastRow; row += 1) {
    if (isFreightDescriptionRow(rows, row, layout)) {
      freightSectionRow = row
      break
    }
  }

  const startRow = freightSectionRow > 0
    ? freightSectionRow + 1
    : layout.lineItemsStartRow

  for (let row = startRow; row <= lastRow; row += 1) {
    const labelText = normalizeCellText(rows, row, layout.colTotalLabel)

    if (labelText !== 'net') {
      continue
    }

    const extPrice = toNumberOrNull(getCell(rows, row, layout.colExtPrice))

    if (extPrice === null) {
      continue
    }

    const inlineDescription = toOptionalText(getCell(rows, row, layout.colDescription))
    const sectionDescription = freightSectionRow > 0
      ? toOptionalText(getCell(rows, freightSectionRow, layout.colDescription))
      : undefined

    return {
      found: true,
      freight: extPrice,
      freightDescription: inlineDescription || sectionDescription,
    }
  }

  return {
    found: false,
    freight: 0,
    freightDescription: undefined,
  }
}

function inferProjectTypeFromTitle(title: string | undefined): string | undefined {
  const normalized = toTrimmedText(title)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return undefined
  }

  if (normalized.includes('reception desk') || normalized.includes('reception')) {
    return 'Reception Desk'
  }

  if (normalized.includes('courtroom') || normalized.includes('court room')) {
    return 'Courtroom'
  }

  if (normalized.includes('libraries') || normalized.includes('library')) {
    return 'Libraries'
  }

  if (
    normalized.includes('conference table')
    || (normalized.includes('conference') && normalized.includes('table'))
  ) {
    return 'Conference Table'
  }

  return undefined
}

function resolveQuoteNumber(rows: unknown[][]): string | undefined {
  const primaryCandidate = toOptionalText(getCell(rows, ROW_QUOTE_NUMBER, COL_QUOTE_NUMBER))

  if (primaryCandidate) {
    return primaryCandidate
  }

  const fallbackCandidate = toOptionalText(getCell(rows, ROW_QUOTE_NUMBER_FALLBACK, COL_QUOTE_NUMBER))

  if (fallbackCandidate) {
    return fallbackCandidate
  }

  // Legacy quote template often keeps "Quote No." in E1 and merges the value in F1:G2.
  for (const [row, col] of [[1, 6], [2, 6], [1, 7], [2, 7]] as Array<[number, number]>) {
    const candidate = toOptionalText(getCell(rows, row, col))

    if (candidate) {
      return candidate
    }
  }

  // Last fallback: find "Quote No." header in the top rows and read nearest value to the right.
  const maxHeaderRow = Math.min(rows.length, 6)

  for (let row = 1; row <= maxHeaderRow; row += 1) {
    const rowValues = rows[row - 1]

    if (!Array.isArray(rowValues)) {
      continue
    }

    const maxHeaderCol = Math.min(rowValues.length || 0, 12)

    for (let col = 1; col <= maxHeaderCol; col += 1) {
      const normalizedHeader = normalizeHeaderText(getCell(rows, row, col))

      if (!quoteNumberHeaderAliases.has(normalizedHeader)) {
        continue
      }

      for (const [targetRow, targetCol] of [
        [row, col + 1],
        [row, col + 2],
        [row + 1, col + 1],
        [row + 1, col + 2],
      ]) {
        const candidate = toOptionalText(getCell(rows, targetRow, targetCol))

        if (candidate) {
          return candidate
        }
      }
    }
  }

  return undefined
}

function normalizeQuoteNumberKey(value: unknown): string {
  return toTrimmedText(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function resolveQuoteRevision(value: unknown): number {
  const match = toTrimmedText(value).match(/(?:^|[\s_-])R(\d+)(?:$|[\s_-])/i)
  return match?.[1] ? Number(match[1]) : -1
}

function resolvePreferredQuoteSheetName(workbook: XLSX.WorkBook, preferredQuoteNumber?: string): string {
  const sheetNames = Array.isArray(workbook.SheetNames)
    ? workbook.SheetNames.map((name) => String(name ?? '').trim()).filter(Boolean)
    : []

  if (sheetNames.length === 0) {
    return ''
  }

  const preferredKey = normalizeQuoteNumberKey(preferredQuoteNumber)
  const candidates = sheetNames.map((name, index) => {
    const sheet = workbook.Sheets[name]
    const rows = sheet
      ? XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][]
      : []
    const quoteNumber = resolveQuoteNumber(rows)
    const quoteRevision = resolveQuoteRevision(quoteNumber)
    const sheetRevision = resolveQuoteRevision(name)
    const hasLineItemHeader = rows.slice(0, 80).some((row) => (
      Array.isArray(row)
      && row.some((value) => normalizeHeaderText(value) === 'item')
      && row.some((value) => normalizeHeaderText(value) === 'description')
    ))

    return {
      name,
      index,
      quoteNumber,
      quoteRevision,
      sheetRevision,
      hasLineItemHeader,
      exactPreferredMatch: Boolean(preferredKey && normalizeQuoteNumberKey(quoteNumber) === preferredKey),
      revisionIsConsistent: quoteRevision >= 0 && quoteRevision === sheetRevision,
    }
  }).filter((entry) => entry.quoteNumber && entry.hasLineItemHeader)

  if (candidates.length === 0) return sheetNames[0]

  candidates.sort((left, right) => {
    if (left.exactPreferredMatch !== right.exactPreferredMatch) return left.exactPreferredMatch ? -1 : 1
    if (left.revisionIsConsistent !== right.revisionIsConsistent) return left.revisionIsConsistent ? -1 : 1
    if (right.quoteRevision !== left.quoteRevision) return right.quoteRevision - left.quoteRevision
    return right.index - left.index
  })

  return candidates[0].name
}

function getOdsElementName(element: Element): string {
  return element.localName || element.nodeName.split(':').at(-1) || ''
}

async function extractOdsLineImages(
  workbookBuffer: ArrayBuffer,
  sheetName: string,
  mainLineRows: number[],
): Promise<ParsedExcelQuoteLineImage[]> {
  if (mainLineRows.length === 0) return []

  try {
    const archive = await JSZip.loadAsync(workbookBuffer)
    const contentFile = archive.file('content.xml')
    if (!contentFile) return []

    const contentXml = await contentFile.async('text')
    const document = new DOMParser().parseFromString(contentXml, 'application/xml')
    if (document.querySelector('parsererror')) return []

    const table = Array.from(document.getElementsByTagName('*')).find((element) => (
      getOdsElementName(element) === 'table'
      && String(element.getAttribute('table:name') || '').trim() === sheetName
    ))

    if (!table) return []

    const extracted: ParsedExcelQuoteLineImage[] = []
    const seen = new Set<string>()
    let rowNumber = 0

    for (const child of Array.from(table.children)) {
      if (getOdsElementName(child) !== 'table-row') continue

      const repeats = Math.max(1, Number(child.getAttribute('table:number-rows-repeated') || 1))
      const imagePaths = Array.from(child.getElementsByTagName('*'))
        .filter((element) => getOdsElementName(element) === 'image')
        .map((element) => String(element.getAttribute('xlink:href') || '').trim())
        .filter((path) => path.startsWith('Pictures/'))

      for (let repeat = 0; repeat < repeats; repeat += 1) {
        rowNumber += 1
        if (imagePaths.length === 0) continue

        const mainLineIndex = mainLineRows.findLastIndex((mainRow) => mainRow <= rowNumber)
        if (mainLineIndex < 0) continue

        for (const imagePath of imagePaths) {
          const dedupeKey = `${mainLineIndex}:${imagePath}`
          if (seen.has(dedupeKey)) continue

          const imageFile = archive.file(imagePath)
          if (!imageFile) continue

          const blob = await imageFile.async('blob')
          const extension = imagePath.split('.').pop()?.toLowerCase() || 'jpg'
          const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'
          extracted.push({
            mainLineIndex,
            sourceRow: rowNumber,
            file: new File([blob], `workbook-line-${mainLineIndex + 1}.${extension}`, { type: mimeType }),
          })
          seen.add(dedupeKey)
        }
      }
    }

    return extracted
  } catch {
    // A workbook's images are supplemental. Its quote data should still sync.
    return []
  }
}

export async function parseExcelQuoteForSync(
  file: File,
  options: { preferredQuoteNumber?: string } = {},
): Promise<ParsedExcelQuoteSync> {
  const fileName = String(file.name ?? '').trim()
  const extension = fileName.includes('.')
    ? fileName.split('.').pop()?.toLowerCase() ?? ''
    : ''

  if (!supportedQuoteSyncExtensions.has(extension)) {
    throw new Error('Unsupported file type. Upload .xls, .xlsx, .xlsm, .ods, or .csv.')
  }

  const workbookBuffer = await file.arrayBuffer()
  let workbook: XLSX.WorkBook

  try {
    workbook = XLSX.read(workbookBuffer, {
      type: 'array',
      cellDates: true,
    })
  } catch {
    throw new Error('Could not read the uploaded file. Ensure it is a valid .xls, .xlsx, .xlsm, .ods, or .csv file.')
  }

  const preferredSheetName = resolvePreferredQuoteSheetName(workbook, options.preferredQuoteNumber)

  if (!preferredSheetName) {
    throw new Error('The uploaded workbook has no sheets.')
  }

  const sheet = workbook.Sheets[preferredSheetName]

  if (!sheet) {
    throw new Error('Could not read the latest quote revision sheet from the workbook.')
  }

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][]

  const quoteNumber = resolveQuoteNumber(rows)

  if (!quoteNumber) {
    throw new Error('No quote number found. Expected H2/H1 or a merged Quote No. value near the header.')
  }

  const title = toOptionalText(getCell(rows, ROW_PROJECT_NAME, COL_PROJECT_NAME))
    || toOptionalText(getCell(rows, ROW_PROJECT_NAME, COL_PROJECT_NAME_FALLBACK))

  const companyName = toOptionalText(getCell(rows, ROW_COMPANY, COL_LABEL_VALUE))
  const contactName = toOptionalText(getCell(rows, ROW_CONTACT_NAME, COL_LABEL_VALUE))
  const contactEmail = toOptionalText(getCell(rows, ROW_CONTACT_EMAIL, COL_LABEL_VALUE))
  const contactPhone = toOptionalText(getCell(rows, ROW_CONTACT_PHONE, COL_LABEL_VALUE))
  const salesRep = toOptionalText(getCell(rows, ROW_SALES_REP, COL_LABEL_VALUE))
  const leadTime = toOptionalText(getCell(rows, ROW_LEAD_TIME, COL_LABEL_VALUE))
  const paymentTerms = toOptionalText(getCell(rows, ROW_PAYMENT_TERMS, COL_LABEL_VALUE))
  const opportunityDate = toIsoDate(getCell(rows, ROW_DATE, COL_LABEL_VALUE))
  const inferredProjectType = inferProjectTypeFromTitle(title)
  const lineItemLayout = findLineItemLayout(rows)

  const parsedLineItems = buildLineItems(rows, lineItemLayout)
  const { lineItems } = parsedLineItems
  const subtotalResult = findSubtotal(rows, lineItemLayout)
  const freightInfo = findFreightInfo(rows, lineItemLayout)
  const calculatedLineSubtotal = Number(lineItems.reduce((sum, item) => sum + Number(item.extPrice || 0), 0).toFixed(2))

  if (lineItems.length === 0) {
    throw new Error(`No priced product lines were found on sheet "${preferredSheetName}". The quote was not updated.`)
  }

  const embeddedLineImages = extension === 'ods'
    ? await extractOdsLineImages(workbookBuffer, preferredSheetName, parsedLineItems.mainLineRows)
    : []
  const importSummary: CrmExcelQuoteImportSummary = {
    sheetName: preferredSheetName,
    mainLineCount: parsedLineItems.mainLineRows.length,
    sublineCount: parsedLineItems.pairedSublineCount + parsedLineItems.singleColumnSublineCount,
    pairedSublineCount: parsedLineItems.pairedSublineCount,
    singleColumnSublineCount: parsedLineItems.singleColumnSublineCount,
    embeddedImageCount: embeddedLineImages.length,
    matchedImageCount: embeddedLineImages.length,
    unmatchedImageCount: 0,
  }

  const payload: ParsedExcelQuoteSync = {
    quoteNumber,
    lineItems,
    importSummary,
    embeddedLineImages,
  }

  if (title) {
    payload.title = title
  }

  if (companyName) {
    payload.companyName = companyName
  }

  if (salesRep) {
    payload.salesRep = salesRep
  }

  if (inferredProjectType) {
    payload.projectType = inferredProjectType
  }

  if (opportunityDate) {
    payload.opportunityDate = opportunityDate
  }

  if (contactName) {
    payload.contactName = contactName
  }

  if (contactEmail) {
    payload.contactEmail = contactEmail
  }

  if (contactPhone) {
    payload.contactPhone = contactPhone
  }

  if (paymentTerms) {
    payload.paymentTerms = paymentTerms
  }

  if (leadTime) {
    payload.leadTime = leadTime
  }

  if (subtotalResult.found || lineItems.length > 0) {
    payload.subtotal = calculatedLineSubtotal
    payload.totalAmount = Number((calculatedLineSubtotal + freightInfo.freight).toFixed(2))
  }

  if (freightInfo.found) {
    payload.freight = freightInfo.freight
  }

  if (freightInfo.freightDescription) {
    payload.freightDescription = freightInfo.freightDescription
  }

  return payload
}

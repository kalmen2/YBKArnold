import * as XLSX from 'xlsx'
import type { CrmQuoteLineItem, CrmExcelQuoteSyncInput } from './api'

const ROW_QUOTE_NUMBER = 2
const COL_QUOTE_NUMBER = 8
const ROW_QUOTE_NUMBER_FALLBACK = 1
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

const subtotalLabelSet = new Set(['sub net total', 'subnet total', 'sub total', 'subtotal'])

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

function isPlainInteger(value: unknown): boolean {
  const parsed = toNumberOrNull(value)

  return parsed !== null && parsed >= 0 && Math.floor(parsed) === parsed
}

function isFilledNumber(value: unknown): boolean {
  return toTrimmedText(value).length > 0 && toNumberOrNull(value) !== null
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

function buildLineItems(rows: unknown[][]): CrmQuoteLineItem[] {
  const lineItems: CrmQuoteLineItem[] = []
  const lastRow = rows.length

  for (let row = ROW_LINE_ITEMS_START; row <= lastRow; row += 1) {
    const itemCell = getCell(rows, row, COL_ITEM)

    if (!isPlainInteger(itemCell)) {
      continue
    }

    const qtyCell = getCell(rows, row, COL_QTY)
    const unitPriceCell = getCell(rows, row, COL_UNIT_PRICE)
    const extPriceCell = getCell(rows, row, COL_EXT_PRICE)

    if (!isFilledNumber(qtyCell) || !isFilledNumber(unitPriceCell) || !isFilledNumber(extPriceCell)) {
      continue
    }

    lineItems.push({
      itemNumber: Math.max(0, Math.trunc(toNumberOrNull(itemCell) || 0)),
      description: toOptionalText(getCell(rows, row, COL_DESCRIPTION)) || null,
      qty: toNumberOrNull(qtyCell),
      unitPrice: toNumberOrNull(unitPriceCell),
      extPrice: toNumberOrNull(extPriceCell),
    })
  }

  return lineItems
}

function findSubtotal(rows: unknown[][]): { found: boolean; subtotal: number } {
  const lastRow = rows.length

  for (let row = ROW_LINE_ITEMS_START; row <= lastRow; row += 1) {
    const labelText = normalizeCellText(rows, row, COL_TOTAL_LABEL)

    if (!subtotalLabelSet.has(labelText)) {
      continue
    }

    const extPrice = toNumberOrNull(getCell(rows, row, COL_EXT_PRICE))

    if (extPrice !== null) {
      return {
        found: true,
        subtotal: extPrice,
      }
    }
  }

  for (let row = ROW_LINE_ITEMS_START; row <= lastRow; row += 1) {
    const labelText = normalizeCellText(rows, row, COL_ITEM)

    if (labelText !== 'sub net total') {
      continue
    }

    for (let col = COL_EXT_PRICE; col >= COL_DESCRIPTION; col -= 1) {
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

function isFreightDescriptionRow(rows: unknown[][], row: number): boolean {
  const descriptionText = normalizeCellText(rows, row, COL_DESCRIPTION)
  return descriptionText.includes('freight description')
}

function findFreightInfo(rows: unknown[][]): {
  found: boolean
  freight: number
  freightDescription: string | undefined
} {
  const lastRow = rows.length
  let freightSectionRow = 0

  for (let row = ROW_LINE_ITEMS_START; row <= lastRow; row += 1) {
    if (isFreightDescriptionRow(rows, row)) {
      freightSectionRow = row
      break
    }
  }

  const startRow = freightSectionRow > 0
    ? freightSectionRow + 1
    : ROW_LINE_ITEMS_START

  for (let row = startRow; row <= lastRow; row += 1) {
    const labelText = normalizeCellText(rows, row, COL_TOTAL_LABEL)

    if (labelText !== 'net') {
      continue
    }

    const extPrice = toNumberOrNull(getCell(rows, row, COL_EXT_PRICE))

    if (extPrice === null) {
      continue
    }

    const inlineDescription = toOptionalText(getCell(rows, row, COL_DESCRIPTION))
    const sectionDescription = freightSectionRow > 0
      ? toOptionalText(getCell(rows, freightSectionRow, COL_DESCRIPTION))
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

  if (
    normalized.includes('conference table')
    || (normalized.includes('conference') && normalized.includes('table'))
  ) {
    return 'Conference Table'
  }

  return undefined
}

export async function parseExcelQuoteForSync(file: File): Promise<CrmExcelQuoteSyncInput> {
  const workbookBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(workbookBuffer, {
    type: 'array',
    cellDates: true,
  })

  const firstSheetName = workbook.SheetNames[0]

  if (!firstSheetName) {
    throw new Error('The uploaded workbook has no sheets.')
  }

  const sheet = workbook.Sheets[firstSheetName]

  if (!sheet) {
    throw new Error('Could not read the first sheet from the workbook.')
  }

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][]

  const quoteNumber = toOptionalText(getCell(rows, ROW_QUOTE_NUMBER, COL_QUOTE_NUMBER))
    || toOptionalText(getCell(rows, ROW_QUOTE_NUMBER_FALLBACK, COL_QUOTE_NUMBER))

  if (!quoteNumber) {
    throw new Error('No quote number found in H2 (or fallback H1).')
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

  const lineItems = buildLineItems(rows)
  const subtotalResult = findSubtotal(rows)
  const freightInfo = findFreightInfo(rows)

  const payload: CrmExcelQuoteSyncInput = {
    quoteNumber,
    lineItems,
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

  if (subtotalResult.found) {
    payload.subtotal = subtotalResult.subtotal
    payload.totalAmount = Number((subtotalResult.subtotal + freightInfo.freight).toFixed(2))
  }

  if (freightInfo.found) {
    payload.freight = freightInfo.freight
  }

  if (freightInfo.freightDescription) {
    payload.freightDescription = freightInfo.freightDescription
  }

  return payload
}

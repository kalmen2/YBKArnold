import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { formatCurrency } from '../lib/formatters'

type AcknowledgementLine = {
  id: string
  quantity: string
  item: string
  description: string
  cost: string
  total: string
}

type AcknowledgementDraft = {
  date: string
  ackNumber: string
  soldTo: string
  shipTo: string
  rep: string
  poNumber: string
  customerPoDate: string
  terms: string
  shipVia: string
  estimatedCompletionWeekOf: string
  lines: AcknowledgementLine[]
}

type LineField = Exclude<keyof AcknowledgementLine, 'id'>
type ScalarField = Exclude<keyof AcknowledgementDraft, 'lines'>

const ACKNOWLEDGEMENT_STORAGE_KEY = 'templates.acknowledgement.overlay.v1'

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792

const DEFAULT_LINE_COUNT = 10
const SINGLE_PAGE_FINAL_LINE_CAPACITY = 12
const FIRST_NON_LAST_PAGE_LINE_CAPACITY = 16
const CONTINUATION_PAGE_LINE_CAPACITY = 20
const CONTINUATION_FINAL_PAGE_LINE_CAPACITY = 19

const ROW_HEIGHT = 22
const BASE_LINE_ROW_HEIGHT = 24
const EXTRA_DESCRIPTION_LINE_HEIGHT = 10
const DESCRIPTION_WRAP_CHAR_LIMIT = 46
const MAX_DESCRIPTION_WRAP_LINES = 4
const ADDRESS_WRAP_CHAR_LIMIT = 30
const ADDRESS_TEXT_LINE_HEIGHT = 14
const ADDRESS_TEXT_VERTICAL_PADDING = 6

const SINGLE_PAGE_FINAL_ROW_SPACE = SINGLE_PAGE_FINAL_LINE_CAPACITY * ROW_HEIGHT
const FIRST_NON_LAST_PAGE_ROW_SPACE = FIRST_NON_LAST_PAGE_LINE_CAPACITY * ROW_HEIGHT
const CONTINUATION_PAGE_ROW_SPACE = CONTINUATION_PAGE_LINE_CAPACITY * ROW_HEIGHT
const CONTINUATION_FINAL_PAGE_ROW_SPACE = CONTINUATION_FINAL_PAGE_LINE_CAPACITY * ROW_HEIGHT

const ROW_TOP_START = 336
const CONTINUATION_ROW_TOP_START = 172

const TABLE_LEFT = 38
const TABLE_QTY_RIGHT = 77
const TABLE_ITEM_RIGHT = 138
const TABLE_DESCRIPTION_RIGHT = 453
const TABLE_COST_RIGHT = 513
const TABLE_RIGHT = 573

const TABLE_COLUMN_LINES = [
  TABLE_LEFT,
  TABLE_QTY_RIGHT,
  TABLE_ITEM_RIGHT,
  TABLE_DESCRIPTION_RIGHT,
  TABLE_COST_RIGHT,
  TABLE_RIGHT,
]

const LEAD_TIMES_SECTION_TOP = 618
const LEAD_TIMES_GAP_BELOW_TABLE = 8

const TOTAL_BOX_LEFT = 379
const TOTAL_BOX_RIGHT = 573
const TOTAL_BOX_SPLIT = 453
const TOTAL_BOX_HEIGHT = 31

const FOOTER_FIXED_TOP = 646

const SOLD_TO_LEFT = 38
const SOLD_TO_RIGHT = 286
const SHIP_TO_LEFT = 331
const SHIP_TO_RIGHT = 573
const ADDRESS_BOX_TOP = 162
const ADDRESS_BOX_HEADER_BOTTOM = 184
const ADDRESS_BOX_BOTTOM = 238
const ADDRESS_BOX_BODY_MIN_HEIGHT = ADDRESS_BOX_BOTTOM - ADDRESS_BOX_HEADER_BOTTOM

const ORDER_META_TOP = 266
const ORDER_META_HEADER_BOTTOM = ORDER_META_TOP + ROW_HEIGHT
const ORDER_META_BOTTOM = ORDER_META_HEADER_BOTTOM + ROW_HEIGHT
const ORDER_META_COLS = [38, 90, 220, 294, 366, 457, 573]

const ADDRESS_TO_META_GAP = ORDER_META_TOP - ADDRESS_BOX_BOTTOM
const META_TO_TABLE_GAP = ROW_TOP_START - ORDER_META_BOTTOM
const FIRST_PAGE_NON_LAST_TABLE_BOTTOM_LIMIT = ROW_TOP_START + FIRST_NON_LAST_PAGE_ROW_SPACE
const FIRST_PAGE_FINAL_TABLE_BOTTOM_LIMIT = LEAD_TIMES_SECTION_TOP - LEAD_TIMES_GAP_BELOW_TABLE

const ACK_BOX_LEFT = 442
const ACK_BOX_RIGHT = 575
const ACK_BOX_TOP = 66
const ACK_BOX_HEADER_BOTTOM = 88
const ACK_BOX_BOTTOM = 111
const ACK_BOX_SPLIT_X = 508

function createLineId() {
  return `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function createBlankLine(): AcknowledgementLine {
  return {
    id: createLineId(),
    quantity: '',
    item: '',
    description: '',
    cost: '',
    total: '',
  }
}

function createDefaultLines(count: number) {
  const boundedCount = Math.max(1, count)
  return Array.from({ length: boundedCount }, () => createBlankLine())
}

function toInputDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildBlankDraft(): AcknowledgementDraft {
  return {
    date: toInputDate(new Date()),
    ackNumber: '',
    soldTo: '',
    shipTo: '',
    rep: '',
    poNumber: '',
    customerPoDate: '',
    terms: '',
    shipVia: '',
    estimatedCompletionWeekOf: '',
    lines: createDefaultLines(DEFAULT_LINE_COUNT),
  }
}

function normalizeStoredLine(value: unknown): AcknowledgementLine | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const line = value as Partial<AcknowledgementLine>

  return {
    id: String(line.id || createLineId()),
    quantity: String(line.quantity ?? ''),
    item: String(line.item ?? ''),
    description: String(line.description ?? ''),
    cost: String(line.cost ?? ''),
    total: String(line.total ?? ''),
  }
}

function readStoredDraft(): AcknowledgementDraft | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(ACKNOWLEDGEMENT_STORAGE_KEY)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<AcknowledgementDraft>
    const parsedLines = Array.isArray(parsed.lines)
      ? parsed.lines
        .map((line) => normalizeStoredLine(line))
        .filter((line): line is AcknowledgementLine => Boolean(line))
      : []

    return {
      date: String(parsed.date || toInputDate(new Date())),
      ackNumber: String(parsed.ackNumber || ''),
      soldTo: String(parsed.soldTo || ''),
      shipTo: String(parsed.shipTo || ''),
      rep: String(parsed.rep || ''),
      poNumber: String(parsed.poNumber || ''),
      customerPoDate: String(parsed.customerPoDate || ''),
      terms: String(parsed.terms || ''),
      shipVia: String(parsed.shipVia || ''),
      estimatedCompletionWeekOf: String(parsed.estimatedCompletionWeekOf || ''),
      lines: parsedLines.length > 0 ? parsedLines : createDefaultLines(DEFAULT_LINE_COUNT),
    }
  } catch {
    return null
  }
}

function parseMoneyInput(rawValue: string): number | null {
  const normalized = String(rawValue || '').replace(/[$,\s]/g, '')

  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function resolveLineAmount(line: AcknowledgementLine): number | null {
  const quantity = parseMoneyInput(line.quantity)
  const cost = parseMoneyInput(line.cost)

  if (quantity === null || cost === null) {
    return null
  }

  return quantity * cost
}

function estimateWrappedVisualLines(rawValue: string, wrapCharLimit: number, maxLines?: number) {
  const normalized = String(rawValue || '').replace(/\r/g, '')

  if (!normalized.trim()) {
    return 1
  }

  const paragraphs = normalized.split('\n')
  let totalLines = 0

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim()

    if (!trimmedParagraph) {
      totalLines += 1
      continue
    }

    let paragraphLines = 1
    let currentLineLength = 0

    for (const word of trimmedParagraph.split(/\s+/)) {
      const wordLength = Math.max(1, word.length)

      if (wordLength > wrapCharLimit) {
        if (currentLineLength > 0) {
          paragraphLines += 1
          currentLineLength = 0
        }

        paragraphLines += Math.ceil(wordLength / wrapCharLimit) - 1
        currentLineLength = wordLength % wrapCharLimit || wrapCharLimit
        continue
      }

      const nextLength = currentLineLength === 0 ? wordLength : currentLineLength + 1 + wordLength

      if (nextLength > wrapCharLimit) {
        paragraphLines += 1
        currentLineLength = wordLength
      } else {
        currentLineLength = nextLength
      }
    }

    totalLines += paragraphLines
  }

  const boundedLines = Math.max(1, totalLines)
  if (typeof maxLines === 'number') {
    return Math.min(maxLines, boundedLines)
  }

  return boundedLines
}

function estimateDescriptionVisualLines(rawDescription: string) {
  return estimateWrappedVisualLines(rawDescription, DESCRIPTION_WRAP_CHAR_LIMIT, MAX_DESCRIPTION_WRAP_LINES)
}

function resolveLineRowHeight(line: AcknowledgementLine) {
  const visualLines = estimateDescriptionVisualLines(line.description)
  return BASE_LINE_ROW_HEIGHT + ((visualLines - 1) * EXTRA_DESCRIPTION_LINE_HEIGHT)
}

function resolveAddressBodyHeight(rawValue: string) {
  const visualLines = estimateWrappedVisualLines(rawValue, ADDRESS_WRAP_CHAR_LIMIT)
  return Math.max(
    ADDRESS_BOX_BODY_MIN_HEIGHT,
    (visualLines * ADDRESS_TEXT_LINE_HEIGHT) + ADDRESS_TEXT_VERTICAL_PADDING,
  )
}

function formatMoneyDisplay(rawValue: string): string {
  const parsed = parseMoneyInput(rawValue)

  if (parsed === null) {
    return ''
  }

  return formatCurrency(parsed, 2)
}

function stripMoneyFormatting(rawValue: string): string {
  return String(rawValue || '').replace(/[$,\s]/g, '')
}

function toPercentLeft(px: number) {
  return `${(px / PAGE_WIDTH) * 100}%`
}

function toPercentTop(px: number) {
  return `${(px / PAGE_HEIGHT) * 100}%`
}

function toPercentWidth(px: number) {
  return `${(px / PAGE_WIDTH) * 100}%`
}

function toPercentHeight(px: number) {
  return `${(px / PAGE_HEIGHT) * 100}%`
}

function rectangleStyle(left: number, top: number, width: number, height: number) {
  return {
    left: toPercentLeft(left),
    top: toPercentTop(top),
    width: toPercentWidth(width),
    height: toPercentHeight(height),
  }
}

function buildLinePages(
  lines: AcknowledgementLine[],
  options?: {
    firstPageFinalRowSpace?: number
    firstPageNonLastRowSpace?: number
  },
) {
  const source = lines.length > 0 ? lines : createDefaultLines(1)
  const sourceWithHeights = source.map((line) => ({ line, rowHeight: resolveLineRowHeight(line) }))
  const firstPageFinalRowSpace = options?.firstPageFinalRowSpace ?? SINGLE_PAGE_FINAL_ROW_SPACE
  const firstPageNonLastRowSpace = options?.firstPageNonLastRowSpace ?? FIRST_NON_LAST_PAGE_ROW_SPACE

  const totalHeight = sourceWithHeights.reduce((sum, entry) => sum + entry.rowHeight, 0)

  if (totalHeight <= firstPageFinalRowSpace) {
    return [sourceWithHeights.map((entry) => entry.line)]
  }

  const pages: AcknowledgementLine[][] = []
  let cursor = 0

  const takePage = (heightLimit: number, keepAtLeastOneRemaining: boolean) => {
    let usedHeight = 0
    let takeCount = 0

    while (cursor + takeCount < sourceWithHeights.length) {
      const nextHeight = sourceWithHeights[cursor + takeCount].rowHeight
      const candidateHeight = usedHeight + nextHeight
      const wouldConsumeAll = cursor + takeCount + 1 >= sourceWithHeights.length

      if (takeCount > 0 && candidateHeight > heightLimit) {
        break
      }

      if (keepAtLeastOneRemaining && wouldConsumeAll) {
        break
      }

      usedHeight = candidateHeight
      takeCount += 1
    }

    if (takeCount === 0) {
      takeCount = 1
    }

    pages.push(sourceWithHeights.slice(cursor, cursor + takeCount).map((entry) => entry.line))
    cursor += takeCount
  }

  takePage(firstPageNonLastRowSpace, true)

  while (cursor < sourceWithHeights.length) {
    const remainingEntries = sourceWithHeights.slice(cursor)
    const remainingHeight = remainingEntries.reduce((sum, entry) => sum + entry.rowHeight, 0)

    if (remainingHeight <= CONTINUATION_FINAL_PAGE_ROW_SPACE) {
      pages.push(remainingEntries.map((entry) => entry.line))
      break
    }

    takePage(CONTINUATION_PAGE_ROW_SPACE, true)
  }

  return pages
}

export default function TemplatesPage() {
  const [draft, setDraft] = useState<AcknowledgementDraft>(() => readStoredDraft() ?? buildBlankDraft())

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(ACKNOWLEDGEMENT_STORAGE_KEY, JSON.stringify(draft))
  }, [draft])

  const grandTotal = useMemo(
    () => draft.lines.reduce((sum, line) => sum + (resolveLineAmount(line) ?? 0), 0),
    [draft.lines],
  )

  const firstPageLayout = useMemo(() => {
    const soldToBodyHeight = resolveAddressBodyHeight(draft.soldTo)
    const shipToBodyHeight = resolveAddressBodyHeight(draft.shipTo)
    const addressBodyHeight = Math.max(soldToBodyHeight, shipToBodyHeight)
    const addressBoxBottom = ADDRESS_BOX_HEADER_BOTTOM + addressBodyHeight

    const orderMetaTop = Math.max(ORDER_META_TOP, addressBoxBottom + ADDRESS_TO_META_GAP)
    const orderMetaHeaderBottom = orderMetaTop + ROW_HEIGHT
    const orderMetaBottom = orderMetaHeaderBottom + ROW_HEIGHT
    const firstPageRowTop = Math.max(ROW_TOP_START, orderMetaBottom + META_TO_TABLE_GAP)

    const firstPageFinalRowSpace = Math.max(
      BASE_LINE_ROW_HEIGHT,
      FIRST_PAGE_FINAL_TABLE_BOTTOM_LIMIT - firstPageRowTop,
    )
    const firstPageNonLastRowSpace = Math.max(
      BASE_LINE_ROW_HEIGHT,
      FIRST_PAGE_NON_LAST_TABLE_BOTTOM_LIMIT - firstPageRowTop,
    )

    return {
      addressBoxBottom,
      orderMetaTop,
      orderMetaHeaderBottom,
      orderMetaBottom,
      firstPageRowTop,
      firstPageFinalRowSpace,
      firstPageNonLastRowSpace,
    }
  }, [draft.soldTo, draft.shipTo])

  const linePages = useMemo(
    () => buildLinePages(draft.lines, {
      firstPageFinalRowSpace: firstPageLayout.firstPageFinalRowSpace,
      firstPageNonLastRowSpace: firstPageLayout.firstPageNonLastRowSpace,
    }),
    [draft.lines, firstPageLayout.firstPageFinalRowSpace, firstPageLayout.firstPageNonLastRowSpace],
  )

  function updateDraftField<Field extends ScalarField>(field: Field, value: AcknowledgementDraft[Field]) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function updateLineField(lineId: string, field: LineField, value: string) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === lineId ? { ...line, [field]: value } : line)),
    }))
  }

  function normalizeCostForEditing(lineId: string) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (
        line.id === lineId
          ? { ...line, cost: stripMoneyFormatting(line.cost) }
          : line
      )),
    }))
  }

  function formatCostForDisplay(lineId: string) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (
        line.id === lineId
          ? { ...line, cost: formatMoneyDisplay(line.cost) }
          : line
      )),
    }))
  }

  function addLine() {
    setDraft((current) => ({
      ...current,
      lines: [...current.lines, createBlankLine()],
    }))
  }

  function removeLastLine() {
    setDraft((current) => {
      if (current.lines.length <= 1) {
        return current
      }

      return {
        ...current,
        lines: current.lines.slice(0, current.lines.length - 1),
      }
    })
  }

  function resetTemplate() {
    setDraft(buildBlankDraft())
  }

  function handlePrint() {
    window.print()
  }

  return (
    <Stack spacing={2.1} sx={{ pb: 2 }}>
      <style>{`
        @page {
          size: letter;
          margin: 0;
        }

        .template-overlay-input,
        .template-overlay-textarea {
          position: absolute;
          margin: 0;
          padding: 2px 4px;
          border: 1px solid transparent;
          background: transparent;
          color: #0f172a;
          caret-color: #0f172a;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 12px;
          line-height: 1.2;
          box-sizing: border-box;
          outline: none;
          z-index: 2;
        }

        .template-overlay-textarea {
          resize: none;
          overflow: hidden;
          white-space: pre-wrap;
        }

        .template-overlay-line-input,
        .template-overlay-line-textarea {
          font-size: 13px;
          line-height: 1.25;
        }

        .template-overlay-line-textarea {
          overflow: hidden;
          white-space: pre-wrap;
        }

        .template-overlay-currency {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .template-overlay-input:focus,
        .template-overlay-textarea:focus {
          border-color: rgba(15, 23, 42, 0.35);
          background: rgba(255, 255, 255, 0.55);
        }

        @media print {
          html,
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          body * {
            visibility: hidden !important;
          }

          .template-print-wrap,
          .template-print-wrap * {
            visibility: visible !important;
          }

          .template-controls {
            display: none !important;
          }

          .template-print-wrap {
            margin: 0 auto !important;
            padding: 0 !important;
            width: 100% !important;
            display: block !important;
            background: #ffffff !important;
          }

          .template-sheet {
            width: 8.5in !important;
            height: 11in !important;
            max-width: none !important;
            aspect-ratio: auto !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 auto !important;
            background: #ffffff !important;
            break-after: auto;
            page-break-after: auto;
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .template-sheet + .template-sheet {
            break-before: page;
            page-break-before: always;
          }

          .template-overlay-input,
          .template-overlay-textarea {
            border: none !important;
          }
        }
      `}</style>

      <Paper className="template-controls" variant="outlined" sx={{ p: 1.4, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.1} justifyContent="space-between" alignItems={{ md: 'center' }}>
          <Stack spacing={0.2}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Acknowledgement Template
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Rebuilt with native HTML/SVG layout for stable multi-page printing.
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={addLine}>
              Add line
            </Button>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<DeleteOutlineRoundedIcon />}
              onClick={removeLastLine}
              disabled={draft.lines.length <= 1}
            >
              Remove line
            </Button>
            <Button variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={resetTemplate}>
              Clear
            </Button>
            <Button variant="contained" startIcon={<PrintRoundedIcon />} onClick={handlePrint}>
              Print
            </Button>
          </Stack>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.6, display: 'block' }}>
          Rows: {draft.lines.length} | Pages: {linePages.length} | Grand Total: {formatCurrency(grandTotal, 2)}
        </Typography>
      </Paper>

      <Box className="template-print-wrap" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        {linePages.map((pageLines, pageIndex) => {
          const lineStartIndex = linePages
            .slice(0, pageIndex)
            .reduce((sum, currentPage) => sum + currentPage.length, 0)

          const isFirstPage = pageIndex === 0
          const isLastPage = pageIndex === linePages.length - 1

          const rowTopBase = isFirstPage ? firstPageLayout.firstPageRowTop : CONTINUATION_ROW_TOP_START
          const tableHeaderTop = rowTopBase - ROW_HEIGHT
          const pageRowHeights = pageLines.map((line) => resolveLineRowHeight(line))
          const rowBoundaries = [rowTopBase]

          for (const rowHeight of pageRowHeights) {
            rowBoundaries.push(rowBoundaries[rowBoundaries.length - 1] + rowHeight)
          }

          const tableBottomY = rowBoundaries[rowBoundaries.length - 1]
          const pageRowLayouts = pageLines.map((line, index) => ({
            line,
            absoluteIndex: lineStartIndex + index,
            top: rowBoundaries[index],
            rowHeight: pageRowHeights[index],
          }))

          const leadTimesTop = Math.min(
            LEAD_TIMES_SECTION_TOP,
            tableBottomY + LEAD_TIMES_GAP_BELOW_TABLE,
          )

          return (
            <Box
              key={`template-page-${String(pageIndex)}`}
              className="template-sheet"
              sx={{
                position: 'relative',
                width: '100%',
                maxWidth: '8.5in',
                aspectRatio: `${PAGE_WIDTH} / ${PAGE_HEIGHT}`,
                border: '1px solid #111827',
                boxShadow: '0 12px 32px rgba(15, 23, 42, 0.22)',
                overflow: 'hidden',
                backgroundColor: '#ffffff',
              }}
            >
              <Box
                component="svg"
                viewBox={`0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}`}
                aria-hidden="true"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              >
                <rect x="0" y="0" width={PAGE_WIDTH} height={PAGE_HEIGHT} fill="#ffffff" />

                <>
                  <rect x="38" y="36" width="66" height="66" fill="#c70b0b" stroke="#8f0000" strokeWidth="1" />
                  <circle cx="83" cy="84" r="16" fill="none" stroke="#d6c4c4" strokeWidth="3" />

                  <text
                    x="110"
                    y="54"
                    fontSize="14"
                    fill="#111827"
                    fontWeight="700"
                    fontFamily="Arial, Helvetica, sans-serif"
                  >
                    ARNOLD  KOLAX FURNITURE, INC
                  </text>
                  <text x="110" y="67" fontSize="9" fill="#111827" fontFamily="Arial, Helvetica, sans-serif">120 COIT STREET</text>
                  <text x="110" y="78" fontSize="9" fill="#111827" fontFamily="Arial, Helvetica, sans-serif">IRVINGTON</text>
                  <text x="110" y="89" fontSize="9" fill="#111827" fontFamily="Arial, Helvetica, sans-serif">NJ 07111</text>
                  <text x="110" y="102" fontSize="8" fill="#6b7280" fontFamily="Arial, Helvetica, sans-serif">Phone #   973-375-8101</text>

                  <text
                    x="508"
                    y="53"
                    textAnchor="middle"
                    fontSize="12"
                    fill="#111827"
                    fontWeight="700"
                    fontFamily="Arial, Helvetica, sans-serif"
                  >
                    ACKNOWLEDGEMENT
                  </text>

                  <rect x={ACK_BOX_LEFT} y={ACK_BOX_TOP} width={ACK_BOX_RIGHT - ACK_BOX_LEFT} height={ACK_BOX_BOTTOM - ACK_BOX_TOP} fill="none" stroke="#111827" strokeWidth="1.3" />
                  <rect x={ACK_BOX_LEFT} y={ACK_BOX_TOP} width={ACK_BOX_RIGHT - ACK_BOX_LEFT} height={ACK_BOX_HEADER_BOTTOM - ACK_BOX_TOP} fill="#7d7d7d" />
                  <line x1={ACK_BOX_LEFT} y1={ACK_BOX_HEADER_BOTTOM} x2={ACK_BOX_RIGHT} y2={ACK_BOX_HEADER_BOTTOM} stroke="#111827" strokeWidth="1.1" />
                  <line x1={ACK_BOX_SPLIT_X} y1={ACK_BOX_TOP} x2={ACK_BOX_SPLIT_X} y2={ACK_BOX_BOTTOM} stroke="#111827" strokeWidth="1.1" />

                  <text x="474" y="81" textAnchor="middle" fontSize="10" fill="#ffffff" fontWeight="700" fontFamily="Arial, Helvetica, sans-serif">Date</text>
                  <text x="541" y="81" textAnchor="middle" fontSize="10" fill="#ffffff" fontWeight="700" fontFamily="Arial, Helvetica, sans-serif">ACK #</text>

                  {!isFirstPage ? (
                    <>
                      <text
                        x={(ACK_BOX_LEFT + ACK_BOX_SPLIT_X) / 2}
                        y="103"
                        textAnchor="middle"
                        fontSize="9"
                        fill="#111827"
                        fontFamily="Arial, Helvetica, sans-serif"
                      >
                        {draft.date}
                      </text>
                      <text
                        x={(ACK_BOX_SPLIT_X + ACK_BOX_RIGHT) / 2}
                        y="103"
                        textAnchor="middle"
                        fontSize="9"
                        fill="#111827"
                        fontFamily="Arial, Helvetica, sans-serif"
                      >
                        {draft.ackNumber}
                      </text>
                    </>
                  ) : null}
                </>

                {isFirstPage ? (
                  <>
                    <rect x={SOLD_TO_LEFT} y={ADDRESS_BOX_TOP} width={SOLD_TO_RIGHT - SOLD_TO_LEFT} height={firstPageLayout.addressBoxBottom - ADDRESS_BOX_TOP} fill="none" stroke="#111827" strokeWidth="1.1" />
                    <rect x={SOLD_TO_LEFT} y={ADDRESS_BOX_TOP} width={SOLD_TO_RIGHT - SOLD_TO_LEFT} height={ADDRESS_BOX_HEADER_BOTTOM - ADDRESS_BOX_TOP} fill="#7d7d7d" />
                    <line x1={SOLD_TO_LEFT} y1={ADDRESS_BOX_HEADER_BOTTOM} x2={SOLD_TO_RIGHT} y2={ADDRESS_BOX_HEADER_BOTTOM} stroke="#111827" strokeWidth="1.1" />
                    <text x="51" y="178" fontSize="10" fill="#ffffff" fontWeight="700" fontFamily="Arial, Helvetica, sans-serif">Sold To</text>

                    <rect x={SHIP_TO_LEFT} y={ADDRESS_BOX_TOP} width={SHIP_TO_RIGHT - SHIP_TO_LEFT} height={firstPageLayout.addressBoxBottom - ADDRESS_BOX_TOP} fill="none" stroke="#111827" strokeWidth="1.1" />
                    <rect x={SHIP_TO_LEFT} y={ADDRESS_BOX_TOP} width={SHIP_TO_RIGHT - SHIP_TO_LEFT} height={ADDRESS_BOX_HEADER_BOTTOM - ADDRESS_BOX_TOP} fill="#7d7d7d" />
                    <line x1={SHIP_TO_LEFT} y1={ADDRESS_BOX_HEADER_BOTTOM} x2={SHIP_TO_RIGHT} y2={ADDRESS_BOX_HEADER_BOTTOM} stroke="#111827" strokeWidth="1.1" />
                    <text x="344" y="178" fontSize="10" fill="#ffffff" fontWeight="700" fontFamily="Arial, Helvetica, sans-serif">Ship To</text>

                    <rect x={ORDER_META_COLS[0]} y={firstPageLayout.orderMetaTop} width={ORDER_META_COLS[ORDER_META_COLS.length - 1] - ORDER_META_COLS[0]} height={firstPageLayout.orderMetaBottom - firstPageLayout.orderMetaTop} fill="none" stroke="#111827" strokeWidth="1.1" />
                    <rect x={ORDER_META_COLS[0]} y={firstPageLayout.orderMetaTop} width={ORDER_META_COLS[ORDER_META_COLS.length - 1] - ORDER_META_COLS[0]} height={ROW_HEIGHT} fill="#7d7d7d" />
                    <line x1={ORDER_META_COLS[0]} y1={firstPageLayout.orderMetaHeaderBottom} x2={ORDER_META_COLS[ORDER_META_COLS.length - 1]} y2={firstPageLayout.orderMetaHeaderBottom} stroke="#111827" strokeWidth="1.1" />

                    {ORDER_META_COLS.slice(1, ORDER_META_COLS.length - 1).map((x) => (
                      <line key={`order-meta-col-${String(x)}`} x1={x} y1={firstPageLayout.orderMetaTop} x2={x} y2={firstPageLayout.orderMetaBottom} stroke="#111827" strokeWidth="1.1" />
                    ))}

                    {[
                      { label: 'Rep', x: (ORDER_META_COLS[0] + ORDER_META_COLS[1]) / 2 },
                      { label: 'P.O. No.', x: (ORDER_META_COLS[1] + ORDER_META_COLS[2]) / 2 },
                      { label: 'Cust. PO Date', x: (ORDER_META_COLS[2] + ORDER_META_COLS[3]) / 2 },
                      { label: 'Terms', x: (ORDER_META_COLS[3] + ORDER_META_COLS[4]) / 2 },
                      { label: 'Ship Via', x: (ORDER_META_COLS[4] + ORDER_META_COLS[5]) / 2 },
                      { label: 'Estd. Completion Week Of', x: (ORDER_META_COLS[5] + ORDER_META_COLS[6]) / 2 },
                    ].map((entry) => (
                      <text
                        key={`order-meta-label-${entry.label}`}
                        x={entry.x}
                        y={firstPageLayout.orderMetaTop + 15}
                        textAnchor="middle"
                        fontSize="8"
                        fill="#ffffff"
                        fontWeight="700"
                        fontFamily="Arial, Helvetica, sans-serif"
                      >
                        {entry.label}
                      </text>
                    ))}
                  </>
                ) : null}

                {pageRowLayouts.map(({ absoluteIndex, top, rowHeight }) => {
                  if (absoluteIndex % 2 === 0) {
                    return null
                  }

                  return (
                    <rect
                      key={`row-shade-${String(pageIndex)}-${String(absoluteIndex)}`}
                      x={TABLE_LEFT}
                      y={top}
                      width={TABLE_RIGHT - TABLE_LEFT}
                      height={rowHeight}
                      fill="#0f172a"
                      fillOpacity="0.18"
                    />
                  )
                })}

                <rect
                  x={TABLE_LEFT}
                  y={tableHeaderTop}
                  width={TABLE_RIGHT - TABLE_LEFT}
                  height={ROW_HEIGHT}
                  fill="#7d7d7d"
                />

                <rect
                  x={TABLE_LEFT}
                  y={tableHeaderTop}
                  width={TABLE_RIGHT - TABLE_LEFT}
                  height={tableBottomY - tableHeaderTop}
                  fill="none"
                  stroke="#111827"
                  strokeWidth="1.2"
                />

                {TABLE_COLUMN_LINES.slice(1, TABLE_COLUMN_LINES.length - 1).map((x) => (
                  <line
                    key={`table-col-${String(pageIndex)}-${String(x)}`}
                    x1={x}
                    y1={tableHeaderTop}
                    x2={x}
                    y2={tableBottomY}
                    stroke="#111827"
                    strokeWidth="1.1"
                  />
                ))}

                {rowBoundaries.map((y, index) => (
                  <line
                    key={`row-line-${String(pageIndex)}-${String(index)}`}
                    x1={TABLE_LEFT}
                    y1={y}
                    x2={TABLE_RIGHT}
                    y2={y}
                    stroke="#111827"
                    strokeWidth={index === rowBoundaries.length - 1 ? '1.2' : '1'}
                  />
                ))}

                {[
                  { label: 'Qty', x: (TABLE_LEFT + TABLE_QTY_RIGHT) / 2 },
                  { label: 'Item', x: (TABLE_QTY_RIGHT + TABLE_ITEM_RIGHT) / 2 },
                  { label: 'Description', x: (TABLE_ITEM_RIGHT + TABLE_DESCRIPTION_RIGHT) / 2 },
                  { label: 'Cost', x: (TABLE_DESCRIPTION_RIGHT + TABLE_COST_RIGHT) / 2 },
                  { label: 'Total', x: (TABLE_COST_RIGHT + TABLE_RIGHT) / 2 },
                ].map((entry) => (
                  <text
                    key={`table-head-${entry.label}`}
                    x={entry.x}
                    y={tableHeaderTop + 15}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#ffffff"
                    fontWeight="700"
                    fontFamily="Arial, Helvetica, sans-serif"
                  >
                    {entry.label}
                  </text>
                ))}

                {isLastPage ? (
                  <>
                    <text
                      x="230"
                      y={leadTimesTop + 11}
                      textAnchor="middle"
                      fontSize="11"
                      fill="#111827"
                      fontWeight="700"
                      fontFamily="Times New Roman, Georgia, serif"
                    >
                      *Lead-times are subjected to change, based on the volume of
                    </text>
                    <text
                      x="230"
                      y={leadTimesTop + 30}
                      textAnchor="middle"
                      fontSize="11"
                      fill="#111827"
                      fontWeight="700"
                      fontFamily="Times New Roman, Georgia, serif"
                    >
                      work inhouse!
                    </text>

                    <rect
                      x={TOTAL_BOX_LEFT}
                      y={leadTimesTop}
                      width={TOTAL_BOX_RIGHT - TOTAL_BOX_LEFT}
                      height={TOTAL_BOX_HEIGHT}
                      fill="none"
                      stroke="#111827"
                      strokeWidth="1.2"
                    />
                    <line
                      x1={TOTAL_BOX_SPLIT}
                      y1={leadTimesTop}
                      x2={TOTAL_BOX_SPLIT}
                      y2={leadTimesTop + TOTAL_BOX_HEIGHT}
                      stroke="#111827"
                      strokeWidth="1.1"
                    />
                    <text
                      x={TOTAL_BOX_LEFT + 18}
                      y={leadTimesTop + 21}
                      fontSize="10"
                      fill="#111827"
                      fontFamily="Arial, Helvetica, sans-serif"
                    >
                      Total
                    </text>
                    <text
                      x={TOTAL_BOX_RIGHT - 12}
                      y={leadTimesTop + 21}
                      textAnchor="end"
                      fontSize="11"
                      fill="#111827"
                      fontWeight="700"
                      fontFamily="Arial, Helvetica, sans-serif"
                    >
                      {formatCurrency(grandTotal, 2)}
                    </text>

                    <text
                      x="306"
                      y={FOOTER_FIXED_TOP + 22}
                      textAnchor="middle"
                      fontSize="8.6"
                      fill="#d35f5f"
                      fontWeight="700"
                      fontFamily="Arial, Helvetica, sans-serif"
                    >
                      PLEASE CHECK THIS ACKNOWLEDGEMENT TO MAKE SURE WE HAVE ENTERED YOUR ORDER EXACTLY AS YOU INTENDED IT TO BE ENTERED.
                    </text>

                    <text
                      x="306"
                      y={FOOTER_FIXED_TOP + 47}
                      textAnchor="middle"
                      fontSize="8.9"
                      fill="#d35f5f"
                      fontWeight="700"
                      fontFamily="Arial, Helvetica, sans-serif"
                    >
                      PLEASE NOTE: CUSTOM MADE AND CUSTOM FINISHED FURNITURE CANNOT BE CANCELLED OR RETURNED.
                    </text>
                    <text
                      x="306"
                      y={FOOTER_FIXED_TOP + 63}
                      textAnchor="middle"
                      fontSize="8.9"
                      fill="#d35f5f"
                      fontWeight="700"
                      fontFamily="Arial, Helvetica, sans-serif"
                    >
                      RETURN WITHOUT AUTHORIZATION NUMBER WILL NOT BE ACCEPTED.
                    </text>

                    <text
                      x="306"
                      y={FOOTER_FIXED_TOP + 92}
                      textAnchor="middle"
                      fontSize="8.2"
                      fill="#111827"
                      fontWeight="700"
                      fontFamily="Arial, Helvetica, sans-serif"
                    >
                      ALL GOODS SOLD FOB IRVINGTON, NJ PRODUCING POINT. THE TRANSPORTATION COMPANY IS YOUR AGENT AND ALL DAMAGE CLAIMS MUST BE
                    </text>
                    <text
                      x="306"
                      y={FOOTER_FIXED_TOP + 106}
                      textAnchor="middle"
                      fontSize="8.2"
                      fill="#111827"
                      fontWeight="700"
                      fontFamily="Arial, Helvetica, sans-serif"
                    >
                      REPORTED TO THEM IMMEDIATELY UPON RECEIPT OF MERCHANDISE.
                    </text>
                  </>
                ) : null}
              </Box>

              {isFirstPage ? (
                <>
                  <input
                    className="template-overlay-input"
                    value={draft.date}
                    onChange={(event) => updateDraftField('date', event.target.value)}
                    style={rectangleStyle(442, 90, 66, 20)}
                    aria-label="Date"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.ackNumber}
                    onChange={(event) => updateDraftField('ackNumber', event.target.value)}
                    style={rectangleStyle(510, 90, 65, 20)}
                    aria-label="ACK number"
                  />

                  <textarea
                    className="template-overlay-textarea"
                    value={draft.soldTo}
                    onChange={(event) => updateDraftField('soldTo', event.target.value)}
                    style={rectangleStyle(40, ADDRESS_BOX_HEADER_BOTTOM + 2, 244, firstPageLayout.addressBoxBottom - ADDRESS_BOX_HEADER_BOTTOM - 4)}
                    aria-label="Sold To"
                  />

                  <textarea
                    className="template-overlay-textarea"
                    value={draft.shipTo}
                    onChange={(event) => updateDraftField('shipTo', event.target.value)}
                    style={rectangleStyle(333, ADDRESS_BOX_HEADER_BOTTOM + 2, 238, firstPageLayout.addressBoxBottom - ADDRESS_BOX_HEADER_BOTTOM - 4)}
                    aria-label="Ship To"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.rep}
                    onChange={(event) => updateDraftField('rep', event.target.value)}
                    style={rectangleStyle(38, firstPageLayout.orderMetaHeaderBottom + 3, 53, 21)}
                    aria-label="Rep"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.poNumber}
                    onChange={(event) => updateDraftField('poNumber', event.target.value)}
                    style={rectangleStyle(94, firstPageLayout.orderMetaHeaderBottom + 3, 124, 21)}
                    aria-label="PO number"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.customerPoDate}
                    onChange={(event) => updateDraftField('customerPoDate', event.target.value)}
                    style={rectangleStyle(220, firstPageLayout.orderMetaHeaderBottom + 3, 71, 21)}
                    aria-label="Customer PO date"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.terms}
                    onChange={(event) => updateDraftField('terms', event.target.value)}
                    style={rectangleStyle(294, firstPageLayout.orderMetaHeaderBottom + 3, 70, 21)}
                    aria-label="Terms"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.shipVia}
                    onChange={(event) => updateDraftField('shipVia', event.target.value)}
                    style={rectangleStyle(366, firstPageLayout.orderMetaHeaderBottom + 3, 88, 21)}
                    aria-label="Ship Via"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.estimatedCompletionWeekOf}
                    onChange={(event) => updateDraftField('estimatedCompletionWeekOf', event.target.value)}
                    style={rectangleStyle(457, firstPageLayout.orderMetaHeaderBottom + 3, 116, 21)}
                    aria-label="Estimated completion week of"
                  />
                </>
              ) : null}

              {pageRowLayouts.map(({ line, top, rowHeight, absoluteIndex }) => {
                const fieldTop = top + 1
                const fieldHeight = Math.max(22, rowHeight - 2)
                const lineTotal = resolveLineAmount(line)

                return (
                  <Fragment key={line.id}>
                    <input
                      className="template-overlay-input template-overlay-line-input"
                      value={line.quantity}
                      onChange={(event) => updateLineField(line.id, 'quantity', event.target.value)}
                      style={rectangleStyle(38, fieldTop, 39, fieldHeight)}
                      inputMode="decimal"
                      aria-label={`Row ${absoluteIndex + 1} quantity`}
                    />

                    <input
                      className="template-overlay-input template-overlay-line-input"
                      value={line.item}
                      onChange={(event) => updateLineField(line.id, 'item', event.target.value)}
                      style={rectangleStyle(79, fieldTop, 59, fieldHeight)}
                      aria-label={`Row ${absoluteIndex + 1} item`}
                    />

                    <textarea
                      className="template-overlay-textarea template-overlay-line-textarea"
                      value={line.description}
                      onChange={(event) => updateLineField(line.id, 'description', event.target.value)}
                      style={rectangleStyle(140, fieldTop, 313, fieldHeight)}
                      aria-label={`Row ${absoluteIndex + 1} description`}
                    />

                    <input
                      className="template-overlay-input template-overlay-line-input template-overlay-currency"
                      value={line.cost}
                      onChange={(event) => updateLineField(line.id, 'cost', event.target.value)}
                      onFocus={() => normalizeCostForEditing(line.id)}
                      onBlur={() => formatCostForDisplay(line.id)}
                      style={rectangleStyle(455, fieldTop, 58, fieldHeight)}
                      inputMode="decimal"
                      aria-label={`Row ${absoluteIndex + 1} cost`}
                    />

                    <input
                      className="template-overlay-input template-overlay-line-input template-overlay-currency"
                      value={lineTotal === null ? '' : formatCurrency(lineTotal, 2)}
                      style={rectangleStyle(515, fieldTop, 58, fieldHeight)}
                      aria-label={`Row ${absoluteIndex + 1} total`}
                      readOnly
                      tabIndex={-1}
                    />
                  </Fragment>
                )
              })}
            </Box>
          )
        })}
      </Box>
    </Stack>
  )
}

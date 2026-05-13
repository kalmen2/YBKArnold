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
const ACK_IMAGE_PATH = '/templates/qb-ack.png'
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const DEFAULT_LINE_COUNT = 10
const SINGLE_PAGE_FINAL_LINE_CAPACITY = 12
const FIRST_NON_LAST_PAGE_LINE_CAPACITY = 16
const CONTINUATION_PAGE_LINE_CAPACITY = 20
const CONTINUATION_FINAL_PAGE_LINE_CAPACITY = 19
const ROW_TOP_START = 336
const CONTINUATION_ROW_TOP_START = 150
const ROW_HEIGHT = 22
const TABLE_LEFT = 38
const TABLE_QTY_RIGHT = 77
const TABLE_ITEM_RIGHT = 138
const TABLE_DESCRIPTION_RIGHT = 453
const TABLE_COST_RIGHT = 513
const TABLE_RIGHT = 573
const CONTINUATION_HEADER_KEEP_BOTTOM = 120
const CONTINUATION_DETAILS_MASK_BOTTOM = 313
const CONTINUATION_TABLE_TOP = 127
const NON_LAST_PAGE_VISIBLE_BOTTOM = 600
const LEAD_TIMES_SECTION_TOP = 618
const LEAD_TIMES_SECTION_BOTTOM = 646
const FOOTER_FIXED_TOP = 646

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

function buildLinePages(lines: AcknowledgementLine[]) {
  const source = lines.length > 0 ? lines : createDefaultLines(1)
  if (source.length <= SINGLE_PAGE_FINAL_LINE_CAPACITY) {
    return [source]
  }

  const pages: AcknowledgementLine[][] = []
  let cursor = 0
  let remaining = source.length

  const firstPageTake = Math.min(FIRST_NON_LAST_PAGE_LINE_CAPACITY, remaining - 1)
  pages.push(source.slice(cursor, cursor + firstPageTake))
  cursor += firstPageTake
  remaining -= firstPageTake

  // Keep continuation pages as full as possible, while reserving footer space for the final page.
  while (remaining > CONTINUATION_FINAL_PAGE_LINE_CAPACITY) {
    const take = Math.min(CONTINUATION_PAGE_LINE_CAPACITY, remaining - CONTINUATION_FINAL_PAGE_LINE_CAPACITY)
    pages.push(source.slice(cursor, cursor + take))
    cursor += take
    remaining -= take
  }

  pages.push(source.slice(cursor, cursor + remaining))
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

  const grandTotal = useMemo(() => (
    draft.lines.reduce((sum, line) => sum + (resolveLineAmount(line) ?? 0), 0)
  ), [draft.lines])

  const linePages = useMemo(() => buildLinePages(draft.lines), [draft.lines])

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
            margin: 0 !important;
            padding: 0 !important;
            width: 8.5in !important;
            display: block !important;
          }

          .template-sheet {
            width: 8.5in !important;
            height: 11in !important;
            max-width: none !important;
            aspect-ratio: auto !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            break-after: page;
            page-break-after: always;
          }

          .template-sheet:last-child {
            break-after: auto;
            page-break-after: auto;
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
              Source locked to QB Ack.pdf for one-to-one visual match.
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button
              variant="outlined"
              startIcon={<AddRoundedIcon />}
              onClick={addLine}
            >
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
          const rowTopBase = isFirstPage ? ROW_TOP_START : CONTINUATION_ROW_TOP_START
          const tableBottomY = rowTopBase + (pageLines.length * ROW_HEIGHT)
          const continuationTableShiftPx = CONTINUATION_TABLE_TOP - CONTINUATION_DETAILS_MASK_BOTTOM
          const continuationTableBottom = isLastPage ? LEAD_TIMES_SECTION_TOP : NON_LAST_PAGE_VISIBLE_BOTTOM
          const leadTimesTargetTop = Math.min(
            LEAD_TIMES_SECTION_TOP,
            Math.max(520, tableBottomY + 8),
          )
          const leadTimesShiftPx = leadTimesTargetTop - LEAD_TIMES_SECTION_TOP

          function buildSliceClipPath(topPx: number, bottomPx: number) {
            return `inset(${toPercentTop(topPx)} 0 ${toPercentTop(PAGE_HEIGHT - bottomPx)} 0)`
          }

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
                backgroundColor: '#fff',
              }}
            >
              {isFirstPage ? (
                <img
                  src={ACK_IMAGE_PATH}
                  alt="Acknowledgement template background"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    userSelect: 'none',
                    pointerEvents: 'none',
                    zIndex: 1,
                    clipPath: isLastPage ? undefined : buildSliceClipPath(0, NON_LAST_PAGE_VISIBLE_BOTTOM),
                  }}
                />
              ) : (
                <>
                  <img
                    src={ACK_IMAGE_PATH}
                    alt="Acknowledgement template background header"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      userSelect: 'none',
                      pointerEvents: 'none',
                      zIndex: 1,
                      clipPath: buildSliceClipPath(0, CONTINUATION_HEADER_KEEP_BOTTOM),
                    }}
                  />
                  <img
                    src={ACK_IMAGE_PATH}
                    alt="Acknowledgement template background table"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      userSelect: 'none',
                      pointerEvents: 'none',
                      zIndex: 1,
                      clipPath: buildSliceClipPath(CONTINUATION_DETAILS_MASK_BOTTOM, continuationTableBottom),
                      transform: `translateY(${continuationTableShiftPx}px)`,
                    }}
                  />

                  {isLastPage ? (
                      <>
                        <img
                          src={ACK_IMAGE_PATH}
                          alt="Acknowledgement template background lead times"
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            userSelect: 'none',
                            pointerEvents: 'none',
                            zIndex: 1,
                            clipPath: buildSliceClipPath(LEAD_TIMES_SECTION_TOP, LEAD_TIMES_SECTION_BOTTOM),
                            transform: `translateY(${leadTimesShiftPx}px)`,
                          }}
                        />
                        <img
                          src={ACK_IMAGE_PATH}
                          alt="Acknowledgement template background footer"
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            userSelect: 'none',
                            pointerEvents: 'none',
                            zIndex: 1,
                            clipPath: buildSliceClipPath(FOOTER_FIXED_TOP, PAGE_HEIGHT),
                          }}
                        />
                      </>
                  ) : null}
                </>
              )}

              {!isLastPage ? (
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
                    zIndex: 1.7,
                  }}
                >
                  {tableBottomY > NON_LAST_PAGE_VISIBLE_BOTTOM
                    ? [TABLE_LEFT, TABLE_QTY_RIGHT, TABLE_ITEM_RIGHT, TABLE_DESCRIPTION_RIGHT, TABLE_COST_RIGHT, TABLE_RIGHT].map((x, index) => (
                      <line
                        key={`extension-column-${String(index)}`}
                        x1={x}
                        y1={NON_LAST_PAGE_VISIBLE_BOTTOM}
                        x2={x}
                        y2={tableBottomY}
                        stroke="#111827"
                        strokeWidth="1"
                      />
                    ))
                    : null}

                  {tableBottomY > NON_LAST_PAGE_VISIBLE_BOTTOM
                    ? Array.from(
                      { length: Math.floor((tableBottomY - NON_LAST_PAGE_VISIBLE_BOTTOM) / ROW_HEIGHT) + 1 },
                      (_, index) => NON_LAST_PAGE_VISIBLE_BOTTOM + (index * ROW_HEIGHT),
                    ).map((y, index) => (
                      <line
                        key={`extension-row-${String(index)}`}
                        x1={TABLE_LEFT}
                        y1={y}
                        x2={TABLE_RIGHT}
                        y2={y}
                        stroke="#111827"
                        strokeWidth="1"
                      />
                    ))
                    : null}

                  <line
                    x1={TABLE_LEFT}
                    y1={tableBottomY}
                    x2={TABLE_RIGHT}
                    y2={tableBottomY}
                    stroke="#111827"
                    strokeWidth="1.2"
                  />
                </Box>
              ) : null}

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

              {isFirstPage ? (
                <>
                  <textarea
                    className="template-overlay-textarea"
                    value={draft.soldTo}
                    onChange={(event) => updateDraftField('soldTo', event.target.value)}
                    style={rectangleStyle(40, 154, 238, 88)}
                    aria-label="Sold To"
                  />

                  <textarea
                    className="template-overlay-textarea"
                    value={draft.shipTo}
                    onChange={(event) => updateDraftField('shipTo', event.target.value)}
                    style={rectangleStyle(331, 154, 242, 88)}
                    aria-label="Ship To"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.rep}
                    onChange={(event) => updateDraftField('rep', event.target.value)}
                    style={rectangleStyle(38, 291, 53, 21)}
                    aria-label="Rep"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.poNumber}
                    onChange={(event) => updateDraftField('poNumber', event.target.value)}
                    style={rectangleStyle(94, 291, 124, 21)}
                    aria-label="PO number"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.customerPoDate}
                    onChange={(event) => updateDraftField('customerPoDate', event.target.value)}
                    style={rectangleStyle(220, 291, 71, 21)}
                    aria-label="Customer PO date"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.terms}
                    onChange={(event) => updateDraftField('terms', event.target.value)}
                    style={rectangleStyle(294, 291, 70, 21)}
                    aria-label="Terms"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.shipVia}
                    onChange={(event) => updateDraftField('shipVia', event.target.value)}
                    style={rectangleStyle(366, 291, 88, 21)}
                    aria-label="Ship Via"
                  />

                  <input
                    className="template-overlay-input"
                    value={draft.estimatedCompletionWeekOf}
                    onChange={(event) => updateDraftField('estimatedCompletionWeekOf', event.target.value)}
                    style={rectangleStyle(457, 291, 116, 21)}
                    aria-label="Estimated completion week of"
                  />
                </>
              ) : null}

              {pageLines.map((line, index) => {
                const top = rowTopBase + (index * ROW_HEIGHT)
                const absoluteIndex = lineStartIndex + index
                const lineTotal = resolveLineAmount(line)
                const isAlternatingRow = absoluteIndex % 2 === 1

                return (
                  <Fragment key={line.id}>
                    {isAlternatingRow ? (
                      <Box
                        sx={{
                          position: 'absolute',
                          ...rectangleStyle(38, top, 535, 21),
                          backgroundColor: 'rgba(15, 23, 42, 0.12)',
                          zIndex: 1.5,
                          pointerEvents: 'none',
                        }}
                      />
                    ) : null}

                    <input
                      className="template-overlay-input"
                      value={line.quantity}
                      onChange={(event) => updateLineField(line.id, 'quantity', event.target.value)}
                      style={rectangleStyle(38, top, 39, 21)}
                      inputMode="decimal"
                      aria-label={`Row ${absoluteIndex + 1} quantity`}
                    />

                    <input
                      className="template-overlay-input"
                      value={line.item}
                      onChange={(event) => updateLineField(line.id, 'item', event.target.value)}
                      style={rectangleStyle(79, top, 59, 21)}
                      aria-label={`Row ${absoluteIndex + 1} item`}
                    />

                    <input
                      className="template-overlay-input"
                      value={line.description}
                      onChange={(event) => updateLineField(line.id, 'description', event.target.value)}
                      style={rectangleStyle(140, top, 313, 21)}
                      aria-label={`Row ${absoluteIndex + 1} description`}
                    />

                    <input
                      className="template-overlay-input template-overlay-currency"
                      value={line.cost}
                      onChange={(event) => updateLineField(line.id, 'cost', event.target.value)}
                      onFocus={() => normalizeCostForEditing(line.id)}
                      onBlur={() => formatCostForDisplay(line.id)}
                      style={rectangleStyle(455, top, 58, 21)}
                      inputMode="decimal"
                      aria-label={`Row ${absoluteIndex + 1} cost`}
                    />

                    <input
                      className="template-overlay-input template-overlay-currency"
                      value={lineTotal === null ? '' : formatCurrency(lineTotal, 2)}
                      style={rectangleStyle(515, top, 58, 21)}
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

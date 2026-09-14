// The quote lines, laid out the way the Minimal invoice lays out its details.
//
// Differences from that reference, all deliberate:
//  - No fixed-height table. Each line is its own block, so the description can
//    grow downward as it is typed instead of scrolling inside a box.
//  - The bold heading is optional and hidden until asked for, because most
//    lines are one product with a description and do not need one.
//  - Quantity and price accept arithmetic, the way the old editor does.
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import ContentPasteRoundedIcon from '@mui/icons-material/ContentPasteRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined'
import SubdirectoryArrowRightRoundedIcon from '@mui/icons-material/SubdirectoryArrowRightRounded'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { inputBaseClasses } from '@mui/material/InputBase'
import type { ClipboardEvent as ReactClipboardEvent } from 'react'
import {
  copyQuoteLineToClipboard,
  readQuoteLineFromClipboard,
} from '../quoteLineClipboard'
import {
  duplicateQuoteLineBlock,
  joinQuoteLineDescription,
  QUOTE_PRODUCT_MAX_LENGTH,
  quoteFormulaHint,
  splitQuoteLineDescription,
  updateQuoteLinePricing,
  type QuoteLineFormState,
} from '../quoteLines'

const DETAIL_WIDTH = 150
const QTY_WIDTH = 100
const PRICE_WIDTH = 116
const TOTAL_WIDTH = 128

const formulaHintSx = {
  ml: 0,
  mt: 0.25,
  fontWeight: 700,
  color: 'primary.main',
} as const

function money(value: number) {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function SummaryRow({ label, value, strong, muted }: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
}) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="flex-end">
      <Typography
        variant={strong ? 'subtitle1' : 'body2'}
        color={strong ? 'text.primary' : 'text.secondary'}
      >
        {label}
      </Typography>
      <Typography
        variant={strong ? 'subtitle1' : 'body2'}
        sx={{
          width: 160,
          textAlign: 'right',
          fontWeight: strong ? 800 : 600,
          color: muted ? 'text.disabled' : undefined,
        }}
      >
        {value}
      </Typography>
    </Stack>
  )
}

export function NewQuoteLines({
  lines,
  discountPercent,
  productTotal,
  freightTotal,
  discountAmount,
  netTotal,
  isUploadingImage,
  onChange,
  onDiscountPercentChange,
  onPickImage,
  onRemoveImage,
  onEditImage,
  onOpenLibrary,
  onSaveToLibrary,
}: {
  lines: QuoteLineFormState[]
  discountPercent: string
  productTotal: number
  freightTotal: number
  discountAmount: number
  netTotal: number
  isUploadingImage: boolean
  onChange: (next: QuoteLineFormState[]) => void
  onDiscountPercentChange: (value: string) => void
  onPickImage: (lineIndex: number, file: File) => void
  onRemoveImage: (lineIndex: number, imageId: string) => void
  onEditImage: (lineIndex: number, imageId: string) => void
  onOpenLibrary: () => void
  onSaveToLibrary: (lineIndex: number) => void
}) {
  const mainLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !line.parentLineId)

  function replaceAt(index: number, next: QuoteLineFormState) {
    onChange(lines.map((line, position) => (position === index ? next : line)))
  }

  function updateField(index: number, field: 'detailLabel' | 'qty' | 'unitPrice', value: string) {
    replaceAt(index, updateQuoteLinePricing(lines[index], field, value))
  }

  function updateDescriptionPart(index: number, part: 'heading' | 'details', value: string) {
    const current = splitQuoteLineDescription(lines[index].description)
    const next = part === 'heading'
      ? joinQuoteLineDescription(value, current.details)
      : joinQuoteLineDescription(current.heading, value)

    replaceAt(index, { ...lines[index], description: next })
  }

  /**
   * A screenshot pasted into any field on a line becomes that line's picture.
   * Checks both clipboard lists because browsers disagree about which one a
   * pasted image lands in, and a mixed text-and-image paste lists text first.
   */
  function pasteImage(lineIndex: number, event: ReactClipboardEvent<HTMLElement>) {
    const file = Array.from(event.clipboardData.items)
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile()
      ?? Array.from(event.clipboardData.files).find((entry) => entry.type.startsWith('image/'))
      ?? null

    if (!file || isUploadingImage) {
      return
    }

    event.preventDefault()
    onPickImage(lineIndex, file)
  }

  /** Fills one row from the clipboard, splitting it back into its fields. */
  async function pasteInto(index: number) {
    const payload = await readQuoteLineFromClipboard()

    if (!payload) {
      return
    }

    const target = lines[index]
    const next = {
      ...target,
      detailLabel: payload.detailLabel,
      description: payload.description,
      // Sublines carry no pricing of their own, so it is not pasted onto one.
      qty: target.parentLineId ? target.qty : payload.qty,
      unitPrice: target.parentLineId ? target.unitPrice : payload.unitPrice,
    }

    replaceAt(index, target.parentLineId
      ? next
      : updateQuoteLinePricing(next, 'unitPrice', next.unitPrice))
  }

  function removeBlock(index: number) {
    const target = lines[index]
    const remaining = lines.filter((line, position) => (
      position !== index && line.parentLineId !== target.id
    ))

    onChange(remaining.length > 0 ? remaining : [])
  }

  function addSubline(parentIndex: number) {
    const parent = lines[parentIndex]
    let insertAt = parentIndex + 1

    while (lines[insertAt]?.parentLineId === parent.id) {
      insertAt += 1
    }

    const subline: QuoteLineFormState = {
      id: crypto.randomUUID(),
      parentLineId: parent.id,
      itemNumber: '',
      detailLabel: '',
      description: '',
      qty: '',
      unitPrice: '',
      extPrice: '',
      images: [],
    }

    onChange([...lines.slice(0, insertAt), subline, ...lines.slice(insertAt)])
  }

  function addLine() {
    onChange([...lines, {
      id: crypto.randomUUID(),
      parentLineId: null,
      itemNumber: '',
      detailLabel: '',
      description: '',
      qty: '',
      unitPrice: '',
      extPrice: '',
      images: [],
    }])
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ color: 'text.disabled', mb: 2.5 }}>Details:</Typography>

      <Stack divider={<Divider flexItem sx={{ borderStyle: 'dashed' }} />} spacing={2.5}>
        {mainLines.map(({ line, index }, position) => {
          const parts = splitQuoteLineDescription(line.description)
          const sublines = lines
            .map((entry, entryIndex) => ({ entry, entryIndex }))
            .filter(({ entry }) => entry.parentLineId === line.id)

          return (
            <Stack
              key={line.id}
              spacing={1.25}
              onPaste={(event) => pasteImage(index, event)}
            >
              <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 800 }}>
                {`Item ${position + 1}`}
              </Typography>

              {/* Always present. Every line is a product, so asking for the
                  title to be summoned first was a step that never earned its
                  place. */}
              <TextField
                size="small"
                label="Product"
                value={parts.heading}
                onChange={(event) => updateDescriptionPart(index, 'heading', event.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ style: { fontWeight: 800 } }}
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'grey.200' } }}
              />

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems="flex-start">
                {/* One row tall to start, matching qty, price and total across
                    the row, and still growing as either one is typed into. */}
                <TextField
                  multiline
                  size="small"
                  label="Product"
                  value={line.detailLabel}
                  onChange={(event) => updateField(index, 'detailLabel', event.target.value)}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ maxLength: QUOTE_PRODUCT_MAX_LENGTH }}
                  sx={{ width: { xs: '100%', md: DETAIL_WIDTH }, flexShrink: 0 }}
                />

                {/* No maxRows: a fourth line of text makes the row taller
                    rather than starting a scrollbar inside the box. */}
                <TextField
                  multiline
                  size="small"
                  label="Description"
                  value={parts.details}
                  onChange={(event) => updateDescriptionPart(index, 'details', event.target.value)}
                  InputLabelProps={{ shrink: true }}
                  sx={{ flexGrow: 1, minWidth: 220, width: '100%' }}
                />

                <TextField
                  size="small"
                  label="Qty"
                  value={line.qty}
                  onChange={(event) => updateField(index, 'qty', event.target.value)}
                  InputLabelProps={{ shrink: true }}
                  placeholder="0"
                  helperText={quoteFormulaHint(line.qty)}
                  FormHelperTextProps={{ sx: formulaHintSx }}
                  sx={{ width: { xs: '100%', md: QTY_WIDTH }, flexShrink: 0 }}
                />

                <TextField
                  size="small"
                  label="Unit price"
                  value={line.unitPrice}
                  onChange={(event) => updateField(index, 'unitPrice', event.target.value)}
                  InputLabelProps={{ shrink: true }}
                  placeholder="0.00"
                  helperText={quoteFormulaHint(line.unitPrice)}
                  FormHelperTextProps={{ sx: formulaHintSx }}
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  sx={{ width: { xs: '100%', md: PRICE_WIDTH }, flexShrink: 0 }}
                />

                <TextField
                  disabled
                  size="small"
                  label="Total"
                  value={line.extPrice}
                  placeholder="0.00"
                  InputLabelProps={{ shrink: true }}
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  sx={{
                    width: { xs: '100%', md: TOTAL_WIDTH },
                    flexShrink: 0,
                    [`& .${inputBaseClasses.input}`]: { textAlign: { md: 'right' } },
                  }}
                />

                {/* A real copy, not a duplicate: it goes to the clipboard, so
                    it can be pasted into another line, another quote, or a
                    spreadsheet. */}
                <Tooltip title="Copy this line">
                  <IconButton
                    size="small"
                    onClick={() => void copyQuoteLineToClipboard(line)}
                    sx={{ mt: 0.4 }}
                  >
                    <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Paste a copied line here">
                  <IconButton size="small" onClick={() => void pasteInto(index)} sx={{ mt: 0.4 }}>
                    <ContentPasteRoundedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Stack>

              {sublines.map(({ entry, entryIndex }) => (
                <Stack key={entry.id} direction="row" spacing={1} alignItems="flex-start" sx={{ pl: { md: 3 } }}>
                  <SubdirectoryArrowRightRoundedIcon
                    sx={{ fontSize: 18, color: 'text.disabled', mt: 1.2, display: { xs: 'none', md: 'block' } }}
                  />
                  <TextField
                    multiline
                    size="small"
                    value={entry.detailLabel}
                    onChange={(event) => updateField(entryIndex, 'detailLabel', event.target.value)}
                    placeholder="Product"
                    inputProps={{ maxLength: QUOTE_PRODUCT_MAX_LENGTH }}
                    sx={{ width: { xs: '40%', md: DETAIL_WIDTH }, flexShrink: 0 }}
                  />
                  <TextField
                    multiline
                    size="small"
                    value={entry.description}
                    onChange={(event) => replaceAt(entryIndex, { ...entry, description: event.target.value })}
                    placeholder="Description"
                    sx={{ flexGrow: 1, minWidth: 200 }}
                  />
                  <Tooltip title="Copy this subline">
                    <IconButton
                      size="small"
                      onClick={() => void copyQuoteLineToClipboard(entry)}
                      sx={{ mt: 0.4 }}
                    >
                      <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Paste a copied line here">
                    <IconButton size="small" onClick={() => void pasteInto(entryIndex)} sx={{ mt: 0.4 }}>
                      <ContentPasteRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Remove this subline">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => onChange(lines.filter((_line, position) => position !== entryIndex))}
                      sx={{ mt: 0.4 }}
                    >
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ))}

              <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                {/* Pictures stay out of the form on purpose: they belong on
                    the quote, not in the way of editing it. They sit under
                    every subline because the picture is of the whole line. */}
                {line.images.length > 0 ? (
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mr: 'auto' }}>
                    {line.images.map((image) => (
                      <Chip
                        key={image.id}
                        size="small"
                        variant="outlined"
                        icon={<ImageOutlinedIcon sx={{ fontSize: 16 }} />}
                        label={
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <span>Image attached</span>
                            <Box
                              component="span"
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.stopPropagation()
                                onEditImage(index, image.id)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') onEditImage(index, image.id)
                              }}
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 0.25,
                                color: 'primary.main',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              <VisibilityOutlinedIcon sx={{ fontSize: 15 }} />
                              Preview &amp; adjust
                            </Box>
                          </Stack>
                        }
                        onDelete={() => onRemoveImage(index, image.id)}
                      />
                    ))}
                  </Stack>
                ) : null}

                {line.images.length < 2 ? (
                  <Button
                    component="label"
                    size="small"
                    disabled={isUploadingImage}
                    startIcon={isUploadingImage
                      ? <CircularProgress size={14} color="inherit" />
                      : <ImageOutlinedIcon sx={{ fontSize: 18 }} />}
                  >
                    {isUploadingImage ? 'Uploading…' : 'Add picture'}
                    <input
                      hidden
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (file) onPickImage(index, file)
                      }}
                    />
                  </Button>
                ) : null}
                <Button
                  size="small"
                  startIcon={<AddRoundedIcon />}
                  onClick={() => addSubline(index)}
                >
                  Add subline
                </Button>
                {/* Copies the line and every subline under it, with fresh ids
                    so the copy is its own line rather than a second reference
                    to this one. */}
                <Button
                  size="small"
                  startIcon={<ContentCopyRoundedIcon sx={{ fontSize: 17 }} />}
                  onClick={() => onChange(duplicateQuoteLineBlock(lines, index))}
                >
                  Copy line
                </Button>
                {/* Saves this line and its sublines as a block that can be
                    dropped into any future quote. */}
                <Button
                  size="small"
                  startIcon={<BookmarkAddOutlinedIcon sx={{ fontSize: 18 }} />}
                  onClick={() => onSaveToLibrary(index)}
                >
                  Save to library
                </Button>
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteOutlineRoundedIcon />}
                  disabled={mainLines.length === 1}
                  onClick={() => removeBlock(index)}
                >
                  Remove
                </Button>
              </Stack>
            </Stack>
          )
        })}
      </Stack>

      <Divider sx={{ my: 3, borderStyle: 'dashed' }} />

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'flex-start', md: 'center' }}
      >
        <Button size="small" startIcon={<AddRoundedIcon />} onClick={addLine} sx={{ flexShrink: 0 }}>
          Add item
        </Button>

        <Button
          size="small"
          startIcon={<LibraryAddOutlinedIcon sx={{ fontSize: 18 }} />}
          onClick={onOpenLibrary}
          sx={{ flexShrink: 0 }}
        >
          Insert from library
        </Button>

        <Box sx={{ flexGrow: 1 }} />

        <TextField
          size="small"
          label="Discount (%)"
          value={discountPercent}
          onChange={(event) => {
            const value = event.target.value

            if (value === '' || (/^\d{0,3}(?:\.\d{0,2})?$/.test(value) && Number(value) <= 100)) {
              onDiscountPercentChange(value)
            }
          }}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 140 }}
        />
      </Stack>

      <Stack spacing={1.25} sx={{ mt: 3 }}>
        <SummaryRow label="Subtotal" value={money(productTotal)} />
        <SummaryRow label="Freight" value={freightTotal ? money(freightTotal) : '—'} muted={!freightTotal} />
        <SummaryRow
          label="Discount"
          value={discountAmount ? `- ${money(discountAmount)}` : '—'}
          muted={!discountAmount}
        />
        <SummaryRow strong label="Total" value={money(netTotal)} />
      </Stack>
    </Box>
  )
}

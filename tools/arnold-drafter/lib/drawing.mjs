// Builds a 2D sheet from the same solids the 3D model is made of.
//
// Four views, all hidden-line removed against the full solid set, so nothing
// interior bleeds through a face. Third-angle projection (US convention):
//
//     PLAN          ISO
//     FRONT         RIGHT SIDE
//
// The plan sits above the front view with the desk's front edge at the bottom;
// the right side view sits to its right with the desk's front edge on the LEFT,
// nearest the front view. The isometric is a true axonometric of the same
// solids — not a separate drawing — so it cannot disagree with the elevations.
//
// Drawn at FULL SIZE (1:1) in inches; scaling happens at plot time.

import { DxfDocument } from './dxf.mjs'
import { formatDimension } from './units.mjs'
import { boxEdges, visibleRuns, normalize, screenBasis, dot } from './hlr.mjs'

const M_TO_IN = 1 / 0.0254

const VIEWS = [
  { key: 'front', label: 'FRONT ELEVATION', dir: [0, 0, 1] },
  { key: 'plan', label: 'PLAN', dir: [0, 1, 0] },
  { key: 'side', label: 'RIGHT SIDE ELEVATION', dir: [1, 0, 0] },
  // Low 3/4 view, close to how a reception desk is actually seen and to how
  // designers present them — a high isometric looks down into the work area.
  { key: 'iso', label: 'ISOMETRIC', dir: [1, 0.42, 1] },
]

export function buildDrawing(parts, summary, { date } = {}) {
  if (!parts.length) throw new Error('nothing to draw: the model has no named parts')

  const boxes = parts.map((part) => ({
    name: part.name,
    x: part.at[0] * M_TO_IN,
    y: part.at[1] * M_TO_IN,
    z: part.at[2] * M_TO_IN,
    w: part.size[0] * M_TO_IN,
    h: part.size[1] * M_TO_IN,
    d: part.size[2] * M_TO_IN,
  }))

  const overallW = Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x))
  const overallH = Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y))
  const overallD = Math.max(...boxes.map((b) => b.z + b.d)) - Math.min(...boxes.map((b) => b.z))

  // Project every view once, in its own local coordinates.
  const projected = {}
  for (const view of VIEWS) {
    const dir = normalize(view.dir)
    const { right, up } = screenBasis(dir)
    const segments = []

    for (const box of boxes) {
      for (const edge of boxEdges(box)) {
        for (const [a, b] of visibleRuns(edge, boxes, dir)) {
          segments.push([
            [dot(a, right), dot(a, up)],
            [dot(b, right), dot(b, up)],
          ])
        }
      }
    }
    if (!segments.length) throw new Error(`view "${view.key}" produced no visible geometry`)

    const us = segments.flatMap((s) => [s[0][0], s[1][0]])
    const vs = segments.flatMap((s) => [s[0][1], s[1][1]])
    const minU = Math.min(...us)
    const minV = Math.min(...vs)
    projected[view.key] = {
      label: view.label,
      segments: segments.map((s) => [
        [s[0][0] - minU, s[0][1] - minV],
        [s[1][0] - minU, s[1][1] - minV],
      ]),
      width: Math.max(...us) - minU,
      height: Math.max(...vs) - minV,
    }
  }

  const dxf = new DxfDocument()
  const scale = Math.max(overallW, overallH, overallD)
  const txt = Math.max(scale * 0.02, 0.4)
  const gapX = scale * 0.3
  const gapY = scale * 0.34
  const dimOffset = scale * 0.1
  const arrow = txt * 0.9

  // --- third-angle placement ------------------------------------------------
  const front = projected.front
  const plan = projected.plan
  const side = projected.side
  const iso = projected.iso

  const origins = {
    front: [0, 0],
    side: [front.width + gapX, 0],
    plan: [0, front.height + gapY],
    iso: [front.width + gapX, front.height + gapY],
  }

  for (const key of ['front', 'side', 'plan', 'iso']) {
    const view = projected[key]
    const [ox, oy] = origins[key]
    const layer = 'OUTLINE'
    for (const [a, b] of view.segments) {
      dxf.line(ox + a[0], oy + a[1], ox + b[0], oy + b[1], layer)
    }
    const labelY = key === 'plan' || key === 'iso' ? oy + view.height + dimOffset * 0.8 : oy - dimOffset * 2.4
    dxf.text(ox, labelY, txt * 1.15, view.label, 'VIEWLABEL')
  }

  // --- dimensions -----------------------------------------------------------
  hDim(dxf, 0, front.width, 0, -dimOffset, formatDimension(overallW / M_TO_IN, 'in'), txt, arrow)
  vDim(dxf, 0, front.height, 0, -dimOffset, formatDimension(overallH / M_TO_IN, 'in'), txt, arrow)
  hDim(dxf, origins.side[0], origins.side[0] + side.width, 0, -dimOffset,
    formatDimension(overallD / M_TO_IN, 'in'), txt, arrow)

  // --- sheet border + title block -------------------------------------------
  const contentMinX = -dimOffset - txt * 4
  const contentMaxX = Math.max(origins.side[0] + side.width, origins.iso[0] + iso.width)
  const contentMinY = -dimOffset * 3.2
  const contentMaxY = Math.max(origins.plan[1] + plan.height, origins.iso[1] + iso.height) + dimOffset * 2

  const margin = scale * 0.12
  const titleH = txt * 7.5
  const titleW = Math.max(scale * 0.85, txt * 34)

  const border = {
    x: contentMinX - margin,
    y: contentMinY - margin - titleH,
    w: Math.max(contentMaxX - contentMinX, titleW) + margin * 2,
    h: contentMaxY - contentMinY + margin * 2 + titleH,
  }
  dxf.rect(border.x, border.y, border.w, border.h, 'TITLE')

  drawTitleBlock(dxf, {
    x: border.x + border.w - titleW,
    y: border.y,
    w: titleW,
    h: titleH,
    txt,
    summary,
    date,
    overall: {
      w: formatDimension(overallW / M_TO_IN, 'in'),
      d: formatDimension(overallD / M_TO_IN, 'in'),
      h: formatDimension(overallH / M_TO_IN, 'in'),
    },
  })

  return { dxf, sheet: border }
}

function hDim(dxf, x1, x2, geomY, dimY, value, txt, arrow) {
  dxf.line(x1, geomY, x1, dimY - txt * 0.6, 'DIMS')
  dxf.line(x2, geomY, x2, dimY - txt * 0.6, 'DIMS')
  dxf.line(x1, dimY, x2, dimY, 'DIMS')
  dxf.arrow(x1, dimY, x1 + arrow, dimY, arrow, 'DIMS')
  dxf.arrow(x2, dimY, x2 - arrow, dimY, arrow, 'DIMS')
  dxf.text((x1 + x2) / 2, dimY + txt * 0.4, txt, value, 'DIMS', { align: 1 })
}

function vDim(dxf, y1, y2, geomX, dimX, value, txt, arrow) {
  dxf.line(geomX, y1, dimX - txt * 0.6, y1, 'DIMS')
  dxf.line(geomX, y2, dimX - txt * 0.6, y2, 'DIMS')
  dxf.line(dimX, y1, dimX, y2, 'DIMS')
  dxf.arrow(dimX, y1, dimX, y1 + arrow, arrow, 'DIMS')
  dxf.arrow(dimX, y2, dimX, y2 - arrow, arrow, 'DIMS')
  dxf.text(dimX - txt * 0.4, (y1 + y2) / 2, txt, value, 'DIMS', { align: 1, rotation: 90 })
}

function drawTitleBlock(dxf, { x, y, w, h, txt, summary, date, overall }) {
  dxf.rect(x, y, w, h, 'TITLE')

  const rows = 4
  const rowH = h / rows
  for (let i = 1; i < rows; i += 1) dxf.line(x, y + rowH * i, x + w, y + rowH * i, 'TITLE')
  const split = x + w * 0.62
  dxf.line(split, y, split, y + rowH * 3, 'TITLE')

  const pad = txt * 0.5
  const put = (col, row, value, size = txt) =>
    dxf.text(col + pad, y + rowH * row + rowH / 2 - size * 0.5, size, value, 'TITLE')

  put(x, 3, 'ARNOLD CONTRACT', txt * 1.5)
  put(x, 2, `PROJECT: ${summary.client ?? '—'}`)
  put(x, 1, `ITEM: ${summary.description}`)
  put(x, 0, `${overall.w} W  x  ${overall.d} D  x  ${overall.h} H`)

  put(split, 2, `QUOTE: ${summary.quoteNumber ?? '—'}`)
  put(split, 1, `ITEM No: ${summary.itemNumber ?? '—'}`)
  put(split, 0, `DATE: ${date ?? '—'}`)
  dxf.text(x + w - pad, y + rowH * 3 + rowH / 2 - txt * 0.5, txt, 'FULL SIZE (1:1)', 'TITLE', { align: 2 })
}

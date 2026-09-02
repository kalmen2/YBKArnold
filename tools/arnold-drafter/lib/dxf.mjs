// Minimal DXF (AC1009 / R12 ASCII) writer.
//
// R12 is the most widely readable DXF revision — AutoCAD, Fusion, Rhino,
// SolidWorks, Illustrator and every free viewer open it without complaint.
//
// Dimensions are emitted as drawn geometry (extension lines, arrowheads, text)
// on a DIMS layer rather than as associative DIMENSION entities. They look and
// print identically; the trade-off is that stretching the geometry in AutoCAD
// will not auto-update the number. For a client sketch that is the right call —
// associative dimensions need a DIMSTYLE table and generated dimension blocks,
// which is where hand-written DXF most often breaks in a real CAD seat.
//
// Drawing units are INCHES (header $INSUNITS = 1). All coordinates handed to
// this writer are already in inches, in sheet space.

const COLORS = { white: 7, red: 1, yellow: 2, green: 3, cyan: 4, blue: 5, magenta: 6, grey: 8, darkGrey: 250 }

export const LAYERS = [
  { name: 'OUTLINE', color: COLORS.white },
  { name: 'DETAIL', color: COLORS.grey },
  { name: 'DIMS', color: COLORS.green },
  { name: 'TEXT', color: COLORS.cyan },
  { name: 'TITLE', color: COLORS.white },
  { name: 'VIEWLABEL', color: COLORS.yellow },
]

export class DxfDocument {
  constructor() {
    this.entities = []
  }

  #push(pairs) {
    this.entities.push(pairs)
  }

  line(x1, y1, x2, y2, layer) {
    this.#push([[0, 'LINE'], [8, layer], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]])
    return this
  }

  /** Closed rectangle as four lines — R12 LWPOLYLINE is not universally read. */
  rect(x, y, w, h, layer) {
    this.line(x, y, x + w, y, layer)
    this.line(x + w, y, x + w, y + h, layer)
    this.line(x + w, y + h, x, y + h, layer)
    this.line(x, y + h, x, y, layer)
    return this
  }

  circle(cx, cy, radius, layer) {
    this.#push([[0, 'CIRCLE'], [8, layer], [10, cx], [20, cy], [30, 0], [40, radius]])
    return this
  }

  /**
   * @param {number} align 0 left, 1 centre, 2 right (DXF group 72)
   * @param {number} vAlign 0 baseline, 1 bottom, 2 middle, 3 top (group 73)
   */
  text(x, y, height, value, layer, { align = 0, vAlign = 0, rotation = 0 } = {}) {
    const pairs = [
      [0, 'TEXT'], [8, layer],
      [10, x], [20, y], [30, 0],
      [40, height], [1, String(value)], [50, rotation],
      [72, align], [73, vAlign],
      [11, x], [21, y], [31, 0],
    ]
    this.#push(pairs)
    return this
  }

  /** Filled triangular arrowhead, pointing from tail toward tip. */
  arrow(tipX, tipY, tailX, tailY, size, layer) {
    const dx = tipX - tailX
    const dy = tipY - tailY
    const length = Math.hypot(dx, dy) || 1
    const ux = dx / length
    const uy = dy / length
    const baseX = tipX - ux * size
    const baseY = tipY - uy * size
    const halfWidth = size * 0.18
    const px = -uy * halfWidth
    const py = ux * halfWidth
    this.#push([
      [0, 'SOLID'], [8, layer],
      [10, tipX], [20, tipY], [30, 0],
      [11, baseX + px], [21, baseY + py], [31, 0],
      [12, baseX - px], [22, baseY - py], [32, 0],
      [13, baseX - px], [23, baseY - py], [33, 0],
    ])
    return this
  }

  toString() {
    const out = []
    const pair = (code, value) => {
      out.push(String(code))
      out.push(typeof value === 'number' ? formatNumber(value) : String(value))
    }

    // --- HEADER: inches -----------------------------------------------------
    pair(0, 'SECTION'); pair(2, 'HEADER')
    pair(9, '$ACADVER'); pair(1, 'AC1009')
    pair(9, '$INSUNITS'); pair(70, 1)
    pair(9, '$MEASUREMENT'); pair(70, 0)
    pair(0, 'ENDSEC')

    // --- TABLES: layers -----------------------------------------------------
    pair(0, 'SECTION'); pair(2, 'TABLES')
    pair(0, 'TABLE'); pair(2, 'LAYER'); pair(70, LAYERS.length)
    for (const layer of LAYERS) {
      pair(0, 'LAYER')
      pair(2, layer.name)
      pair(70, 0)
      pair(62, layer.color)
      pair(6, 'CONTINUOUS')
    }
    pair(0, 'ENDTAB')
    pair(0, 'ENDSEC')

    // --- ENTITIES -----------------------------------------------------------
    pair(0, 'SECTION'); pair(2, 'ENTITIES')
    for (const entity of this.entities) for (const [code, value] of entity) pair(code, value)
    pair(0, 'ENDSEC')

    pair(0, 'EOF')
    return out.join('\n') + '\n'
  }
}

function formatNumber(value) {
  if (!Number.isFinite(value)) throw new Error(`DXF: refusing to write non-finite coordinate ${value}`)
  return Number.isInteger(value) ? value.toFixed(1) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0')
}

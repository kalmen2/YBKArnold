// Renders a written DXF back to SVG, by parsing the file rather than the
// in-memory model. That makes it a genuine check on the file itself: if the
// group codes are malformed, the preview breaks in the same way a CAD seat would.

const LAYER_COLORS = {
  OUTLINE: '#111111',
  DETAIL: '#8a8a8a',
  DIMS: '#1a7f37',
  TEXT: '#0b6bcb',
  TITLE: '#111111',
  VIEWLABEL: '#b8860b',
}

export function parseDxf(text) {
  const lines = text.split(/\r?\n/)
  const pairs = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([Number(lines[i].trim()), lines[i + 1]])
  }

  const entities = []
  let inEntities = false
  let current = null

  for (const [code, value] of pairs) {
    if (code === 0) {
      if (value === 'SECTION') { current = null; continue }
      if (value === 'ENDSEC') { if (current) entities.push(current); current = null; inEntities = false; continue }
      if (current) entities.push(current)
      current = inEntities ? { type: value, groups: {} } : null
      continue
    }
    if (code === 2 && value === 'ENTITIES') { inEntities = true; continue }
    if (current) {
      if (current.groups[code] === undefined) current.groups[code] = value
    }
  }
  return entities.filter((entity) => ['LINE', 'CIRCLE', 'TEXT', 'SOLID'].includes(entity.type))
}

export function dxfToSvg(text) {
  const entities = parseDxf(text)
  if (!entities.length) throw new Error('DXF preview: no drawable entities parsed — the file is malformed')

  const xs = []
  const ys = []
  const collect = (x, y) => { xs.push(x); ys.push(y) }

  for (const entity of entities) {
    const g = entity.groups
    const num = (code) => Number(g[code])
    if (entity.type === 'LINE') { collect(num(10), num(20)); collect(num(11), num(21)) }
    else if (entity.type === 'CIRCLE') {
      collect(num(10) - num(40), num(20) - num(40))
      collect(num(10) + num(40), num(20) + num(40))
    } else if (entity.type === 'TEXT') collect(num(10), num(20))
    else if (entity.type === 'SOLID') {
      for (const [cx, cy] of [[10, 20], [11, 21], [12, 22], [13, 23]]) collect(num(cx), num(cy))
    }
  }

  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const pad = (maxX - minX) * 0.02
  const width = maxX - minX + pad * 2
  const height = maxY - minY + pad * 2

  // DXF Y is up, SVG Y is down.
  const fx = (x) => (x - minX + pad).toFixed(3)
  const fy = (y) => (maxY - y + pad).toFixed(3)

  const stroke = Math.max(width * 0.0006, 0.02)
  const body = []

  for (const entity of entities) {
    const g = entity.groups
    const num = (code) => Number(g[code])
    const layer = g[8] ?? 'OUTLINE'
    const color = LAYER_COLORS[layer] ?? '#111111'

    if (entity.type === 'LINE') {
      body.push(`<line x1="${fx(num(10))}" y1="${fy(num(20))}" x2="${fx(num(11))}" y2="${fy(num(21))}" stroke="${color}" stroke-width="${stroke}"/>`)
    } else if (entity.type === 'CIRCLE') {
      body.push(`<circle cx="${fx(num(10))}" cy="${fy(num(20))}" r="${num(40).toFixed(3)}" fill="none" stroke="${color}" stroke-width="${stroke}"/>`)
    } else if (entity.type === 'SOLID') {
      const points = [[10, 20], [11, 21], [12, 22]].map(([cx, cy]) => `${fx(num(cx))},${fy(num(cy))}`).join(' ')
      body.push(`<polygon points="${points}" fill="${color}"/>`)
    } else if (entity.type === 'TEXT') {
      const size = num(40)
      const anchor = { 0: 'start', 1: 'middle', 2: 'end' }[Number(g[72] ?? 0)] ?? 'start'
      const rotation = Number(g[50] ?? 0)
      const x = fx(num(10))
      const y = fy(num(20))
      const transform = rotation ? ` transform="rotate(${-rotation} ${x} ${y})"` : ''
      const escaped = String(g[1] ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
      body.push(
        `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" ` +
          `fill="${color}" text-anchor="${anchor}"${transform}>${escaped}</text>`,
      )
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(3)} ${height.toFixed(3)}" width="1600">` +
    `<rect width="${width.toFixed(3)}" height="${height.toFixed(3)}" fill="#ffffff"/>${body.join('')}</svg>`
}

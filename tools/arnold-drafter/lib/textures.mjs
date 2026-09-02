// Procedural material textures.
//
// Generated rather than sourced so the pipeline stays self-contained and so a
// finish can be retuned by changing numbers instead of hunting for a photo with
// the right licence. Everything tiles seamlessly: the noise lattice wraps on a
// fixed period, so a 10ft counter shows no repeat seam.
//
// Textures are authored with the grain running along U. planarUv() in mesh.mjs
// decides which world axis that maps to per face.

import { encodePng } from './png.mjs'

// --- tileable value noise ---------------------------------------------------

function hash(ix, iy, seed) {
  let h = ix * 374761393 + iy * 668265263 + seed * 1442695040888963407
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) >>> 0) / 4294967295
}

const fade = (t) => t * t * (3 - 2 * t)

function noise(x, y, periodX, periodY, seed) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = fade(x - ix)
  const fy = fade(y - iy)
  const wrap = (v, p) => ((v % p) + p) % p

  const x0 = wrap(ix, periodX)
  const x1 = wrap(ix + 1, periodX)
  const y0 = wrap(iy, periodY)
  const y1 = wrap(iy + 1, periodY)

  const n00 = hash(x0, y0, seed)
  const n10 = hash(x1, y0, seed)
  const n01 = hash(x0, y1, seed)
  const n11 = hash(x1, y1, seed)

  return (n00 * (1 - fx) + n10 * fx) * (1 - fy) + (n01 * (1 - fx) + n11 * fx) * fy
}

function fbm(x, y, periodX, periodY, octaves, seed) {
  let sum = 0
  let amplitude = 1
  let total = 0
  for (let o = 0; o < octaves; o += 1) {
    const scale = 2 ** o
    sum += noise(x * scale, y * scale, periodX * scale, periodY * scale, seed + o * 101) * amplitude
    total += amplitude
    amplitude *= 0.5
  }
  return sum / total
}

// --- colour helpers ---------------------------------------------------------

function hexToRgb(hex) {
  const int = parseInt(String(hex).replace('#', ''), 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

const mix = (a, b, t) => a + (b - a) * t
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/** Lighten/darken an sRGB triple by a multiplier around 1. */
const shade = (rgb, factor) => rgb.map((c) => clamp255(c * factor))

// --- generators -------------------------------------------------------------

/**
 * Straight-grain veneer: long fine grain lines along U with pore streaks and a
 * slow cathedral undulation. Contract casework is veneered, not solid, so
 * straight/rift figure is the right default.
 */
function woodTexture(size, baseHex, seed) {
  const base = hexToRgb(baseHex)
  const dark = shade(base, 0.62)
  const light = shade(base, 1.24)
  const pixels = new Uint8Array(size * size * 3)

  const P = 8 // lattice period — the texture repeats over this many noise cells
  for (let y = 0; y < size; y += 1) {
    const v = y / size
    for (let x = 0; x < size; x += 1) {
      const u = x / size

      // Slow undulation so the grain is not mechanically straight.
      const warp = (fbm(u * P * 0.5, v * P * 0.5, P, P, 3, seed) - 0.5) * 0.35
      // Grain lines: high frequency across the grain, low along it.
      const lines = fbm((u + warp) * P * 1.5, v * P * 7, P, P * 14, 4, seed + 7)
      // Pores: very fine, elongated along the grain.
      const pores = fbm(u * P * 2, v * P * 26, P * 4, P * 52, 2, seed + 31)

      let t = lines * 0.78 + pores * 0.22
      t = t ** 1.35 // bias dark so the grain reads

      const rgb = [
        mix(dark[0], light[0], t),
        mix(dark[1], light[1], t),
        mix(dark[2], light[2], t),
      ]
      const i = (y * size + x) * 3
      pixels[i] = clamp255(rgb[0])
      pixels[i + 1] = clamp255(rgb[1])
      pixels[i + 2] = clamp255(rgb[2])
    }
  }
  return encodePng(size, size, pixels)
}

/** Brushed metal: fine directional streaks along U. */
function metalTexture(size, baseHex, seed) {
  const base = hexToRgb(baseHex)
  const pixels = new Uint8Array(size * size * 3)
  const P = 8

  for (let y = 0; y < size; y += 1) {
    const v = y / size
    for (let x = 0; x < size; x += 1) {
      const u = x / size
      const streak = fbm(u * P * 1.5, v * P * 40, P, P * 80, 3, seed)
      const factor = 0.86 + streak * 0.3
      const i = (y * size + x) * 3
      pixels[i] = clamp255(base[0] * factor)
      pixels[i + 1] = clamp255(base[1] * factor)
      pixels[i + 2] = clamp255(base[2] * factor)
    }
  }
  return encodePng(size, size, pixels)
}

/** Solid laminate / paint: a whisper of variation so it is not dead flat. */
function solidTexture(size, baseHex, seed) {
  const base = hexToRgb(baseHex)
  const pixels = new Uint8Array(size * size * 3)
  const P = 8

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = fbm((x / size) * P * 4, (y / size) * P * 4, P * 4, P * 4, 3, seed)
      const factor = 0.985 + n * 0.03
      const i = (y * size + x) * 3
      pixels[i] = clamp255(base[0] * factor)
      pixels[i + 1] = clamp255(base[1] * factor)
      pixels[i + 2] = clamp255(base[2] * factor)
    }
  }
  return encodePng(size, size, pixels)
}

/** Engineered stone / solid surface: fine speckle over a base. */
function stoneTexture(size, baseHex, seed) {
  const base = hexToRgb(baseHex)
  const pixels = new Uint8Array(size * size * 3)
  const P = 8

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * P * 30
      const v = (y / size) * P * 30
      const speck = noise(u, v, P * 30, P * 30, seed)
      const cloud = fbm((x / size) * P * 3, (y / size) * P * 3, P * 3, P * 3, 3, seed + 5)
      let factor = 0.97 + cloud * 0.06
      if (speck > 0.86) factor *= 0.82      // dark fleck
      else if (speck < 0.1) factor *= 1.08  // light fleck
      const i = (y * size + x) * 3
      pixels[i] = clamp255(base[0] * factor)
      pixels[i + 1] = clamp255(base[1] * factor)
      pixels[i + 2] = clamp255(base[2] * factor)
    }
  }
  return encodePng(size, size, pixels)
}

/** Cane / rattan webbing: an over-under weave on an open hexagonal-ish grid. */
function weaveTexture(size, baseHex, seed) {
  const base = hexToRgb(baseHex)
  const dark = shade(base, 0.45)
  const light = shade(base, 1.15)
  const pixels = new Uint8Array(size * size * 4)
  const cells = 26
  const strandHalf = 0.17 // half-width of a strand, in cell units

  for (let y = 0; y < size; y += 1) {
    const cy = (y / size) * cells
    for (let x = 0; x < size; x += 1) {
      const cx = (x / size) * cells
      const fx = cx - Math.floor(cx)
      const fy = cy - Math.floor(cy)

      const onVertical = Math.abs(fx - 0.5) < strandHalf
      const onHorizontal = Math.abs(fy - 0.5) < strandHalf
      const overUnder = (Math.floor(cx) + Math.floor(cy)) % 2 === 0

      const i = (y * size + x) * 4
      if (!onVertical && !onHorizontal) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0
        pixels[i + 3] = 0 // open weave — you see through it
        continue
      }

      // The strand on top catches light; the one passing under is shaded.
      const vTop = overUnder
      const useVertical = onVertical && (!onHorizontal || vTop)
      const across = useVertical ? (fx - 0.5) / strandHalf : (fy - 0.5) / strandHalf
      const round = Math.sqrt(Math.max(0, 1 - across * across)) // cylindrical shading
      const grain = fbm(cx * 3, cy * 3, cells * 3, cells * 3, 2, seed) * 0.12
      const lit = useVertical === vTop ? 1 : 0.72
      const t = (0.35 + round * 0.6) * lit + grain

      pixels[i] = clamp255(mix(dark[0], light[0], t))
      pixels[i + 1] = clamp255(mix(dark[1], light[1], t))
      pixels[i + 2] = clamp255(mix(dark[2], light[2], t))
      pixels[i + 3] = 255
    }
  }
  return encodePng(size, size, pixels, { alpha: true })
}

const GENERATORS = { wood: woodTexture, metal: metalTexture, solid: solidTexture, stone: stoneTexture, weave: weaveTexture }

/**
 * @param {{type: string, size?: number, seed?: number}} spec
 * @param {string} baseHex the finish colour the texture modulates
 */
export function generateTexture(spec, baseHex) {
  const generator = GENERATORS[spec.type]
  if (!generator) {
    throw new Error(`unknown texture type "${spec.type}". Known: ${Object.keys(GENERATORS).join(', ')}`)
  }
  return generator(spec.size ?? 1024, baseHex, spec.seed ?? 1)
}

export const TEXTURE_TYPES = Object.keys(GENERATORS)

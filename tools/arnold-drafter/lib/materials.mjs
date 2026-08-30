// Arnold finish palette.
//
// ---------------------------------------------------------------------------
// PLACEHOLDER PALETTE — replace with Arnold Contract's real finish schedule.
// These are visually plausible stand-ins so the pipeline runs end to end. Every
// entry needs to be confirmed against an actual sample before a customer sees a
// render generated from it.
// ---------------------------------------------------------------------------
//
// Authored as genuine metallic-roughness PBR, so glb-presentation-service keeps
// these values as written (its matte-recovery path only rewrites legacy
// spec-gloss exports from SimLab/SketchUp). Roughness stays at or above 0.55 on
// non-metals to match the matte SketchUp look the viewer is tuned for.

/** sRGB hex -> linear RGB, which is what glTF baseColorFactor stores. */
export function hexToLinear(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!match) throw new Error(`finish colour must be a #rrggbb hex, got "${hex}"`)
  const int = parseInt(match[1], 16)
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255]
  return channels.map((channel) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
}

export const FINISHES = {
  // --- Wood veneers -------------------------------------------------------
  'white-oak': { label: 'White Oak, clear', hex: '#c8a878', roughness: 0.62 },
  'rift-white-oak': { label: 'Rift White Oak', hex: '#d0b489', roughness: 0.6 },
  walnut: { label: 'American Walnut', hex: '#6b4a32', roughness: 0.6 },
  maple: { label: 'Hard Maple, natural', hex: '#dcc199', roughness: 0.62 },
  cherry: { label: 'Cherry, natural', hex: '#9a5b3c', roughness: 0.6 },
  'ebonized-oak': { label: 'Ebonized Oak', hex: '#2e2a26', roughness: 0.65 },

  // --- Laminates / painted ------------------------------------------------
  'white-laminate': { label: 'White laminate', hex: '#f2f1ee', roughness: 0.55 },
  'black-laminate': { label: 'Black laminate', hex: '#1c1c1e', roughness: 0.55 },
  'grey-laminate': { label: 'Storm grey laminate', hex: '#8c8c8a', roughness: 0.58 },
  'greige-paint': { label: 'Greige painted', hex: '#b9b2a6', roughness: 0.7 },

  // --- Stone / solid surface ----------------------------------------------
  'white-quartz': { label: 'White quartz', hex: '#eceae5', roughness: 0.45 },
  'carrara-marble': { label: 'Carrara marble', hex: '#e4e4e0', roughness: 0.35 },

  // --- Metals (authored as real metal, not matte) -------------------------
  'brushed-brass': { label: 'Brushed brass', hex: '#b08d4f', roughness: 0.35, metallic: 1 },
  'satin-nickel': { label: 'Satin nickel', hex: '#a8a9ad', roughness: 0.3, metallic: 1 },
  'blackened-steel': { label: 'Blackened steel', hex: '#3a3a3c', roughness: 0.45, metallic: 1 },
  'polished-chrome': { label: 'Polished chrome', hex: '#c4c6c9', roughness: 0.08, metallic: 1 },

  // --- Glass --------------------------------------------------------------
  'clear-glass': { label: 'Clear glass', hex: '#dfe7e6', roughness: 0.08, alpha: 0.25 },
}

export function finishNames() {
  return Object.keys(FINISHES).sort()
}

/**
 * Look up a finish, refusing to invent one.
 * @param {string} name
 * @param {string} label spec field the name came from, for the error message
 */
export function resolveFinish(name, label) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`${label}: a finish name is required`)
  }
  const finish = FINISHES[name.trim()]
  if (!finish) {
    throw new Error(
      `${label}: unknown finish "${name}". Known finishes: ${finishNames().join(', ')}.\n` +
        `  Add it to tools/arnold-drafter/lib/materials.mjs rather than substituting a similar one.`,
    )
  }
  return { key: name.trim(), ...finish }
}

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
  'white-oak': { label: 'White Oak, clear', hex: '#c8a878', roughness: 0.62, texture: { type: 'wood', seed: 11 } },
  'rift-white-oak': { label: 'Rift White Oak', hex: '#d0b489', roughness: 0.6, texture: { type: 'wood', seed: 17 } },
  walnut: { label: 'American Walnut', hex: '#6b4a32', roughness: 0.6, texture: { type: 'wood', seed: 3 } },
  maple: { label: 'Hard Maple, natural', hex: '#dcc199', roughness: 0.62, texture: { type: 'wood', seed: 23 } },
  cherry: { label: 'Cherry, natural', hex: '#9a5b3c', roughness: 0.6, texture: { type: 'wood', seed: 29 } },
  'ebonized-oak': { label: 'Ebonized Oak', hex: '#2e2a26', roughness: 0.65, texture: { type: 'wood', seed: 37 } },

  // --- Laminates / painted ------------------------------------------------
  'white-laminate': { label: 'White laminate', hex: '#f2f1ee', roughness: 0.55, texture: { type: 'solid', seed: 41, size: 512 } },
  'black-laminate': { label: 'Black laminate', hex: '#1c1c1e', roughness: 0.55, texture: { type: 'solid', seed: 43, size: 512 } },
  'grey-laminate': { label: 'Storm grey laminate', hex: '#8c8c8a', roughness: 0.58, texture: { type: 'solid', seed: 47, size: 512 } },
  'greige-paint': { label: 'Greige painted', hex: '#b9b2a6', roughness: 0.7, texture: { type: 'solid', seed: 53, size: 512 } },

  // --- Stone / solid surface ----------------------------------------------
  'white-quartz': { label: 'White quartz', hex: '#eceae5', roughness: 0.45, texture: { type: 'stone', seed: 59 } },
  'carrara-marble': { label: 'Carrara marble', hex: '#e4e4e0', roughness: 0.35, texture: { type: 'stone', seed: 61 } },

  // --- Metals (authored as real metal, not matte) -------------------------
  'brushed-brass': { label: 'Brushed brass', hex: '#b08d4f', roughness: 0.35, metallic: 1, texture: { type: 'metal', seed: 67, size: 512 } },
  'satin-nickel': { label: 'Satin nickel', hex: '#a8a9ad', roughness: 0.3, metallic: 1, texture: { type: 'metal', seed: 71, size: 512 } },
  'blackened-steel': { label: 'Blackened steel', hex: '#3a3a3c', roughness: 0.45, metallic: 1, texture: { type: 'metal', seed: 73, size: 512 } },
  'polished-chrome': { label: 'Polished chrome', hex: '#c4c6c9', roughness: 0.08, metallic: 1 },

  // --- Specified on live quotes -------------------------------------------
  // Exact products named in a quote. Colours below are read from the designer's
  // rendering, NOT from a physical sample — confirm before a customer sees them.
  'wilsonart-black-velvet': {
    label: 'Wilsonart Traceless Black Velvet #15505-138-31',
    hex: '#1b1b1d', roughness: 0.88,
    texture: { type: 'solid', seed: 79, size: 512 },
  },
  'wilsonart-satin-black-aluminum': {
    label: 'Wilsonart Metal Satin Brushed Black Aluminum #6296-419',
    hex: '#3a3a3d', roughness: 0.42, metallic: 0.85,
    texture: { type: 'metal', seed: 83, size: 512 },
  },

  // --- Unconfirmed on the quote -------------------------------------------
  // The quote itself says TBD. These render so a sketch can exist; every output
  // reports them as unconfirmed. They are not a decision — they are a placeholder
  // for a decision the customer has not made.
  'corian-group-3-tbd': {
    label: 'Corian Group 3 — COLOUR TBD', hex: '#ddd3c1', roughness: 0.48, tbd: true,
    texture: { type: 'stone', seed: 89 },
  },
  'tbd-wood-veneer': {
    label: 'Arnold std. wood veneer — SPECIES TBD', hex: '#7d5334', roughness: 0.58, tbd: true,
    texture: { type: 'wood', seed: 97 },
  },
  'tbd-wood-grain-laminate': {
    label: 'Wilsonart/Formica wood grain laminate — TBD matte', hex: '#8a6242', roughness: 0.7, tbd: true,
    texture: { type: 'wood', seed: 101 },
  },

  'cane-webbing-natural': {
    label: 'Cane webbing, rattan natural', hex: '#c9a06a', roughness: 0.72,
    texture: { type: 'weave', seed: 2 }, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true,
  },

  // --- Glass --------------------------------------------------------------
  'clear-glass': { label: 'Clear glass', hex: '#dfe7e6', roughness: 0.08, alpha: 0.25 },
}

export function tbdFinishNames() {
  return Object.entries(FINISHES).filter(([, finish]) => finish.tbd).map(([name]) => name).sort()
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

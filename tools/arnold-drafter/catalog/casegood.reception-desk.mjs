// Reception / transaction desk.
//
// A stepped casegood: a raised transaction counter across the public face, a
// lower work surface behind it on the staff side, a chassis with recessed
// accent panels, and a recessed toe kick. The side elevation is what makes it a
// reception desk rather than a credenza — the profile steps down from counter
// height to work-surface height.
//
// Modelled from quote 26_AC 149_R0 (Complete Wellness). Rectilinear only.

import { IN } from '../lib/units.mjs'

export default {
  type: 'casegood.reception-desk',
  label: 'Reception / transaction desk',
  params: [
    // --- primary -----------------------------------------------------------
    { key: 'width', type: 'dimension', ask: 'Overall width?' },
    { key: 'depth', type: 'dimension', ask: 'Overall depth, front face to back?' },
    { key: 'height', type: 'dimension', ask: 'Overall height, floor to top of the transaction counter?' },
    { key: 'counterDepth', type: 'dimension', ask: 'Transaction counter depth (the raised public-side ledge)?' },
    { key: 'counterThickness', type: 'dimension', ask: 'Transaction counter thickness?' },
    { key: 'toeKickHeight', type: 'dimension', ask: 'Toe kick height?' },
    {
      key: 'accentPanelCount', type: 'integer', min: 0, max: 8,
      ask: 'How many recessed accent panels across the front face?',
    },
    { key: 'accentPanelWidth', type: 'dimension', ask: 'Width of each accent panel?', when: (p) => p.accentPanelCount > 0 },
    { key: 'accentPanelRecess', type: 'dimension', ask: 'How far is each accent panel recessed from the chassis face?', when: (p) => p.accentPanelCount > 0 },
    { key: 'pedestalWidth', type: 'dimension', ask: 'Width of the storage pedestal?' },

    { key: 'chassisFinish', type: 'finish', ask: 'Chassis / exterior finish?' },
    { key: 'counterFinish', type: 'finish', ask: 'Transaction counter finish?' },
    { key: 'accentPanelFinish', type: 'finish', ask: 'Accent panel finish?', when: (p) => p.accentPanelCount > 0 },
    { key: 'toeKickFinish', type: 'finish', ask: 'Toe kick finish?' },
    { key: 'pedestalFinish', type: 'finish', ask: 'Pedestal finish?' },
    { key: 'workSurfaceFinish', type: 'finish', ask: 'Work surface finish?' },

    // --- detail ------------------------------------------------------------
    { key: 'panelThickness', type: 'dimension', rule: 'shop standard 3/4" sheet', derive: () => 0.75 * IN },
    {
      key: 'workSurfaceHeight', type: 'dimension', confirm: true,
      rule: 'contract standard 29" work-surface height', derive: () => 29 * IN,
    },
    {
      key: 'workSurfaceThickness', type: 'dimension',
      rule: 'shop standard 1 1/4" work surface', derive: () => 1.25 * IN,
    },
    {
      key: 'toeKickRecess', type: 'dimension',
      rule: 'shop standard 3" recess', derive: () => 3 * IN,
    },
    {
      key: 'pedestalSide', type: 'enum', values: ['left', 'right'],
      rule: 'pedestal to the right of the knee space unless told otherwise', derive: () => 'right',
    },
    {
      key: 'counterOverhang', type: 'dimension',
      rule: 'self edge, flush with the chassis face (no overhang)', derive: () => 0,
    },
  ],

  build(mesh, p) {
    const halfWidth = p.width / 2
    const halfDepth = p.depth / 2
    const t = p.panelThickness
    const frontZ = halfDepth
    const backZ = -halfDepth

    const chassisTop = p.height - p.counterThickness
    const chassisHeight = chassisTop - p.toeKickHeight

    if (chassisHeight <= 0) throw new Error('toe kick plus counter thickness is taller than the overall height')
    if (p.counterDepth > p.depth) throw new Error('counterDepth is deeper than the overall depth')
    if (p.workSurfaceHeight >= chassisTop) throw new Error('workSurfaceHeight sits above the transaction counter')

    // --- front face: chassis segments with the accent panels set into them ---
    // The chassis face is NOT continuous. It is the runs between the accent
    // panels; each accent panel fills its own opening with its face set back by
    // accentPanelRecess. Drawing a full-width chassis panel would bury them.
    const count = p.accentPanelCount
    const gap = count > 0 ? (p.width - p.accentPanelWidth * count) / (count + 1) : p.width
    if (gap < 0) throw new Error('accent panels are wider than the desk face')

    for (let i = 0; i <= count; i += 1) {
      const segX = -halfWidth + i * (gap + p.accentPanelWidth)
      if (gap <= 0) continue
      mesh.addBox({
        x: segX, y: p.toeKickHeight, z: frontZ - t,
        w: gap, h: chassisHeight, d: t, material: p.chassisFinish, grain: 'vertical',
        name: count > 0 ? `chassis face segment ${i + 1}` : 'front chassis panel',
      })
    }

    for (let i = 0; i < count; i += 1) {
      const x = -halfWidth + gap * (i + 1) + p.accentPanelWidth * i
      mesh.addBox({
        x, y: p.toeKickHeight, z: frontZ - p.accentPanelRecess - t,
        w: p.accentPanelWidth, h: chassisHeight, d: t, grain: 'vertical',
        material: p.accentPanelFinish, name: `accent panel ${i + 1}`,
      })
    }

    // --- end panels ---------------------------------------------------------
    for (const [name, x] of [['end panel L', -halfWidth], ['end panel R', halfWidth - t]]) {
      mesh.addBox({
        x, y: p.toeKickHeight, z: backZ, w: t, h: chassisHeight, d: p.depth,
        material: p.chassisFinish, grain: 'vertical', name,
      })
    }

    // --- back panel ---------------------------------------------------------
    mesh.addBox({
      x: -halfWidth + t, y: p.toeKickHeight, z: backZ,
      w: p.width - 2 * t, h: p.workSurfaceHeight - p.toeKickHeight, d: t,
      material: p.chassisFinish, name: 'back panel',
    })

    // --- work surface (staff side, behind the raised counter) ---------------
    const workDepth = p.depth - p.counterDepth - t
    if (workDepth <= 0) throw new Error('counterDepth leaves no room for a work surface')
    mesh.addBox({
      x: -halfWidth + t, y: p.workSurfaceHeight - p.workSurfaceThickness, z: backZ + t,
      w: p.width - 2 * t, h: p.workSurfaceThickness, d: workDepth,
      material: p.workSurfaceFinish, name: 'work surface',
    })

    // --- storage pedestal ---------------------------------------------------
    const pedestalHeight = p.workSurfaceHeight - p.workSurfaceThickness - p.toeKickHeight
    if (pedestalHeight > 0) {
      const pedX = p.pedestalSide === 'right' ? halfWidth - t - p.pedestalWidth : -halfWidth + t
      mesh.addBox({
        x: pedX, y: p.toeKickHeight, z: backZ + t,
        w: p.pedestalWidth, h: pedestalHeight, d: workDepth,
        material: p.pedestalFinish, name: 'B/B/F pedestal',
      })
    }

    // --- recessed toe kick ---------------------------------------------------
    const kickDepth = p.depth - p.toeKickRecess
    if (kickDepth <= 0) throw new Error('toeKickRecess is deeper than the desk')
    mesh.addBox({
      x: -halfWidth, y: 0, z: backZ,
      w: p.width, h: p.toeKickHeight, d: kickDepth, material: p.toeKickFinish, name: 'toe kick',
    })

    // --- transaction counter -------------------------------------------------
    mesh.addBox({
      x: -halfWidth, y: chassisTop, z: frontZ + p.counterOverhang - p.counterDepth,
      w: p.width, h: p.counterThickness, d: p.counterDepth,
      material: p.counterFinish, name: 'transaction counter',
    })
  },
}

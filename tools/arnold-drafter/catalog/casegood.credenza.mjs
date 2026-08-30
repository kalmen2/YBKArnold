// Casegood / millwork box: credenza, buffet, low storage unit, base cabinet run.
//
// Construction modelled: end panels, top and bottom decks, back panel, an
// applied top with overhang, a base (toe kick / legs / plinth / wall-hung), and
// overlay doors with optional pulls.
//
// Every dimension below is asked, never assumed. `ask` is the question to put
// to the estimator or customer verbatim when the parameter is missing.

export default {
  type: 'casegood.credenza',
  label: 'Credenza / low storage casegood',
  params: [
    { key: 'width', type: 'dimension', ask: 'Overall width (outside face of end panel to outside face)?' },
    {
      key: 'depth',
      type: 'dimension',
      ask: 'Overall depth, front face of the doors to the back?',
      note: 'This INCLUDES the door thickness. The carcass is set back by the door thickness.',
    },
    { key: 'height', type: 'dimension', ask: 'Overall height, floor to top of the finished top?' },
    { key: 'panelThickness', type: 'dimension', ask: 'Carcass panel thickness (ends, decks, back, doors)?' },

    { key: 'topThickness', type: 'dimension', ask: 'Thickness of the applied top?' },
    { key: 'topOverhangFront', type: 'dimension', ask: 'How far does the top overhang past the door face at the front?' },
    { key: 'topOverhangSides', type: 'dimension', ask: 'How far does the top overhang past each end panel?' },

    {
      key: 'baseType',
      type: 'enum',
      values: ['toe-kick', 'legs', 'plinth', 'wall-hung'],
      ask: 'How does it meet the floor — recessed toe kick, legs, a flush plinth, or wall-hung (nothing below)?',
    },
    { key: 'toeKickHeight', type: 'dimension', ask: 'Toe kick height, floor to underside of the cabinet?', when: (p) => p.baseType === 'toe-kick' },
    { key: 'toeKickRecess', type: 'dimension', ask: 'How far is the toe kick set back from the door face?', when: (p) => p.baseType === 'toe-kick' },
    { key: 'toeKickFinish', type: 'finish', ask: 'Toe kick finish?', when: (p) => p.baseType === 'toe-kick' },
    { key: 'legHeight', type: 'dimension', ask: 'Leg height, floor to underside of the cabinet?', when: (p) => p.baseType === 'legs' },
    { key: 'legDiameter', type: 'dimension', ask: 'Leg diameter?', when: (p) => p.baseType === 'legs' },
    { key: 'legInset', type: 'dimension', ask: 'How far in from each corner is the leg centre set?', when: (p) => p.baseType === 'legs' },
    { key: 'legFinish', type: 'finish', ask: 'Leg finish?', when: (p) => p.baseType === 'legs' },
    { key: 'plinthHeight', type: 'dimension', ask: 'Plinth height?', when: (p) => p.baseType === 'plinth' },
    { key: 'plinthReveal', type: 'dimension', ask: 'Reveal — how far is the plinth set in from the cabinet face on each visible side?', when: (p) => p.baseType === 'plinth' },
    { key: 'plinthFinish', type: 'finish', ask: 'Plinth finish?', when: (p) => p.baseType === 'plinth' },
    { key: 'wallHungHeight', type: 'dimension', ask: 'Height from finished floor to the underside of the cabinet?', when: (p) => p.baseType === 'wall-hung' },

    { key: 'doorCount', type: 'integer', min: 0, max: 12, ask: 'How many doors across the front? (0 for an open box)' },
    { key: 'doorGap', type: 'dimension', ask: 'Reveal between adjacent doors?', when: (p) => p.doorCount > 1 },
    { key: 'doorFinish', type: 'finish', ask: 'Door face finish?', when: (p) => p.doorCount > 0 },
    {
      key: 'pullStyle',
      type: 'enum',
      values: ['bar', 'edge-pull', 'none'],
      ask: 'Pull style — surface-mounted bar, continuous edge pull, or none (push-to-open)?',
      when: (p) => p.doorCount > 0,
    },
    { key: 'pullLength', type: 'dimension', ask: 'Bar pull length?', when: (p) => p.pullStyle === 'bar' },
    { key: 'pullDiameter', type: 'dimension', ask: 'Bar pull diameter / section?', when: (p) => p.pullStyle === 'bar' },
    { key: 'pullProjection', type: 'dimension', ask: 'How far does the bar stand off the door face?', when: (p) => p.pullStyle === 'bar' },
    { key: 'pullOffsetFromTop', type: 'dimension', ask: 'Centreline of the pull, measured down from the top of the door?', when: (p) => p.pullStyle === 'bar' },
    { key: 'edgePullHeight', type: 'dimension', ask: 'Height of the continuous edge pull across the door top?', when: (p) => p.pullStyle === 'edge-pull' },
    { key: 'edgePullProjection', type: 'dimension', ask: 'How far does the edge pull stand proud of the door face?', when: (p) => p.pullStyle === 'edge-pull' },
    { key: 'pullFinish', type: 'finish', ask: 'Pull finish?', when: (p) => p.pullStyle === 'bar' || p.pullStyle === 'edge-pull' },

    { key: 'carcassFinish', type: 'finish', ask: 'Carcass finish (end panels and interior)?' },
    { key: 'topFinish', type: 'finish', ask: 'Finish of the applied top?' },
  ],

  /**
   * @param {import('../lib/mesh.mjs').MeshBuilder} mesh
   * @param {Record<string, any>} p resolved params, all in metres
   */
  build(mesh, p) {
    const halfWidth = p.width / 2
    const halfDepth = p.depth / 2
    const t = p.panelThickness

    const baseHeight =
      p.baseType === 'toe-kick' ? p.toeKickHeight
      : p.baseType === 'legs' ? p.legHeight
      : p.baseType === 'plinth' ? p.plinthHeight
      : p.wallHungHeight

    const hasDoors = p.doorCount > 0
    const doorThickness = hasDoors ? t : 0
    const carcassDepth = p.depth - doorThickness
    const carcassHeight = p.height - p.topThickness - baseHeight
    const backZ = -halfDepth
    const carcassFrontZ = backZ + carcassDepth

    if (carcassHeight <= 2 * t) {
      throw new Error(
        `height (${p.height.toFixed(3)}m) leaves only ${carcassHeight.toFixed(3)}m of carcass after the top and base; ` +
          'check height, topThickness and the base height.',
      )
    }
    if (carcassDepth <= t) throw new Error('depth is too shallow for the door thickness plus a carcass')

    // --- carcass ----------------------------------------------------------
    for (const [name, x] of [['end panel L', -halfWidth], ['end panel R', halfWidth - t]]) {
      mesh.addBox({ x, y: baseHeight, z: backZ, w: t, h: carcassHeight, d: carcassDepth, material: p.carcassFinish, name })
    }
    const innerWidth = p.width - 2 * t
    mesh.addBox({ x: -halfWidth + t, y: baseHeight, z: backZ, w: innerWidth, h: t, d: carcassDepth, material: p.carcassFinish, name: 'bottom deck' })
    mesh.addBox({
      x: -halfWidth + t, y: baseHeight + carcassHeight - t, z: backZ,
      w: innerWidth, h: t, d: carcassDepth, material: p.carcassFinish, name: 'top deck',
    })
    mesh.addBox({
      x: -halfWidth + t, y: baseHeight + t, z: backZ,
      w: innerWidth, h: carcassHeight - 2 * t, d: t, material: p.carcassFinish, name: 'back panel',
    })

    // --- base -------------------------------------------------------------
    if (p.baseType === 'toe-kick') {
      const kickDepth = carcassDepth - p.toeKickRecess
      if (kickDepth <= 0) throw new Error('toeKickRecess is deeper than the carcass')
      mesh.addBox({ x: -halfWidth, y: 0, z: backZ, w: p.width, h: p.toeKickHeight, d: kickDepth, material: p.toeKickFinish, name: 'toe kick' })
    } else if (p.baseType === 'legs') {
      const radius = p.legDiameter / 2
      for (const [label, x] of [['L', -halfWidth + p.legInset], ['R', halfWidth - p.legInset]]) {
        for (const [side, z] of [['front', carcassFrontZ - p.legInset], ['back', backZ + p.legInset]]) {
          mesh.addCylinder({ x, y: 0, z, radius, height: p.legHeight, material: p.legFinish, name: `leg ${label}-${side}` })
        }
      }
    } else if (p.baseType === 'plinth') {
      const plinthWidth = p.width - 2 * p.plinthReveal
      const plinthDepth = carcassDepth - p.plinthReveal
      if (plinthWidth <= 0 || plinthDepth <= 0) throw new Error('plinthReveal is larger than the cabinet')
      mesh.addBox({
        x: -halfWidth + p.plinthReveal, y: 0, z: backZ,
        w: plinthWidth, h: p.plinthHeight, d: plinthDepth, material: p.plinthFinish, name: 'plinth',
      })
    }

    // --- doors ------------------------------------------------------------
    if (hasDoors) {
      const gap = p.doorCount > 1 ? p.doorGap : 0
      const doorWidth = (p.width - gap * (p.doorCount - 1)) / p.doorCount
      if (doorWidth <= 0) throw new Error('doorGap is too large for the number of doors across this width')
      const doorHeight = carcassHeight
      const doorY = baseHeight

      for (let i = 0; i < p.doorCount; i += 1) {
        const doorX = -halfWidth + i * (doorWidth + gap)
        mesh.addBox({
          x: doorX, y: doorY, z: carcassFrontZ,
          w: doorWidth, h: doorHeight, d: doorThickness, material: p.doorFinish, name: `door ${i + 1}`,
        })

        if (p.pullStyle === 'bar') {
          const barY = doorY + doorHeight - p.pullOffsetFromTop - p.pullDiameter / 2
          const barZ = halfDepth + p.pullProjection - p.pullDiameter
          mesh.addBox({
            x: doorX + (doorWidth - p.pullLength) / 2, y: barY, z: barZ,
            w: p.pullLength, h: p.pullDiameter, d: p.pullDiameter, material: p.pullFinish, name: `pull ${i + 1}`,
          })
          const standoffDepth = p.pullProjection - p.pullDiameter
          if (standoffDepth > 0) {
            const inset = p.pullLength * 0.15
            for (const [label, sx] of [['a', doorX + (doorWidth - p.pullLength) / 2 + inset], ['b', doorX + (doorWidth + p.pullLength) / 2 - inset - p.pullDiameter]]) {
              mesh.addBox({
                x: sx, y: barY, z: halfDepth,
                w: p.pullDiameter, h: p.pullDiameter, d: standoffDepth, material: p.pullFinish, name: `pull ${i + 1} standoff ${label}`,
              })
            }
          }
        } else if (p.pullStyle === 'edge-pull') {
          mesh.addBox({
            x: doorX, y: doorY + doorHeight - p.edgePullHeight, z: halfDepth,
            w: doorWidth, h: p.edgePullHeight, d: p.edgePullProjection,
            material: p.pullFinish, name: `edge pull ${i + 1}`,
          })
        }
      }
    }

    // --- applied top ------------------------------------------------------
    mesh.addBox({
      x: -halfWidth - p.topOverhangSides,
      y: p.height - p.topThickness,
      z: backZ,
      w: p.width + 2 * p.topOverhangSides,
      h: p.topThickness,
      d: p.depth + p.topOverhangFront,
      material: p.topFinish,
      name: 'top',
    })
  },
}

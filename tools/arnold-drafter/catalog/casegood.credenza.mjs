// Casegood / millwork box: credenza, buffet, low storage unit, base cabinet run.
//
// PRIMARY params (asked, never guessed): overall width, base type, door count,
// and the finishes. Everything else derives from those by a stated rule, so a
// sketch can start from "72 inch credenza, three doors, rift oak" and still be
// buildable — with every derived number reported back for a sanity check.
//
// Derived values are overridden by putting them in the spec. An explicit value
// always beats its rule.

import { IN } from '../lib/units.mjs'

export default {
  type: 'casegood.credenza',
  label: 'Credenza / low storage casegood',
  params: [
    // --- primary: the customer decides these -------------------------------
    { key: 'width', type: 'dimension', ask: 'Overall width (outside face of end panel to outside face)?' },
    {
      key: 'depth', type: 'dimension', confirm: true,
      rule: 'contract standard 20" credenza depth',
      derive: () => 20 * IN,
      ask: 'Overall depth, front face of the doors to the back?',
      note: 'Includes the door thickness; the carcass is set back by it.',
    },
    {
      key: 'height', type: 'dimension', confirm: true,
      rule: 'contract standard 30" credenza height',
      derive: () => 30 * IN,
      ask: 'Overall height, floor to top of the finished top?',
    },
    {
      key: 'baseType', type: 'enum', values: ['toe-kick', 'legs', 'plinth', 'wall-hung'],
      ask: 'How does it meet the floor — recessed toe kick, legs, a flush plinth, or wall-hung?',
    },
    { key: 'doorCount', type: 'integer', min: 0, max: 12, ask: 'How many doors across the front? (0 for an open box)' },
    {
      key: 'pullStyle', type: 'enum', values: ['bar', 'edge-pull', 'none'],
      ask: 'Pull style — surface-mounted bar, continuous edge pull, or none (push-to-open)?',
      when: (p) => p.doorCount > 0,
    },
    { key: 'carcassFinish', type: 'finish', ask: 'Carcass finish (end panels and interior)?' },
    { key: 'doorFinish', type: 'finish', ask: 'Door face finish?', when: (p) => p.doorCount > 0 },
    { key: 'topFinish', type: 'finish', ask: 'Finish of the applied top?' },
    {
      key: 'pullFinish', type: 'finish', ask: 'Pull finish?',
      when: (p) => p.pullStyle === 'bar' || p.pullStyle === 'edge-pull',
    },

    // --- detail: derived from the primaries --------------------------------
    { key: 'panelThickness', type: 'dimension', rule: 'shop standard 3/4" sheet', derive: () => 0.75 * IN },
    { key: 'topThickness', type: 'dimension', rule: 'shop standard 1 1/4" top', derive: () => 1.25 * IN },
    { key: 'topOverhangFront', type: 'dimension', rule: 'shop standard 1" front overhang', derive: () => 1 * IN },
    { key: 'topOverhangSides', type: 'dimension', rule: 'shop standard 1" side overhang', derive: () => 1 * IN },

    {
      key: 'toeKickHeight', type: 'dimension', when: (p) => p.baseType === 'toe-kick',
      rule: 'shop standard 4" toe kick', derive: () => 4 * IN,
    },
    {
      key: 'toeKickRecess', type: 'dimension', when: (p) => p.baseType === 'toe-kick',
      rule: 'shop standard 3" recess', derive: () => 3 * IN,
    },
    {
      key: 'toeKickFinish', type: 'finish', when: (p) => p.baseType === 'toe-kick',
      rule: 'matches the carcass finish', derive: (p) => p.carcassFinish,
    },
    {
      key: 'legHeight', type: 'dimension', when: (p) => p.baseType === 'legs',
      rule: '20% of overall height', derive: (p) => p.height * 0.2,
    },
    {
      key: 'legDiameter', type: 'dimension', when: (p) => p.baseType === 'legs',
      rule: '25% of leg height', derive: (p) => p.legHeight * 0.25,
    },
    {
      key: 'legInset', type: 'dimension', when: (p) => p.baseType === 'legs',
      rule: 'leg diameter plus 1"', derive: (p) => p.legDiameter + 1 * IN,
    },
    {
      key: 'legFinish', type: 'finish', when: (p) => p.baseType === 'legs',
      rule: 'matches the carcass finish', derive: (p) => p.carcassFinish,
    },
    {
      key: 'plinthHeight', type: 'dimension', when: (p) => p.baseType === 'plinth',
      rule: 'shop standard 4" plinth', derive: () => 4 * IN,
    },
    {
      key: 'plinthReveal', type: 'dimension', when: (p) => p.baseType === 'plinth',
      rule: 'shop standard 1" reveal', derive: () => 1 * IN,
    },
    {
      key: 'plinthFinish', type: 'finish', when: (p) => p.baseType === 'plinth',
      rule: 'matches the carcass finish', derive: (p) => p.carcassFinish,
    },
    {
      key: 'wallHungHeight', type: 'dimension', when: (p) => p.baseType === 'wall-hung', confirm: true,
      rule: 'underside set at 40% of overall height', derive: (p) => p.height * 0.4,
    },

    {
      key: 'doorGap', type: 'dimension', when: (p) => p.doorCount > 1,
      rule: 'shop standard 1/8" reveal', derive: () => 0.125 * IN,
    },
    {
      key: 'pullLength', type: 'dimension', when: (p) => p.pullStyle === 'bar',
      rule: '45% of door width, capped at 12"',
      derive: (p) => {
        const gap = p.doorCount > 1 ? p.doorGap : 0
        const doorWidth = (p.width - gap * (p.doorCount - 1)) / p.doorCount
        return Math.min(doorWidth * 0.45, 12 * IN)
      },
    },
    {
      key: 'pullDiameter', type: 'dimension', when: (p) => p.pullStyle === 'bar',
      rule: 'shop standard 5/8" bar', derive: () => 0.625 * IN,
    },
    {
      key: 'pullProjection', type: 'dimension', when: (p) => p.pullStyle === 'bar',
      rule: '2.4x the bar diameter', derive: (p) => p.pullDiameter * 2.4,
    },
    {
      key: 'pullOffsetFromTop', type: 'dimension', when: (p) => p.pullStyle === 'bar',
      rule: 'shop standard 3" down from the door top', derive: () => 3 * IN,
    },
    {
      key: 'edgePullHeight', type: 'dimension', when: (p) => p.pullStyle === 'edge-pull',
      rule: 'shop standard 1 1/2" edge pull', derive: () => 1.5 * IN,
    },
    {
      key: 'edgePullProjection', type: 'dimension', when: (p) => p.pullStyle === 'edge-pull',
      rule: 'shop standard 1/4" proud of the door', derive: () => 0.25 * IN,
    },
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
        `height leaves only ${(carcassHeight / IN).toFixed(2)}" of carcass after the top and base; ` +
          'check height, topThickness and the base height.',
      )
    }
    if (carcassDepth <= t) throw new Error('depth is too shallow for the door thickness plus a carcass')

    // --- carcass ----------------------------------------------------------
    for (const [name, x] of [['end panel L', -halfWidth], ['end panel R', halfWidth - t]]) {
      mesh.addBox({
        x, y: baseHeight, z: backZ, w: t, h: carcassHeight, d: carcassDepth,
        material: p.carcassFinish, grain: 'vertical', name,
      })
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
          w: doorWidth, h: doorHeight, d: doorThickness, material: p.doorFinish,
          grain: 'vertical', name: `door ${i + 1}`,
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
            const left = doorX + (doorWidth - p.pullLength) / 2 + inset
            const right = doorX + (doorWidth + p.pullLength) / 2 - inset - p.pullDiameter
            for (const [label, sx] of [['a', left], ['b', right]]) {
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

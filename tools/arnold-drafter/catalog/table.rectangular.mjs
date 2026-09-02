// Rectangular table or desk: conference table, work desk, occasional table.
//
// PRIMARY params: the long dimension, the base family, and the finishes. Give
// it "10 foot walnut conference table, panel ends" and it builds — depth,
// height, thickness and every base detail scale from there and get reported
// back. Put any of them in the spec to pin it.

import { IN } from '../lib/units.mjs'

export default {
  type: 'table.rectangular',
  label: 'Rectangular table / desk',
  params: [
    // --- primary -----------------------------------------------------------
    { key: 'topWidth', type: 'dimension', ask: 'Top width (the long dimension)?' },
    {
      key: 'topDepth', type: 'dimension', confirm: true,
      rule: '40% of the length, held between 30" and 60"',
      derive: (p) => Math.min(Math.max(p.topWidth * 0.4, 30 * IN), 60 * IN),
      ask: 'Top depth (the short dimension)?',
    },
    {
      key: 'overallHeight', type: 'dimension', confirm: true,
      rule: 'contract standard 29" table height',
      derive: () => 29 * IN,
      ask: 'Overall height, floor to the top surface?',
    },
    {
      key: 'baseType', type: 'enum', values: ['four-legs', 'panel-ends'],
      ask: 'Base type — four legs, or solid panel ends?',
    },
    { key: 'topFinish', type: 'finish', ask: 'Top finish?' },
    {
      key: 'baseFinish', type: 'finish', ask: 'Base finish (legs or end panels)?',
      rule: 'matches the top finish', derive: (p) => p.topFinish,
    },

    // --- detail ------------------------------------------------------------
    {
      key: 'topThickness', type: 'dimension',
      rule: '1 1/4" up to 8ft, 1 1/2" beyond', derive: (p) => (p.topWidth > 96 * IN ? 1.5 : 1.25) * IN,
    },

    {
      key: 'legSection', type: 'dimension', when: (p) => p.baseType === 'four-legs',
      rule: '2 1/2" square, 3" on tops over 8ft', derive: (p) => (p.topWidth > 96 * IN ? 3 : 2.5) * IN,
    },
    {
      key: 'legInsetFromEnd', type: 'dimension', when: (p) => p.baseType === 'four-legs',
      rule: '1.5x the leg section', derive: (p) => p.legSection * 1.5,
    },
    {
      key: 'legInsetFromSide', type: 'dimension', when: (p) => p.baseType === 'four-legs',
      rule: '80% of the leg section', derive: (p) => p.legSection * 0.8,
    },
    {
      key: 'hasApron', type: 'boolean', when: (p) => p.baseType === 'four-legs',
      rule: 'aprons on tables over 6ft, which need the rail for stiffness',
      derive: (p) => p.topWidth > 72 * IN,
    },
    {
      key: 'apronHeight', type: 'dimension', when: (p) => p.hasApron === true,
      rule: 'shop standard 4" apron', derive: () => 4 * IN,
    },
    {
      key: 'apronThickness', type: 'dimension', when: (p) => p.hasApron === true,
      rule: 'shop standard 3/4" stock', derive: () => 0.75 * IN,
    },
    {
      key: 'apronSetback', type: 'dimension', when: (p) => p.hasApron === true,
      rule: '60% of the leg section, so the apron sits behind the leg face',
      derive: (p) => p.legSection * 0.6,
    },

    {
      key: 'panelThickness', type: 'dimension', when: (p) => p.baseType === 'panel-ends',
      rule: '1 1/2" panel, 2" on tops over 10ft', derive: (p) => (p.topWidth > 120 * IN ? 2 : 1.5) * IN,
    },
    {
      key: 'panelInsetFromEnd', type: 'dimension', when: (p) => p.baseType === 'panel-ends',
      rule: '10% of the length, so the top cantilevers evenly', derive: (p) => p.topWidth * 0.1,
    },
    {
      key: 'panelInsetFromSide', type: 'dimension', when: (p) => p.baseType === 'panel-ends',
      rule: '15% of the depth', derive: (p) => p.topDepth * 0.15,
    },
    {
      key: 'hasStretcher', type: 'boolean', when: (p) => p.baseType === 'panel-ends',
      rule: 'stretcher on tops over 7ft, which need the span tied together',
      derive: (p) => p.topWidth > 84 * IN,
    },
    {
      key: 'stretcherSection', type: 'dimension', when: (p) => p.hasStretcher === true,
      rule: 'twice the panel thickness', derive: (p) => p.panelThickness * 2,
    },
    {
      key: 'stretcherHeightFromFloor', type: 'dimension', when: (p) => p.hasStretcher === true,
      rule: '28% of overall height, clear of knees', derive: (p) => p.overallHeight * 0.28,
    },
  ],

  build(mesh, p) {
    const halfWidth = p.topWidth / 2
    const halfDepth = p.topDepth / 2
    const underTop = p.overallHeight - p.topThickness

    if (underTop <= 0) throw new Error('topThickness is greater than or equal to overallHeight')

    mesh.addBox({
      x: -halfWidth, y: underTop, z: -halfDepth,
      w: p.topWidth, h: p.topThickness, d: p.topDepth, material: p.topFinish, name: 'top',
    })

    if (p.baseType === 'four-legs') {
      const s = p.legSection
      const xs = [-halfWidth + p.legInsetFromEnd, halfWidth - p.legInsetFromEnd - s]
      const zs = [-halfDepth + p.legInsetFromSide, halfDepth - p.legInsetFromSide - s]
      if (xs[1] <= xs[0] || zs[1] <= zs[0]) throw new Error('leg insets overlap at the centre of the top')

      const labels = [['L', 'back'], ['R', 'back'], ['L', 'front'], ['R', 'front']]
      let index = 0
      for (const z of zs) {
        for (const x of xs) {
          const [side, face] = labels[index]
          mesh.addBox({ x, y: 0, z, w: s, h: underTop, d: s, material: p.baseFinish, name: `leg ${side}-${face}` })
          index += 1
        }
      }

      if (p.hasApron) {
        const apronY = underTop - p.apronHeight
        if (apronY <= 0) throw new Error('apronHeight is taller than the space under the top')
        const innerLeft = xs[0] + s
        const innerRight = xs[1]
        const innerBack = zs[0] + s
        const innerFront = zs[1]

        for (const [name, z] of [
          ['apron front', halfDepth - p.apronSetback - p.apronThickness],
          ['apron back', -halfDepth + p.apronSetback],
        ]) {
          mesh.addBox({
            x: innerLeft, y: apronY, z,
            w: innerRight - innerLeft, h: p.apronHeight, d: p.apronThickness, material: p.baseFinish, name,
          })
        }
        for (const [name, x] of [
          ['apron end L', -halfWidth + p.apronSetback],
          ['apron end R', halfWidth - p.apronSetback - p.apronThickness],
        ]) {
          mesh.addBox({
            x, y: apronY, z: innerBack,
            w: p.apronThickness, h: p.apronHeight, d: innerFront - innerBack, material: p.baseFinish, name,
          })
        }
      }
    } else {
      const panelDepth = p.topDepth - 2 * p.panelInsetFromSide
      if (panelDepth <= 0) throw new Error('panelInsetFromSide is more than half the top depth')

      const xs = [-halfWidth + p.panelInsetFromEnd, halfWidth - p.panelInsetFromEnd - p.panelThickness]
      if (xs[1] <= xs[0]) throw new Error('panelInsetFromEnd values overlap at the centre of the top')

      for (const [label, x] of [['L', xs[0]], ['R', xs[1]]]) {
        mesh.addBox({
          x, y: 0, z: -halfDepth + p.panelInsetFromSide,
          w: p.panelThickness, h: underTop, d: panelDepth, material: p.baseFinish, name: `end panel ${label}`,
        })
      }

      if (p.hasStretcher) {
        const s = p.stretcherSection
        const y = p.stretcherHeightFromFloor - s / 2
        if (y <= 0 || y + s >= underTop) throw new Error('stretcher centreline puts it through the floor or the top')
        const spanStart = xs[0] + p.panelThickness
        mesh.addBox({
          x: spanStart, y, z: -s / 2,
          w: xs[1] - spanStart, h: s, d: s, material: p.baseFinish, name: 'stretcher',
        })
      }
    }
  },
}

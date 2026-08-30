// Rectangular table or desk: conference table, work desk, occasional table.
//
// Two base families are modelled: four legs (with an optional apron) and solid
// panel ends (with an optional stretcher). Trestle and pedestal bases are not
// built yet — see the gaps list in SKILL.md.

export default {
  type: 'table.rectangular',
  label: 'Rectangular table / desk',
  params: [
    { key: 'topWidth', type: 'dimension', ask: 'Top width (the long dimension)?' },
    { key: 'topDepth', type: 'dimension', ask: 'Top depth (the short dimension)?' },
    { key: 'topThickness', type: 'dimension', ask: 'Top thickness?' },
    { key: 'overallHeight', type: 'dimension', ask: 'Overall height, floor to the top surface?' },

    {
      key: 'baseType',
      type: 'enum',
      values: ['four-legs', 'panel-ends'],
      ask: 'Base type — four legs, or solid panel ends?',
    },

    { key: 'legSection', type: 'dimension', ask: 'Leg section (square legs, so one dimension)?', when: (p) => p.baseType === 'four-legs' },
    { key: 'legInsetFromEnd', type: 'dimension', ask: 'How far in from each END of the top does the leg start?', when: (p) => p.baseType === 'four-legs' },
    { key: 'legInsetFromSide', type: 'dimension', ask: 'How far in from each SIDE edge of the top does the leg start?', when: (p) => p.baseType === 'four-legs' },
    { key: 'hasApron', type: 'boolean', ask: 'Is there an apron / rail below the top? (true or false)', when: (p) => p.baseType === 'four-legs' },
    { key: 'apronHeight', type: 'dimension', ask: 'Apron height (its vertical face)?', when: (p) => p.hasApron === true },
    { key: 'apronThickness', type: 'dimension', ask: 'Apron thickness?', when: (p) => p.hasApron === true },
    { key: 'apronSetback', type: 'dimension', ask: 'How far is the apron set back from the top edge?', when: (p) => p.hasApron === true },

    { key: 'panelThickness', type: 'dimension', ask: 'End panel thickness?', when: (p) => p.baseType === 'panel-ends' },
    { key: 'panelInsetFromEnd', type: 'dimension', ask: 'How far in from each end of the top does the panel sit?', when: (p) => p.baseType === 'panel-ends' },
    { key: 'panelInsetFromSide', type: 'dimension', ask: 'How far in from the front and back edges of the top does the panel sit?', when: (p) => p.baseType === 'panel-ends' },
    { key: 'hasStretcher', type: 'boolean', ask: 'Is there a stretcher between the end panels? (true or false)', when: (p) => p.baseType === 'panel-ends' },
    { key: 'stretcherSection', type: 'dimension', ask: 'Stretcher section (square, so one dimension)?', when: (p) => p.hasStretcher === true },
    { key: 'stretcherHeightFromFloor', type: 'dimension', ask: 'Height from the floor to the centreline of the stretcher?', when: (p) => p.hasStretcher === true },

    { key: 'topFinish', type: 'finish', ask: 'Top finish?' },
    { key: 'baseFinish', type: 'finish', ask: 'Base finish (legs or end panels)?' },
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

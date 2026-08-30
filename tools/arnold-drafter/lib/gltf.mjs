// MeshBuilder -> GLB, via the same @gltf-transform stack functions/ already uses.

import { Document, NodeIO } from '@gltf-transform/core'
import { resolveFinish, hexToLinear } from './materials.mjs'

/**
 * @param {import('./mesh.mjs').MeshBuilder} builder
 * @param {{name: string, credit?: string}} meta
 * @returns {Promise<Uint8Array>} GLB bytes
 */
export async function buildGlb(builder, meta) {
  if (builder.groups.size === 0) throw new Error('nothing to export: the builder produced no geometry')

  const document = new Document()
  document.getRoot().getAsset().generator = `arnold-drafter (${meta.credit ?? 'Arnold Contract'})`

  const buffer = document.createBuffer()
  const mesh = document.createMesh(meta.name)

  for (const [finishName, group] of builder.groups) {
    const finish = resolveFinish(finishName, `material "${finishName}"`)

    const position = document
      .createAccessor(`${finishName}_POSITION`)
      .setType('VEC3')
      .setArray(new Float32Array(group.positions))
      .setBuffer(buffer)

    const normal = document
      .createAccessor(`${finishName}_NORMAL`)
      .setType('VEC3')
      .setArray(new Float32Array(group.normals))
      .setBuffer(buffer)

    const vertexCount = group.positions.length / 3
    const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array
    const indices = document
      .createAccessor(`${finishName}_indices`)
      .setType('SCALAR')
      .setArray(new IndexArray(group.indices))
      .setBuffer(buffer)

    const material = document
      .createMaterial(finish.label)
      .setBaseColorFactor([...hexToLinear(finish.hex), finish.alpha ?? 1])
      .setMetallicFactor(finish.metallic ?? 0)
      .setRoughnessFactor(finish.roughness)
      .setDoubleSided(false)

    if (finish.alpha != null && finish.alpha < 1) material.setAlphaMode('BLEND')

    mesh.addPrimitive(
      document
        .createPrimitive()
        .setAttribute('POSITION', position)
        .setAttribute('NORMAL', normal)
        .setIndices(indices)
        .setMaterial(material),
    )
  }

  const node = document.createNode(meta.name).setMesh(mesh)
  document.createScene(meta.name).addChild(node)

  return new NodeIO().writeBinary(document)
}

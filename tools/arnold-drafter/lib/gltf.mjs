// MeshBuilder -> GLB, via the same @gltf-transform stack functions/ already uses.
//
// Materials carry a generated base-colour texture where the finish declares one,
// so veneer reads as grain rather than a flat brown, and brushed metal reads as
// brushed. Textures are embedded in the GLB, so the file stays a single portable
// asset for the customer viewer.

import { Document, NodeIO } from '@gltf-transform/core'
import { resolveFinish, hexToLinear } from './materials.mjs'
import { generateTexture } from './textures.mjs'

const WRAP_REPEAT = 10497

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

    const texcoord = document
      .createAccessor(`${finishName}_TEXCOORD_0`)
      .setType('VEC2')
      .setArray(new Float32Array(group.uvs))
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
      .setMetallicFactor(finish.metallic ?? 0)
      .setRoughnessFactor(finish.roughness)
      .setDoubleSided(Boolean(finish.doubleSided))

    if (finish.texture) {
      // The texture carries the colour, so the factor stays white or the two
      // would multiply and darken every surface.
      material.setBaseColorFactor([1, 1, 1, finish.alpha ?? 1])
      const texture = document
        .createTexture(`${finishName}_baseColor`)
        .setImage(generateTexture(finish.texture, finish.hex))
        .setMimeType('image/png')
      material.setBaseColorTexture(texture)
      const info = material.getBaseColorTextureInfo()
      info.setWrapS(WRAP_REPEAT).setWrapT(WRAP_REPEAT)
    } else {
      material.setBaseColorFactor([...hexToLinear(finish.hex), finish.alpha ?? 1])
    }

    if (finish.alphaMode === 'MASK') {
      material.setAlphaMode('MASK').setAlphaCutoff(finish.alphaCutoff ?? 0.5)
    } else if (finish.alpha != null && finish.alpha < 1) {
      material.setAlphaMode('BLEND')
    }

    mesh.addPrimitive(
      document
        .createPrimitive()
        .setAttribute('POSITION', position)
        .setAttribute('NORMAL', normal)
        .setAttribute('TEXCOORD_0', texcoord)
        .setIndices(indices)
        .setMaterial(material),
    )
  }

  const node = document.createNode(meta.name).setMesh(mesh)
  document.createScene(meta.name).addChild(node)

  return new NodeIO().writeBinary(document)
}

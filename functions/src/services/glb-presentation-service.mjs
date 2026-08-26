import { WebIO } from '@gltf-transform/core'

// SketchUp exporters (SimLab and similar) write materials twice: the accurate
// appearance goes into the legacy KHR_materials_pbrSpecularGlossiness extension,
// while the base pbrMetallicRoughness block only gets a crude fallback with
// non-zero metallic factors. model-viewer/three.js only read the fallback, so
// painted colors and light textures turn dark, mirror-like, or washed out under
// image-based lighting. This service recovers the spec-gloss appearance,
// flattens legacy exports to matte dielectric materials (the SketchUp look),
// and compresses the result for fast customer loading. Models authored with
// genuine metallic-roughness PBR (no spec-gloss extension) keep their authored
// material values and only receive the safe fixes plus compression.

let glbToolingPromise = null
async function loadGlbTooling() {
  if (!glbToolingPromise) {
    glbToolingPromise = (async () => {
      const [{ ALL_EXTENSIONS }, transforms, { default: draco3d }, { default: sharp }] = await Promise.all([
        import('@gltf-transform/extensions'),
        import('@gltf-transform/functions'),
        import('draco3dgltf'),
        import('sharp'),
      ])
      const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
        'draco3d.encoder': await draco3d.createEncoderModule(),
        'draco3d.decoder': await draco3d.createDecoderModule(),
      })
      return { io, transforms, sharp }
    })()
  }
  return glbToolingPromise
}

function normalizeMaterials(document, { matteRecovery }) {
  const stats = { materialCount: 0, glassCount: 0, maskToOpaqueCount: 0 }
  for (const material of document.getRoot().listMaterials()) {
    stats.materialCount += 1

    if (matteRecovery) {
      // metalRough() parks legacy spec-gloss data in KHR_materials_specular/ior.
      // Exporters fill those with a non-physical 0.5 specular default that makes
      // every surface plastic-shiny, so drop them for the matte SketchUp look.
      material.setExtension('KHR_materials_specular', null)
      material.setExtension('KHR_materials_ior', null)
      material.setExtension('KHR_materials_pbrSpecularGlossiness', null)

      material.setMetallicFactor(0)
      material.setMetallicRoughnessTexture(null)
      const isGlassLike = material.getAlphaMode() === 'BLEND' && material.getAlpha() < 0.7
      if (isGlassLike) {
        stats.glassCount += 1
        material.setRoughnessFactor(0.08)
      } else {
        material.setRoughnessFactor(Math.min(1, Math.max(0.55, material.getRoughnessFactor())))
      }
    }

    material.setDoubleSided(true)

    // SimLab marks every material MASK; without real cutout alpha that only
    // causes edge artifacts, so restore OPAQUE where no alpha can exist.
    const baseColorTexture = material.getBaseColorTexture()
    const textureCannotHaveAlpha = !baseColorTexture || baseColorTexture.getMimeType() === 'image/jpeg'
    if (material.getAlphaMode() === 'MASK' && material.getAlpha() >= 1 && textureCannotHaveAlpha) {
      material.setAlphaMode('OPAQUE')
      stats.maskToOpaqueCount += 1
    }
  }
  return stats
}

/**
 * Prepares an uploaded GLB for the customer viewer.
 *
 * @param {Uint8Array|Buffer} sourceBinary Raw GLB bytes.
 * @param {{ forceMatteRecovery?: boolean, logContext?: object }} [options]
 *   forceMatteRecovery applies the matte material recovery even without a
 *   spec-gloss extension — used for files damaged by the old v1 processor,
 *   which stripped the extension but kept its broken metallic values.
 * @returns {Promise<{ outputBinary: Uint8Array, quality: object }>}
 */
export async function prepareGlbForCustomerPresentation(sourceBinary, options = {}) {
  const { io, transforms, sharp } = await loadGlbTooling()
  const document = await io.readBinary(new Uint8Array(sourceBinary))

  const hadSpecGloss = document
    .getRoot()
    .listExtensionsUsed()
    .some((extension) => extension.extensionName === 'KHR_materials_pbrSpecularGlossiness')
  const matteRecovery = hadSpecGloss || options.forceMatteRecovery === true

  // Fidelity pass: recover real colors/textures from legacy spec-gloss
  // materials (no-op for properly authored files), then normalize.
  await document.transform(transforms.metalRough())
  const materialStats = normalizeMaterials(document, { matteRecovery })

  // Optimization pass: smaller textures and draco geometry for fast loading.
  // If it fails on an unusual model, the fidelity-fixed document still ships.
  let optimized = true
  try {
    await document.transform(
      transforms.dedup(),
      transforms.prune(),
      transforms.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048] }),
      transforms.draco(),
    )
  } catch (optimizationError) {
    optimized = false
    console.warn('GLB optimization pass failed; publishing the material-corrected model uncompressed.', {
      ...options.logContext,
      message: optimizationError instanceof Error ? optimizationError.message : String(optimizationError),
    })
  }

  const outputBinary = await io.writeBinary(document)
  return {
    outputBinary,
    quality: {
      pipeline: 'specgloss-matte-v2',
      materialMode: matteRecovery ? 'matte-recovery' : 'preserve-authored',
      hadSpecGloss,
      optimized,
      ...materialStats,
    },
  }
}

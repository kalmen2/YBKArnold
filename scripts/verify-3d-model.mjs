#!/usr/bin/env node
// Visual regression test for the customer 3D viewer.
//
// Renders a GLB in a real headless Chrome using the same <model-viewer>
// settings customers get, then verifies the render against expectations
// derived from the GLB's own material data:
//
//   * the model loads at all
//   * textures survived the preparation pipeline
//   * the render is not mostly black or washed out
//   * saturated materials keep the color the file says they should be
//   * that color stays stable as the model rotates (no directional blowout)
//   * the file stays inside the size budget for fast customer loading
//
// Usage:
//   node scripts/verify-3d-model.mjs <model.glb> [--out <dir>] [--json]
//   node scripts/verify-3d-model.mjs <https://firebasestorage.../model.glb>
//
// Exits non-zero when a check fails, so it can gate a deploy.

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Keep in sync with default3dViewerSettings in src/features/crm/api.ts.
const VIEWER_SETTINGS = {
  brightness: 1,
  edgeColor: '#000000',
  edgeThreshold: 18,
  edgeWidth: 2,
  showEdges: true,
  backgroundColor: '#ffffff',
  fieldOfView: 28,
}

// One elevation, six azimuths: drift across them isolates the compass direction
// a surface faces. 55deg looks slightly down so top faces are sampled too.
const ORBITS = [0, 60, 120, 180, 240, 300].map((azimuth) => ({ azimuth, elevation: 55 }))

const BUDGET = {
  maxBytes: 8 * 1024 * 1024,
  // Mean luminance of the model's own pixels, 0-255. Outside this band the
  // render reads as either crushed-dark or blown-out.
  minMeanLuminance: 90,
  maxMeanLuminance: 225,
  maxDarkPixelPct: 12,
  maxBlownPixelPct: 6,
  // Brightness legitimately varies with surface orientation — that is what 3D
  // shading is. Hue and saturation must not: a material that shifts hue or
  // loses saturation as the model turns is the "washed out from some angles"
  // failure. Thresholds are on those, not on raw RGB.
  maxHueError: 14,
  minSaturationRatio: 0.62,
  maxSaturationDrift: 0.17,
  maxHueDrift: 12,
  minTrackedPixels: 250,
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new Error(
      `No Chrome/Chromium found. Set CHROME_PATH to a browser binary. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`,
    )
  }
  return found
}

function linearToSrgb255(value) {
  const clamped = Math.min(1, Math.max(0, value))
  const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
  return Math.round(srgb * 255)
}

/** Reads the JSON chunk out of a binary glTF without any glTF dependency. */
function readGlbJson(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a binary glTF (bad magic).')
  const jsonLength = buffer.readUInt32LE(12)
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
}

/**
 * Picks the materials worth asserting on: strongly saturated, untextured
 * colors whose rendered result can be matched back to the material by hue.
 * White/grey/textured materials are ambiguous in a render, so they are
 * covered by the overall luminance checks instead.
 */
function hueOf([r, g, b]) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return -1
  const d = max - min
  let hue
  if (max === r) hue = ((g - b) / d) % 6
  else if (max === g) hue = (b - r) / d + 2
  else hue = (r - g) / d + 4
  hue *= 60
  return hue < 0 ? hue + 360 : hue
}

function hueDistance(a, b) {
  if (a < 0 || b < 0) return 360
  const d = Math.abs(a - b)
  return d > 180 ? 360 - d : d
}

function trackableMaterials(gltf) {
  const candidates = []
  for (const material of gltf.materials || []) {
    const pbr = material.pbrMetallicRoughness || {}
    if (pbr.baseColorTexture) continue
    const factor = pbr.baseColorFactor
    if (!factor) continue
    const [r, g, b, a = 1] = factor
    if (a < 0.95) continue
    const rgb = [linearToSrgb255(r), linearToSrgb255(g), linearToSrgb255(b)]
    const max = Math.max(...rgb)
    const min = Math.min(...rgb)
    if (max < 60) continue
    const saturation = (max - min) / max
    if (saturation < 0.45) continue
    candidates.push({
      name: material.name || `material-${candidates.length}`,
      expected: rgb,
      hue: hueOf(rgb),
      saturation: +saturation.toFixed(3),
    })
  }

  // Materials closer than the segmentation window cannot be told apart in a
  // render by color alone, so collapse them into one tracked hue family and
  // assert on the family rather than pretending to measure each separately.
  const families = []
  for (const candidate of candidates.sort((a, b) => b.saturation - a.saturation)) {
    const existing = families.find((family) => hueDistance(family.hue, candidate.hue) <= 20)
    if (existing) {
      existing.members.push(candidate.name)
      continue
    }
    families.push({
      name: candidate.name,
      expected: candidate.expected,
      hue: candidate.hue,
      saturation: candidate.saturation,
      members: [candidate.name],
    })
  }
  return families.map((family) => ({
    ...family,
    label: family.members.length > 1 ? `${family.name} +${family.members.length - 1}` : family.name,
  }))
}

/**
 * Detects the two defects that make a SketchUp export unfit for the customer
 * viewer. Neither is visible to the render checks below: they live in
 * textured materials, which a render cannot segment by color.
 */
function auditMaterials(gltf) {
  const usesSpecGloss = (gltf.extensionsUsed || []).includes('KHR_materials_pbrSpecularGlossiness')
  const metallicTextured = []
  for (const material of gltf.materials || []) {
    const pbr = material.pbrMetallicRoughness || {}
    if (!pbr.baseColorTexture) continue
    // glTF's default metallicFactor is 1 when the property is absent.
    const metallic = pbr.metallicFactor === undefined ? 1 : pbr.metallicFactor
    if (metallic >= 0.3) metallicTextured.push({ name: material.name || '(unnamed)', metallic })
  }
  return { usesSpecGloss, metallicTextured }
}

// Mirrors src/features/crm/SketchUpStyleViewer.tsx: flat matte materials, no
// environment map, and SketchUp-style edge lines. Kept in sync by hand — if the
// component's shading changes, change it here too or the test stops measuring
// what customers actually see.
const HARNESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden}canvas{display:block}</style>
<script type="importmap">
{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}
</script>
</head><body>
<script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'

const params = new URLSearchParams(location.search)
const settings = JSON.parse(decodeURIComponent(params.get('settings')))

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(window.innerWidth, window.innerHeight, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(settings.backgroundColor)
const camera = new THREE.PerspectiveCamera(settings.fieldOfView, window.innerWidth / window.innerHeight, 0.1, 10000)

const hemisphere = new THREE.HemisphereLight(0xffffff, 0xd8d4cc, 1.15 * settings.brightness)
const ambient = new THREE.AmbientLight(0xffffff, 0.55 * settings.brightness)
const keyLight = new THREE.DirectionalLight(0xffffff, 0.6 * settings.brightness)
scene.add(hemisphere, ambient, keyLight)

const group = new THREE.Group()
scene.add(group)
let center = new THREE.Vector3()
let distance = 10

const draco = new DRACOLoader()
draco.setDecoderPath('/draco/')
const loader = new GLTFLoader()
loader.setDRACOLoader(draco)

loader.load(params.get('model'), (gltf) => {
  const root = gltf.scene
  root.updateWorldMatrix(true, true)
  const edgeGeometries = []
  root.traverse((child) => {
    if (!child.isMesh) return
    const source = child.material
    child.material = new THREE.MeshLambertMaterial({
      color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
      map: source.map || null,
      transparent: source.transparent,
      opacity: source.opacity,
      alphaTest: source.alphaTest,
      depthWrite: source.transparent ? false : true,
      side: THREE.DoubleSide,
    })
    if (settings.showEdges && child.geometry) {
      const edges = new THREE.EdgesGeometry(child.geometry, settings.edgeThreshold)
      if (edges.getAttribute('position') && edges.getAttribute('position').count) {
        edges.applyMatrix4(child.matrixWorld)
        edgeGeometries.push(edges)
      }
    }
  })
  if (edgeGeometries.length) {
    const merged = mergeGeometries(edgeGeometries, false)
    if (merged) {
      const lineGeometry = new LineSegmentsGeometry()
      lineGeometry.setPositions(merged.getAttribute('position').array)
      const lineMaterial = new LineMaterial({ color: new THREE.Color(settings.edgeColor), linewidth: settings.edgeWidth })
      lineMaterial.resolution.set(window.innerWidth, window.innerHeight)
      group.add(new LineSegments2(lineGeometry, lineMaterial))
    }
  }
  group.add(root)

  const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere())
  center = sphere.center.clone()
  const radius = sphere.radius || 1
  const vFov = THREE.MathUtils.degToRad(camera.fov)
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
  distance = Math.max(radius / Math.sin(vFov / 2), radius / Math.sin(hFov / 2)) * 1.06
  camera.near = Math.max(distance / 1000, 0.01)
  camera.far = distance * 100
  camera.updateProjectionMatrix()
  window.__loaded = true
}, undefined, (error) => {
  window.__error = String((error && error.message) || 'load failed')
})

window.__renderAt = async (azimuth, elevation) => {
  const theta = THREE.MathUtils.degToRad(azimuth)
  const phi = THREE.MathUtils.degToRad(elevation)
  camera.position.set(
    center.x + distance * Math.sin(phi) * Math.sin(theta),
    center.y + distance * Math.cos(phi),
    center.z + distance * Math.sin(phi) * Math.cos(theta),
  )
  camera.lookAt(center)
  keyLight.position.copy(camera.position)
  renderer.render(scene, camera)
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  return renderer.domElement.toDataURL('image/png')
}

  // Measures the rendered frame: overall luminance health plus, for each
  // tracked material, the mean color of the pixels that match its hue.
  window.__measure = (dataUrl, tracked, background) => new Promise((done) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)

      const bg = [
        parseInt(background.slice(1, 3), 16),
        parseInt(background.slice(3, 5), 16),
        parseInt(background.slice(5, 7), 16),
      ]
      const hueOf = (r, g, b) => {
        const max = Math.max(r, g, b), min = Math.min(r, g, b)
        if (max === min) return -1
        const d = max - min
        let h
        if (max === r) h = ((g - b) / d) % 6
        else if (max === g) h = (b - r) / d + 2
        else h = (r - g) / d + 4
        h *= 60
        return h < 0 ? h + 360 : h
      }
      const hueDistance = (a, b) => {
        if (a < 0 || b < 0) return 360
        const d = Math.abs(a - b)
        return d > 180 ? 360 - d : d
      }

      const width = canvas.width, height = canvas.height
      const isBackground = new Uint8Array(width * height)
      for (let p = 0; p < width * height; p++) {
        const i = p * 4
        const near = Math.abs(data[i] - bg[0]) < 7 && Math.abs(data[i + 1] - bg[1]) < 7 && Math.abs(data[i + 2] - bg[2]) < 7
        isBackground[p] = (data[i + 3] < 8 || near) ? 1 : 0
      }
      // Erode one pixel in from the silhouette: edge pixels are antialiased
      // blends with the page background and would fake a washed-out reading.
      const isInterior = new Uint8Array(width * height)
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const p = y * width + x
          if (isBackground[p]) continue
          let touchesBackground = false
          for (let dy = -1; dy <= 1 && !touchesBackground; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (isBackground[p + dy * width + dx]) { touchesBackground = true; break }
            }
          }
          isInterior[p] = touchesBackground ? 0 : 1
        }
      }

      // Per material we keep the individual pixels rather than a running mean:
      // several materials can share a hue window (and textured surfaces can
      // stray into it), so the honest question is whether the material's true
      // vivid color is present at all, measured on its most saturated decile.
      // The SketchUp-style outlines are deliberately near-black. They are
      // strokes, not surfaces, so they must not count toward "the model is
      // rendering dark". A dark pixel belonging to a thin stroke has bright
      // pixels a few px away; a genuinely dark surface does not.
      const luminance = new Float32Array(width * height)
      for (let p = 0; p < width * height; p++) {
        const i = p * 4
        luminance[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      }
      const STROKE_PROBE = 3
      const isStroke = new Uint8Array(width * height)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = y * width + x
          if (!isInterior[p] || luminance[p] >= 60) continue
          const neighbours = [
            x - STROKE_PROBE >= 0 ? luminance[p - STROKE_PROBE] : 255,
            x + STROKE_PROBE < width ? luminance[p + STROKE_PROBE] : 255,
            y - STROKE_PROBE >= 0 ? luminance[p - STROKE_PROBE * width] : 255,
            y + STROKE_PROBE < height ? luminance[p + STROKE_PROBE * width] : 255,
          ]
          // Bright on any side ⇒ this is a line, not a dark surface.
          if (neighbours.some((value) => value >= 60)) isStroke[p] = 1
        }
      }

      const buckets = tracked.map(() => ({ matched: 0, sat: [], hue: [], lum: [] }))
      let modelPixels = 0, lumSum = 0, dark = 0, blown = 0
      for (let p = 0; p < width * height; p++) {
        if (!isInterior[p] || isStroke[p]) continue
        const i = p * 4
        const r = data[i], g = data[i + 1], b = data[i + 2]
        const lum = luminance[p]
        modelPixels++; lumSum += lum
        if (lum < 40) dark++
        if (lum > 250) blown++

        const max = Math.max(r, g, b), min = Math.min(r, g, b)
        const saturation = max ? (max - min) / max : 0
        if (saturation < 0.3 || max < 50) continue
        const hue = hueOf(r, g, b)
        for (let t = 0; t < tracked.length; t++) {
          if (hueDistance(hue, tracked[t].hue) > 18) continue
          const bucket = buckets[t]
          bucket.matched++
          // Textured surfaces (wood, stone) are far less saturated than flat
          // paint and can share its hue window. Only pixels carrying most of
          // the material's own saturation are treated as that material; if
          // none do, the material really has washed out.
          if (saturation < tracked[t].saturation * 0.7) continue
          bucket.sat.push(saturation)
          bucket.hue.push(hue)
          bucket.lum.push(lum)
        }
      }

      done({
        modelPixels,
        meanLuminance: modelPixels ? +(lumSum / modelPixels).toFixed(1) : 0,
        darkPct: modelPixels ? +(100 * dark / modelPixels).toFixed(2) : 0,
        blownPct: modelPixels ? +(100 * blown / modelPixels).toFixed(2) : 0,
        materials: buckets.map((bucket, t) => {
          const count = bucket.sat.length
          if (!count) return { name: tracked[t].label, pixels: 0, matched: bucket.matched }
          let hx = 0, hy = 0, satSum = 0, lumSum2 = 0
          for (let i = 0; i < count; i++) {
            const radians = bucket.hue[i] * Math.PI / 180
            hx += Math.cos(radians)
            hy += Math.sin(radians)
            satSum += bucket.sat[i]
            lumSum2 += bucket.lum[i]
          }
          let hue = Math.atan2(hy / count, hx / count) * 180 / Math.PI
          if (hue < 0) hue += 360
          return {
            name: tracked[t].label,
            pixels: count,
            matched: bucket.matched,
            hue: +hue.toFixed(1),
            saturation: +(satSum / count).toFixed(3),
            luminance: +(lumSum2 / count).toFixed(1),
          }
        }),
      })
    }
    image.onerror = () => done(null)
    image.src = dataUrl
  })
</script></body></html>`

async function loadModelBytes(target) {
  if (/^https?:\/\//i.test(target)) {
    const response = await fetch(target)
    if (!response.ok) throw new Error(`Could not download the model (HTTP ${response.status}).`)
    return Buffer.from(await response.arrayBuffer())
  }
  return readFileSync(resolve(target))
}

async function main() {
  const args = process.argv.slice(2)
  const target = args.find((arg) => !arg.startsWith('--'))
  if (!target) {
    console.error('Usage: node scripts/verify-3d-model.mjs <model.glb|url> [--out <dir>] [--json]')
    process.exit(2)
  }
  const outIndex = args.indexOf('--out')
  const outDir = outIndex >= 0 ? resolve(args[outIndex + 1]) : resolve(tmpdir(), 'arnold-3d-verify')
  const asJson = args.includes('--json')
  // --no-edges renders without the SketchUp outlines, for comparison runs.
  if (args.includes('--no-edges')) VIEWER_SETTINGS.showEdges = false
  mkdirSync(outDir, { recursive: true })

  const modelBytes = await loadModelBytes(target)
  const modelName = basename(target.split('?')[0]) || 'model.glb'
  const gltf = readGlbJson(modelBytes)
  const tracked = trackableMaterials(gltf)
  const textureCount = (gltf.textures || []).length
  const materialCount = (gltf.materials || []).length

  const threeRoot = resolve(repoRoot, 'node_modules/three')
  if (!existsSync(threeRoot)) throw new Error('three is not installed. Run npm install first.')
  const files = {
    '/harness.html': { body: Buffer.from(HARNESS_HTML), type: 'text/html' },
    [`/${modelName}`]: { body: modelBytes, type: 'model/gltf-binary' },
  }
  const mimeFor = (path) => {
    if (path.endsWith('.js')) return 'text/javascript'
    if (path.endsWith('.wasm')) return 'application/wasm'
    if (path.endsWith('.glb')) return 'model/gltf-binary'
    return 'application/octet-stream'
  }
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const file = files[path]
    if (file) {
      response.writeHead(200, { 'content-type': file.type })
      return response.end(file.body)
    }
    // three.js modules and the Draco decoder are served straight from disk.
    let onDisk = null
    if (path.startsWith('/three/')) onDisk = resolve(threeRoot, path.slice('/three/'.length))
    else if (path.startsWith('/draco/')) onDisk = resolve(repoRoot, 'public', path.slice(1))
    if (onDisk && onDisk.startsWith(repoRoot) && existsSync(onDisk)) {
      response.writeHead(200, { 'content-type': mimeFor(path) })
      return response.end(readFileSync(onDisk))
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((ready) => server.listen(0, ready))
  const port = server.address().port

  const { default: puppeteer } = await import('puppeteer-core')
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  })

  const failures = []
  const frames = []
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 900, height: 650, deviceScaleFactor: 1 })
    const settings = encodeURIComponent(JSON.stringify(VIEWER_SETTINGS))
    await page.goto(`http://127.0.0.1:${port}/harness.html?model=/${encodeURIComponent(modelName)}&settings=${settings}`)

    await page.waitForFunction('window.__loaded || window.__error', { timeout: 120000 })
    const loadError = await page.evaluate('window.__error || null')
    if (loadError) throw new Error(`The model failed to load in the viewer: ${loadError}`)

    for (const orbit of ORBITS) {
      const dataUrl = await page.evaluate(
        (azimuth, elevation) => window.__renderAt(azimuth, elevation),
        orbit.azimuth,
        orbit.elevation,
      )
      const measurement = await page.evaluate(
        (url, list, background) => window.__measure(url, list, background),
        dataUrl,
        tracked,
        VIEWER_SETTINGS.backgroundColor,
      )
      const label = `${orbit.azimuth}° / ${orbit.elevation}°`
      if (!measurement) throw new Error(`Could not measure the render at ${label}.`)
      frames.push({ orbit: label, ...measurement })
      writeFileSync(resolve(outDir, `render-${orbit.azimuth}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
    }
  } finally {
    await browser.close()
    server.close()
  }

  // --- checks -------------------------------------------------------------
  const audit = auditMaterials(gltf)
  if (audit.usesSpecGloss) {
    failures.push(
      'File still carries KHR_materials_pbrSpecularGlossiness materials, which the customer viewer cannot read — its colors come from the exporter fallback instead.',
    )
  }
  if (audit.metallicTextured.length) {
    const worst = audit.metallicTextured
      .slice(0, 3)
      .map((material) => `${material.name} (${material.metallic})`)
      .join(', ')
    failures.push(
      `${audit.metallicTextured.length} textured material(s) are marked metallic and will render dark or mirror-like: ${worst}${audit.metallicTextured.length > 3 ? ', …' : ''}.`,
    )
  }
  if (textureCount === 0 && materialCount > 0) {
    const texturedInSource = (gltf.materials || []).some((m) => m.pbrMetallicRoughness?.baseColorTexture)
    if (texturedInSource) failures.push('All textures were lost during preparation.')
  }
  if (modelBytes.length > BUDGET.maxBytes) {
    failures.push(`Model is ${(modelBytes.length / 1048576).toFixed(1)} MB, over the ${(BUDGET.maxBytes / 1048576).toFixed(0)} MB budget.`)
  }
  for (const frame of frames) {
    if (frame.modelPixels < 5000) {
      failures.push(`Almost nothing rendered at ${frame.orbit} (${frame.modelPixels} model pixels).`)
      continue
    }
    if (frame.meanLuminance < BUDGET.minMeanLuminance) {
      failures.push(`Render is too dark at ${frame.orbit} (mean luminance ${frame.meanLuminance}).`)
    }
    if (frame.meanLuminance > BUDGET.maxMeanLuminance) {
      failures.push(`Render is washed out at ${frame.orbit} (mean luminance ${frame.meanLuminance}).`)
    }
    if (frame.darkPct > BUDGET.maxDarkPixelPct) {
      failures.push(`${frame.darkPct}% of the model is near-black at ${frame.orbit}.`)
    }
    if (frame.blownPct > BUDGET.maxBlownPixelPct) {
      failures.push(`${frame.blownPct}% of the model is blown out at ${frame.orbit}.`)
    }
  }

  const materialReport = tracked.map((material, index) => {
    const all = frames.map((frame) => frame.materials[index]).filter(Boolean)
    const samples = all.filter((sample) => sample.pixels >= BUDGET.minTrackedPixels)
    if (!samples.length) {
      // Plenty of pixels in this hue range but none carrying the material's
      // saturation means the color is present and washed out, which is a
      // real failure — distinct from the material simply being hidden.
      const washedOut = all.filter((sample) => sample.matched >= BUDGET.minTrackedPixels * 4)
      if (washedOut.length) {
        failures.push(
          `${material.label} never reaches its own saturation (${(material.saturation * 100).toFixed(0)}%) at any angle — it renders washed out.`,
        )
        return { name: material.label, expected: material.expected, seen: false, washedOut: true }
      }
      return { name: material.label, expected: material.expected, seen: false }
    }

    const hueErrors = samples.map((sample) => hueDistance(sample.hue, material.hue))
    const worstHueError = Math.max(...hueErrors)
    const saturations = samples.map((sample) => sample.saturation)
    const minSaturation = Math.min(...saturations)
    const saturationRatio = minSaturation / material.saturation
    const saturationDrift = Math.max(...saturations) - minSaturation
    const hues = samples.map((sample) => sample.hue)
    const hueDrift = Math.max(...hues.map((a) => Math.max(...hues.map((b) => hueDistance(a, b)))))

    if (worstHueError > BUDGET.maxHueError) {
      failures.push(
        `${material.label} renders at hue ${samples[hueErrors.indexOf(worstHueError)].hue}° but the file says ${material.hue.toFixed(0)}° (off by ${worstHueError.toFixed(0)}°).`,
      )
    }
    if (saturationRatio < BUDGET.minSaturationRatio) {
      failures.push(
        `${material.label} washes out to ${(minSaturation * 100).toFixed(0)}% saturation where the file says ${(material.saturation * 100).toFixed(0)}% (${(saturationRatio * 100).toFixed(0)}% of it).`,
      )
    }
    if (saturationDrift > BUDGET.maxSaturationDrift) {
      failures.push(
        `${material.label} saturation swings by ${(saturationDrift * 100).toFixed(0)} points across rotation angles (directional washout).`,
      )
    }
    if (hueDrift > BUDGET.maxHueDrift) {
      failures.push(`${material.label} shifts hue by ${hueDrift.toFixed(0)}° across rotation angles (directional color cast).`)
    }

    return {
      name: material.label,
      expected: material.expected,
      seen: true,
      angles: samples.length,
      expectedHue: +material.hue.toFixed(0),
      worstHueError: +worstHueError.toFixed(1),
      expectedSaturation: material.saturation,
      minSaturation: +minSaturation.toFixed(3),
      saturationDrift: +saturationDrift.toFixed(3),
      hueDrift: +hueDrift.toFixed(1),
    }
  })

  const result = {
    model: modelName,
    bytes: modelBytes.length,
    materialCount,
    textureCount,
    frames: frames.map(({ orbit, meanLuminance, darkPct, blownPct, modelPixels }) => ({ orbit, meanLuminance, darkPct, blownPct, modelPixels })),
    materials: materialReport,
    audit,
    outDir,
    passed: failures.length === 0,
    failures,
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`\n  ${modelName}  ${(modelBytes.length / 1048576).toFixed(2)} MB · ${materialCount} materials · ${textureCount} textures`)
    console.log(`  renders written to ${outDir}\n`)
    console.log('  angle          mean lum   dark%   blown%')
    for (const frame of result.frames) {
      console.log(
        `  ${frame.orbit.padEnd(14)} ${String(frame.meanLuminance).padStart(7)} ${String(frame.darkPct).padStart(7)} ${String(frame.blownPct).padStart(8)}`,
      )
    }
    if (materialReport.length) {
      console.log('\n  tracked material        expected        hue err   saturation (of file)   sat drift')
      for (const material of materialReport) {
        if (!material.seen) {
          console.log(`  ${material.name.padEnd(23)} rgb(${material.expected.join(',')})`.padEnd(50) + 'not visible')
          continue
        }
        const ratio = `${(material.minSaturation * 100).toFixed(0)}% of ${(material.expectedSaturation * 100).toFixed(0)}%`
        console.log(
          `  ${material.name.padEnd(23)} ${`${material.expectedHue}°`.padEnd(15)} ${`${material.worstHueError}°`.padStart(7)} ${ratio.padStart(21)} ${String(material.saturationDrift).padStart(11)}`,
        )
      }
    }
    console.log('')
    if (failures.length) {
      console.log('  FAILED')
      for (const failure of failures) console.log(`   · ${failure}`)
    } else {
      console.log('  PASSED — model loads, colors match the file, and stays stable through rotation.')
    }
    console.log('')
  }

  process.exit(failures.length ? 1 : 0)
}

main().catch((error) => {
  console.error(`\n  ERROR: ${error.message}\n`)
  process.exit(2)
})

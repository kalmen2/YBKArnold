#!/usr/bin/env node
// Presentation renderer for customer-facing sketches.
//
// This renderer creates the image that goes on a proposal: full PBR,
// image-based lighting from
// a room environment, a soft key light with shadows, a contact shadow on the
// ground, and filmic tone mapping.
//
// Usage:
//   node scripts/render-presentation.mjs <model.glb> [--out <dir>] [--views hero,front,detail]
//   node scripts/render-presentation.mjs <model.glb> --azimuth 35 --elevation 12

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
  if (!found) throw new Error(`No Chrome/Chromium found. Set CHROME_PATH.\n  ${CHROME_CANDIDATES.join('\n  ')}`)
  return found
}

// Low, near-eye-level angles — how a piece of furniture is actually seen, and
// how designers present them. A high isometric looks down into open casework.
const VIEWS = {
  hero: { azimuth: 34, elevation: 11, fov: 30, zoom: 1.0 },
  left: { azimuth: -38, elevation: 12, fov: 30, zoom: 1.0 },
  front: { azimuth: 0, elevation: 6, fov: 26, zoom: 1.0 },
  detail: { azimuth: 26, elevation: 8, fov: 20, zoom: 0.52 },
}

const HARNESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#fff}canvas{display:block}</style>
<script type="importmap">
{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}
</script>
</head><body>
<script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const params = new URLSearchParams(location.search)

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false })
renderer.setPixelRatio(1)
renderer.setSize(window.innerWidth, window.innerHeight, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.94
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xf4f2ef)

// Image-based lighting: this is what makes a PBR material read as a material
// rather than as a flat colour with a highlight stuck on it.
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 500)

const key = new THREE.DirectionalLight(0xfff4e4, 1.55)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.bias = -0.0004
key.shadow.normalBias = 0.012
scene.add(key)

const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55)
scene.add(fill)
const rim = new THREE.DirectionalLight(0xffffff, 0.7)
scene.add(rim)
scene.add(new THREE.AmbientLight(0xffffff, 0.18))

const group = new THREE.Group()
scene.add(group)

let center = new THREE.Vector3()
let radius = 1
let floorY = 0

const loader = new GLTFLoader()
loader.load(params.get('model'), (gltf) => {
  const root = gltf.scene
  root.traverse((child) => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    const material = child.material
    if (material && material.map) {
      material.map.wrapS = material.map.wrapT = THREE.RepeatWrapping
      material.map.anisotropy = renderer.capabilities.getMaxAnisotropy()
      material.map.colorSpace = THREE.SRGBColorSpace
      material.map.needsUpdate = true
    }
    if (material) material.envMapIntensity = 1.0
  })
  group.add(root)

  const box = new THREE.Box3().setFromObject(group)
  center = box.getCenter(new THREE.Vector3())
  radius = box.getSize(new THREE.Vector3()).length() / 2
  floorY = box.min.y

  // Ground plane that shows only the shadow, so the piece sits on a surface
  // instead of floating in a void.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 40, radius * 40),
    new THREE.ShadowMaterial({ opacity: 0.26 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = floorY
  ground.receiveShadow = true
  scene.add(ground)

  const span = radius * 3
  key.shadow.camera.left = -span
  key.shadow.camera.right = span
  key.shadow.camera.top = span
  key.shadow.camera.bottom = -span
  key.shadow.camera.near = 0.1
  key.shadow.camera.far = span * 6
  key.shadow.camera.updateProjectionMatrix()

  window.__loaded = true
}, undefined, (error) => { window.__error = String(error && error.message || error) })

window.__renderAt = (azimuth, elevation, fov, zoom) => {
  const a = THREE.MathUtils.degToRad(azimuth)
  const e = THREE.MathUtils.degToRad(elevation)
  camera.fov = fov
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(fov) / 2)) * 1.12 * zoom
  camera.position.set(
    center.x + distance * Math.cos(e) * Math.sin(a),
    center.y + distance * Math.sin(e),
    center.z + distance * Math.cos(e) * Math.cos(a),
  )
  camera.lookAt(center)
  camera.updateProjectionMatrix()

  // Lights follow the camera so the key stays over the viewer's shoulder.
  key.position.set(
    center.x + distance * Math.sin(a + 0.65) * 0.9,
    center.y + distance * 1.15,
    center.z + distance * Math.cos(a + 0.65) * 0.9,
  )
  key.target.position.copy(center)
  key.target.updateMatrixWorld()
  scene.add(key.target)

  fill.position.set(center.x - distance * Math.sin(a - 0.9), center.y + distance * 0.35, center.z - distance * Math.cos(a - 0.9))
  rim.position.set(center.x - distance * Math.sin(a) * 1.2, center.y + distance * 0.5, center.z - distance * Math.cos(a) * 1.2)

  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}
</script></body></html>`

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.html': 'text/html' }

async function main() {
  const args = process.argv.slice(2)
  const modelPath = resolve(args[0] ?? '')
  if (!args[0] || !existsSync(modelPath)) throw new Error('usage: render-presentation <model.glb> [--out <dir>] [--views hero,front]')

  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`)
    return i === -1 ? fallback : args[i + 1]
  }

  const outDir = resolve(flag('out', resolve(repoRoot, 'tmp/presentation')))
  mkdirSync(outDir, { recursive: true })
  const wanted = String(flag('views', 'hero,left,front,detail')).split(',').map((v) => v.trim())
  const width = Number(flag('width', 1800))
  const height = Number(flag('height', 1250))

  const modelName = basename(modelPath)
  const threeRoot = resolve(repoRoot, 'node_modules/three')
  if (!existsSync(threeRoot)) throw new Error('three is not installed. Run npm install first.')

  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (path === '/harness.html') {
      response.writeHead(200, { 'content-type': 'text/html' })
      return response.end(HARNESS_HTML)
    }
    let onDisk = null
    if (path.startsWith('/three/')) onDisk = resolve(threeRoot, path.slice('/three/'.length))
    else if (path === `/${modelName}`) onDisk = modelPath
    if (onDisk && existsSync(onDisk)) {
      response.writeHead(200, { 'content-type': MIME[extname(onDisk)] ?? 'application/octet-stream' })
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
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
  })

  const written = []
  try {
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await page.goto(`http://127.0.0.1:${port}/harness.html?model=/${encodeURIComponent(modelName)}`)
    await page.waitForFunction('window.__loaded || window.__error', { timeout: 180000 })
    const error = await page.evaluate('window.__error || null')
    if (error) throw new Error(`Model failed to load: ${error}`)

    for (const name of wanted) {
      const view = VIEWS[name]
      if (!view) throw new Error(`unknown view "${name}". Known: ${Object.keys(VIEWS).join(', ')}`)
      const dataUrl = await page.evaluate(
        (a, e, f, z) => window.__renderAt(a, e, f, z),
        view.azimuth, view.elevation, view.fov, view.zoom,
      )
      const file = resolve(outDir, `${basename(modelPath, '.glb')}--${name}.png`)
      writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
      written.push(file)
    }
  } finally {
    await browser.close()
    server.close()
  }

  for (const file of written) console.log(`  ${file}`)
}

main().catch((error) => {
  console.error(`\n${error.message}\n`)
  process.exit(1)
})

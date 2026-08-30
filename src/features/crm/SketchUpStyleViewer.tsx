import { Box, type SxProps, type Theme } from '@mui/material'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Crm3dViewerSettings } from './api'

// Renders a model the way SketchUp draws it rather than the way a photoreal
// engine would: flat matte surfaces with no reflections, plus the dark edge
// lines on every profile. Those edges are most of what makes a SketchUp view
// read as crisp, and no physically-based viewer draws them.
//
// Edges come from EdgesGeometry with an angle threshold, so they appear only
// where faces genuinely meet at an angle. Curved surfaces stay smooth — the
// segment lines that made earlier attempts look faceted never appear.

export type SketchUpViewerSettings = Required<
  Pick<
    Crm3dViewerSettings,
    'brightness' | 'edgeColor' | 'edgeThreshold' | 'edgeWidth' | 'showEdges' | 'backgroundColor' | 'autoRotate' | 'fieldOfView'
  >
>

type Props = {
  src: string
  alt?: string
  settings: SketchUpViewerSettings
  onLoad?: () => void
  onError?: (message: string) => void
  sx?: SxProps<Theme>
  /** Populated with viewer controls while the scene is mounted. */
  controlsRef?: { current: ViewerControls | null }
}

export type ViewerControls = {
  /** Returns the camera to the framing the model opened with. */
  resetView: () => void
}

const AUTO_ROTATE_DEGREES_PER_SECOND = 6
// Pause auto-rotation briefly after the viewer interacts, so the model does not
// fight the drag.
const INTERACTION_PAUSE_MS = 4000

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  const list = Array.isArray(material) ? material : [material]
  for (const entry of list) {
    const withMap = entry as THREE.Material & { map?: THREE.Texture | null }
    withMap.map?.dispose()
    entry.dispose()
  }
}

export default function SketchUpStyleViewer({ src, alt, settings, onLoad, onError, sx, controlsRef }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  // Settings change often (the editor sliders); keep them in a ref so tweaking
  // one does not tear down and reload the whole scene. Synced in an effect that
  // is declared before the scene effect, so the scene always reads current values.
  const settingsRef = useRef(settings)
  const callbacksRef = useRef({ onLoad, onError })

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    callbacksRef.current = { onLoad, onError }
  }, [onLoad, onError])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    let disposed = false
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.outline = 'none'
    renderer.domElement.setAttribute('aria-label', alt || '3D model')
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(settingsRef.current.backgroundColor)

    const camera = new THREE.PerspectiveCamera(settingsRef.current.fieldOfView, 1, 0.1, 10000)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.85
    controls.zoomSpeed = 0.9
    controls.panSpeed = 0.7
    controls.minDistance = 0.01
    controls.maxDistance = Infinity

    // SketchUp's shading model. These three intensities are balanced so the
    // brightest face lands just under full material colour — push them higher
    // and textures blow out toward white, which is what made earlier versions
    // look washed and flat. The key light follows the camera, so surfaces keep
    // their roundness without their colour depending on which way they face.
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0xd8d4cc, 1.15)
    const ambient = new THREE.AmbientLight(0xffffff, 0.55)
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.6)
    scene.add(hemisphere, ambient, keyLight)

    const modelGroup = new THREE.Group()
    scene.add(modelGroup)
    let edgeMaterial: LineMaterial | null = null
    let edgeLines: LineSegments2 | null = null
    let homeState: { position: THREE.Vector3; target: THREE.Vector3 } | null = null

    const resize = () => {
      const width = mount.clientWidth || 1
      const height = mount.clientHeight || 1
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      // Fat lines are drawn in screen space, so they need the pixel size.
      edgeMaterial?.resolution.set(width, height)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(mount)

    let interactionUntil = 0
    const noteInteraction = () => { interactionUntil = performance.now() + INTERACTION_PAUSE_MS }
    controls.addEventListener('start', noteInteraction)

    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('/draco/')
    const loader = new GLTFLoader()
    loader.setDRACOLoader(dracoLoader)

    loader.load(
      src,
      (gltf) => {
        if (disposed) return
        const root = gltf.scene
        const currentSettings = settingsRef.current
        // A plain LineBasicMaterial is locked to one hardware pixel on nearly
        // every GPU, which reads as a faint grey hairline. LineMaterial draws
        // real screen-space width, which is what makes SketchUp's outlines
        // look drawn rather than aliased.
        edgeMaterial = new LineMaterial({
          color: new THREE.Color(currentSettings.edgeColor),
          linewidth: currentSettings.edgeWidth,
        })
        edgeMaterial.resolution.set(mount.clientWidth || 1, mount.clientHeight || 1)
        const edgeGeometries: THREE.BufferGeometry[] = []

        root.updateWorldMatrix(true, true)
        root.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh.isMesh) return
          const source = mesh.material as THREE.MeshStandardMaterial

          // Flat matte replacement: keep the colour and texture the file
          // specifies, drop every reflective property so the surface always
          // shows its own colour instead of mirroring the surroundings.
          const flat = new THREE.MeshLambertMaterial({
            color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
            map: source.map || null,
            transparent: source.transparent,
            opacity: source.opacity,
            alphaTest: source.alphaTest,
            depthWrite: source.transparent ? false : true,
            side: THREE.DoubleSide,
          })
          mesh.material = flat
          disposeMaterial(source)

          if (currentSettings.showEdges && mesh.geometry) {
            try {
              const edges = new THREE.EdgesGeometry(mesh.geometry, currentSettings.edgeThreshold)
              if (edges.getAttribute('position')?.count) {
                edges.applyMatrix4(mesh.matrixWorld)
                edgeGeometries.push(edges)
              } else {
                edges.dispose()
              }
            } catch {
              // A malformed primitive should never stop the model rendering.
            }
          }
        })

        // One merged LineSegments instead of hundreds keeps large models fast
        // on phones; this model alone has 300+ primitives.
        if (edgeGeometries.length) {
          const merged = mergeGeometries(edgeGeometries, false)
          for (const geometry of edgeGeometries) geometry.dispose()
          if (merged) {
            const lineGeometry = new LineSegmentsGeometry()
            lineGeometry.setPositions(merged.getAttribute('position').array as Float32Array)
            merged.dispose()
            edgeLines = new LineSegments2(lineGeometry, edgeMaterial)
            edgeLines.renderOrder = 1
            modelGroup.add(edgeLines)
          }
        }
        modelGroup.add(root)

        // Frame the model: fit its bounding sphere in both axes, so a tall
        // piece fills a portrait window and a wide one fills a landscape window
        // instead of floating in empty space.
        const box = new THREE.Box3().setFromObject(modelGroup)
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        const center = sphere.center.clone()
        const radius = sphere.radius || 1
        const verticalFov = THREE.MathUtils.degToRad(camera.fov)
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.0001))
        const distance = Math.max(
          radius / Math.sin(verticalFov / 2),
          radius / Math.sin(horizontalFov / 2),
        ) * 1.06
        const theta = THREE.MathUtils.degToRad(25)
        const phi = THREE.MathUtils.degToRad(78)
        camera.position.set(
          center.x + distance * Math.sin(phi) * Math.sin(theta),
          center.y + distance * Math.cos(phi),
          center.z + distance * Math.sin(phi) * Math.cos(theta),
        )
        camera.near = Math.max(distance / 1000, 0.01)
        camera.far = distance * 100
        camera.updateProjectionMatrix()
        controls.target.copy(center)
        controls.update()
        homeState = { position: camera.position.clone(), target: controls.target.clone() }

        callbacksRef.current.onLoad?.()
      },
      undefined,
      (loadError) => {
        if (disposed) return
        const message = loadError instanceof Error ? loadError.message : 'The 3D model could not be loaded.'
        callbacksRef.current.onError?.(message)
      },
    )

    let frame = 0
    let lastFrameAt = performance.now()
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const now = performance.now()
      const deltaSeconds = Math.min((now - lastFrameAt) / 1000, 0.1)
      lastFrameAt = now
      const active = settingsRef.current

      scene.background = (scene.background as THREE.Color).set(active.backgroundColor)
      camera.fov = active.fieldOfView
      camera.updateProjectionMatrix()
      hemisphere.intensity = 1.15 * active.brightness
      ambient.intensity = 0.55 * active.brightness
      keyLight.intensity = 0.6 * active.brightness
      if (edgeMaterial) {
        edgeMaterial.color.set(active.edgeColor)
        edgeMaterial.linewidth = active.edgeWidth
      }
      if (edgeLines) edgeLines.visible = active.showEdges

      // Keep the key light on the camera so the face you are looking at is
      // always legible, exactly as SketchUp does.
      keyLight.position.copy(camera.position)

      if (active.autoRotate && now > interactionUntil && homeState) {
        const angle = THREE.MathUtils.degToRad(AUTO_ROTATE_DEGREES_PER_SECOND) * deltaSeconds
        const offset = camera.position.clone().sub(controls.target)
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle)
        camera.position.copy(controls.target).add(offset)
      }

      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    // Exposed so the page's "Reset view" control can recentre without reloading.
    if (controlsRef) {
      controlsRef.current = {
        resetView: () => {
          if (!homeState) return
          camera.position.copy(homeState.position)
          controls.target.copy(homeState.target)
          controls.update()
          interactionUntil = 0
        },
      }
    }

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.removeEventListener('start', noteInteraction)
      controls.dispose()
      dracoLoader.dispose()
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) disposeMaterial(mesh.material)
      })
      edgeMaterial?.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      if (controlsRef) controlsRef.current = null
    }
  }, [src, alt, controlsRef])

  return <Box ref={mountRef} sx={{ display: 'block', overflow: 'hidden', touchAction: 'none', ...sx }} />
}

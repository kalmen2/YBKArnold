// Hidden-line removal by ray-cast visibility.
//
// Every part is an axis-aligned box, so visibility has an exact test: take a
// point on an edge, cast a ray toward the viewer, and see whether any box is in
// the way. Sampling along each edge finds the visible runs; bisection refines
// each transition to a hair, so the drawn endpoints land on the real silhouette
// rather than on a sample boundary.
//
// One implementation serves all four views. An orthographic view is just a
// view direction of (0,0,1), (0,1,0) or (1,0,0); the isometric is (1,1,1). That
// is why the elevations and the 3/4 view cannot disagree with each other.

const EPS = 1e-4          // inches — nudge off the surface the edge sits on
const SAMPLES = 220       // per edge, before refinement
const REFINE_STEPS = 22   // bisection passes per transition

/** The 12 edges of an axis-aligned box, as [[x,y,z],[x,y,z]] pairs. */
export function boxEdges(box) {
  const { x, y, z, w, h, d } = box
  const [x0, y0, z0, x1, y1, z1] = [x, y, z, x + w, y + h, z + d]
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]
  const idx = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  return idx.map(([a, b]) => [c[a], c[b]])
}

/** Slab test: does the ray from `origin` along `dir` enter `box` at t > 0? */
function hitsBox(origin, dir, box) {
  const min = [box.x, box.y, box.z]
  const max = [box.x + box.w, box.y + box.h, box.z + box.d]
  let tMin = 1e-6
  let tMax = Infinity

  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin[axis]
    const dAxis = dir[axis]
    if (Math.abs(dAxis) < 1e-12) {
      if (o <= min[axis] + EPS || o >= max[axis] - EPS) return false
      continue
    }
    let t0 = (min[axis] + EPS - o) / dAxis
    let t1 = (max[axis] - EPS - o) / dAxis
    if (t0 > t1) [t0, t1] = [t1, t0]
    if (t0 > tMin) tMin = t0
    if (t1 < tMax) tMax = t1
    if (tMin > tMax) return false
  }
  return tMax > tMin
}

function visibleAt(point, dir, boxes) {
  const origin = [point[0] + dir[0] * EPS * 4, point[1] + dir[1] * EPS * 4, point[2] + dir[2] * EPS * 4]
  for (const box of boxes) if (hitsBox(origin, dir, box)) return false
  return true
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Refine a visibility change between parameters tA (known) and tB (opposite). */
function refine(a, b, tA, tB, dir, boxes, wantAtA) {
  let lo = tA
  let hi = tB
  for (let i = 0; i < REFINE_STEPS; i += 1) {
    const mid = (lo + hi) / 2
    if (visibleAt(lerp(a, b, mid), dir, boxes) === wantAtA) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * Clip one edge against the solid set, returning the visible 3D sub-segments.
 * @param {[number[],number[]]} edge
 * @param {Array} boxes every solid in the model
 * @param {number[]} dir unit direction toward the viewer
 */
export function visibleRuns(edge, boxes, dir) {
  const [a, b] = edge
  const runs = []
  let runStart = null
  let prevVisible = false

  for (let i = 0; i <= SAMPLES; i += 1) {
    const t = i / SAMPLES
    const isVisible = visibleAt(lerp(a, b, t), dir, boxes)

    if (isVisible && !prevVisible) {
      runStart = i === 0 ? 0 : refine(a, b, t, (i - 1) / SAMPLES, dir, boxes, true)
    } else if (!isVisible && prevVisible) {
      const end = refine(a, b, (i - 1) / SAMPLES, t, dir, boxes, true)
      if (end > runStart + 1e-6) runs.push([runStart, end])
      runStart = null
    }
    prevVisible = isVisible
  }
  if (prevVisible && runStart !== null && runStart < 1 - 1e-6) runs.push([runStart, 1])

  return runs.map(([t0, t1]) => [lerp(a, b, t0), lerp(a, b, t1)])
}

/** Normalised view direction (pointing from the model toward the viewer). */
export function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2])
  return [v[0] / length, v[1] / length, v[2] / length]
}

/**
 * Screen basis for a view direction, with world +Y as up where possible.
 * Returns { right, up } unit vectors to project onto.
 */
export function screenBasis(dir) {
  const worldUp = Math.abs(dir[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0]
  const right = normalize(cross(worldUp, dir))
  const up = cross(dir, right)
  return { right, up }
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

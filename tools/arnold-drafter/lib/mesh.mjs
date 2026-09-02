// Flat-shaded solid builder.
//
// Coordinate convention for every Arnold product (matches glTF: Y-up, metres):
//   X  width,  0 at the centre of the footprint
//   Y  height, 0 at the finished floor
//   Z  depth,  +Z is the FRONT (the face the customer looks at)
//
// Geometry is accumulated per material so each finish becomes one glTF
// primitive. Faces are not welded: every face gets its own four vertices so
// normals stay hard, which is what the SketchUp-style viewer expects for clean
// profile edges.

export class MeshBuilder {
  constructor() {
    /** @type {Map<string, {positions: number[], normals: number[], indices: number[]}>} */
    this.groups = new Map()
    /** @type {Array<{name: string, material: string, size: [number,number,number], at: [number,number,number]}>} */
    this.parts = []
  }

  #group(material) {
    let group = this.groups.get(material)
    if (!group) {
      group = { positions: [], normals: [], uvs: [], indices: [] }
      this.groups.set(material, group)
    }
    return group
  }

  #quad(group, a, b, c, d, normal, grain = 'length') {
    const base = group.positions.length / 3
    for (const vertex of [a, b, c, d]) {
      group.positions.push(vertex[0], vertex[1], vertex[2])
      const [u, v] = planarUv(vertex, normal, grain)
      group.uvs.push(u, v)
    }
    for (let i = 0; i < 4; i += 1) group.normals.push(normal[0], normal[1], normal[2])
    group.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  /**
   * Add an axis-aligned box from its minimum corner.
   * @param {{x:number,y:number,z:number,w:number,h:number,d:number,material:string,name?:string}} box
   */
  addBox({ x, y, z, w, h, d, material, name, grain = 'length' }) {
    if (!material) throw new Error(`addBox(${name ?? 'unnamed'}): material is required`)
    for (const [label, value] of [['w', w], ['h', h], ['d', d]]) {
      if (!Number.isFinite(value)) throw new Error(`addBox(${name ?? 'unnamed'}): ${label} is ${value}`)
      if (value <= 0) throw new Error(`addBox(${name ?? 'unnamed'}): ${label} must be positive, got ${value}`)
    }

    const group = this.#group(material)
    const [x0, y0, z0] = [x, y, z]
    const [x1, y1, z1] = [x + w, y + h, z + d]

    // front (+Z), back (-Z), right (+X), left (-X), top (+Y), bottom (-Y)
    this.#quad(group, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], grain)
    this.#quad(group, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], grain)
    this.#quad(group, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], grain)
    this.#quad(group, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], grain)
    this.#quad(group, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], grain)
    this.#quad(group, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], grain)

    if (name) this.parts.push({ name, material, size: [w, h, d], at: [x, y, z] })
    return this
  }

  /**
   * Add a vertical cylinder (round legs, bar pulls stood on end).
   * @param {{x:number,y:number,z:number,radius:number,height:number,material:string,segments?:number,name?:string}} cylinder
   */
  addCylinder({ x, y, z, radius, height, material, segments = 24, name }) {
    if (!material) throw new Error(`addCylinder(${name ?? 'unnamed'}): material is required`)
    if (!(radius > 0) || !(height > 0)) {
      throw new Error(`addCylinder(${name ?? 'unnamed'}): radius and height must be positive`)
    }

    const group = this.#group(material)
    const ring = []
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2
      ring.push([x + Math.cos(angle) * radius, z + Math.sin(angle) * radius])
    }

    for (let i = 0; i < segments; i += 1) {
      const [ax, az] = ring[i]
      const [bx, bz] = ring[(i + 1) % segments]
      const nx = (ax - x) / radius
      const nz = (az - z) / radius
      this.#quad(group, [ax, y, az], [bx, y, bz], [bx, y + height, bz], [ax, y + height, az], [nx, 0, nz], 'vertical')
    }

    for (const [yPlane, normal] of [[y + height, 1], [y, -1]]) {
      const base = group.positions.length / 3
      group.positions.push(x, yPlane, z)
      group.normals.push(0, normal, 0)
      group.uvs.push(...planarUv([x, yPlane, z], [0, normal, 0], 'length'))
      for (const [rx, rz] of ring) {
        group.positions.push(rx, yPlane, rz)
        group.normals.push(0, normal, 0)
        group.uvs.push(...planarUv([rx, yPlane, rz], [0, normal, 0], 'length'))
      }
      for (let i = 0; i < segments; i += 1) {
        const a = base + 1 + i
        const b = base + 1 + ((i + 1) % segments)
        if (normal > 0) group.indices.push(base, a, b)
        else group.indices.push(base, b, a)
      }
    }

    if (name) {
      this.parts.push({
        name,
        material,
        size: [radius * 2, height, radius * 2],
        at: [x - radius, y, z - radius],
        round: true,
      })
    }
    return this
  }

  /** Overall bounding box in metres, for framing the camera and sanity checks. */
  bounds() {
    let min = [Infinity, Infinity, Infinity]
    let max = [-Infinity, -Infinity, -Infinity]
    for (const group of this.groups.values()) {
      for (let i = 0; i < group.positions.length; i += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = group.positions[i + axis]
          if (value < min[axis]) min[axis] = value
          if (value > max[axis]) max[axis] = value
        }
      }
    }
    return { min, max, size: max.map((value, axis) => value - min[axis]) }
  }

  triangleCount() {
    let total = 0
    for (const group of this.groups.values()) total += group.indices.length / 3
    return total
  }
}

// Metres of model per texture tile. Wood grain and weave read at roughly the
// right scale on furniture-sized parts at this value.
export const TEXTURE_SCALE = 0.75

/**
 * Planar UV for a vertex on an axis-aligned face.
 *
 * Textures are authored with the grain running along U, so `grain` chooses
 * which world axis U follows: 'vertical' aligns it with world Y (door and
 * panel faces, where veneer runs floor-to-ceiling), 'length' aligns it with the
 * longer horizontal axis (tops, counters, rails).
 */
export function planarUv(vertex, normal, grain) {
  const [x, y, z] = vertex
  const vertical = grain === 'vertical'
  let u
  let v

  if (Math.abs(normal[2]) > 0.5) {
    ;[u, v] = vertical ? [y, x] : [x, y]
  } else if (Math.abs(normal[0]) > 0.5) {
    ;[u, v] = vertical ? [y, z] : [z, y]
  } else {
    ;[u, v] = [x, z]
  }
  return [u / TEXTURE_SCALE, v / TEXTURE_SCALE]
}

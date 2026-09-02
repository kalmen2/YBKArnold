// Minimal PNG encoder built on node:zlib.
//
// Textures are generated as raw pixel buffers and need to reach the GLB as
// PNG. Node already ships the only hard part (deflate), so this avoids adding
// a native image dependency to a tool that otherwise runs anywhere.

import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} pixels RGB or RGBA, row-major
 * @param {{alpha?: boolean}} options
 */
export function encodePng(width, height, pixels, { alpha = false } = {}) {
  const channels = alpha ? 4 : 3
  if (pixels.length !== width * height * channels) {
    throw new Error(`encodePng: expected ${width * height * channels} bytes, got ${pixels.length}`)
  }

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * channels
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8                    // bit depth
  ihdr[9] = alpha ? 6 : 2        // colour type: RGBA / RGB
  ihdr[10] = 0                   // deflate
  ihdr[11] = 0                   // adaptive filtering
  ihdr[12] = 0                   // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

import { inflateSync } from 'node:zlib'

import { createRaster } from './maskRaster'
import { encodeMaskPng } from './pngCodec'

/** Reads the PNG back with node's zlib: header, then the unfiltered rows. */
const decode = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)
  expect(Array.from(bytes.subarray(0, 8))).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10
  ])
  const chunks: Record<string, Uint8Array> = {}
  let at = 8
  while (at < bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    chunks[type] = bytes.subarray(at + 8, at + 8 + length)
    at += 12 + length
  }
  const header = new DataView(chunks.IHDR.buffer, chunks.IHDR.byteOffset)
  const width = header.getUint32(0)
  const height = header.getUint32(4)
  const rows = inflateSync(chunks.IDAT)
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const filter = rows[y * (width + 1)]
    for (let x = 0; x < width; x += 1) {
      const raw = rows[y * (width + 1) + 1 + x]
      const above = y === 0 ? 0 : data[(y - 1) * width + x]
      data[y * width + x] = filter === 2 ? (raw + above) & 0xff : raw
    }
  }
  return {
    width,
    height,
    depth: chunks.IHDR[8],
    colourType: chunks.IHDR[9],
    data,
    hasEnd: 'IEND' in chunks
  }
}

describe('encodeMaskPng', () => {
  it('writes an 8-bit greyscale PNG that decodes back to the raster', async () => {
    const raster = createRaster({ width: 37, height: 21 })
    for (let i = 0; i < raster.data.length; i += 1) {
      raster.data[i] = (i * 7) % 256
    }
    const blob = await encodeMaskPng(raster)
    expect(blob.type).toBe('image/png')
    const decoded = await decode(blob)
    expect(decoded).toMatchObject({
      width: 37,
      height: 21,
      depth: 8,
      colourType: 0,
      hasEnd: true
    })
    expect(Array.from(decoded.data)).toEqual(Array.from(raster.data))
  })

  it('keeps a full-size mask well under the 2 MiB upload cap', async () => {
    const raster = createRaster({ width: 1024, height: 768 })
    raster.data.fill(255, 200 * 1024, 500 * 1024)
    const blob = await encodeMaskPng(raster)
    expect(blob.size).toBeLessThan(50_000)
    expect((await decode(blob)).data[300 * 1024]).toBe(255)
  })

  it('falls back to uncompressed blocks without CompressionStream', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    try {
      const raster = createRaster({ width: 300, height: 300 })
      raster.data.fill(9, 0, 50_000)
      const blob = await encodeMaskPng(raster)
      expect(blob.size).toBeGreaterThan(90_000)
      expect(Array.from((await decode(blob)).data)).toEqual(
        Array.from(raster.data)
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to uncompressed blocks when the stream pipeline fails', async () => {
    vi.stubGlobal(
      'CompressionStream',
      class {
        constructor() {
          throw new Error('unsupported')
        }
      }
    )
    try {
      const raster = createRaster({ width: 100, height: 100 })
      raster.data.fill(200, 0, 3000)
      const blob = await encodeMaskPng(raster)
      expect(Array.from((await decode(blob)).data)).toEqual(
        Array.from(raster.data)
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

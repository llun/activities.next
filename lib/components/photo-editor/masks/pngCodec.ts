import type { MaskRaster } from './maskRaster'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

let crcTable: Uint32Array | null = null
const crc32 = (parts: Uint8Array[]): number => {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      crc = crcTable[(crc ^ part[i]) & 0xff] ^ (crc >>> 8)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  const name = new TextEncoder().encode(type)
  out.set(name, 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32([name, data]))
  return out
}

const adler32 = (data: Uint8Array): number => {
  let a = 1
  let b = 0
  for (let i = 0; i < data.length; i += 1) {
    a = (a + data[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/** A zlib stream of "stored" (uncompressed) blocks; the fallback encoder. */
const zlibStored = (data: Uint8Array): Uint8Array => {
  const blocks = Math.max(1, Math.ceil(data.length / 65535))
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4)
  out[0] = 0x78
  out[1] = 0x01
  let at = 2
  for (let i = 0; i < blocks; i += 1) {
    const start = i * 65535
    const size = Math.min(65535, data.length - start)
    out[at] = i === blocks - 1 ? 1 : 0
    out[at + 1] = size & 0xff
    out[at + 2] = size >>> 8
    out[at + 3] = ~size & 0xff
    out[at + 4] = (~size >>> 8) & 0xff
    out.set(data.subarray(start, start + size), at + 5)
    at += 5 + size
  }
  new DataView(out.buffer).setUint32(at, adler32(data))
  return out
}

const zlibDeflate = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof CompressionStream === 'undefined') return zlibStored(data)
  try {
    const stream = new Blob([data as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    // A browser without a working stream pipeline still gets a valid PNG,
    // only a bigger one.
    return zlibStored(data)
  }
}

/**
 * An 8-bit greyscale PNG of the raster, with the "up" filter on every row so
 * a mask (long runs of the same value) compresses to a few kilobytes.
 */
export const encodeMaskPng = async (raster: MaskRaster): Promise<Blob> => {
  const { width, height, data } = raster
  const rows = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const at = y * (width + 1)
    rows[at] = 2
    for (let x = 0; x < width; x += 1) {
      const above = y === 0 ? 0 : data[(y - 1) * width + x]
      rows[at + 1 + x] = (data[y * width + x] - above) & 0xff
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 0 // greyscale
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', await zlibDeflate(rows)),
    chunk('IEND', new Uint8Array(0))
  ]
  return new Blob(parts as BlobPart[], { type: 'image/png' })
}

/**
 * Reads a mask PNG (the server stores 8-bit greyscale) into a raster: the red
 * channel is the value. No colour management is applied.
 */
export const decodeMaskPng = async (blob: Blob): Promise<MaskRaster> => {
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none'
  })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas is not available')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const data = new Uint8ClampedArray(bitmap.width * bitmap.height)
    for (let i = 0; i < data.length; i += 1) data[i] = pixels.data[i * 4]
    return { width: bitmap.width, height: bitmap.height, data }
  } finally {
    bitmap.close()
  }
}

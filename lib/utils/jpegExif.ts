// Browser-safe helpers to carry a JPEG's EXIF APP1 segment across a canvas
// re-encode (canvas.toBlob drops all metadata). No Node Buffer: works on
// Uint8Array only.

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"
const ORIENTATION_TAG = 0x0112
const TYPE_SHORT = 3

const isJpeg = (bytes: Uint8Array) =>
  bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8

const hasExifHeader = (bytes: Uint8Array, start: number) =>
  EXIF_HEADER.every((value, index) => bytes[start + index] === value)

/**
 * Finds the first Exif APP1 segment in the JPEG header area. Returns the
 * [start, end) offsets of the whole segment (marker and length included).
 */
const findExifSegment = (
  bytes: Uint8Array
): { start: number; end: number } | null => {
  if (!isJpeg(bytes)) return null

  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]
    if (marker === 0xff) {
      // Fill byte before a marker.
      offset += 1
      continue
    }
    // SOS (start of scan) or EOI: no more header segments.
    if (marker === 0xda || marker === 0xd9) return null
    // Standalone markers without a length (TEM, RSTn).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (length < 2) return null
    const end = offset + 2 + length
    if (end > bytes.length) return null

    if (
      marker === 0xe1 &&
      length >= 2 + EXIF_HEADER.length &&
      hasExifHeader(bytes, offset + 4)
    ) {
      return { start: offset, end }
    }
    offset = end
  }
  return null
}

/**
 * Rewrites the IFD0 Orientation tag to 1 (normal) in place. `segment` is a
 * whole APP1 segment. Returns false when the TIFF header is invalid.
 */
const resetOrientation = (segment: Uint8Array): boolean => {
  const tiff = 4 + EXIF_HEADER.length
  if (segment.length < tiff + 8) return false

  const order = String.fromCharCode(segment[tiff], segment[tiff + 1])
  if (order !== 'II' && order !== 'MM') return false
  const little = order === 'II'

  const view = new DataView(
    segment.buffer,
    segment.byteOffset,
    segment.byteLength
  )
  if (view.getUint16(tiff + 2, little) !== 42) return false

  const ifdStart = tiff + view.getUint32(tiff + 4, little)
  if (ifdStart + 2 > segment.length) return true

  const count = view.getUint16(ifdStart, little)
  for (let index = 0; index < count; index++) {
    const entry = ifdStart + 2 + index * 12
    if (entry + 12 > segment.length) return true
    if (view.getUint16(entry, little) !== ORIENTATION_TAG) continue
    // Browsers only honour a SHORT Orientation, so the canvas did not rotate
    // a non-SHORT one either; leave it and the server handles it as it would
    // an un-resized upload.
    if (view.getUint16(entry + 2, little) === TYPE_SHORT) {
      view.setUint16(entry + 8, 1, little)
    }
    return true
  }
  return true
}

/**
 * Returns a copy of the first Exif APP1 segment (including the FFE1 marker
 * and length) with Orientation reset to 1, or null when there is none or the
 * input is not a well-formed JPEG/TIFF. Never throws.
 */
export const extractJpegExifSegment = (
  input: Uint8Array | ArrayBuffer
): Uint8Array | null => {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
    const found = findExifSegment(bytes)
    if (!found) return null
    const segment = bytes.slice(found.start, found.end)
    return resetOrientation(segment) ? segment : null
  } catch {
    return null
  }
}

const JFIF_ID = [0x4a, 0x46, 0x49, 0x46, 0x00] // "JFIF\0"

/** End offset of a leading JFIF APP0 segment right after SOI, else 2. */
const insertionOffset = (bytes: Uint8Array): number => {
  if (
    bytes.length >= 11 &&
    bytes[2] === 0xff &&
    bytes[3] === 0xe0 &&
    JFIF_ID.every((value, index) => bytes[6 + index] === value)
  ) {
    const end = 4 + ((bytes[4] << 8) | bytes[5])
    if (end <= bytes.length) return end
  }
  return 2
}

/**
 * Inserts an Exif APP1 segment right after SOI (or after a leading JFIF APP0,
 * the usual layout), dropping any Exif APP1 the target already has. Non-JPEG
 * input is returned unchanged.
 */
export const insertJpegExifSegment = (
  jpegBytes: Uint8Array,
  segment: Uint8Array
): Uint8Array => {
  if (!isJpeg(jpegBytes)) return jpegBytes

  const at = insertionOffset(jpegBytes)
  const existing = findExifSegment(jpegBytes)
  const parts: Uint8Array[] = [jpegBytes.subarray(0, at), segment]
  if (existing && existing.start >= at) {
    parts.push(jpegBytes.subarray(at, existing.start))
    parts.push(jpegBytes.subarray(existing.end))
  } else {
    parts.push(jpegBytes.subarray(at))
  }

  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

import { ACCEPTED_IMAGE_TYPES } from '@/lib/services/medias/constants'
import {
  extractJpegExifSegment,
  insertJpegExifSegment
} from '@/lib/utils/jpegExif'

export interface ResizeImageOptions {
  /**
   * Carry the source JPEG's EXIF (date, gear, GPS) into the resized file with
   * Orientation reset to 1, since the canvas output is already upright.
   */
  keepMetadata?: boolean
}

const isJpegBytes = (bytes: Uint8Array) =>
  bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8

const graftExif = async (
  blob: Blob,
  sourceBuffer: ArrayBuffer
): Promise<Blob> => {
  try {
    const segment = extractJpegExifSegment(sourceBuffer)
    if (!segment) return blob
    const resized = new Uint8Array(await blob.arrayBuffer())
    if (!isJpegBytes(resized)) return blob
    const merged = insertJpegExifSegment(resized, segment)
    return new Blob([merged as BlobPart], { type: blob.type })
  } catch {
    return blob
  }
}

export async function resizeImage(
  file: File,
  widthLimitPixel: number,
  heightLimitPixel: number,
  options?: ResizeImageOptions
): Promise<File> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return file
  }

  const fileBuffer: ArrayBuffer = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(reader.result as ArrayBuffer)
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })

  const image: HTMLImageElement = await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      resolve(img)
    }
    img.onerror = reject

    const blob = new Blob([fileBuffer], { type: file.type })
    img.src = URL.createObjectURL(blob)
  })

  if (image.width <= widthLimitPixel && image.height <= heightLimitPixel) {
    return file
  }

  const originalImageCanvas = document.createElement('canvas')
  const originalContext = originalImageCanvas.getContext('2d')

  const destinationImageCanvas = document.createElement('canvas')
  const destinationContext = destinationImageCanvas.getContext('2d')

  // Calculate new dimensions
  const scale = Math.min(
    widthLimitPixel / image.width,
    heightLimitPixel / image.height
  )
  // Keep at least one pixel so an extreme aspect ratio still re-encodes.
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  // Set up source canvas
  originalImageCanvas.width = image.width
  originalImageCanvas.height = image.height
  originalContext?.drawImage(image, 0, 0)

  // Set up destination canvas
  destinationImageCanvas.width = width
  destinationImageCanvas.height = height

  // Draw resized image
  destinationContext?.drawImage(
    originalImageCanvas,
    0,
    0,
    image.width,
    image.height,
    0,
    0,
    width,
    height
  )

  // Convert to blob and return as new File
  return new Promise((resolve) => {
    destinationImageCanvas.toBlob(
      async (blob) => {
        if (!blob) {
          resolve(file)
          return
        }
        const output =
          options?.keepMetadata && file.type === 'image/jpeg'
            ? await graftExif(blob, fileBuffer)
            : blob
        resolve(new File([output], file.name, { type: file.type }))
      },
      file.type,
      0.8
    )
  })
}

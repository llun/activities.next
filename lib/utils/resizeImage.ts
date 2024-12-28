import { ACCEPTED_IMAGE_TYPES } from '../services/medias/constants'

export async function resizeImage(
  file: File,
  widthLimitPixel: number,
  heightLimitPixel: number
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
  let width = image.width
  let height = image.height

  if (width > height) {
    if (width > widthLimitPixel) {
      height = Math.round((height * widthLimitPixel) / width)
      width = widthLimitPixel
    }
  } else {
    if (height > heightLimitPixel) {
      width = Math.round((width * heightLimitPixel) / height)
      height = heightLimitPixel
    }
  }

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
      (blob) => {
        if (!blob) {
          resolve(file)
          return
        }
        resolve(new File([blob], file.name, { type: file.type }))
      },
      file.type,
      0.8
    )
  })
}

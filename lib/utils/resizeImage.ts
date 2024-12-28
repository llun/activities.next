import { MAX_HEIGHT, MAX_WIDTH } from '../services/medias/constants'

/**
 * Resize image in browser to reduce file
 *
 * @param file File to resize
 */
export async function resizeImage(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Invalid file type, only image is supported')
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

  if (image.width <= MAX_WIDTH && image.height <= MAX_HEIGHT) {
    console.log('Return original file')
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
    if (width > MAX_WIDTH) {
      height = Math.round((height * MAX_WIDTH) / width)
      width = MAX_WIDTH
    }
  } else {
    if (height > MAX_HEIGHT) {
      width = Math.round((width * MAX_HEIGHT) / height)
      height = MAX_HEIGHT
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

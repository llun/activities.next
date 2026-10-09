export async function getMediaWidthAndHeight(media: File) {
  const metaData: { width: number; height: number } | null = await new Promise(
    (resolve) => {
      if (media.type.startsWith('video')) {
        const element = document.createElement('video')
        const url = URL.createObjectURL(media)
        element.src = url
        element.onloadedmetadata = () => {
          URL.revokeObjectURL(url)
          resolve({ width: element.videoWidth, height: element.videoHeight })
        }
        element.onerror = () => {
          URL.revokeObjectURL(url)
          resolve(null)
        }
        return
      }

      if (media.type.startsWith('image')) {
        const element = document.createElement('img')
        const url = URL.createObjectURL(media)
        element.src = url
        element.onload = () => {
          URL.revokeObjectURL(url)
          resolve({ width: element.width, height: element.height })
        }
        element.onerror = () => {
          URL.revokeObjectURL(url)
          resolve(null)
        }
        return
      }
      resolve(null)
    }
  )
  return metaData
}

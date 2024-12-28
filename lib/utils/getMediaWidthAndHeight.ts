export async function getMediaWidthAndHeight(media: File) {
  const metaData: { width: number; height: number } | null = await new Promise(
    (resolve) => {
      if (media.type.startsWith('video')) {
        const element = document.createElement('video')
        element.src = URL.createObjectURL(media)
        element.onloadedmetadata = () => {
          resolve({ width: element.videoWidth, height: element.videoHeight })
        }
        return
      }

      if (media.type.startsWith('image')) {
        const element = document.createElement('img')
        element.src = URL.createObjectURL(media)
        element.onload = () => {
          resolve({ width: element.width, height: element.height })
        }
        return
      }
      resolve(null)
    }
  )
  return metaData
}

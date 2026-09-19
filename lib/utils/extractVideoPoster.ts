export const extractVideoPoster = async (
  videoFile: File,
  seekTimeSeconds = 0.1
): Promise<File | null> => {
  if (typeof document === 'undefined' || !videoFile.type.startsWith('video')) {
    return null
  }

  return new Promise((resolve) => {
    const video = document.createElement('video')
    const videoUrl = URL.createObjectURL(videoFile)
    video.src = videoUrl
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'

    let isDone = false
    const cleanup = () => {
      if (isDone) return
      isDone = true
      clearTimeout(timer)
      video.onloadedmetadata = null
      video.onseeked = null
      video.onerror = null
      URL.revokeObjectURL(videoUrl)
      video.removeAttribute('src')
      video.load()
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve(null)
    }, 5000)

    video.onloadedmetadata = () => {
      const targetTime =
        video.duration && !Number.isNaN(video.duration) && video.duration > 0
          ? Math.min(seekTimeSeconds, Math.max(0, video.duration / 2))
          : seekTimeSeconds
      video.currentTime = targetTime
    }

    video.onseeked = () => {
      try {
        const width = video.videoWidth || 640
        const height = video.videoHeight || 360
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          cleanup()
          return resolve(null)
        }
        ctx.drawImage(video, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            cleanup()
            if (!blob) return resolve(null)
            const posterFile = new File([blob], 'poster.jpg', {
              type: 'image/jpeg'
            })
            resolve(posterFile)
          },
          'image/jpeg',
          0.85
        )
      } catch {
        cleanup()
        resolve(null)
      }
    }

    video.onerror = () => {
      cleanup()
      resolve(null)
    }
  })
}

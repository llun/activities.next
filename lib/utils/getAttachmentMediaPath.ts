const FILES_PATH_MARKER = '/api/v1/files/'

const safelyDecode = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const getAttachmentMediaPath = (url: string): string => {
  const markerIndex = url.indexOf(FILES_PATH_MARKER)

  if (markerIndex >= 0) {
    return safelyDecode(
      url.slice(markerIndex + FILES_PATH_MARKER.length)
    ).replace(/^\/+/, '')
  }

  try {
    return safelyDecode(new URL(url, 'https://local.invalid').pathname).replace(
      /^\/+/,
      ''
    )
  } catch {
    return safelyDecode(url).replace(/^\/+/, '')
  }
}

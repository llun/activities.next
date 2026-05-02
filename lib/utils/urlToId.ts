const OPAQUE_URL_ID_PREFIX = 'apurl_'

const encodeBase64Url = (value: string) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64url')
  }

  return btoa(unescape(encodeURIComponent(value)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

const decodeBase64Url = (value: string) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64url').toString('utf8')
  }

  const paddedValue = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    '='
  )
  return decodeURIComponent(
    escape(atob(paddedValue.replaceAll('-', '+').replaceAll('_', '/')))
  )
}

export const urlToId = (idInURLFormat: string) => {
  if (!idInURLFormat) return ''
  if (idInURLFormat.startsWith(OPAQUE_URL_ID_PREFIX)) return idInURLFormat

  try {
    // Handle URLs without protocol by adding a temporary one
    const urlString = idInURLFormat.startsWith('http')
      ? idInURLFormat
      : `https://${idInURLFormat}`

    const url = new URL(urlString)

    if (url.pathname.includes(':')) {
      return `${OPAQUE_URL_ID_PREFIX}${encodeBase64Url(url.toString())}`
    }

    // Remove leading slash and replace all slashes with colons
    return (
      `${url.host}:${url.pathname.slice(1).replaceAll('/', ':')}` +
      (url.search || '') + // Preserve query parameters
      (url.hash || '')
    ) // Preserve fragments
  } catch {
    // If URL parsing fails, return the original string
    return idInURLFormat
  }
}

export const idToUrl = (id: string) => {
  if (!id) return ''

  if (id.startsWith(OPAQUE_URL_ID_PREFIX)) {
    try {
      return decodeBase64Url(id.slice(OPAQUE_URL_ID_PREFIX.length))
    } catch {
      return id
    }
  }

  // Handle query parameters and fragments
  const [baseId, ...rest] = id.split(/([?#].*)/)
  const extras = rest.join('')

  // Check if the ID already contains the protocol
  if (id.startsWith('https:')) {
    // Replace the first colon with ://
    const withProtocol = id.replace('https:', 'https://')
    // Replace remaining colons with slashes, but skip the one in protocol
    return withProtocol.replace(/(?<!https:\/):(?!\/)/g, '/')
  }

  // Split by the first colon to get host and path
  const parts = baseId.split(':')
  const host = parts[0]
  const path = parts.slice(1).join('/')

  return `https://${host}/${path}${extras}`
}

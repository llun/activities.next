const OPAQUE_URL_ID_PREFIX = 'apurl_'

const toBase64Url = (value: string) =>
  value.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

const fromBase64Url = (value: string) =>
  value
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=')
    .replaceAll('-', '+')
    .replaceAll('_', '/')

const encodeBase64Url = (value: string) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64url')
  }

  if (typeof btoa === 'function' && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(value)
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
      ''
    )
    return toBase64Url(btoa(binary))
  }

  throw new Error('Base64url encoding is not available')
}

const decodeBase64Url = (value: string) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64url').toString('utf8')
  }

  if (typeof atob !== 'function' || typeof TextDecoder === 'undefined') {
    throw new Error('Base64url decoding is not available')
  }

  const base64 = fromBase64Url(value)
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
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

    if (url.host.includes(':') || url.pathname.includes(':')) {
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
      const decoded = decodeBase64Url(id.slice(OPAQUE_URL_ID_PREFIX.length))
      const decodedUrl = new URL(decoded)
      if (!['http:', 'https:'].includes(decodedUrl.protocol)) return ''
      return decoded
    } catch {
      return ''
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

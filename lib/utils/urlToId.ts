export const urlToId = (idInURLFormat: string) => {
  if (!idInURLFormat) return ''

  try {
    // Handle URLs without protocol by adding a temporary one
    const urlString = idInURLFormat.startsWith('http')
      ? idInURLFormat
      : `https://${idInURLFormat}`

    const url = new URL(urlString)
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

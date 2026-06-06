export type HeaderSource =
  | Headers
  | Record<string, string | string[] | undefined | null>
  | undefined
  | null

const getFirstHeaderValue = (value: string | string[] | undefined | null) => {
  if (Array.isArray(value)) return value[0]
  return value
}

/**
 * Reads a header value case-insensitively from either a Web `Headers` object or
 * a plain record of header name to value(s). Array values (repeated headers)
 * collapse to the first entry. Returns `undefined` when the source is missing or
 * the header is absent.
 */
export const getHeaderValue = (headers: HeaderSource, name: string) => {
  if (!headers) return undefined

  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name)
  }

  const normalizedName = name.toLowerCase()
  const recordHeaders = headers as Record<
    string,
    string | string[] | undefined | null
  >
  const directValue = getFirstHeaderValue(recordHeaders[name])
  if (directValue !== undefined) return directValue

  const lowercaseValue = getFirstHeaderValue(recordHeaders[normalizedName])
  if (lowercaseValue !== undefined) return lowercaseValue

  const matchingKey = Object.keys(recordHeaders).find(
    (key) => key.toLowerCase() === normalizedName
  )
  return matchingKey
    ? getFirstHeaderValue(recordHeaders[matchingKey])
    : undefined
}

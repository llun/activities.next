// Credential-bearing dynamic app routes. The route-walking test guards additions.
export const CLIENT_ERROR_SECRET_ROUTES = [
  '/u/heatmaps/[token]',
  '/embed/heatmap/[token]',
  '/api/v1/webhooks/strava/[webhookToken]'
] as const

const secretPathPrefixes = CLIENT_ERROR_SECRET_ROUTES.map((route) =>
  route.split('/').slice(1, -1)
)

const redactPathSegments = (value: string): string => {
  const segments = value.split('/')
  return segments
    .map((segment, index) => {
      const isCredential = secretPathPrefixes.some(
        (prefix) =>
          index >= prefix.length &&
          prefix.every(
            (part, offset) => segments[index - prefix.length + offset] === part
          )
      )
      return isCredential && segment ? '[token]' : segment
    })
    .join('/')
}

const stripQueryAndHash = (value: string): string => {
  const query = value.indexOf('?')
  const hash = value.indexOf('#')
  const end = query < 0 ? hash : hash < 0 ? query : Math.min(query, hash)
  return end < 0 ? value : value.slice(0, end)
}

export const sanitiseClientErrorPathname = (value: string): string =>
  redactPathSegments(stripQueryAndHash(value))

// A token is URL-like when it has a path, or a query that carries a value.
// A bare prose question mark such as `ok?` stays untouched.
const isUrlLikeToken = (token: string): boolean =>
  token.includes('/') || /[?&][^=\s]*=/.test(token)

const stripUserinfo = (value: string): string =>
  value.replace(/((?:[a-z][a-z0-9+.-]*:)?\/\/)[^/\s]*@/g, '$1')

const sanitiseToken = (token: string): string => {
  if (!isUrlLikeToken(token)) return token

  // Only the end of a token can supply frame punctuation and coordinates.
  // A ')' or quote inside a query must never terminate query removal.
  const closing = token.match(/[)"']*$/)?.[0] ?? ''
  const withoutClosing = token.slice(0, token.length - closing.length)
  const coordinates = withoutClosing.match(/:\d+:\d+$/)?.[0] ?? ''
  const resource = stripQueryAndHash(
    coordinates ? withoutClosing.slice(0, -coordinates.length) : withoutClosing
  )

  return redactPathSegments(stripUserinfo(resource)) + coordinates + closing
}

export const sanitiseClientErrorText = (value: string): string =>
  value.replace(/\S+/g, sanitiseToken)

export const sanitiseClientErrorStack = (value: string): string =>
  sanitiseClientErrorText(value)
    .split('\n')
    .map((line) => {
      if (/^\s*at /.test(line)) return line
      const separator = line.indexOf('@')
      if (separator < 0) return line
      const name = line.slice(0, separator)
      const location = line.slice(separator + 1)
      if (
        name.includes('(') ||
        name.includes(')') ||
        !/:\d+:\d+$/.test(location)
      ) {
        return line
      }
      return `    at ${name || '<anonymous>'} (${location})`
    })
    .join('\n')

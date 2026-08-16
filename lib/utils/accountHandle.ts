export const parseAccountHandle = (value: string) => {
  const normalized = value.trim().replace(/^@/, '')
  const [username, domain, ...rest] = normalized.split('@')
  if (!username || !domain || rest.length > 0) return null
  return { username, domain: domain.toLowerCase() }
}

/**
 * Drops a case-insensitive `acct:` URI scheme prefix. WebFinger resources and
 * the `uri` other servers hand to `/authorize_interaction` both arrive in that
 * form, and `parseAccountHandle` splits on `@`, so `acct:user@domain` would
 * otherwise parse with `acct:user` as the username.
 */
export const stripAcctPrefix = (value: string) => {
  const trimmed = value.trim()
  return trimmed.toLowerCase().startsWith('acct:')
    ? trimmed.slice('acct:'.length)
    : trimmed
}

/**
 * Reads the account handle out of a profile page URL (`https://d/@user` or
 * `https://d/@user@other`), qualifying a bare `@user` with the URL's own host.
 * Returns null for any other URL shape, including status permalinks.
 */
export const parseProfileUrlAccountHandle = (value: string) => {
  try {
    const url = new URL(value)
    const match = /^\/@([^/]+)\/?$/.exec(url.pathname)
    if (!match) return null

    const profileHandle = decodeURIComponent(match[1])
    const handle = profileHandle.includes('@')
      ? `@${profileHandle.replace(/^@/, '')}`
      : `@${profileHandle}@${url.hostname}`
    return parseAccountHandle(handle)
  } catch {
    return null
  }
}

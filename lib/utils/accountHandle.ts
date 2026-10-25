export const parseAccountHandle = (value: string) => {
  const normalized = value.trim().replace(/^@/, '')
  const [username, domain, ...rest] = normalized.split('@')
  if (!username || !domain || rest.length > 0) return null
  return { username, domain: domain.toLowerCase() }
}

/**
 * Whether a handle IS the actor's current one, case-insensitively: the
 * username folds both sides, the domain folds both sides (a current handle
 * may have been stored before domains were normalized). A current handle and
 * a retired one can both resolve to the same actor; only the current one
 * answers true here, which is what decides whether a resolved URL needs
 * redirecting to the canonical profile path.
 */
export const isCurrentHandle = (
  actor: { username: string; domain: string },
  { username, domain }: { username: string; domain: string }
) =>
  actor.username.toLowerCase() === username.toLowerCase() &&
  actor.domain.toLowerCase() === domain.toLowerCase()

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
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const match = /^\/@([^/]+)\/?$/.exec(url.pathname)
    if (!match) return null

    const profileHandle = decodeURIComponent(match[1])
    const handle = profileHandle.includes('@')
      ? `@${profileHandle.replace(/^@/, '')}`
      : `@${profileHandle}@${url.host}`
    return parseAccountHandle(handle)
  } catch {
    return null
  }
}

/**
 * Reads the account handle out of an ActivityPub actor URL (`https://d/users/user`).
 * Returns null for any other URL shape.
 */
export const parseActorUrlAccountHandle = (value: string) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const match = /^\/users\/([^/]+)\/?$/.exec(url.pathname)
    if (!match) return null

    const username = decodeURIComponent(match[1])
    return parseAccountHandle(`@${username}@${url.host}`)
  } catch {
    return null
  }
}

/**
 * Reads the account handle out of any supported account URL:
 * - ActivityPub actor URL: `https://d/users/user`
 * - Profile URL: `https://d/@user` or `https://d/@user@other`
 * Returns null for any other URL shape or non-URL value.
 */
export const parseAccountUrlHandle = (value: string) => {
  return (
    parseActorUrlAccountHandle(value) ?? parseProfileUrlAccountHandle(value)
  )
}

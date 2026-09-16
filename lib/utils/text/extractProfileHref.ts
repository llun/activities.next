import { Tag } from '@/lib/types/domain/tag'
import { parseAccountUrlHandle } from '@/lib/utils/accountHandle'
import { isOpaqueActorUsernameValue } from '@/lib/utils/activitypubActor'

export interface ExtractProfileHrefOptions {
  host?: string
  tags?: Tag[]
}

const getDecodedPathParts = (pathname: string) => {
  try {
    return pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
}

const getProfileHandleFromParts = (parts: string[]) => {
  if (parts.length === 2 && parts[0] === 'profile') {
    const profileHandle = parts[1]
    if (profileHandle && !isOpaqueActorUsernameValue(profileHandle)) {
      return profileHandle.replace(/^@+/, '').split('@')[0]
    }
  }
  return null
}

const getBlueskyHandle = (url: URL): string | null => {
  if (url.hostname === 'bsky.app') {
    const parts = getDecodedPathParts(url.pathname)
    return parts ? getProfileHandleFromParts(parts) : null
  }

  if (url.hostname !== 'bsky.brid.gy' || !url.pathname.startsWith('/r/')) {
    return null
  }

  const raw = url.pathname.slice('/r/'.length)
  try {
    const embeddedUrl = new URL(decodeURIComponent(raw))
    if (embeddedUrl.hostname !== 'bsky.app') return null
    const parts = getDecodedPathParts(embeddedUrl.pathname)
    return parts ? getProfileHandleFromParts(parts) : null
  } catch {
    return null
  }
}

const isHostMatch = (
  domainA: string | undefined,
  domainB: string | undefined
): boolean => {
  const a = domainA?.trim().toLowerCase()
  const b = domainB?.trim().toLowerCase()
  if (!a || !b) return false
  if (a === b) return true
  const aHasPort = /:[0-9]+$/.test(a)
  const bHasPort = /:[0-9]+$/.test(b)
  if (aHasPort && bHasPort) return false
  return a.replace(/:[0-9]+$/, '') === b.replace(/:[0-9]+$/, '')
}

const normalizeUrlForMatch = (urlStr: string): string => {
  try {
    const u = new URL(urlStr)
    const pathname =
      u.pathname.length > 1 && u.pathname.endsWith('/')
        ? u.pathname.slice(0, -1)
        : u.pathname
    return `${u.protocol}//${u.host.toLowerCase()}${pathname}`
  } catch {
    return urlStr
  }
}

export const extractProfileHref = (
  href: string | undefined,
  options?: ExtractProfileHrefOptions
): string | undefined => {
  if (!href) return undefined

  // 1. Root-relative handle paths are already local profile destinations.
  if (href.startsWith('/')) {
    const localMatch = /^\/@([a-zA-Z0-9_.-]+)(?:@([a-zA-Z0-9_.:-]+))?\/?$/.exec(
      href
    )
    if (localMatch) {
      return href.endsWith('/') && href.length > 2 ? href.slice(0, -1) : href
    }
    return undefined
  }

  // Guard against non-HTTP(S) schemes (e.g. javascript:, data:) and invalid URLs
  let parsedUrl: URL
  try {
    parsedUrl = new URL(href)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return undefined
    }
  } catch {
    return undefined
  }

  // 2. Resolve via status mention tags when available (covers non-standard fediverse profile URLs).
  if (options?.tags && options.tags.length > 0) {
    const normalizedTarget = normalizeUrlForMatch(href)
    const matchingTag = options.tags.find(
      (tag) =>
        tag.type === 'mention' &&
        (tag.value === href ||
          normalizeUrlForMatch(tag.value) === normalizedTarget)
    )
    if (matchingTag) {
      const cleanName = matchingTag.name.replace(/^@+/, '')
      const parts = cleanName.split('@')
      if (parts.length === 1 && parts[0]) {
        const username = parts[0]
        let domain: string
        try {
          domain = new URL(matchingTag.value).host.toLowerCase()
        } catch {
          domain = ''
        }
        if (isHostMatch(domain, options?.host)) {
          return `/@${username}`
        }
        return domain ? `/@${username}@${domain}` : `/@${username}`
      }

      if (parts.length === 2 && parts[0] && parts[1]) {
        const username = parts[0]
        const domain = parts[1].toLowerCase()
        if (isHostMatch(domain, options?.host)) {
          return `/@${username}`
        }
        return `/@${username}@${domain}`
      }
    }
  }

  // 3. Resolve standard Fediverse URL shapes (/@user, /@user@domain, /users/user).
  const account = parseAccountUrlHandle(href)
  if (account) {
    const { username, domain } = account
    if (isHostMatch(domain, options?.host)) {
      return `/@${username}`
    }
    return `/@${username}@${domain}`
  }

  // 4. Resolve Bluesky bridge profile URLs.
  const bskyUser = getBlueskyHandle(parsedUrl)
  if (bskyUser) {
    return `/@${bskyUser}@bsky.brid.gy`
  }

  return undefined
}

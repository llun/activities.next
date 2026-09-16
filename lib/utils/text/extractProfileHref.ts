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
  const profileIndex = parts.indexOf('profile')
  const profileHandle = parts[profileIndex + 1]
  if (
    profileIndex >= 0 &&
    profileHandle &&
    !isOpaqueActorUsernameValue(profileHandle)
  ) {
    return profileHandle.replace(/^@+/, '').split('@')[0]
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

export const extractProfileHref = (
  href: string | undefined,
  options?: ExtractProfileHrefOptions
): string | undefined => {
  if (!href) return undefined

  // 1. Root-relative handle paths are already local profile destinations.
  if (href.startsWith('/@')) {
    return href
  }

  // 2. Resolve via status mention tags when available (covers non-standard fediverse profile URLs).
  if (options?.tags && options.tags.length > 0) {
    const matchingTag = options.tags.find(
      (tag) => tag.type === 'mention' && tag.value === href
    )
    if (matchingTag) {
      const cleanName = matchingTag.name.replace(/^@+/, '')
      const atIndex = cleanName.indexOf('@')
      let username: string
      let domain: string
      if (atIndex > 0) {
        username = cleanName.slice(0, atIndex)
        domain = cleanName.slice(atIndex + 1).toLowerCase()
      } else {
        username = cleanName
        try {
          domain = new URL(matchingTag.value).host.toLowerCase()
        } catch {
          domain = ''
        }
      }

      if (username) {
        if (options.host && domain && domain === options.host.toLowerCase()) {
          return `/@${username}`
        }
        return domain ? `/@${username}@${domain}` : `/@${username}`
      }
    }
  }

  // 3. Resolve standard Fediverse URL shapes (/@user, /@user@domain, /users/user).
  const account = parseAccountUrlHandle(href)
  if (account) {
    const { username, domain } = account
    if (options?.host && domain.toLowerCase() === options.host.toLowerCase()) {
      return `/@${username}`
    }
    return `/@${username}@${domain}`
  }

  // 4. Resolve Bluesky bridge profile URLs.
  try {
    const parsedUrl = new URL(href)
    const bskyUser = getBlueskyHandle(parsedUrl)
    if (bskyUser) {
      return `/@${bskyUser}@bsky.brid.gy`
    }
  } catch {
    return undefined
  }

  return undefined
}

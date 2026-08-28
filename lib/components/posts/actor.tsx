import Link from 'next/link'
import { FC } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { getMentionDomainFromActorID } from '@/lib/types/domain/actor'
import type { ActorProfile } from '@/lib/types/domain/actor'
import {
  getActorIdUsername,
  isOpaqueActorUsernameValue
} from '@/lib/utils/activitypubActor'

interface Props {
  actor?: ActorProfile | null
  actorId?: string
  statusUrl?: string | null
}

type ActorIdParts = {
  handle: string
  domain: string
  href?: string
}

const getInitials = (value: string) =>
  value
    .replace(/^@/, '')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

const getDisplayUsername = (username: string) =>
  username.replace(/^@+/, '').split('@')[0]

const getActorMention = (actor: ActorProfile) =>
  `@${getDisplayUsername(actor.username)}@${actor.domain}`

// The actor's own mention is only usable while its username normalises to
// something: `@@domain` is a handle `parseAccountHandle` rejects, so an actor
// with a degenerate `preferredUsername` has no mention to offer here.
const getUsableActorMention = (actor?: ActorProfile | null): string | null =>
  actor && getDisplayUsername(actor.username) ? getActorMention(actor) : null

const getProfileHandleFromParts = (parts: string[]) => {
  const profileIndex = parts.indexOf('profile')
  const profileHandle = parts[profileIndex + 1]
  if (
    profileIndex >= 0 &&
    profileHandle &&
    !isOpaqueActorUsernameValue(profileHandle)
  ) {
    return `@${getDisplayUsername(profileHandle)}`
  }
  return null
}

const getDecodedPathParts = (pathname: string) => {
  try {
    return pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
}

const decodePathParam = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

const getBlueskyProfileHandle = (url: URL) => {
  if (url.hostname === 'bsky.app') {
    const parts = getDecodedPathParts(url.pathname)
    return parts ? getProfileHandleFromParts(parts) : null
  }

  if (url.hostname !== 'bsky.brid.gy' || !url.pathname.startsWith('/r/')) {
    return null
  }

  const embeddedUrlString = decodePathParam(url.pathname.slice('/r/'.length))
  if (!embeddedUrlString) return null

  let embeddedUrl: URL
  try {
    embeddedUrl = new URL(embeddedUrlString)
  } catch {
    return null
  }
  if (embeddedUrl.hostname !== 'bsky.app') return null

  const parts = getDecodedPathParts(embeddedUrl.pathname)
  return parts ? getProfileHandleFromParts(parts) : null
}

const getStatusUrlHandle = (statusUrl?: string | null) => {
  if (!statusUrl) return null
  try {
    const url = new URL(statusUrl)
    const parts = getDecodedPathParts(url.pathname)
    if (!parts) return null

    const handle = parts.find((part) => part.startsWith('@') && part.length > 1)
    if (handle) return `@${getDisplayUsername(handle)}`

    return getBlueskyProfileHandle(url)
  } catch {
    return null
  }
}

const getActorIdDomain = (actorId: string) => {
  try {
    return getMentionDomainFromActorID(actorId)
  } catch {
    return ''
  }
}

const getActorIdParts = (
  actorId: string,
  statusUrl?: string | null
): ActorIdParts => {
  const statusHandle = getStatusUrlHandle(statusUrl)
  if (statusHandle) {
    const domain = getActorIdDomain(actorId)
    return {
      handle: statusHandle,
      domain,
      href: `/${statusHandle}${domain}`
    }
  }

  const username = getDisplayUsername(getActorIdUsername(actorId))
  if (isOpaqueActorUsernameValue(username)) {
    const domain = getActorIdDomain(actorId)
    return {
      handle: domain || `@${username}`,
      domain: ''
    }
  }

  const handle = `@${username}`
  const domain = getActorIdDomain(actorId)
  return {
    handle,
    domain,
    href: `/${handle}${domain}`
  }
}

const getActorIdHandle = (actorId: string, statusUrl?: string | null) =>
  getActorIdParts(actorId, statusUrl).handle

// The profile page an actor links to, shared by every author link in a post —
// the avatar below, `ActorInfo`'s display name, and the boosted-by line in
// `post.tsx` — instead of each re-deriving it. Falls through to the actor-id
// path when the actor is present but its username normalises to empty (e.g. a
// federated `preferredUsername` of just `@` characters), so the href is never
// built from a mention with an empty local part — otherwise undefined when the
// actor id also carries no usable handle (an opaque `did:`/UUID username),
// which is the case those callers render as unlinked content rather than a
// link to nowhere: plain text in `ActorInfo` and `BoostStatus`, an unlinked
// avatar (image or initials) in `ActorAvatar`.
export const getActorProfileHref = (
  actor?: ActorProfile | null,
  actorId?: string,
  statusUrl?: string | null
): string | undefined => {
  const mention = getUsableActorMention(actor)
  if (mention) return `/${mention}`
  if (!actorId) return undefined
  return getActorIdParts(actorId, statusUrl).href
}

export const getActorIdMention = (
  actorId: string,
  statusUrl?: string | null
) => {
  const { handle, domain } = getActorIdParts(actorId, statusUrl)
  return `${handle}${domain}`
}

// The name a caller shows beside (or instead of) `getActorProfileHref`'s
// destination: `name || getDisplayUsername(username)`.
// Undefined when there is no actor to name, mirroring `getActorProfileHref`'s
// own `undefined` for "nothing to link". It is empty — not undefined — for an
// actor that exists but has neither a name nor a username that normalises to
// anything, so every caller needs a fallback of its own and chains it with
// `||`: `BoostStatus` and `ActorInfo` read the actor id, `ActorAvatar` draws
// no initials.
export const getActorDisplayName = (
  actor?: ActorProfile | null
): string | undefined =>
  actor ? actor.name || getDisplayUsername(actor.username) : undefined

// Both author links below opt out of prefetching. `<Link>` prefetches on
// viewport entry, and every post renders two of them, so scrolling a feed fired
// one RSC request per author per link — against `/@user@domain`, a fully
// dynamic route that runs a session lookup plus six actor queries and, for a
// remote actor this instance has not persisted yet, a WebFinger lookup and a
// signed actor fetch to the remote server. See "Link prefetching in feeds" in
// AGENTS.md.
export const ActorAvatar: FC<Props> = ({ actor, actorId, statusUrl }) => {
  if (!actor && !actorId) return null

  const href = getActorProfileHref(actor, actorId, statusUrl)
  const initials = actor
    ? getInitials(getActorDisplayName(actor) || '')
    : getInitials(getActorIdHandle(actorId || '', statusUrl))

  const avatar = (
    <Avatar className="h-10 w-10">
      <AvatarImage src={actor?.iconUrl} />
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  )

  if (!href) {
    return <div onClick={(e) => e.stopPropagation()}>{avatar}</div>
  }

  return (
    <Link href={href} prefetch={false} onClick={(e) => e.stopPropagation()}>
      {avatar}
    </Link>
  )
}

export const ActorInfo: FC<Props> = ({ actor, actorId, statusUrl }) => {
  if (!actor && !actorId) return null

  const href = getActorProfileHref(actor, actorId, statusUrl)
  // `name` and `mention` are independent fallback chains, so they can
  // disagree: a named actor whose username normalises to empty keeps its own
  // name while its mention and href come from the actor id. See "Status Posts
  // & Actions" in AGENTS.md.
  const mention = getUsableActorMention(actor)
  const idParts = mention ? null : getActorIdParts(actorId || '', statusUrl)
  const name = getActorDisplayName(actor) || idParts?.handle || ''
  const mutedHandle = mention ?? idParts?.domain ?? ''

  return (
    <div
      className="flex min-w-0 max-w-full items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {href ? (
        <Link
          href={href}
          prefetch={false}
          className="font-semibold hover:underline truncate"
        >
          {name}
        </Link>
      ) : (
        <span className="font-semibold truncate">{name}</span>
      )}
      <span className="text-muted-foreground truncate">{mutedHandle}</span>
    </div>
  )
}

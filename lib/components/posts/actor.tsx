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

export const getActorIdMention = (
  actorId: string,
  statusUrl?: string | null
) => {
  const { handle, domain } = getActorIdParts(actorId, statusUrl)
  return `${handle}${domain}`
}

export const ActorAvatar: FC<Props> = ({ actor, actorId, statusUrl }) => {
  if (!actor && !actorId) return null

  const href = actor
    ? `/${getActorMention(actor)}`
    : getActorIdParts(actorId || '', statusUrl).href
  const initials = actor
    ? getInitials(actor.name || getDisplayUsername(actor.username) || '')
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
    <Link href={href} onClick={(e) => e.stopPropagation()}>
      {avatar}
    </Link>
  )
}

export const ActorInfo: FC<Props> = ({ actor, actorId, statusUrl }) => {
  if (!actor && !actorId) return null

  if (!actor) {
    const { handle, domain, href } = getActorIdParts(actorId || '', statusUrl)
    return (
      <div
        className="flex min-w-0 max-w-full items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        {href ? (
          <Link href={href} className="font-semibold hover:underline truncate">
            {handle}
          </Link>
        ) : (
          <span className="font-semibold truncate">{handle}</span>
        )}
        <span className="text-muted-foreground truncate">{domain}</span>
      </div>
    )
  }

  return (
    <div
      className="flex min-w-0 max-w-full items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <Link
        href={`/${getActorMention(actor)}`}
        className="font-semibold hover:underline truncate"
      >
        {actor.name || getDisplayUsername(actor.username)}
      </Link>
      <span className="text-muted-foreground truncate">
        {getActorMention(actor)}
      </span>
    </div>
  )
}

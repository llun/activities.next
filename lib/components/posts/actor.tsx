import Link from 'next/link'
import { FC } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import {
  ActorProfile,
  getMentionDomainFromActorID
} from '@/lib/types/domain/actor'

interface Props {
  actor?: ActorProfile | null
  actorId?: string
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

const getActorIdHandle = (actorId: string) =>
  `@${getDisplayUsername(actorId.split('/').filter(Boolean).pop() || actorId)}`

const getActorIdDomain = (actorId: string) => {
  try {
    return getMentionDomainFromActorID(actorId)
  } catch {
    return ''
  }
}

export const getActorIdMention = (actorId: string) =>
  `${getActorIdHandle(actorId)}${getActorIdDomain(actorId)}`

export const ActorAvatar: FC<Props> = ({ actor, actorId }) => {
  if (!actor && !actorId) return null

  const href = actor
    ? `/${getActorMention(actor)}`
    : `/${getActorIdMention(actorId || '')}`
  const initials = actor
    ? getInitials(actor.name || getDisplayUsername(actor.username) || '')
    : getInitials(getActorIdHandle(actorId || ''))

  return (
    <Link href={href} onClick={(e) => e.stopPropagation()}>
      <Avatar className="h-10 w-10">
        <AvatarImage src={actor?.iconUrl} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
    </Link>
  )
}

export const ActorInfo: FC<Props> = ({ actor, actorId }) => {
  if (!actor && !actorId) return null

  if (!actor) {
    const handle = getActorIdHandle(actorId || '')
    const domain = getActorIdDomain(actorId || '')
    const href = `/${getActorIdMention(actorId || '')}`
    return (
      <div
        className="flex items-center gap-1 min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Link href={href} className="font-semibold hover:underline truncate">
          {handle}
        </Link>
        <span className="text-muted-foreground truncate">{domain}</span>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-1 min-w-0"
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

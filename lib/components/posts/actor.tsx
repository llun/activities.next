import Link from 'next/link'
import { FC } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import {
  ActorProfile,
  getMention,
  getMentionDomainFromActorID,
  getMentionFromActorID
} from '@/lib/models/actor'

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

export const ActorAvatar: FC<Props> = ({ actor, actorId }) => {
  if (!actor && !actorId) return null

  const href = actor
    ? `/${getMention(actor, true)}`
    : `/${getMentionFromActorID(actorId || '', true)}`
  const initials = actor
    ? getInitials(actor.name || actor.username || '')
    : getInitials(getMentionFromActorID(actorId || '', false))

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
    const handle = getMentionFromActorID(actorId || '', false)
    const domain = getMentionDomainFromActorID(actorId || '')
    const href = `/${getMentionFromActorID(actorId || '', true)}`
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
        href={`/${getMention(actor, true)}`}
        className="font-semibold hover:underline truncate"
      >
        {actor.name || actor.username}
      </Link>
      <span className="text-muted-foreground truncate">
        {getMention(actor, true)}
      </span>
    </div>
  )
}

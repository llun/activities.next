import Link from 'next/link'
import { FC } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { ActorProfile } from '@/lib/models/actor'

interface Props {
  actor?: ActorProfile | null
  actorId?: string // We can use this to fetch if needed, but for now we'll assume actor is passed
}

export const ActorAvatar: FC<Props> = ({ actor }) => {
  if (!actor) return null

  const initials = (actor.name || actor.username || '')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <Link href={`/@${actor.username}@${actor.domain}`} onClick={(e) => e.stopPropagation()}>
      <Avatar className="h-10 w-10">
        <AvatarImage src={actor.iconUrl} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
    </Link>
  )
}

export const ActorInfo: FC<Props> = ({ actor }) => {
  if (!actor) return null

  return (
    <div className="flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
      <Link
        href={`/@${actor.username}@${actor.domain}`}
        className="font-semibold hover:underline truncate"
      >
        {actor.name || actor.username}
      </Link>
      <span className="text-muted-foreground truncate">
        @{actor.username}@{actor.domain}
      </span>
    </div>
  )
}
import Link from 'next/link'
import { UserCheck } from 'lucide-react'
import { FC } from 'react'

import {
  ActorProfile,
  getMention,
  getMentionDomainFromActorID,
  getMentionFromActorID
} from '@/lib/models/actor'

interface Props {
  actorId?: string
  actor?: ActorProfile | null
  className?: string
}

export const Actor: FC<Props> = ({ actor, actorId, className }) => {
  if (actor) {
    return (
      <div className={className}>
        <Link
          prefetch={false}
          href={`/${getMention(actor, true)}`}
          target="_blank"
        >
          <span className="inline-block truncate align-middle overflow-hidden max-w-[calc(100%-2rem)]">
            <strong>@{actor.username}</strong>
            <small>@{actor.domain}</small>
          </span>
          <UserCheck className="ml-2 inline align-middle size-4" />
        </Link>
      </div>
    )
  }

  if (actorId) {
    return (
      <div className={className}>
        <Link
          prefetch={false}
          href={`/${getMentionFromActorID(actorId, true)}`}
        >
          <strong>{getMentionFromActorID(actorId, false)}</strong>
          <small>{getMentionDomainFromActorID(actorId)}</small>

          <UserCheck className="ml-2 inline size-4" />
        </Link>
      </div>
    )
  }

  return null
}

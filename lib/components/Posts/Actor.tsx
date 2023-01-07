import Link from 'next/link'
import { FC } from 'react'

import { Actor as ActorModel, ActorProfile } from '../../models/actor'

interface Props {
  actorId?: string
  actor?: ActorProfile | null
  className?: string
}

export const Actor: FC<Props> = ({ actor, actorId, className }) => {
  if (actor) {
    return (
      <div className={className}>
        <strong>@{actor.username}</strong>
        <small>@{actor.domain}</small>
        <Link
          className="ms-2"
          href={`/${ActorModel.getMentionFromProfile(actor, true)}`}
        >
          <i className="bi bi-person-badge"></i>
        </Link>
      </div>
    )
  }

  if (actorId) {
    return (
      <div className={className}>
        <strong>{ActorModel.getMentionFromId(actorId, false)}</strong>
        <small>{ActorModel.getMentionHostnameFromId(actorId)}</small>
        <Link
          className="ms-2"
          href={`/@${ActorModel.getMentionFromId(actorId, true)}`}
        >
          <i className="bi bi-person-badge"></i>
        </Link>
      </div>
    )
  }

  return null
}

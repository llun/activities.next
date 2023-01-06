import Link from 'next/link'
import { FC } from 'react'

import {
  Actor as ActorModel,
  getHostnameFromId,
  getUsernameFromId
} from '../../models/actor'

interface Props {
  actorId?: string
  actor?: ActorModel | null
  className?: string
}

export const Actor: FC<Props> = ({ actor, actorId, className }) => {
  if (actor) {
    return (
      <div className={className}>
        <strong>@{actor.username}</strong>
        <small>@{actor.domain}</small>
        <Link className="ms-2" href={`/@${actor.username}@${actor.domain}`}>
          <i className="bi bi-person-badge"></i>
        </Link>
      </div>
    )
  }

  if (actorId) {
    return (
      <div className={className}>
        <strong>@{getUsernameFromId(actorId)}</strong>
        <small>@{getHostnameFromId(actorId)}</small>
        <Link
          className="ms-2"
          href={`/@${getUsernameFromId(actorId)}@${getHostnameFromId(actorId)}`}
        >
          <i className="bi bi-person-badge"></i>
        </Link>
      </div>
    )
  }

  return null
}

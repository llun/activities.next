import cn from 'classnames'
import Link from 'next/link'
import { FC } from 'react'

import { Actor as ActorModel, ActorProfile } from '../../models/actor'
import styles from './Actor.module.scss'

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
          href={`/${ActorModel.getMentionFromProfile(actor, true)}`}
          target="_blank"
        >
          <span
            className={cn(
              'd-inline-block',
              'text-truncate',
              'align-middle',
              'overflow-hidden',
              styles.handle
            )}
          >
            <strong>@{actor.username}</strong>
            <small>@{actor.domain}</small>
          </span>
          <i className="ms-2 align-middle bi bi-person-badge"></i>
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
          prefetch={false}
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

import cn from 'classnames'
import Link from 'next/link'
import { FC } from 'react'

import {
  Actor as ActorModel,
  ActorProfile,
  getMention,
  getMentionDomainFromActorID,
  getMentionFromActorID
} from '@/lib/models/actor'

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
          href={`/${getMention(actor, true)}`}
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
        <Link
          prefetch={false}
          href={`/${getMentionFromActorID(actorId, true)}`}
        >
          <strong>{getMentionFromActorID(actorId, false)}</strong>
          <small>{getMentionDomainFromActorID(actorId)}</small>

          <i className="ms-2 bi bi-person-badge"></i>
        </Link>
      </div>
    )
  }

  return null
}

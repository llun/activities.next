import Link from 'next/link'
import { FC } from 'react'

import { getHostnameFromId, getUsernameFromId } from '../../models/actor'

interface Props {
  actorId?: string
}

export const Actor: FC<Props> = ({ actorId }) => {
  if (!actorId) return null
  return (
    <div>
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

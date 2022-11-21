import { FC } from 'react'

import { getHostnameFromId, getUsernameFromId } from '../../models/actor'

interface Props {
  actorId?: string
}

export const Actor: FC<Props> = ({ actorId }) => {
  if (!actorId) return null
  return (
    <div>
      <strong>
        @{getUsernameFromId(actorId)}@{getHostnameFromId(actorId)}
      </strong>
    </div>
  )
}

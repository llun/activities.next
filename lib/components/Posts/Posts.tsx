import { FC } from 'react'
import cn from 'classnames'
import parse from 'html-react-parser'
import { formatDistanceToNow } from 'date-fns'

import { Actor } from './Actor'
import { Status } from '../../models/status'
import { Post } from './Post'

interface Props {
  showActorId?: boolean
  statuses: Status[]
}

export const Posts: FC<Props> = ({ showActorId = false, statuses }) => {
  if (statuses.length === 0) return null

  return (
    <section className={cn('w-full', 'grid', 'grid-cols-1', 'mt-4')}>
      {statuses.map((status) => (
        <div key={status.id} className="block">
          <Actor actorId={(showActorId && status.actorId) || ''} />
          <div key={status.id} className={cn('d-flex')}>
            <Post status={status} />
            <div className="flex-shrink-0">
              {formatDistanceToNow(status.createdAt)}
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}

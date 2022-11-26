import cn from 'classnames'
import { FC } from 'react'

import { Status } from '../../models/status'
import { Actor } from './Actor'
import { Post } from './Post'
import styles from './Posts.module.scss'

interface Props {
  showActorId?: boolean
  showActions?: boolean
  currentTime: Date
  statuses: Status[]
  onReply?: (status: Status) => void
}

export const Posts: FC<Props> = ({
  showActorId = false,
  showActions = false,
  currentTime,
  statuses,
  onReply
}) => {
  if (statuses.length === 0) return null

  return (
    <section className={cn('w-full', 'grid', 'grid-cols-1', 'mt-4')}>
      {statuses.map((status) => (
        <div key={status.id} className={cn(styles.block)}>
          <Actor actorId={(showActorId && status.actorId) || ''} />
          <Post
            currentTime={currentTime}
            status={status}
            showActions={showActions}
            onReply={onReply}
          />
        </div>
      ))}
    </section>
  )
}

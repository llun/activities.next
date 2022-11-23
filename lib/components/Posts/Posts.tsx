import { FC } from 'react'
import cn from 'classnames'

import { Actor } from './Actor'
import { Status } from '../../models/status'
import { Post } from './Post'

import styles from './Posts.module.scss'

interface Props {
  showActorId?: boolean
  showActions?: boolean
  statuses: Status[]
}

export const Posts: FC<Props> = ({
  showActorId = false,
  showActions = false,
  statuses
}) => {
  if (statuses.length === 0) return null

  return (
    <section className={cn('w-full', 'grid', 'grid-cols-1', 'mt-4')}>
      {statuses.map((status) => (
        <div key={status.id} className={cn(styles.block)}>
          <Actor actorId={(showActorId && status.actorId) || ''} />
          <Post status={status} showActions={showActions} />
        </div>
      ))}
    </section>
  )
}

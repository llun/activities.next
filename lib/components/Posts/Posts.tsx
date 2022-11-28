import cn from 'classnames'
import { FC } from 'react'

import { conversation } from '../../models/helpers/conversation'
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

  const conversations = conversation(statuses)
  return (
    <section className={cn('w-full', 'grid', 'grid-cols-1', 'mt-4')}>
      {conversations.map(({ conversation, statuses }) => (
        <div key={conversation} className={cn(styles.block)}>
          <Actor actorId={(showActorId && statuses[0].actorId) || ''} />
          <Post
            currentTime={currentTime}
            status={statuses[0]}
            showActions={showActions}
            onReply={onReply}
          />
          {statuses.length > 1 && (
            <ul className={styles.thread}>
              {statuses.slice(1).map((status) => (
                <li key={status.id}>
                  <Actor actorId={(showActorId && status.actorId) || ''} />
                  <Post
                    currentTime={currentTime}
                    status={status}
                    showActions={showActions}
                    onReply={onReply}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  )
}

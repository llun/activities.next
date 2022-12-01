import cn from 'classnames'
import groupBy from 'lodash/groupBy'
import { FC } from 'react'

import { Attachment } from '../../models/attachment'
import { Status } from '../../models/status'
import { Actor } from './Actor'
import { Post } from './Post'
import styles from './Posts.module.scss'

interface Props {
  showActorId?: boolean
  showActions?: boolean
  currentTime: Date
  statuses: Status[]
  attachments: Attachment[]
  onReply?: (status: Status) => void
}

export const Posts: FC<Props> = ({
  showActorId = false,
  showActions = false,
  currentTime,
  statuses,
  attachments,
  onReply
}) => {
  if (statuses.length === 0) return null

  const attachmentsMap = groupBy(attachments, 'statusId')
  return (
    <section className={cn('w-full', 'grid', 'grid-cols-1', 'mt-4')}>
      {statuses.map((status, index) => (
        <div key={`${index}-${status.id}`} className={cn(styles.block)}>
          <Actor actorId={(showActorId && status.actorId) || ''} />
          <Post
            currentTime={currentTime}
            status={status}
            attachments={attachmentsMap[status.id]}
            showActions={showActions}
            onReply={onReply}
          />
        </div>
      ))}
    </section>
  )
}

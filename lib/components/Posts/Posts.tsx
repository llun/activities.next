import cn from 'classnames'
import groupBy from 'lodash/groupBy'
import { FC, useState } from 'react'

import { Attachment } from '../../models/attachment'
import { Status } from '../../models/status'
import { Modal } from '../Modal'
import { Media } from './Media'
import { Post } from './Post'
import styles from './Posts.module.scss'

interface Props {
  showActorId?: boolean
  showActions?: boolean
  currentTime: Date
  statuses: Status[]
  onReply?: (status: Status) => void
  onPostDeleted?: (status: Status) => void
}

export const Posts: FC<Props> = ({
  showActorId = false,
  showActions = false,
  currentTime,
  statuses,
  onReply,
  onPostDeleted
}) => {
  const [modalMedia, setModalMedia] = useState<Attachment>()

  if (statuses.length === 0) return null

  return (
    <section className={cn('w-full', 'grid', 'grid-cols-1', 'mt-4')}>
      {statuses.map((status, index) => (
        <div key={`${index}-${status.id}`} className={cn(styles.block)}>
          <Post
            showActorId={showActorId}
            currentTime={currentTime}
            status={status}
            showActions={showActions}
            onReply={onReply}
            onPostDeleted={onPostDeleted}
            onShowAttachment={(attachment: Attachment) =>
              setModalMedia(attachment)
            }
          />
        </div>
      ))}
      <Modal
        isOpen={Boolean(modalMedia)}
        onRequestClose={() => setModalMedia(undefined)}
      >
        <Media
          showVideoControl
          className={cn(styles.media)}
          attachment={modalMedia}
        />
      </Modal>
    </section>
  )
}

import cn from 'classnames'
import groupBy from 'lodash/groupBy'
import { FC, useState } from 'react'
import ReactModal from 'react-modal'

import { Attachment } from '../../models/attachment'
import { Status } from '../../models/status'
import { Actor } from './Actor'
import { Media } from './Media'
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
  const [modalMedia, setModalMedia] = useState<Attachment>()

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
            onShowAttachment={(attachment: Attachment) =>
              setModalMedia(attachment)
            }
          />
        </div>
      ))}
      <ReactModal
        overlayClassName={styles.modalOverlay}
        className={cn(styles.modal)}
        isOpen={Boolean(modalMedia)}
        onRequestClose={() => setModalMedia(undefined)}
      >
        <Media
          showVideoControl
          className={cn(styles.selectedMedia)}
          attachment={modalMedia}
        />
      </ReactModal>
    </section>
  )
}

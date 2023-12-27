'use client'

import cn from 'classnames'
import { FC, useState } from 'react'

import { ActorProfile } from '../../models/actor'
import { AttachmentData } from '../../models/attachment'
import { EditableStatusData, StatusData } from '../../models/status'
import { Modal } from '../Modal'
import { Media } from './Media'
import { Post } from './Post'
import styles from './Posts.module.scss'

interface Props {
  className?: string
  currentActor?: ActorProfile
  showActions?: boolean
  currentTime: Date
  statuses: StatusData[]
  onReply?: (status: StatusData) => void
  onEdit?: (status: EditableStatusData) => void
  onPostDeleted?: (status: StatusData) => void
}

export const Posts: FC<Props> = ({
  className,
  currentActor,
  showActions = false,
  currentTime,
  statuses,
  onReply,
  onEdit,
  onPostDeleted
}) => {
  const [modalMedia, setModalMedia] = useState<AttachmentData>()

  if (statuses.length === 0) return null

  return (
    <section className={cn('w-full', 'grid', 'grid-cols-1', className)}>
      {statuses.map((status, index) => (
        <div key={`${index}-${status.id}`} className={cn(styles.block)}>
          <Post
            currentTime={currentTime}
            currentActor={currentActor}
            status={status}
            showActions={showActions}
            showDeleteAction={currentActor?.id === status.actorId}
            onReply={onReply}
            onEdit={onEdit}
            onPostDeleted={onPostDeleted}
            onShowAttachment={(attachment: AttachmentData) =>
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

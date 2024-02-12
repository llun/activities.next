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
  host: string
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
  host,
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
            host={host}
            currentTime={currentTime}
            currentActor={currentActor}
            status={status}
            showActions={showActions}
            editable={currentActor?.id === status.actorId}
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

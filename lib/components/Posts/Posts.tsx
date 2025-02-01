'use client'

import cn from 'classnames'
import { FC, useState } from 'react'

import { ActorProfile } from '../../models/actor'
import { AttachmentData } from '../../models/attachment'
import { EditableStatus, Status } from '../../models/status'
import { MediasModal } from '../MediasModal'
import { Post } from './Post'
import styles from './Posts.module.scss'

interface Props {
  host: string
  className?: string
  currentActor?: ActorProfile
  showActions?: boolean
  currentTime: Date
  statuses: Status[]
  onReply?: (status: Status) => void
  onEdit?: (status: EditableStatus) => void
  onPostDeleted?: (status: Status) => void
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
  const [modalMedias, setModalMedias] = useState<{
    medias: AttachmentData[]
    initialSelection: number
  } | null>(null)

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
            onShowAttachment={(allMedias, index) => {
              setModalMedias({ medias: allMedias, initialSelection: index })
            }}
          />
        </div>
      ))}
      <MediasModal
        medias={modalMedias?.medias ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        onClosed={() => setModalMedias(null)}
      />
    </section>
  )
}

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
  const [modalMedias, setModalMedias] = useState<AttachmentData[] | null>(null)
  const [modalSelection, setModalSelection] = useState<number>(0)

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
              setModalMedias(allMedias)
              setModalSelection(index)
            }}
          />
        </div>
      ))}
      <Modal
        className={styles.modal}
        isOpen={Boolean(modalMedias)}
        onRequestClose={() => {
          setModalMedias(null)
          setModalSelection(0)
        }}
      >
        <div
          className={styles.mediasContent}
          onClick={() => {
            setModalMedias(null)
            setModalSelection(0)
          }}
        >
          {modalMedias?.length && modalMedias?.length > 1 && (
            <div className={styles.mediasSelection}>
              {modalMedias?.map((media, index) => (
                <img
                  key={media.id}
                  src={media.url}
                  width={50}
                  height={50}
                  onClick={(event) => {
                    event.stopPropagation()
                    setModalSelection(index)
                  }}
                />
              ))}
            </div>
          )}
          <Media
            showVideoControl
            className={cn(styles.media)}
            attachment={modalMedias?.[modalSelection]}
          />
        </div>
      </Modal>
    </section>
  )
}

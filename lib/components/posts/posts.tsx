'use client'

import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { cn } from '@/lib/utils'
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'

import { ActorProfile } from '../../models/actor'
import { Attachment } from '../../models/attachment'
import { EditableStatus, Status } from '../../models/status'
import { MediasModal } from '../medias-modal/medias-modal'
import { Post } from './post'
import { StatusReplyBox } from './status-reply-box'

interface Props {
  host: string
  className?: string
  currentActor?: ActorProfile
  showActions?: boolean
  currentTime: Date
  statuses: Status[]
  isMediaUploadEnabled?: boolean
  onReply?: (status: Status) => void
  onReplyCreated?: (status: Status, attachments: Attachment[]) => void
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
  isMediaUploadEnabled,
  onReply,
  onReplyCreated,
  onEdit,
  onPostDeleted
}) => {
  const router = useRouter()
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    initialSelection: number
  } | null>(null)
  const [replyingToStatusId, setReplyingToStatusId] = useState<string | null>(
    null
  )

  if (statuses.length === 0) return null

  const handleReply = (status: Status) => {
    if (currentActor && onReplyCreated) {
      // Use inline reply box
      setReplyingToStatusId(status.id)
    } else if (onReply) {
      // Fall back to old behavior
      onReply(status)
    }
  }

  const handleReplyCreated = (status: Status, attachments: Attachment[]) => {
    setReplyingToStatusId(null)
    onReplyCreated?.(status, attachments)
  }

  const handleCancelReply = () => {
    setReplyingToStatusId(null)
  }

  return (
    <section className={cn('w-full grid grid-cols-1', className)}>
      {statuses.map((status, index) => (
        <article
          key={`${index}-${status.id}`}
          className="border-b border-border/60 p-4 last:border-b-0"
        >
          <div
            className="cursor-pointer transition-colors hover:bg-muted/40 -m-4 p-4"
            onClick={() => {
              const detailPath = getStatusDetailPath(status)
              if (detailPath) router.push(detailPath)
            }}
          >
            <Post
              host={host}
              currentTime={currentTime}
              currentActor={currentActor}
              status={status}
              showActions={showActions}
              editable={currentActor?.id === status.actorId}
              onReply={handleReply}
              onEdit={onEdit}
              onPostDeleted={onPostDeleted}
              onShowAttachment={(allMedias, index) => {
                setModalMedias({ medias: allMedias, initialSelection: index })
              }}
            />
          </div>
          {replyingToStatusId === status.id && currentActor && (
            <div onClick={(e) => e.stopPropagation()}>
              <StatusReplyBox
                profile={currentActor}
                replyStatus={status}
                isMediaUploadEnabled={isMediaUploadEnabled}
                onCancel={handleCancelReply}
                onPostCreated={handleReplyCreated}
              />
            </div>
          )}
        </article>
      ))}
      <MediasModal
        medias={modalMedias?.medias ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        onClosed={() => setModalMedias(null)}
      />
    </section>
  )
}

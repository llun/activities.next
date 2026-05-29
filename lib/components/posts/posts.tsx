'use client'

import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  EditableStatus,
  Status,
  StatusNote,
  StatusPoll
} from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import { Post } from './post'
import { StatusReplyBox } from './status-reply-box'

interface Props {
  host: string
  className?: string
  /**
   * When true (default) the feed renders as a self-contained bordered card
   * (the merged-feed box). Set to false to render only the divided rows so the
   * feed can be embedded inside an existing card (e.g. the search results card).
   */
  framed?: boolean
  currentActor?: ActorProfile
  showActions?: boolean
  currentTime: number
  statuses: Status[]
  isMediaUploadEnabled?: boolean
  postLineLimit?: PostLineLimit
  onReply?: (status: Status) => void
  onReplyCreated?: (status: Status, attachments: Attachment[]) => void
  onEdit?: (status: EditableStatus) => void
  onPostDeleted?: (status: Status) => void
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => void
}

export const Posts: FC<Props> = ({
  host,
  className,
  framed = true,
  currentActor,
  showActions = false,
  currentTime,
  statuses,
  isMediaUploadEnabled,
  postLineLimit,
  onReply,
  onReplyCreated,
  onEdit,
  onPostDeleted,
  onBookmarkChanged
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

  const openStatus = (status: Status) => {
    void (async () => {
      const detailPath = await getStatusDetailPathClient(status)
      if (detailPath) router.push(detailPath)
    })()
  }

  return (
    <>
      <section
        className={cn(
          // `divide-border` keeps the hairlines on the theme border color in
          // dark mode. No `overflow-hidden`: posts render non-portaled overlays
          // (edit-history panel, inline error bubbles) that must escape the box.
          'w-full min-w-0 divide-y divide-border',
          framed && 'rounded-xl border bg-card shadow-sm',
          className
        )}
      >
        {statuses.map((status) => (
          <article key={status.id} className="min-w-0 px-4 py-3">
            <Post
              host={host}
              currentTime={currentTime}
              currentActor={currentActor}
              status={status}
              showActions={showActions}
              editable={currentActor?.id === status.actorId}
              collapsible
              postLineLimit={postLineLimit}
              onReply={handleReply}
              onEdit={onEdit}
              onPostDeleted={onPostDeleted}
              onBookmarkChanged={onBookmarkChanged}
              onOpenStatus={openStatus}
              onShowAttachment={(allMedias, index) => {
                setModalMedias({ medias: allMedias, initialSelection: index })
              }}
            />
            {replyingToStatusId === status.id && currentActor && (
              <StatusReplyBox
                profile={currentActor}
                replyStatus={status}
                isMediaUploadEnabled={isMediaUploadEnabled}
                onCancel={handleCancelReply}
                onPostCreated={handleReplyCreated}
              />
            )}
          </article>
        ))}
      </section>
      <MediasModal
        medias={modalMedias?.medias ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        onClosed={() => setModalMedias(null)}
      />
    </>
  )
}

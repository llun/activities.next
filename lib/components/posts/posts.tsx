'use client'

import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import { InlineStatusComposer } from './inline-status-composer'
import { Post } from './post'
import { useInlineComposer } from './useInlineComposer'

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
  /**
   * Render non-interactive engagement counts (reply/boost/like) under each post
   * instead of action buttons. For read-only previews like the logged-out
   * landing feed. Ignored when `showActions` is on.
   */
  showReadOnlyStats?: boolean
  currentTime: number
  statuses: Status[]
  isMediaUploadEnabled?: boolean
  postLineLimit?: PostLineLimit
  /**
   * A reply or quote composed inline produced a new status. Surfaces that own
   * this feed can prepend it (e.g. the home timeline); others may ignore it.
   * The shared composer closes itself either way, so this is data-sync only.
   */
  onStatusCreated?: (status: Status) => void
  /** An inline edit updated a status already present in this feed. */
  onPostUpdated?: (status: Status) => void
  onPostDeleted?: (status: Status) => void
  onBookmarkChanged?: (
    status: StatusNote | StatusPoll,
    isBookmarked: boolean
  ) => void
  onLikeChanged?: (status: StatusNote | StatusPoll, isLiked: boolean) => void
}

export const Posts: FC<Props> = ({
  host,
  className,
  framed = true,
  currentActor,
  showActions = false,
  showReadOnlyStats = false,
  currentTime,
  statuses,
  isMediaUploadEnabled,
  postLineLimit,
  onStatusCreated,
  onPostUpdated,
  onPostDeleted,
  onBookmarkChanged,
  onLikeChanged
}) => {
  const router = useRouter()
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    initialSelection: number
  } | null>(null)
  // Reply/quote/edit share one inline composer owned here, so every surface
  // that renders <Posts> offers the identical action set without re-wiring it.
  const composer = useInlineComposer()

  if (statuses.length === 0) return null

  const openStatus = (status: Status) => {
    void (async () => {
      const detailPath = await getStatusDetailPathClient(status)
      if (detailPath) router.push(detailPath)
    })()
  }

  // Authoring actions require a signed-in actor and an interactive feed. When
  // either is missing (logged-out landing feed, admin read-only view) the
  // action row is hidden anyway, so leaving the handlers off keeps it inert.
  const canCompose = Boolean(currentActor) && showActions

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
        {statuses.map((status) => {
          const actualStatus = getActualStatus(status)
          // Anchor on the wrapper row id (unique per row), not the unwrapped
          // target id, so a boost and its original — or two boosts of the same
          // post — don't both open a composer.
          const activeComposer =
            currentActor && composer.active?.anchorId === status.id
              ? composer.active
              : null
          return (
            <article
              key={status.id}
              className={cn(
                'min-w-0 px-4 py-3',
                // Match the framed box's corners so any child background can't
                // bleed past the rounded edges now that overflow-hidden is gone.
                framed && 'first:rounded-t-xl last:rounded-b-xl'
              )}
            >
              <Post
                host={host}
                currentTime={currentTime}
                currentActor={currentActor}
                status={status}
                showActions={showActions}
                showReadOnlyStats={showReadOnlyStats}
                editable={currentActor?.id === actualStatus.actorId}
                collapsible
                postLineLimit={postLineLimit}
                onReply={
                  canCompose
                    ? (target) => composer.openReply(target, status.id)
                    : undefined
                }
                onEdit={
                  canCompose
                    ? (target) => composer.openEdit(target, status.id)
                    : undefined
                }
                onQuote={
                  canCompose
                    ? (target) => composer.openQuote(target, status.id)
                    : undefined
                }
                onPostDeleted={onPostDeleted}
                onBookmarkChanged={onBookmarkChanged}
                onLikeChanged={onLikeChanged}
                onOpenStatus={openStatus}
                onShowAttachment={(allMedias, index) => {
                  setModalMedias({ medias: allMedias, initialSelection: index })
                }}
              />
              {activeComposer && currentActor ? (
                <InlineStatusComposer
                  key={`${activeComposer.mode}-${activeComposer.anchorId}`}
                  host={host}
                  profile={currentActor}
                  mode={activeComposer.mode}
                  status={activeComposer.status}
                  isMediaUploadEnabled={isMediaUploadEnabled}
                  onCancel={composer.close}
                  onCreated={onStatusCreated}
                  onUpdated={onPostUpdated}
                />
              ) : null}
            </article>
          )
        })}
      </section>
      <MediasModal
        medias={modalMedias?.medias ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        onClosed={() => setModalMedias(null)}
      />
    </>
  )
}

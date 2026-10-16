'use client'

import { useRouter } from 'next/navigation'
import { FC, useCallback, useMemo, useState } from 'react'

import { getAlbumsOwnerId } from '@/lib/components/gallery/mediaAlbumsUi'
import { OwnPostMediasModal } from '@/lib/components/medias-modal/own-post-medias-modal'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import { cn } from '@/lib/utils'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import { getPrioritizedAttachment } from './attachments'
import { MOBILE_FEED_SURFACE_CLASS, POST_LIST_FRAME_CLASS } from './feedLayout'
import { PostListItem } from './post-list-item'
import { useInlineComposer } from './useInlineComposer'

interface Props {
  host: string
  className?: string
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
  onReactionsChanged?: (
    status: StatusNote | StatusPoll,
    reactions: StatusReaction[]
  ) => void
}

// Rows past this are below the fold on any viewport, so they never get the
// first-visible-media priority.
const PRIORITY_ROW_WINDOW = 3

/**
 * The row whose first picture should load at high priority: the first of the
 * list's first rows whose post shows an ordinary image outright. Content
 * warning posts keep their media collapsed, so they are skipped.
 */
export const getPrioritizedRowIndex = (statuses: Status[]) =>
  statuses.slice(0, PRIORITY_ROW_WINDOW).findIndex((status) => {
    const actual = getActualStatus(status)
    return (
      actual.type === StatusType.enum.Note &&
      !actual.summary?.trim() &&
      getPrioritizedAttachment(actual.attachments) !== undefined
    )
  })

export const Posts: FC<Props> = ({
  host,
  className,
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
  onLikeChanged,
  onReactionsChanged
}) => {
  const router = useRouter()
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    tags?: Tag[]
    initialSelection: number
    /** The viewer's actor id when the post is their own (the albums pill). */
    albumsOwnerId: string | null
  } | null>(null)
  // Reply/quote/edit share one inline composer owned here, so every surface
  // that renders <Posts> offers the identical action set without re-wiring it.
  const composer = useInlineComposer(Boolean(currentActor))

  // Stable so memoized rows don't re-render when this list's state changes.
  const openStatus = useCallback(
    (status: Status) => {
      void (async () => {
        const detailPath = await getStatusDetailPathClient(status)
        if (detailPath) router.push(detailPath)
      })()
    },
    [router]
  )
  const showMedia = useCallback(
    (
      medias: Attachment[],
      index: number,
      actualStatus: StatusNote | StatusPoll
    ) => {
      setModalMedias({
        medias,
        tags: actualStatus.tags,
        initialSelection: index,
        albumsOwnerId: getAlbumsOwnerId(currentActor, actualStatus)
      })
    },
    [currentActor]
  )

  const prioritizedRowIndex = useMemo(
    () => getPrioritizedRowIndex(statuses),
    [statuses]
  )

  if (statuses.length === 0) return null

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
          POST_LIST_FRAME_CLASS,
          MOBILE_FEED_SURFACE_CLASS,
          className
        )}
      >
        {statuses.map((status, index) => (
          <PostListItem
            key={status.id}
            className="first:rounded-t-lg last:rounded-b-lg"
            status={status}
            prioritizeMedia={index === prioritizedRowIndex}
            host={host}
            currentTime={currentTime}
            currentActor={currentActor}
            showActions={showActions}
            showReadOnlyStats={showReadOnlyStats}
            postLineLimit={postLineLimit}
            canCompose={canCompose}
            // Anchor on the wrapper row id (unique per row), not the unwrapped
            // target id, so a boost and its original — or two boosts of the
            // same post — don't both open a composer.
            activeComposer={
              currentActor && composer.active?.anchorId === status.id
                ? composer.active
                : null
            }
            isMediaUploadEnabled={isMediaUploadEnabled}
            openReply={composer.openReply}
            openQuote={composer.openQuote}
            openEdit={composer.openEdit}
            close={composer.close}
            onOpenStatus={openStatus}
            onShowMedia={showMedia}
            onStatusCreated={onStatusCreated}
            onPostUpdated={onPostUpdated}
            onPostDeleted={onPostDeleted}
            onBookmarkChanged={onBookmarkChanged}
            onLikeChanged={onLikeChanged}
            onReactionsChanged={onReactionsChanged}
          />
        ))}
      </section>
      <OwnPostMediasModal
        medias={modalMedias?.medias ?? null}
        tags={modalMedias?.tags ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        albumsOwnerId={modalMedias?.albumsOwnerId}
        onClosed={() => setModalMedias(null)}
      />
    </>
  )
}

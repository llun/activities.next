'use client'

import { Copy, Heart, MessageCircle, Repeat2, Video } from 'lucide-react'
import { FC, useEffect, useMemo, useState } from 'react'

import { getActorMedia } from '@/lib/client'
import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { Media } from '@/lib/components/posts/media'
import { Button } from '@/lib/components/ui/button'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

const compactNumberFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1
})

export const formatCount = (count: number): string =>
  compactNumberFormatter.format(count)

interface Props {
  actorId: string
  initialAttachments: Attachment[]
  statuses?: Status[]
  isPixelfed?: boolean
  isMediaOnly?: boolean
  className?: string
}

export const ActorMediaGallery: FC<Props> = ({
  actorId,
  initialAttachments,
  statuses,
  isPixelfed = false,
  isMediaOnly = false,
  className
}) => {
  const isMediaStream = isPixelfed || isMediaOnly
  const [modalIndex, setModalIndex] = useState<number | null>(null)
  const [attachments, setAttachments] =
    useState<Attachment[]>(initialAttachments)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(initialAttachments.length >= 25)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isMediaStream && statuses && statuses.length > 0) {
      const derived = statuses.flatMap((s) =>
        s.type === StatusType.enum.Note ? s.attachments : []
      )
      if (derived.length > 0) {
        setAttachments(derived)
      }
    } else if (initialAttachments.length > 0) {
      setAttachments(initialAttachments)
    }
  }, [isMediaStream, statuses, initialAttachments])

  const statusMap = useMemo(() => {
    const map = new Map<string, StatusNote>()
    if (statuses) {
      for (const status of statuses) {
        if (status.type === StatusType.enum.Note) {
          map.set(status.id, status)
          if (status.url) {
            map.set(status.url, status)
          }
        }
      }
    }
    return map
  }, [statuses])

  const handleLoadMore = async () => {
    setIsLoadingMore(true)
    setError(null)
    try {
      const maxCreatedAt = attachments[attachments.length - 1]?.createdAt
      const newAttachments = await getActorMedia({
        actorId,
        maxCreatedAt,
        limit: 25
      })
      setAttachments([...attachments, ...newAttachments])
      setHasMore(newAttachments.length >= 25)
    } catch {
      setError('Failed to load more media. Please try again.')
    } finally {
      setIsLoadingMore(false)
    }
  }

  return (
    <>
      <div
        className={cn(
          'rounded-xl border bg-card p-1 shadow-sm sm:p-2',
          className
        )}
      >
        <div className="grid grid-cols-3 gap-1 sm:gap-2">
          {attachments.map((attachment, index) => {
            const parentStatus = statusMap.get(attachment.statusId)
            const totalLikes = parentStatus?.totalLikes ?? 0
            const totalShares = parentStatus?.totalShares ?? 0
            const totalReplies =
              parentStatus?.totalReplies ?? parentStatus?.replies.length ?? 0
            const attachmentCount = parentStatus?.attachments.length ?? 1
            const isVideo =
              attachment.mediaType.startsWith('video') ||
              attachment.url.endsWith('.mp4') ||
              attachment.url.endsWith('.webm')

            return (
              <button
                key={attachment.id}
                type="button"
                className="group relative aspect-square overflow-hidden bg-muted/20 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                onClick={() => setModalIndex(index)}
                aria-label={
                  attachment.name
                    ? `Open media: ${attachment.name}`
                    : `Open media ${index + 1}`
                }
              >
                <Media
                  attachment={attachment}
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                />

                {/* Multiple attachments badge */}
                {attachmentCount > 1 ? (
                  <span
                    className="pointer-events-none absolute top-1.5 right-1.5 z-10 flex items-center rounded bg-black/60 p-1 text-white shadow-sm backdrop-blur-xs"
                    aria-label="Multiple items"
                    data-testid="album-indicator"
                  >
                    <Copy className="size-3.5 sm:size-4" aria-hidden="true" />
                  </span>
                ) : isVideo ? (
                  <span
                    className="pointer-events-none absolute top-1.5 right-1.5 z-10 flex items-center rounded bg-black/60 p-1 text-white shadow-sm backdrop-blur-xs"
                    aria-label="Video"
                    data-testid="video-indicator"
                  >
                    <Video className="size-3.5 sm:size-4" aria-hidden="true" />
                  </span>
                ) : null}

                {/* Alt text badge */}
                {attachment.name?.trim() ? (
                  <span
                    className="pointer-events-none absolute bottom-1.5 left-1.5 z-10 flex items-center rounded bg-black/60 px-1 py-0.5 text-[10px] font-semibold text-white shadow-sm backdrop-blur-xs"
                    aria-hidden="true"
                  >
                    ALT
                  </span>
                ) : null}

                {/* Engagement counts overlay on hover/focus */}
                <div
                  className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
                  data-testid={`media-overlay-${attachment.id}`}
                >
                  <div className="flex flex-wrap items-center justify-center gap-3 px-2 text-white font-semibold text-sm sm:gap-4 sm:text-base">
                    <span
                      className="flex items-center gap-1.5"
                      title={`${totalLikes} favorites`}
                    >
                      <Heart
                        className="size-4 sm:size-5 fill-white text-white"
                        aria-hidden="true"
                      />
                      <span>{formatCount(totalLikes)}</span>
                    </span>
                    <span
                      className="flex items-center gap-1.5"
                      title={`${totalReplies} comments`}
                    >
                      <MessageCircle
                        className="size-4 sm:size-5 fill-white text-white"
                        aria-hidden="true"
                      />
                      <span>{formatCount(totalReplies)}</span>
                    </span>
                    <span
                      className="flex items-center gap-1.5"
                      title={`${totalShares} reposts`}
                    >
                      <Repeat2
                        className="size-4 sm:size-5 text-white"
                        aria-hidden="true"
                      />
                      <span>{formatCount(totalShares)}</span>
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="mt-4 p-4 text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {!isMediaStream && hasMore && (
        <div className="mt-4 text-center">
          <Button
            variant="outline"
            disabled={isLoadingMore}
            onClick={handleLoadMore}
          >
            {isLoadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}

      <MediasModal
        medias={modalIndex === null ? null : attachments}
        initialSelection={modalIndex ?? 0}
        onClosed={() => setModalIndex(null)}
      />
    </>
  )
}

'use client'

import { FC, useState } from 'react'

import { getActorMedia } from '@/lib/client'
import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { Media } from '@/lib/components/posts/media'
import { Button } from '@/lib/components/ui/button'
import { Attachment } from '@/lib/models/attachment'

interface Props {
  actorId: string
  initialAttachments: Attachment[]
}

export const ActorMediaGallery: FC<Props> = ({
  actorId,
  initialAttachments
}) => {
  const [modalIndex, setModalIndex] = useState<number | null>(null)
  const [attachments, setAttachments] =
    useState<Attachment[]>(initialAttachments)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(initialAttachments.length >= 25)
  const [error, setError] = useState<string | null>(null)

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
    } catch (err) {
      setError('Failed to load more media. Please try again.')
      console.error('Failed to load more media:', err)
    } finally {
      setIsLoadingMore(false)
    }
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1 sm:gap-2">
        {attachments.map((attachment, index) => (
          <button
            key={attachment.id}
            type="button"
            className="group relative aspect-square overflow-hidden bg-muted/20"
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
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 p-4 text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {hasMore && (
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

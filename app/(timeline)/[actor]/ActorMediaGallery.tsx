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
  const [attachments, setAttachments] = useState<Attachment[]>(
    initialAttachments
  )
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const handleLoadMore = async () => {
    setIsLoadingMore(true)
    try {
      const maxId = attachments[attachments.length - 1]?.id
      const newAttachments = await getActorMedia({
        actorId,
        maxId,
        limit: 25
      })
      setAttachments([...attachments, ...newAttachments])
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

      {attachments.length > 0 && attachments.length % 25 === 0 && (
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

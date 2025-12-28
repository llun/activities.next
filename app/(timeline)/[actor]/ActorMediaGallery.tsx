'use client'

import { FC, useState } from 'react'

import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { Media } from '@/lib/components/posts/media'
import { Attachment } from '@/lib/models/attachment'

interface Props {
  attachments: Attachment[]
}

export const ActorMediaGallery: FC<Props> = ({ attachments }) => {
  const [modalIndex, setModalIndex] = useState<number | null>(null)

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

      <MediasModal
        medias={modalIndex === null ? null : attachments}
        initialSelection={modalIndex ?? 0}
        onClosed={() => setModalIndex(null)}
      />
    </>
  )
}

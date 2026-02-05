'use client'

import { FC, useState } from 'react'

import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import type { Attachment } from '@/lib/types/domain/attachment'

interface Props {
  actorId: string
  imageUrl: string | null
}

export const ProfileHeaderImage: FC<Props> = ({ actorId, imageUrl }) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  const headerMedia: Attachment[] | null = imageUrl
    ? [
        {
          id: `profile-header-${actorId}`,
          actorId,
          statusId: `profile-header-${actorId}`,
          type: 'Document',
          mediaType: 'image/jpeg',
          url: imageUrl,
          name: 'Profile header image',
          createdAt: 0,
          updatedAt: 0
        }
      ]
    : null

  return (
    <div className="relative h-36 bg-muted md:h-52">
      {imageUrl && (
        <button
          type="button"
          className="block h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onClick={() => setIsPreviewOpen(true)}
          aria-label="Open profile header image preview"
        >
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        </button>
      )}

      <MediasModal
        medias={isPreviewOpen ? headerMedia : null}
        initialSelection={0}
        onClosed={() => setIsPreviewOpen(false)}
      />
    </div>
  )
}

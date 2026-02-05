'use client'

import { FC, useMemo, useState } from 'react'

import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import type { Attachment } from '@/lib/types/domain/attachment'

interface Props {
  actorId: string
  imageUrl: string | null
  mediaType: string | null
}

const inferImageMediaType = (url: string) => {
  try {
    const pathname = new URL(url, 'http://localhost').pathname.toLowerCase()
    if (pathname.endsWith('.png')) return 'image/png'
    if (pathname.endsWith('.gif')) return 'image/gif'
    if (pathname.endsWith('.webp')) return 'image/webp'
    if (pathname.endsWith('.avif')) return 'image/avif'
    if (pathname.endsWith('.svg')) return 'image/svg+xml'
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg'))
      return 'image/jpeg'
  } catch {
    return 'image/*'
  }

  return 'image/*'
}

export const ProfileHeaderImage: FC<Props> = ({
  actorId,
  imageUrl,
  mediaType
}) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  const headerMedia = useMemo<Attachment[] | null>(() => {
    if (!imageUrl) return null

    return [
      {
        id: `profile-header-${actorId}`,
        actorId,
        statusId: `profile-header-${actorId}`,
        type: 'Document',
        mediaType: mediaType ?? inferImageMediaType(imageUrl),
        url: imageUrl,
        name: 'Profile header image',
        createdAt: 0,
        updatedAt: 0
      }
    ]
  }, [actorId, imageUrl, mediaType])

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

'use client'

import { FC } from 'react'

import { Media } from '@/lib/components/posts/media'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

interface Props {
  item: GalleryItemEntity
  className?: string
  loading?: 'lazy' | 'eager'
}

/** A gallery item as a cover-fitted square thumbnail (the still of a video). */
export const GalleryAlbumThumb: FC<Props> = ({
  item,
  className,
  loading = 'lazy'
}) => (
  <Media
    attachment={
      item.attachment.thumbnailUrl
        ? {
            ...item.attachment,
            mediaType: 'image/jpeg',
            url: item.attachment.thumbnailUrl
          }
        : item.attachment
    }
    loading={loading}
    className={cn('h-full w-full object-cover', className)}
  />
)

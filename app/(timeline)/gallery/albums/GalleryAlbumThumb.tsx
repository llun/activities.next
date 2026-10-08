'use client'

import { FC } from 'react'

import { Media } from '@/lib/components/posts/media'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

interface Props {
  item: GalleryItemEntity
  className?: string
  loading?: 'lazy' | 'eager'
  /**
   * `full` shows the full-size picture of a still image, for a large cover (the
   * stored thumbnail is small and goes soft when stretched). A video, an
   * animation or a media with no still keeps its thumbnail.
   */
  quality?: 'thumbnail' | 'full'
}

const FULL_SIZE_TYPES = /^image\/(?!gif$)/

/** A gallery item as a cover-fitted square thumbnail (the still of a video). */
export const GalleryAlbumThumb: FC<Props> = ({
  item,
  className,
  loading = 'lazy',
  quality = 'thumbnail'
}) => (
  <Media
    attachment={
      item.attachment.thumbnailUrl &&
      !(quality === 'full' && FULL_SIZE_TYPES.test(item.attachment.mediaType))
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

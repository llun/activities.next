'use client'

import { Video } from 'lucide-react'
import { FC, useState } from 'react'

import { formatGalleryDate } from '@/lib/components/gallery/galleryCategories'
import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { Media } from '@/lib/components/posts/media'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

interface Props {
  items: GalleryItemEntity[]
  /** Show the subject and capture date under each tile. */
  showCaption?: boolean
  className?: string
}

const isVideo = (item: GalleryItemEntity) =>
  item.attachment.mediaType.startsWith('video') ||
  /\.(mp4|webm|m3u8)(?:[?#]|$)/i.test(item.attachment.url)

// The media type is part of the button's own name: a badge inside a labelled
// button is never announced.
const itemLabel = (item: GalleryItemEntity, index: number) => {
  const noun = isVideo(item) ? 'video' : 'media'
  const alt = item.attachment.name?.trim()
  if (alt) return `Open ${noun}: ${alt}`
  if (item.subject?.name) return `Open ${noun}: ${item.subject.name}`
  return `Open ${noun} ${index + 1}`
}

/**
 * A square grid of gallery photos and videos. A tile opens `MediasModal` over
 * the whole list, which lazily fetches each photo's public details by media id.
 */
export const GalleryGrid: FC<Props> = ({
  items,
  showCaption = false,
  className
}) => {
  const [modalIndex, setModalIndex] = useState<number | null>(null)

  return (
    <>
      <ul
        className={cn(
          'grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2',
          className
        )}
      >
        {items.map((item, index) => {
          const caption = [item.subject?.name, formatGalleryDate(item.takenAt)]
            .filter(Boolean)
            .join(' · ')
          return (
            <li key={item.mediaId} className="min-w-0">
              <button
                type="button"
                className="group bg-muted/20 focus-visible:outline-primary relative block aspect-square w-full overflow-hidden rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2"
                onClick={() => setModalIndex(index)}
                aria-label={itemLabel(item, index)}
              >
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
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                />
                {isVideo(item) ? (
                  <span
                    className="pointer-events-none absolute top-1.5 right-1.5 flex items-center rounded bg-black/60 p-1 text-white"
                    aria-hidden="true"
                  >
                    <Video className="size-3.5" aria-hidden="true" />
                  </span>
                ) : null}
              </button>
              {showCaption && caption ? (
                <p className="text-muted-foreground mt-1 truncate text-xs">
                  {caption}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>

      <MediasModal
        medias={
          modalIndex === null ? null : items.map((item) => item.attachment)
        }
        initialSelection={modalIndex ?? 0}
        onClosed={() => setModalIndex(null)}
      />
    </>
  )
}

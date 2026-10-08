'use client'

import { Folder, Lock } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { Badge } from '@/lib/components/ui/badge'
import type { GalleryAlbumCardEntity } from '@/lib/services/gallery/galleryAlbumEntities'
import { cn } from '@/lib/utils'

import { GalleryAlbumThumb } from './GalleryAlbumThumb'
import { getAlbumCardMeta } from './galleryAlbumsUi'

interface Props {
  album: GalleryAlbumCardEntity
}

// One tile fills the cover; two put the second one in a full-height column;
// three are the cover and two stacked squares.
const getTileClassNames = (count: number): string[] => {
  if (count <= 1) return ['col-span-3 row-span-2']
  if (count === 2) return ['col-span-2 row-span-2', 'col-span-1 row-span-2']
  return ['col-span-2 row-span-2', 'col-span-1', 'col-span-1']
}

export const GalleryAlbumCard: FC<Props> = ({ album }) => {
  const tiles = album.previews.slice(0, 3)
  const tileClassNames = getTileClassNames(tiles.length)

  return (
    <Link
      // Per-row links to per-user pages: no prefetch for every card.
      href={`/gallery/albums/${encodeURIComponent(album.id)}`}
      prefetch={false}
      className="group focus-visible:outline-primary block min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <div
        className={cn(
          'bg-muted/40 grid aspect-[3/2] grid-cols-3 grid-rows-2 gap-0.5 overflow-hidden rounded-lg border'
        )}
      >
        {tiles.length === 0 ? (
          <span
            aria-hidden="true"
            className="text-muted-foreground col-span-3 row-span-2 flex items-center justify-center"
          >
            <Folder className="size-8" />
          </span>
        ) : (
          tiles.map((item, index) => (
            <span
              key={item.mediaId}
              className={cn('block min-h-0 min-w-0', tileClassNames[index])}
            >
              <GalleryAlbumThumb
                item={item}
                className="transition-transform duration-200 group-hover:scale-[1.02]"
              />
            </span>
          ))
        )}
      </div>
      <div className="mt-2 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold group-hover:underline">
            {album.title}
          </h3>
          {album.visibility === 'private' ? (
            <Badge tone="gray" className="shrink-0">
              <Lock className="size-3" aria-hidden="true" />
              Private
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground truncate text-xs">
          {getAlbumCardMeta(album)}
        </p>
      </div>
    </Link>
  )
}

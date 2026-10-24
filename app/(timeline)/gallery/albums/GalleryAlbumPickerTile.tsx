'use client'

import { Check, EyeOff } from 'lucide-react'
import { FC } from 'react'

import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

import { GalleryAlbumThumb } from './GalleryAlbumThumb'
import { getPickerBadges, getPickerCaption } from './galleryAlbumPickerUi'
import { getAlbumTileLabel } from './galleryAlbumsUi'

interface Props {
  item: GalleryItemEntity
  /** Its place in the grid, for the accessible name. */
  index: number
  isSelected: boolean
  /** Already in the album: shown as such and not pickable. */
  isMember?: boolean
  /** Not pickable right now (the album is full). */
  isBlocked?: boolean
  disabled?: boolean
  showCaption?: boolean
  onToggle: (mediaId: string) => void
}

/** One photo of a picker grid: a toggle with a check, or an "In album" badge. */
export const GalleryAlbumPickerTile: FC<Props> = ({
  item,
  index,
  isSelected,
  isMember = false,
  isBlocked = false,
  disabled = false,
  showCaption = false,
  onToggle
}) => {
  const caption = getPickerCaption(item)
  const parts = [
    getAlbumTileLabel(item, index),
    showCaption ? caption : '',
    ...getPickerBadges(item)
  ]
    .filter(Boolean)
    .join(', ')

  const albumCount = item.albumCount ?? 0

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-pressed={isMember ? undefined : isSelected}
        aria-label={
          isMember ? `${parts}, already in the album` : `Select ${parts}`
        }
        disabled={disabled || isMember || isBlocked}
        onClick={() => onToggle(item.mediaId)}
        className={cn(
          'focus-visible:outline-primary bg-muted/20 relative block aspect-square w-full cursor-pointer overflow-hidden rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:cursor-not-allowed',
          isMember ? 'disabled:opacity-60' : 'disabled:opacity-40',
          isSelected && 'ring-primary ring-2 ring-inset'
        )}
      >
        <GalleryAlbumThumb item={item} />
        {isMember ? (
          <span
            aria-hidden="true"
            className="absolute right-1 bottom-1 left-1 flex items-center justify-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white"
          >
            <Check className="size-3 shrink-0" />
            <span className="truncate">In album</span>
          </span>
        ) : (
          <>
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full border border-white/80 bg-black/30 text-white',
                isSelected && 'bg-primary border-primary'
              )}
            >
              {isSelected ? <Check className="size-3.5" /> : null}
            </span>
            {item.inGallery === false ? (
              <span
                aria-hidden="true"
                className="absolute right-1 bottom-1 left-1 flex items-center justify-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white"
              >
                <EyeOff className="size-3 shrink-0" />
                <span className="truncate max-sm:hidden">Not in gallery</span>
              </span>
            ) : null}
          </>
        )}
        {albumCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[11px] text-white"
          >
            <span className="max-sm:hidden">In </span>
            {albumCount}
            <span className="max-sm:hidden">
              {' '}
              {albumCount === 1 ? 'album' : 'albums'}
            </span>
          </span>
        ) : null}
      </button>
      {showCaption && caption ? (
        <p className="text-muted-foreground mt-1 truncate text-xs">{caption}</p>
      ) : null}
    </div>
  )
}

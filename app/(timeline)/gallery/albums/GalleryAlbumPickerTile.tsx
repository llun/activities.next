'use client'

import { Check } from 'lucide-react'
import { FC } from 'react'

import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

import { GalleryAlbumThumb } from './GalleryAlbumThumb'
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
  onToggle
}) => (
  <button
    type="button"
    aria-pressed={isMember ? undefined : isSelected}
    aria-label={
      isMember
        ? `${getAlbumTileLabel(item, index)}, already in the album`
        : `Select ${getAlbumTileLabel(item, index)}`
    }
    disabled={disabled || isMember || isBlocked}
    onClick={() => onToggle(item.mediaId)}
    className={cn(
      'focus-visible:outline-primary bg-muted/20 relative block aspect-square w-full overflow-hidden rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:cursor-not-allowed',
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
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full border border-white/80 bg-black/30 text-white',
          isSelected && 'bg-primary border-primary'
        )}
      >
        {isSelected ? <Check className="size-3.5" /> : null}
      </span>
    )}
  </button>
)

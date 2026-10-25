'use client'

import { Check, EyeOff } from 'lucide-react'
import { FC } from 'react'

import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

import { GalleryAlbumThumb } from './GalleryAlbumThumb'
import {
  getPickerBadges,
  getPickerCaption,
  getPickerTileDate
} from './galleryAlbumPickerUi'
import { getAlbumTileLabel } from './galleryAlbumsUi'

interface Props {
  item: GalleryItemEntity
  /** Its place in the grid (flat, across day groups), for the name and roving. */
  index: number
  isSelected: boolean
  /** Already in the album: shown as such and not pickable. */
  isMember?: boolean
  /** Not pickable right now (the album is full). */
  isBlocked?: boolean
  disabled?: boolean
  showCaption?: boolean
  /** False: the caption and accessible name drop the date (the picker). */
  showCaptionDate?: boolean
  /** Roving tab stop: 0 on the active tile, -1 on the rest. */
  tabIndex?: number
  onFocus?: () => void
  /** The range anchor: a dark ring, whether or not it is selected. */
  isAnchor?: boolean
  onToggle: (mediaId: string, modifiers: { shiftKey: boolean }) => void
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
  showCaptionDate = true,
  tabIndex,
  onFocus,
  isAnchor = false,
  onToggle
}) => {
  const caption = getPickerCaption(item, { date: showCaptionDate })
  const tileDate =
    showCaption && !showCaptionDate ? getPickerTileDate(item) : ''
  const captionForLabel =
    showCaption && showCaptionDate
      ? caption
      : item.attachment.name?.trim() && item.subject?.name
        ? item.subject.name
        : ''
  const parts = [
    getAlbumTileLabel(item, index),
    captionForLabel,
    tileDate,
    ...getPickerBadges(item)
  ]
    .filter(Boolean)
    .join(', ')

  const albumCount = item.albumCount ?? 0
  const notPickable = isMember || isBlocked
  // A shift-modified activation on a not-pickable tile still reaches the
  // host: a range ending on the tile applies up to it (the tile itself
  // stays unpicked), like ranges already skip blocked tiles in the middle.
  const canActivate = (shiftKey: boolean) =>
    !disabled && (!notPickable || shiftKey)

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-pressed={isMember ? undefined : isSelected}
        aria-disabled={notPickable || undefined}
        aria-label={
          isMember ? `${parts}, already in the album` : `Select ${parts}`
        }
        disabled={disabled}
        data-grid-index={index}
        tabIndex={tabIndex}
        onFocus={onFocus}
        onClick={(event) => {
          if (!canActivate(event.shiftKey)) return
          onToggle(item.mediaId, { shiftKey: event.shiftKey })
        }}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault()
            if (event.repeat) return
            if (!canActivate(event.shiftKey)) return
            onToggle(item.mediaId, { shiftKey: event.shiftKey })
          }
        }}
        onKeyUp={(event) => {
          if (event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault()
          }
        }}
        className={cn(
          // The focus outline sits outside the tile in the foreground
          // colour: the inset primary ring already marks a selected tile,
          // and an inset primary outline on top of it is invisible. The
          // pick ring is an inset ring and the anchor ring an offset one,
          // so a selected anchor shows both: the primary band inside, the
          // dark anchor ring outside it.
          'focus-visible:outline-foreground bg-muted/20 relative block aspect-square w-full cursor-pointer scroll-mt-12 overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
          isMember
            ? 'disabled:opacity-60 aria-disabled:opacity-60'
            : 'disabled:opacity-40 aria-disabled:opacity-40',
          isSelected && 'inset-ring-primary inset-ring-2',
          isAnchor &&
            'ring-2 ring-foreground ring-offset-2 ring-offset-background'
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

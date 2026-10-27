'use client'

import { ChevronUp, Folder, Star, X } from 'lucide-react'
import dynamic from 'next/dynamic'
import { type FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { MAX_GALLERY_ALBUM_ITEMS } from '@/lib/types/database/galleryAlbums'
import { cn } from '@/lib/utils'

import { GalleryAlbumThumb } from './GalleryAlbumThumb'

// The sheet is only needed once the owner unfolds the strip on a phone.
const GalleryAlbumPicksSheet = dynamic(
  () =>
    import('./GalleryAlbumPicksSheet').then(
      (module) => module.GalleryAlbumPicksSheet
    ),
  { ssr: false }
)

interface Props {
  selected: string[]
  items: ReadonlyMap<string, GalleryItemEntity>
  starId: string | null
  intent: 'create' | 'add'
  room: number
  onRemove: (id: string) => void
  /** The starred pick; null clears the star (the add intent only). */
  onSetCover: (id: string | null) => void
  onClear: () => void
  disabled?: boolean
}

/** How many picks the strip shows before the "+K" overflow pill. */
export const MAX_STRIP_THUMBS = 5

const formatCount = (count: number) => count.toLocaleString('en-US')

const pickName = (
  items: ReadonlyMap<string, GalleryItemEntity>,
  id: string,
  index: number,
  count: number
) => {
  const subject = items.get(id)?.subject?.name?.trim()
  return subject
    ? `${subject}, photo ${index + 1} of ${count}`
    : `photo ${index + 1} of ${count}`
}

/**
 * The picks strip between the picker and the footer: the count and Clear, the
 * last picks as thumbs with a remove and a cover button each, and on phones a
 * folded line that opens the picks sheet.
 */
export const GalleryAlbumPicksStrip: FC<Props> = ({
  selected,
  items,
  starId,
  intent,
  room,
  onRemove,
  onSetCover,
  onClear,
  disabled = false
}) => {
  const [sheetOpen, setSheetOpen] = useState(false)
  // The sheet stays mounted once unfolded, so Radix can animate it shut.
  const [sheetMounted, setSheetMounted] = useState(false)
  const openSheet = () => {
    setSheetMounted(true)
    setSheetOpen(true)
  }
  const count = selected.length
  const overflow = Math.max(count - MAX_STRIP_THUMBS, 0)
  const thumbStart = Math.max(count - MAX_STRIP_THUMBS, 0)
  const thumbs = selected
    .slice(thumbStart, count)
    .map((id, index) => ({ id, index: thumbStart + index }))
  const line =
    intent === 'add'
      ? room > 0
        ? `${formatCount(count)} selected · room for ${formatCount(room)} more`
        : `${formatCount(count)} selected · album full`
      : `${formatCount(count)} selected · max ${formatCount(
          MAX_GALLERY_ALBUM_ITEMS
        )} per album`

  return (
    <div data-testid="album-picks-strip">
      <div
        data-testid="album-picks-desktop"
        className="hidden flex-col gap-2 sm:flex"
      >
        <div className="flex items-center justify-between gap-2">
          <span role="status" className="text-muted-foreground text-sm">
            {line}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={disabled || count === 0}
            className="text-muted-foreground hover:text-foreground h-8 px-2 text-sm font-normal pointer-coarse:h-11"
          >
            Clear
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          {overflow > 0 ? (
            <button
              type="button"
              aria-label={`Show all ${formatCount(count)} picks`}
              onClick={openSheet}
              disabled={disabled}
              className="cursor-pointer rounded-full border px-2 py-0.5 text-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              +{formatCount(overflow)}
            </button>
          ) : null}
          {thumbs.map(({ id, index }) => {
            const item = items.get(id) ?? null
            const name = pickName(items, id, index, count)
            const isStar = starId === id
            return (
              <div
                key={id}
                className="relative size-[46px] overflow-hidden rounded-md pointer-coarse:size-24"
              >
                {item ? (
                  <GalleryAlbumThumb item={item} />
                ) : (
                  <span
                    aria-hidden="true"
                    className="bg-muted/40 text-muted-foreground flex size-full items-center justify-center"
                  >
                    <Folder className="size-5" />
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${name} from selection`}
                  onClick={() => onRemove(id)}
                  disabled={disabled}
                  className="bg-black/60 text-white absolute top-0.5 right-0.5 flex size-5 cursor-pointer items-center justify-center rounded-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-11"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-pressed={isStar}
                  aria-label={
                    isStar
                      ? `${name[0].toUpperCase()}${name.slice(1)}, is the cover`
                      : `Set ${name}${item?.subject?.name ? ',' : ''} as cover`
                  }
                  onClick={() => {
                    if (!isStar) onSetCover(id)
                    // Add photos: the ★ is a real toggle, so pressing it on
                    // the starred pick clears the star again (the album keeps
                    // its cover). Create always keeps exactly one star.
                    else if (intent === 'add') onSetCover(null)
                  }}
                  disabled={disabled}
                  className="bg-black/60 text-white absolute bottom-0.5 left-0.5 flex size-5 cursor-pointer items-center justify-center rounded-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-11"
                >
                  <Star
                    className={cn('size-3.5', isStar && 'fill-current')}
                    aria-hidden="true"
                  />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <button
        type="button"
        data-testid="album-picks-phone"
        onClick={openSheet}
        disabled={disabled}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm sm:hidden pointer-coarse:min-h-11"
      >
        {formatCount(count)} selected · Show
        <ChevronUp
          className="text-muted-foreground size-4"
          aria-hidden="true"
        />
      </button>

      {sheetMounted ? (
        <GalleryAlbumPicksSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          selected={selected}
          items={items}
          starId={starId}
          intent={intent}
          room={room}
          onRemove={onRemove}
          onSetCover={onSetCover}
          onClear={onClear}
        />
      ) : null}
    </div>
  )
}

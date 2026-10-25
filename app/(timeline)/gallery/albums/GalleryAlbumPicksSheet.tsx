'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Folder, Star, X } from 'lucide-react'
import { type FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle
} from '@/lib/components/ui/dialog'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { MAX_GALLERY_ALBUM_ITEMS } from '@/lib/types/database/galleryAlbums'
import { cn } from '@/lib/utils'

import { GalleryAlbumThumb } from './GalleryAlbumThumb'

export interface GalleryAlbumPicksSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: string[]
  items: ReadonlyMap<string, GalleryItemEntity>
  starId: string | null
  intent: 'create' | 'add'
  room: number
  onRemove: (id: string) => void
  onSetCover: (id: string) => void
  onClear: () => void
}

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
 * The phone's picks sheet: every pick as a tile with the same remove and cover
 * buttons as the desktop strip, opened by the strip's folded line.
 */
export const GalleryAlbumPicksSheet: FC<GalleryAlbumPicksSheetProps> = ({
  open,
  onOpenChange,
  selected,
  items,
  starId,
  intent,
  room,
  onRemove,
  onSetCover,
  onClear
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className="bg-background dark:bg-card data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 motion-reduce:data-[state=open]:slide-in-from-bottom-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-48px)] w-full flex-col rounded-t-2xl border-t shadow-lg duration-200 ease-out outline-none"
      >
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
          <div
            aria-hidden="true"
            className="bg-muted-foreground/30 mx-auto mt-2 h-1 w-9 shrink-0 rounded-full"
          />

          <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={selected.length === 0}
              className="text-muted-foreground hover:text-foreground h-8 px-2 text-sm font-normal pointer-coarse:h-11"
            >
              Clear
            </Button>
            <DialogTitle className="text-base font-semibold">
              {formatCount(selected.length)} selected
            </DialogTitle>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="rounded-lg text-sm font-medium pointer-coarse:h-11"
            >
              Done
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            <div className="grid grid-cols-3 gap-1">
              {selected.map((id, index) => {
                const item = items.get(id) ?? null
                const name = pickName(items, id, index, selected.length)
                const isStar = starId === id
                return (
                  <div
                    key={id}
                    className="relative aspect-square overflow-hidden rounded-md"
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
                      className="bg-black/60 text-white absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-11"
                    >
                      <X className="size-4" aria-hidden="true" />
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
                      }}
                      className="bg-black/60 text-white absolute bottom-1 left-1 flex size-6 cursor-pointer items-center justify-center rounded-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-11"
                    >
                      <Star
                        className={cn('size-4', isStar && 'fill-current')}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="text-muted-foreground shrink-0 border-t px-4 py-3 text-xs">
            {intent === 'add'
              ? `Room for ${formatCount(room)} more · ★ is the cover`
              : `Max ${formatCount(MAX_GALLERY_ALBUM_ITEMS)} per album · ★ is the cover`}
          </div>
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  </Dialog>
)

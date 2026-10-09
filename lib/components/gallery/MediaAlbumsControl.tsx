'use client'

import { ChevronDown, Folder, Loader2, Plus } from 'lucide-react'
import Link from 'next/link'
import { FC, KeyboardEvent, ReactNode, useId, useState } from 'react'

import { GalleryAlbumFormDialog } from '@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog'
import { AlbumUndoToast } from '@/lib/components/gallery/AlbumUndoToast'
import {
  NOT_ADDABLE_HINT,
  getAlbumOptionNames,
  getAlbumsPillLabel
} from '@/lib/components/gallery/mediaAlbumsUi'
import { useMediaAlbums } from '@/lib/components/gallery/useMediaAlbums'
import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/lib/components/ui/popover'
import type { MediaAlbumOptionEntity } from '@/lib/services/gallery/galleryAlbumEntities'
import { cn } from '@/lib/utils'

/**
 * The open menu carries `data-albums-menu`, so the lightbox can leave the arrow
 * keys to it (the menu is portalled out of the lightbox, but its keydowns still
 * reach the lightbox's window listener).
 */
export const ALBUMS_MENU_SELECTOR = '[data-albums-menu]'

interface Props {
  /** The photo's media id (the row id the albums route takes). */
  mediaId: string
  /** The signed-in owner's actor id, for the picker of "New album". */
  ownerId: string
  /**
   * `row` is the media details dialog's Albums section: chips for the albums
   * holding the photo and an Add to album button. `pill` is the lightbox's
   * "In N albums" button.
   */
  variant: 'row' | 'pill'
  /**
   * Wraps what the row shows (not the empty case: a photo that is not the
   * caller's shows nothing at all, frame included), so a host can give it a
   * titled section.
   */
  renderFrame?: (content: ReactNode) => ReactNode
  className?: string
}

const AlbumChip: FC<{ album: MediaAlbumOptionEntity }> = ({ album }) => (
  <li>
    <Link
      // One per album in a short list inside a dialog, opened in a new tab so
      // the composer or lightbox it sits in is not left.
      href={`/gallery/albums/${encodeURIComponent(album.id)}`}
      target="_blank"
      rel="noopener"
      prefetch={false}
      className="bg-primary/10 text-primary-text focus-visible:ring-ring/50 relative inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-medium outline-none hover:underline focus-visible:ring-[3px] before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
    >
      <Folder className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{album.title}</span>
      <span className="sr-only">(opens in a new tab)</span>
    </Link>
  </li>
)

/**
 * Adds a photo to the owner's albums, or takes it out. A toggle is saved as it
 * is made (with an Undo), so it is deliberately separate from any form it
 * appears beside. The same menu serves the details dialog and the lightbox.
 */
export const MediaAlbumsControl: FC<Props> = ({
  mediaId,
  ownerId,
  variant,
  renderFrame,
  className
}) => {
  const uid = useId()
  const albums = useMediaAlbums(mediaId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const {
    status,
    albums: options,
    memberIds,
    addable,
    busyIds,
    toast,
    writeError
  } = albums

  const live = (
    <span role="status" aria-live="polite" className="sr-only">
      {albums.announcement}
    </span>
  )

  const frame = (content: ReactNode) =>
    renderFrame ? renderFrame(content) : content

  if (status === 'hidden') return null
  if (status === 'loading') {
    return variant === 'row'
      ? frame(
          <div className={className}>
            <p
              role="status"
              className="text-muted-foreground flex items-center gap-2 text-xs"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Loading albums…
            </p>
          </div>
        )
      : null
  }
  if (status === 'error') {
    return frame(
      <div className={cn('text-xs', className)}>
        <p role="alert" className="text-destructive">
          {albums.loadError}
        </p>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => void albums.reload()}
        >
          Try again
        </Button>
      </div>
    )
  }

  const holding = options.filter((album) => memberIds.includes(album.id))
  const names = getAlbumOptionNames(options)
  const titleId = `${uid}-title`
  // The lightbox backdrop is dark in both themes, so its menu is too.
  const dark = variant === 'pill'

  const moveFocus = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const boxes = Array.from(
      event.currentTarget.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]:not(:disabled)'
      )
    )
    const at = boxes.indexOf(document.activeElement as HTMLInputElement)
    if (at === -1) return
    event.preventDefault()
    const next =
      event.key === 'ArrowDown'
        ? Math.min(at + 1, boxes.length - 1)
        : Math.max(at - 1, 0)
    boxes[next]?.focus()
  }

  const trigger =
    variant === 'pill' ? (
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        className="focus-visible:ring-ring/60 relative inline-flex h-9 items-center gap-2 rounded-full bg-white/12 px-3.5 text-sm font-medium text-white outline-none hover:bg-white/20 focus-visible:ring-[3px] pointer-coarse:h-10 pointer-coarse:px-4 aria-expanded:bg-white/20 aria-expanded:ring-2 aria-expanded:ring-orange-400/80"
      >
        <Folder className="size-4" aria-hidden="true" />
        {getAlbumsPillLabel(holding.length)}
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </button>
    ) : (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        className="pointer-coarse:h-10"
      >
        <Plus aria-hidden="true" />
        Add to album
      </Button>
    )

  // What the last change did. While the menu is open it lies over the spot
  // below the button, so the message moves into the menu (beside what was just
  // toggled, and with Undo in reach); closed, it sits under the row.
  const messages = (
    <>
      {writeError ? (
        <p
          role="alert"
          className={cn(
            'text-xs',
            dark ? 'text-red-300' : 'text-destructive',
            menuOpen && 'px-2 pt-1'
          )}
        >
          {writeError}
        </p>
      ) : null}
      {toast ? (
        <AlbumUndoToast
          toast={toast}
          onDismiss={albums.dismissToast}
          tone={dark ? 'dark' : 'default'}
          className={
            menuOpen ? 'mt-1.5 shadow-none' : dark ? 'max-w-sm' : undefined
          }
        />
      ) : null}
    </>
  )
  const feedback = (
    <>
      {menuOpen ? null : messages}
      {live}
    </>
  )

  const menu = (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        aria-labelledby={titleId}
        data-albums-menu=""
        className={cn(
          'w-72 max-w-[calc(100vw-2rem)] p-1.5',
          dark && 'border-white/15 bg-neutral-800 text-neutral-50'
        )}
      >
        <p
          id={titleId}
          className={cn(
            'px-2 py-1.5 text-xs font-medium',
            dark ? 'text-neutral-400' : 'text-muted-foreground'
          )}
        >
          Add to album
        </p>
        {options.length === 0 ? (
          <p
            className={cn(
              'px-2 py-2 text-sm',
              dark ? 'text-neutral-400' : 'text-muted-foreground'
            )}
          >
            You have no albums yet.
          </p>
        ) : (
          <ul
            className="max-h-64 overflow-y-auto"
            onKeyDown={moveFocus}
            aria-labelledby={titleId}
          >
            {options.map((album, index) => {
              const isMember = memberIds.includes(album.id)
              const blocked = !isMember && !addable
              return (
                <li key={album.id}>
                  <label
                    className={cn(
                      'flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm pointer-coarse:min-h-10',
                      dark ? 'hover:bg-white/10' : 'hover:bg-accent',
                      blocked && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    <Checkbox
                      checked={isMember}
                      disabled={blocked}
                      aria-busy={busyIds.includes(album.id) || undefined}
                      aria-label={names[index]}
                      className={
                        dark ? 'border-white/40 bg-transparent' : undefined
                      }
                      onChange={() => albums.toggle(album.id)}
                    />
                    <span
                      className="min-w-0 flex-1 truncate"
                      aria-hidden="true"
                    >
                      {album.title}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 text-xs tabular-nums',
                        dark ? 'text-neutral-400' : 'text-muted-foreground'
                      )}
                      aria-hidden="true"
                    >
                      {album.itemCount.toLocaleString('en-US')}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        {addable ? null : (
          <p
            className={cn(
              'px-2 pt-1 pb-1.5 text-xs',
              dark ? 'text-neutral-400' : 'text-muted-foreground'
            )}
          >
            {NOT_ADDABLE_HINT}
          </p>
        )}
        {menuOpen ? messages : null}
        <div className={cn('mt-1 border-t pt-1', dark && 'border-white/15')}>
          <button
            type="button"
            disabled={!addable}
            onClick={() => {
              setMenuOpen(false)
              setCreateOpen(true)
            }}
            className={cn(
              'focus-visible:ring-ring/50 flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm font-medium outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-10',
              dark
                ? 'text-orange-300 hover:bg-white/10'
                : 'text-primary-text hover:bg-accent'
            )}
          >
            <Plus className="size-4" aria-hidden="true" />
            New album with this photo
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )

  const createDialog = (
    <GalleryAlbumFormDialog
      open={createOpen}
      ownerId={ownerId}
      intent="create"
      initialMediaIds={[mediaId]}
      onOpenChange={setCreateOpen}
      // The new album holds the photo: read the menu's data again.
      onSaved={() => void albums.reload()}
    />
  )

  if (variant === 'pill') {
    return (
      <div className={cn('flex flex-col items-center gap-2', className)}>
        {menu}
        {feedback}
        {createDialog}
      </div>
    )
  }

  return frame(
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {holding.length > 0 ? (
          <ul
            aria-label="Albums holding this photo"
            className="flex min-w-0 flex-wrap gap-1.5"
          >
            {holding.map((album) => (
              <AlbumChip key={album.id} album={album} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Not in any album yet.</p>
        )}
        {menu}
      </div>
      <p className="text-muted-foreground text-xs">
        {addable ? '' : `${NOT_ADDABLE_HINT} `}
        Albums apply right away. They are not part of Save details.
      </p>
      {feedback}
      {createDialog}
    </div>
  )
}

'use client'

import { Check, EyeOff, Video } from 'lucide-react'
import { FC, useCallback, useMemo, useRef, useState } from 'react'

import { GalleryEditDetailsDialog } from '@/lib/components/gallery/GalleryEditDetailsDialog'
import { formatGalleryDate } from '@/lib/components/gallery/galleryCategories'
import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { Media } from '@/lib/components/posts/media'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

/** Select mode: a tile toggles instead of opening the viewer. */
export interface GalleryGridSelection {
  selected: ReadonlySet<string>
  onToggle: (item: GalleryItemEntity) => void
}

interface Props {
  items: GalleryItemEntity[]
  /** Show the subject and capture date under each tile. */
  showCaption?: boolean
  /** Select mode; absent when tiles open the viewer. */
  selection?: GalleryGridSelection
  /**
   * The signed-in viewer's actor id when every photo is theirs: the viewer
   * then offers each photo's albums menu and an Edit button that opens Edit
   * details over it. The tiles show what the owner's edit changed.
   */
  albumsOwnerId?: string | null
  /**
   * Told the tile as it is after an owner's edit saved, so the page holding the
   * list can keep it (the grid shows the edit itself until `items` changes).
   */
  onItemEdited?: (item: GalleryItemEntity) => void
  /** Called once the viewer has closed. */
  onViewerClosed?: () => void
  /**
   * Called once the viewer closes, with the ids of the albums whose photos
   * its albums pill changed, so a page that shows one of them can refresh.
   */
  onAlbumsChanged?: (albumIds: string[]) => void
  className?: string
}

const isVideo = (item: GalleryItemEntity) =>
  item.attachment.mediaType.startsWith('video') ||
  /\.(mp4|webm|m3u8)(?:[?#]|$)/i.test(item.attachment.url)

// The media type is part of the button's own name: a badge inside a labelled
// button is never announced.
const itemLabel = (item: GalleryItemEntity, index: number, verb = 'Open') => {
  const noun = isVideo(item) ? 'video' : 'media'
  const alt = item.attachment.name?.trim()
  // Only the owner is told (`inGallery` is omitted for everyone else). Spoken
  // here, in the name, because the visible "Hidden" pill is decoration.
  const state = item.inGallery === false ? ', hidden from your gallery' : ''
  if (alt) return `${verb} ${noun}: ${alt}${state}`
  if (item.subject?.name) return `${verb} ${noun}: ${item.subject.name}${state}`
  return `${verb} ${noun} ${index + 1}${state}`
}

const EMPTY_EDITS: Record<string, GalleryItemEntity> = {}

/**
 * A square grid of gallery photos and videos. A tile opens `MediasModal` over
 * the whole list, which lazily fetches each photo's public details by media id.
 */
export const GalleryGrid: FC<Props> = ({
  items,
  showCaption = false,
  selection,
  albumsOwnerId,
  onItemEdited,
  onViewerClosed,
  onAlbumsChanged,
  className
}) => {
  const [modalIndex, setModalIndex] = useState<number | null>(null)
  // The photo Edit details is open on, by media id.
  const [editingId, setEditingId] = useState<string | null>(null)
  // Tiles as the owner's edits left them. Tied to the `items` they were made
  // against: a new list (a reload, a page appended) brings its own copies.
  const [edits, setEdits] = useState<{
    base: GalleryItemEntity[]
    byId: Record<string, GalleryItemEntity>
  }>({ base: items, byId: EMPTY_EDITS })
  const editedById = edits.base === items ? edits.byId : EMPTY_EDITS
  const shownItems = useMemo(
    () =>
      Object.keys(editedById).length === 0
        ? items
        : items.map((item) => editedById[item.mediaId] ?? item),
    [items, editedById]
  )
  const editingItems = useMemo(
    () =>
      editingId === null
        ? []
        : shownItems.filter((item) => item.mediaId === editingId),
    [shownItems, editingId]
  )
  const onItemEditedRef = useRef(onItemEdited)
  onItemEditedRef.current = onItemEdited
  const handleEdited = useCallback(
    (saved: GalleryItemEntity[]) => {
      setEdits((current) => ({
        base: items,
        byId: {
          ...(current.base === items ? current.byId : EMPTY_EDITS),
          ...Object.fromEntries(saved.map((item) => [item.mediaId, item]))
        }
      }))
      for (const item of saved) onItemEditedRef.current?.(item)
    },
    [items]
  )
  const changedAlbums = useRef(new Set<string>())
  // Read when a write settles, which can be after the viewer closed (and so
  // after the render this callback was made in).
  const viewerOpen = useRef(false)
  viewerOpen.current = modalIndex !== null
  const albumsChangedRef = useRef(onAlbumsChanged)
  albumsChangedRef.current = onAlbumsChanged
  // A new array resets the viewer's open overlay and details cache, so it only
  // changes when the items do.
  const attachments = useMemo(
    () => shownItems.map((item) => item.attachment),
    [shownItems]
  )

  return (
    <>
      <ul
        className={cn(
          'grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2',
          className
        )}
      >
        {shownItems.map((item, index) => {
          const caption = [item.subject?.name, formatGalleryDate(item.takenAt)]
            .filter(Boolean)
            .join(' · ')
          const isSelected = selection?.selected.has(item.mediaId) ?? false
          return (
            <li key={item.mediaId} className="min-w-0">
              <button
                type="button"
                className={cn(
                  'group bg-muted/20 focus-visible:outline-primary relative block aspect-square w-full overflow-hidden rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2',
                  isSelected && 'ring-primary ring-3 ring-inset'
                )}
                onClick={() =>
                  selection ? selection.onToggle(item) : setModalIndex(index)
                }
                aria-label={itemLabel(
                  item,
                  index,
                  selection ? 'Select' : 'Open'
                )}
                aria-pressed={selection ? isSelected : undefined}
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
                {item.inGallery === false ? (
                  <span
                    data-testid="hidden-badge"
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[11px] leading-4 font-medium text-white backdrop-blur-xs',
                      // Clear of the select mark that sits in the same corner.
                      selection ? 'left-9' : 'left-1.5'
                    )}
                  >
                    <EyeOff className="size-3" aria-hidden="true" />
                    Hidden
                  </span>
                ) : null}
                {selection ? (
                  <span
                    aria-hidden="true"
                    data-testid="select-mark"
                    className={cn(
                      'pointer-events-none absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full border-2 border-white text-white shadow-sm',
                      isSelected ? 'bg-primary' : 'bg-black/30'
                    )}
                  >
                    {isSelected ? <Check className="size-3.5" /> : null}
                  </span>
                ) : null}
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
        medias={modalIndex === null ? null : attachments}
        initialSelection={modalIndex ?? 0}
        albumsOwnerId={albumsOwnerId}
        onEdit={
          albumsOwnerId
            ? (index) => setEditingId(shownItems[index]?.mediaId ?? null)
            : undefined
        }
        onAlbumsChange={(albumId) => {
          // Open: collected, and reported when the viewer closes (refreshing
          // under it would swap the photo being viewed). Already closed: the
          // write settled late, so nothing else will report it.
          if (viewerOpen.current) changedAlbums.current.add(albumId)
          else albumsChangedRef.current?.([albumId])
        }}
        onClosed={() => {
          viewerOpen.current = false
          setModalIndex(null)
          onViewerClosed?.()
          if (changedAlbums.current.size === 0) return
          const changed = [...changedAlbums.current]
          changedAlbums.current.clear()
          onAlbumsChanged?.(changed)
        }}
      />
      {albumsOwnerId && editingId !== null ? (
        <GalleryEditDetailsDialog
          // Over the viewer, for the photo on screen only: the viewer's own
          // arrows and strip stay where they were.
          items={editingItems}
          initialMediaId={editingId}
          ownerId={albumsOwnerId}
          onClose={() => setEditingId(null)}
          onSaved={handleEdited}
        />
      ) : null}
    </>
  )
}

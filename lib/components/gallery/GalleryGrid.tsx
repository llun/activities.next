'use client'

import { Check, EyeOff, Lock, Video } from 'lucide-react'
import dynamic from 'next/dynamic'
import { FC, ReactNode, useCallback, useMemo, useRef, useState } from 'react'

import { formatGalleryDate } from '@/lib/components/gallery/galleryCategories'
import { useRovingGridFocus } from '@/lib/components/gallery/useRovingGridFocus'
import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { Media } from '@/lib/components/posts/media'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

/** Select mode: a tile toggles instead of opening the viewer. */
export interface GalleryGridSelection {
  selected: ReadonlySet<string>
  onToggle: (item: GalleryItemEntity, modifiers?: { shiftKey: boolean }) => void
  /** The range anchor: drawn with a dark ring. */
  anchorId?: string | null
}

/** One day's slice of a grouped grid: its sticky header and its tiles. */
export interface GalleryGridGroup {
  key: string
  header: ReactNode
  items: GalleryItemEntity[]
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
  /**
   * Owner views: Post… on a photo added in Gallery and not posted yet, from
   * Edit details over the viewer. Without it Edit details offers no Post….
   */
  onPostItems?: (mediaIds: string[]) => void
  /**
   * Owner views: told the photos Edit details deleted (unposted ones only), so
   * the page holding the list can drop them. The viewer closes with them.
   */
  onItemsDeleted?: (mediaIds: string[]) => void
  /** Called once the viewer has closed. */
  onViewerClosed?: () => void
  /**
   * Called once the viewer closes, with the ids of the albums whose photos
   * its albums pill changed, so a page that shows one of them can refresh.
   */
  onAlbumsChanged?: (albumIds: string[]) => void
  /**
   * Day groups: one section per group, each with its header and its tiles.
   * When given, `items` must be the groups' items flattened in order.
   */
  groups?: GalleryGridGroup[]
  /**
   * The grid is the page's primary content: its first tile is revealed
   * without the hydration fade (eager only where it would otherwise be lazy)
   * and the rest stay lazy.
   */
  prioritizeFirst?: boolean
  className?: string
}

const isVideo = (item: GalleryItemEntity) =>
  item.attachment.mediaType.startsWith('video') ||
  /\.(mp4|webm|m3u8)(?:[?#]|$)/i.test(item.attachment.url)

// Rendered only while the owner is editing a photo, so keep it (and the album
// dialogs behind it) out of every page that shows a grid to visitors too.
const GalleryEditDetailsDialog = dynamic(
  () =>
    import('@/lib/components/gallery/GalleryEditDetailsDialog').then(
      (module) => module.GalleryEditDetailsDialog
    ),
  { ssr: false }
)

// The media type is part of the button's own name: a badge inside a labelled
// button is never announced. A grouped tile also names its date, since the
// caption under it drops it.
const itemLabel = (
  item: GalleryItemEntity,
  index: number,
  verb = 'Open',
  withDate = false
) => {
  const noun = isVideo(item) ? 'video' : 'media'
  const alt = item.attachment.name?.trim()
  // Only the owner is told (`inGallery` is omitted for everyone else). Spoken
  // here, in the name, because the visible "Hidden" pill is decoration.
  const state = [
    item.posted === false ? 'only you can see it, not posted' : '',
    item.inGallery === false ? 'hidden from your gallery' : ''
  ]
  const taken = withDate ? formatGalleryDate(item.takenAt) : ''
  const uploaded = withDate ? formatGalleryDate(item.uploadedAt) : ''
  const date = taken ? `taken ${taken}` : uploaded ? `uploaded ${uploaded}` : ''
  const extras = [...state, date]
    .filter(Boolean)
    .map((part) => `, ${part}`)
    .join('')
  if (alt) return `${verb} ${noun}: ${alt}${extras}`
  if (item.subject?.name)
    return `${verb} ${noun}: ${item.subject.name}${extras}`
  return `${verb} ${noun} ${index + 1}${extras}`
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
  onPostItems,
  onItemsDeleted,
  onViewerClosed,
  onAlbumsChanged,
  groups,
  prioritizeFirst = false,
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

  const groupSizes = useMemo(
    () => groups?.map((group) => group.items.length),
    [groups]
  )
  // One roving tab stop for the grid while tiles toggle (Select mode).
  const roving = useRovingGridFocus({
    enabled: Boolean(selection),
    count: items.length,
    groupSizes
  })
  // The flat tile index across groups: the position in `items`, which a
  // grouped host passes as the groups' items flattened in order.
  const indexById = useMemo(
    () => new Map(items.map((item, index) => [item.mediaId, index])),
    [items]
  )

  const renderTile = (item: GalleryItemEntity, index: number) => {
    // A grouped tile drops the date from its caption (the day header carries
    // it) but keeps it in its accessible name.
    const caption = [
      item.subject?.name,
      groups ? '' : formatGalleryDate(item.takenAt)
    ]
      .filter(Boolean)
      .join(' · ')
    const isSelected = selection?.selected.has(item.mediaId) ?? false
    const isAnchor = selection?.anchorId === item.mediaId
    const isPriorityTile = prioritizeFirst && index === 0 && !isVideo(item)
    return (
      <li key={item.mediaId} className="min-w-0">
        <button
          type="button"
          className={cn(
            'group bg-muted/20 relative block aspect-square w-full cursor-pointer overflow-hidden rounded-md',
            // Select mode draws a dashed focus outline outside the tile in
            // the foreground colour, further out than the anchor's solid
            // offset ring, so focus never looks like the anchor. Viewer
            // tiles keep the inset primary outline. A focused tile is
            // raised so the next tile can't paint over its outline.
            selection
              ? 'focus-visible:outline-foreground focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:z-1'
              : 'focus-visible:outline-primary focus-visible:outline-2 focus-visible:-outline-offset-2',
            isSelected && 'inset-ring-primary inset-ring-3',
            isAnchor &&
              'ring-2 ring-foreground ring-offset-2 ring-offset-background',
            groups &&
              'max-md:scroll-mt-[calc(56px+env(safe-area-inset-top,0px)+var(--status-strip-h,0px)+3rem)] md:scroll-mt-[calc(79px+3rem)]'
          )}
          onClick={(event) =>
            selection
              ? selection.onToggle(item, { shiftKey: event.shiftKey })
              : setModalIndex(index)
          }
          onKeyDown={
            selection
              ? (event) => {
                  // A native button fires its click on Space keyup in some
                  // browsers and not at all under jsdom: handle the key here
                  // and suppress the later native click for the full key press.
                  if (event.key === ' ' || event.key === 'Spacebar') {
                    event.preventDefault()
                    if (event.repeat) return
                    selection.onToggle(item, { shiftKey: event.shiftKey })
                  }
                }
              : undefined
          }
          onKeyUp={
            selection
              ? (event) => {
                  if (event.key === ' ' || event.key === 'Spacebar') {
                    event.preventDefault()
                  }
                }
              : undefined
          }
          tabIndex={roving.getTabIndex(index)}
          data-grid-index={selection ? index : undefined}
          onFocus={selection ? () => roving.onFocusTile(index) : undefined}
          aria-label={itemLabel(
            item,
            index,
            selection ? 'Select' : 'Open',
            Boolean(groups)
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
            loading={isPriorityTile ? 'eager' : 'lazy'}
            revealImmediately={isPriorityTile}
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
          {item.posted === false ? (
            <span
              data-testid="only-you-badge"
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[11px] leading-4 font-medium text-white backdrop-blur-xs'
              )}
            >
              <Lock className="size-3" aria-hidden="true" />
              Only you
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
  }

  return (
    <>
      {groups ? (
        <div onKeyDown={roving.onKeyDown}>
          {groups.map((group) => (
            <section key={group.key}>
              {group.header}
              <ul
                className={cn(
                  'grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2',
                  className
                )}
                data-grid
              >
                {group.items.map((item) =>
                  renderTile(
                    editedById[item.mediaId] ?? item,
                    indexById.get(item.mediaId) ?? 0
                  )
                )}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul
          className={cn(
            'grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2',
            className
          )}
          data-grid={selection ? true : undefined}
          onKeyDown={selection ? roving.onKeyDown : undefined}
        >
          {shownItems.map((item, index) => renderTile(item, index))}
        </ul>
      )}

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
          onPost={onPostItems}
          onDeleted={
            onItemsDeleted
              ? (ids) => {
                  setModalIndex(null)
                  onItemsDeleted(ids)
                }
              : undefined
          }
        />
      ) : null}
    </>
  )
}

'use client'

import { CheckSquare, ImagePlus, Images, Lock, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { GalleryAlbumFormDialog } from '@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog'
import { AddToGalleryDialog } from '@/lib/components/gallery/AddToGalleryDialog'
import { ConfirmDeleteMediaDialog } from '@/lib/components/gallery/ConfirmDeleteMediaDialog'
import { GalleryAddedToast } from '@/lib/components/gallery/GalleryAddedToast'
import { GalleryEditDetailsDialog } from '@/lib/components/gallery/GalleryEditDetailsDialog'
import {
  GalleryPagedGrid,
  type GalleryPagedGridController
} from '@/lib/components/gallery/GalleryPagedGrid'
import { GalleryShowSelect } from '@/lib/components/gallery/GalleryShowSelect'
import {
  GALLERY_CATEGORY_ICONS,
  GALLERY_CATEGORY_LABELS
} from '@/lib/components/gallery/galleryCategories'
import { useInstanceLimits } from '@/lib/components/instance-limits'
import { PageHeader } from '@/lib/components/page-header'
import {
  SectionNavSelect,
  type SectionNavSelectTab
} from '@/lib/components/section-nav-select'
import { Button } from '@/lib/components/ui/button'
import type {
  GalleryItemEntity,
  GalleryMediaPage
} from '@/lib/services/gallery/galleryEntities'
import { MAX_ADD_TO_GALLERY_MEDIA } from '@/lib/services/gallery/galleryRequests'
import { ACCEPTED_FILE_TYPES } from '@/lib/services/medias/constants'
import {
  type GalleryShow,
  MEDIA_SUBJECT_CATEGORIES,
  type MediaSubjectCategory
} from '@/lib/types/database/gallery'

import { GalleryAddToAlbumDialog } from './GalleryAddToAlbumDialog'
import {
  GALLERY_SELECTION_BAR_ID,
  GallerySelectionBar
} from './GallerySelectionBar'
import { describeHiddenSkipped } from './galleryAddToAlbumUi'

interface Props {
  actorId: string
  initialCategory: MediaSubjectCategory | null
  initialShow: GalleryShow
  initialPage: GalleryMediaPage
}

type Filter = MediaSubjectCategory | 'all'

const FILTER_TABS: SectionNavSelectTab<Filter>[] = [
  { id: 'all', label: 'All photos and videos', icon: Images },
  ...MEDIA_SUBJECT_CATEGORIES.map((category) => ({
    id: category,
    label: GALLERY_CATEGORY_LABELS[category],
    icon: GALLERY_CATEGORY_ICONS[category]
  }))
]

interface Outcome {
  message: string
  /** The album the message links to, when it is about one. */
  albumId?: string
}

const EMPTY_TITLES: Record<GalleryShow, string> = {
  all: 'No photos or videos yet',
  in_gallery: 'No photos in your gallery yet',
  hidden: 'Nothing is hidden from your gallery',
  not_posted: 'No photos waiting to be posted'
}

/** What the Add picker and a drop take: the types the composer uploads, minus audio. */
const ADDABLE_TYPES = ACCEPTED_FILE_TYPES.filter(
  (type) => !type.startsWith('audio/')
)

interface AddedToast {
  id: number
  message: string
  mediaIds: string[]
}

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files')

const describeDeleted = (count: number) =>
  count === 1 ? 'Deleted 1 photo.' : `Deleted ${count} photos.`

export const GalleryAllMediaView: FC<Props> = ({
  actorId,
  initialCategory,
  initialShow,
  initialPage
}) => {
  const [filter, setFilterState] = useState<Filter>(initialCategory ?? 'all')
  const startFilter = initialCategory ?? 'all'
  const [show, setShowState] = useState<GalleryShow>(initialShow)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const gridController = useRef<GalleryPagedGridController | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  // In the order they were picked: the first is the cover of a new album.
  const [selected, setSelected] = useState<string[]>([])
  const [loaded, setLoaded] = useState<GalleryItemEntity[]>([])
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const router = useRouter()
  const { maxMediaAttachments } = useInstanceLimits()
  // Add to gallery: the files being added, the drag overlay and the toast that
  // follows. `gridNonce` remounts the grid so the new photos load first.
  const [addFiles, setAddFiles] = useState<File[] | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [toast, setToast] = useState<AddedToast | null>(null)
  const [gridNonce, setGridNonce] = useState(0)
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  // The page the server rendered is only the first list this view shows: once
  // the owner has switched filters (or edited anything) it is stale, so a later
  // return to the starting filter loads its own.
  const [reuseInitialPage, setReuseInitialPage] = useState(true)

  const selectButton = useRef<HTMLButtonElement>(null)
  // Set when an add or create finished, so the dialog that closes hands focus
  // to the Select button: the bar that had it is gone with select mode.
  const finished = useRef(false)

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const selectedItems = useMemo(
    () => loaded.filter((item) => selectedSet.has(item.mediaId)),
    [loaded, selectedSet]
  )
  // The photos Edit details was opened for: fixed while the dialog is open, so
  // a tile that drops out of the list after a save does not pull the item from
  // under it.
  const [editItems, setEditItems] = useState<GalleryItemEntity[]>([])

  const setFilter = (next: Filter) => {
    // A different filter is a different list: a selection does not carry over.
    setSelected([])
    setReuseInitialPage(false)
    setFilterState(next)
  }

  const setShow = (next: GalleryShow) => {
    setSelected([])
    setReuseInitialPage(false)
    setShowState(next)
  }

  // The grid reports its photos whenever they change (a page loads, an edit
  // moves one out of the list). A pick of a photo that is gone is dropped, so
  // the count and what Add to album sends match what the owner can see.
  const handleItemsChange = useCallback((items: GalleryItemEntity[]) => {
    setLoaded(items)
    setSelected((current) => {
      const present = new Set(items.map((item) => item.mediaId))
      const next = current.filter((id) => present.has(id))
      return next.length === current.length ? current : next
    })
  }, [])

  // Albums hold only photos shown in the gallery. A hidden one in a selection is
  // left out of an add or a new album, and the owner is told so.
  const hiddenIds = useMemo(
    () =>
      new Set(
        selectedItems
          .filter((item) => item.inGallery === false)
          .map((item) => item.mediaId)
      ),
    [selectedItems]
  )
  const addableIds = useMemo(
    () => selected.filter((id) => !hiddenIds.has(id)),
    [selected, hiddenIds]
  )
  const addableItems = useMemo(
    () => selectedItems.filter((item) => item.inGallery !== false),
    [selectedItems]
  )
  const withHiddenNote = (message: string) =>
    hiddenIds.size > 0
      ? `${message} ${describeHiddenSkipped(hiddenIds.size)}`
      : message

  const toggle = useCallback((item: GalleryItemEntity) => {
    setSelected((current) =>
      current.includes(item.mediaId)
        ? current.filter((id) => id !== item.mediaId)
        : [...current, item.mediaId]
    )
  }, [])
  const selection = useMemo(
    () =>
      isSelecting ? { selected: selectedSet, onToggle: toggle } : undefined,
    [isSelecting, selectedSet, toggle]
  )

  const stopSelecting = () => {
    setIsSelecting(false)
    setSelected([])
  }

  const selectAllLoaded = () =>
    setSelected((current) => [
      ...current,
      ...loaded
        .map((item) => item.mediaId)
        .filter((id) => !current.includes(id))
    ])

  const restoreFocus = (event: Event) => {
    if (!finished.current) return
    finished.current = false
    event.preventDefault()
    selectButton.current?.focus()
  }

  const dismissToast = useCallback(() => setToast(null), [])

  // The Home composer takes these photos from the address (`/?media=1,2`); it
  // checks they are the owner's own and not in a post.
  const postMedia = useCallback(
    (mediaIds: string[]) => {
      if (mediaIds.length === 0) return
      router.push(`/?media=${mediaIds.map(encodeURIComponent).join(',')}`)
    },
    [router]
  )

  const startAdd = useCallback((picked: File[]) => {
    const accepted = picked.filter((file) => ADDABLE_TYPES.includes(file.type))
    const skipped = picked.length - accepted.length
    if (accepted.length === 0) {
      setToast(null)
      setOutcome({
        message:
          'Only photos and videos can be added (JPEG, PNG, MP4, WebM or MOV).'
      })
      return
    }
    const taken = accepted.slice(0, MAX_ADD_TO_GALLERY_MEDIA)
    const notes: string[] = []
    if (accepted.length > taken.length) {
      notes.push(
        `Only the first ${MAX_ADD_TO_GALLERY_MEDIA} were taken: add the rest next.`
      )
    }
    if (skipped > 0) {
      notes.push(
        `${skipped} ${skipped === 1 ? 'file was' : 'files were'} skipped: only photos and videos can be added.`
      )
    }
    setToast(null)
    setOutcome(notes.length > 0 ? { message: notes.join(' ') } : null)
    setIsSelecting(false)
    setSelected([])
    setAddFiles(taken)
  }, [])

  const handleAdded = useCallback((mediaIds: string[]) => {
    // New photos are unposted, so they are in Everything, In gallery and Not
    // posted. Hidden and a category filter would not list them: start over at
    // the unfiltered list, whose first page has them first.
    setFilterState('all')
    setShowState((current) => (current === 'hidden' ? 'all' : current))
    setReuseInitialPage(false)
    setGridNonce((nonce) => nonce + 1)
    setSelected([])
    setToast({
      id: Date.now(),
      message: `${mediaIds.length} added to your gallery.`,
      mediaIds
    })
  }, [])

  // Dropping files anywhere on the page adds them. The overlay says so while
  // files are dragged over the window; a drag of anything else is left alone.
  useEffect(() => {
    let depth = 0
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth += 1
      setIsDragging(true)
    }
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
    }
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setIsDragging(false)
    }
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setIsDragging(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length > 0) startAdd(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [startAdd])

  const allUnposted =
    selectedItems.length > 0 &&
    selectedItems.every((item) => item.posted === false)

  const finish = (result: Outcome) => {
    finished.current = true
    setOutcome(result)
    stopSelecting()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="All media"
        description="Every photo and video you've posted or added, newest first"
        actions={
          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ADDABLE_TYPES.join(',')}
              aria-label="Choose photos and videos to add"
              className="hidden"
              onChange={(event) => {
                const input = event.currentTarget
                const picked = input.files ? Array.from(input.files) : []
                // Clear it so picking the same files again still fires `change`.
                input.value = ''
                if (picked.length > 0) startAdd(picked)
              }}
            />
            <Button
              ref={addButton}
              type="button"
              className="pointer-coarse:h-10"
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus aria-hidden="true" />
              Add
            </Button>
            <Button
              ref={selectButton}
              type="button"
              variant="outline"
              className="pointer-coarse:h-10"
              onClick={() => {
                setOutcome(null)
                // Select mode's bar takes the bottom of the page the toast is on.
                setToast(null)
                if (isSelecting) stopSelecting()
                else setIsSelecting(true)
              }}
            >
              {isSelecting ? (
                <X aria-hidden="true" />
              ) : (
                <CheckSquare aria-hidden="true" />
              )}
              {isSelecting ? 'Cancel' : 'Select'}
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        <SectionNavSelect
          label="Category"
          tabs={FILTER_TABS}
          active={filter}
          onChange={setFilter}
        />
        <GalleryShowSelect value={show} onChange={setShow} />
      </div>
      {/* Always on the page (hidden visually while empty), so the result is
          announced when it appears. */}
      <div role="status" aria-live="polite" className="empty:sr-only">
        {outcome ? (
          <div className="bg-card flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
            <p className="min-w-0 flex-1 break-words">
              {outcome.message}
              {outcome.albumId ? (
                <>
                  {' '}
                  <Link
                    href={`/gallery/albums/${encodeURIComponent(outcome.albumId)}`}
                    prefetch={false}
                    className="text-primary-text font-medium hover:underline"
                  >
                    Open album
                  </Link>
                </>
              ) : null}
            </p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setOutcome(null)}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-6 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-[3px] pointer-coarse:size-10"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {isSelecting
          ? 'Select mode is on. Choose photos, then edit their details, add them to an album, post or delete them.'
          : ''}
      </div>
      {isSelecting ? (
        <button
          type="button"
          className="bg-background focus-visible:ring-ring/50 sr-only rounded-md border px-3 py-2 text-sm font-medium focus:not-sr-only focus-visible:ring-[3px]"
          onClick={() =>
            document.getElementById(GALLERY_SELECTION_BAR_ID)?.focus()
          }
        >
          Skip to selection bar
        </button>
      ) : null}
      <GalleryPagedGrid
        // A different filter is a different query, so a fresh grid.
        key={`${filter}:${show}:${gridNonce}`}
        actorId={actorId}
        category={filter === 'all' ? undefined : filter}
        show={show}
        initialPage={
          reuseInitialPage && filter === startFilter && show === initialShow
            ? initialPage
            : undefined
        }
        controllerRef={gridController}
        emptyTitle={
          filter === 'all'
            ? EMPTY_TITLES[show]
            : `No ${GALLERY_CATEGORY_LABELS[filter].toLowerCase()} yet`
        }
        selection={selection}
        albumsOwnerId={actorId}
        onPostItems={postMedia}
        onItemsDeleted={(ids) =>
          setOutcome({ message: describeDeleted(ids.length) })
        }
        onItemsChange={handleItemsChange}
      />
      {isSelecting ? (
        <GallerySelectionBar
          count={selected.length}
          loadedCount={loaded.length}
          onSelectAllLoaded={selectAllLoaded}
          onClear={() => setSelected([])}
          hiddenCount={hiddenIds.size}
          onAddToAlbum={() => setIsAddOpen(true)}
          onEditDetails={() => {
            setEditItems(selectedItems)
            setIsEditOpen(true)
          }}
          allUnposted={allUnposted}
          maxPostAttachments={maxMediaAttachments}
          onPost={() => postMedia(selected)}
          onDelete={() => setDeleteIds(selected)}
        />
      ) : null}

      {isEditOpen && editItems.length > 0 ? (
        <GalleryEditDetailsDialog
          items={editItems}
          initialMediaId={editItems[0].mediaId}
          ownerId={actorId}
          onClose={() => setIsEditOpen(false)}
          onSaved={(saved) => {
            gridController.current?.updateItems(saved)
            setOutcome({
              message:
                saved.length === 1
                  ? 'Details saved for 1 item.'
                  : `Details saved for ${saved.length} items.`
            })
          }}
          onPost={postMedia}
          onDeleted={(ids) => {
            gridController.current?.removeItems(ids)
            setOutcome({ message: describeDeleted(ids.length) })
          }}
        />
      ) : null}

      {addFiles ? (
        <AddToGalleryDialog
          files={addFiles}
          onClose={() => {
            setAddFiles(null)
            // The dialog hands focus back to where it came from; Add is the
            // control that opened it.
            requestAnimationFrame(() => addButton.current?.focus())
          }}
          onAdded={handleAdded}
        />
      ) : null}

      {deleteIds ? (
        <ConfirmDeleteMediaDialog
          mediaIds={deleteIds}
          onCancel={() => setDeleteIds(null)}
          onPartlyDeleted={(gone) => {
            gridController.current?.removeItems(gone)
          }}
          onDeleted={(gone) => {
            gridController.current?.removeItems(gone)
            setDeleteIds(null)
            finish({ message: describeDeleted(gone.length) })
          }}
          onCloseAutoFocus={restoreFocus}
        />
      ) : null}

      {toast ? (
        <GalleryAddedToast
          id={toast.id}
          message={toast.message}
          action={{
            label: 'Post them',
            onSelect: () => {
              dismissToast()
              postMedia(toast.mediaIds)
            }
          }}
          onDismiss={dismissToast}
        />
      ) : null}

      {isDragging && !addFiles ? (
        <div
          data-testid="drop-overlay"
          aria-hidden="true"
          className="bg-background/80 pointer-events-none fixed inset-0 z-50 hidden items-center justify-center p-8 backdrop-blur-xs md:flex"
        >
          <div className="border-primary bg-card flex max-w-md flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-10 py-12 text-center shadow-lg">
            <ImagePlus className="text-primary size-8" aria-hidden="true" />
            <p className="text-lg font-semibold">
              Drop photos and videos to add them to your gallery
            </p>
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Lock className="size-3.5" aria-hidden="true" />
              Only you can see them until you post them
            </p>
          </div>
        </div>
      ) : null}

      <GalleryAddToAlbumDialog
        open={isAddOpen}
        mediaIds={addableIds}
        onOpenChange={setIsAddOpen}
        onNewAlbum={() => {
          setIsAddOpen(false)
          setIsCreateOpen(true)
        }}
        onAdded={(result) =>
          finish({ ...result, message: withHiddenNote(result.message) })
        }
        onCloseAutoFocus={restoreFocus}
      />
      <GalleryAlbumFormDialog
        open={isCreateOpen}
        ownerId={actorId}
        intent="create"
        initialMediaIds={addableIds}
        initialItems={addableItems}
        onOpenChange={setIsCreateOpen}
        onCloseAutoFocus={restoreFocus}
        onSaved={(albumId) =>
          finish({
            albumId,
            message: withHiddenNote('Album created.')
          })
        }
      />
    </div>
  )
}

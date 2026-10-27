'use client'

import { CheckSquare, ImagePlus, Images, Lock, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { GalleryAlbumFormDialog } from '@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog'
import { scrollToResultsStart } from '@/app/(timeline)/gallery/albums/galleryAlbumPickerUi'
import {
  countGalleryMedia,
  getGalleryMedia,
  getGalleryMediaIds
} from '@/lib/client'
import { AddToGalleryDialog } from '@/lib/components/gallery/AddToGalleryDialog'
import { AlbumUndoToast } from '@/lib/components/gallery/AlbumUndoToast'
import { ConfirmDeleteMediaDialog } from '@/lib/components/gallery/ConfirmDeleteMediaDialog'
import { GalleryAddedToast } from '@/lib/components/gallery/GalleryAddedToast'
import { GalleryDayHeader } from '@/lib/components/gallery/GalleryDayHeader'
import { GalleryEditDetailsDialog } from '@/lib/components/gallery/GalleryEditDetailsDialog'
import {
  GalleryPagedGrid,
  type GalleryPagedGridController
} from '@/lib/components/gallery/GalleryPagedGrid'
import { GalleryShowSelect } from '@/lib/components/gallery/GalleryShowSelect'
import { GalleryMediaFilterBar } from '@/lib/components/gallery/filters/GalleryMediaFilterBar'
import { GalleryMediaFilterEmpty } from '@/lib/components/gallery/filters/GalleryMediaFilterEmpty'
import {
  EMPTY_GALLERY_FILTERS,
  type GalleryMediaFilterState,
  type GalleryMediaQuery,
  countActiveFilters,
  toGalleryMediaQuery
} from '@/lib/components/gallery/filters/galleryMediaFilterState'
import { useGalleryMediaFacets } from '@/lib/components/gallery/filters/useGalleryMediaFacets'
import {
  GALLERY_CATEGORY_ICONS,
  GALLERY_CATEGORY_LABELS
} from '@/lib/components/gallery/galleryCategories'
import { groupGalleryItemsByDay } from '@/lib/components/gallery/galleryDayGroups'
import {
  applyRangeSelection,
  describeRangeResult
} from '@/lib/components/gallery/gallerySelectionKeys'
import {
  type GalleryHydrationResume,
  useDaySelection
} from '@/lib/components/gallery/useDaySelection'
import { useInstanceLimits } from '@/lib/components/instance-limits'
import { PageHeader } from '@/lib/components/page-header'
import {
  SectionNavSelect,
  type SectionNavSelectTab
} from '@/lib/components/section-nav-select'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import type {
  GalleryDayKey,
  GalleryDayStats,
  GalleryItemEntity,
  GalleryMediaPage
} from '@/lib/services/gallery/galleryEntities'
import { MAX_ADD_TO_GALLERY_MEDIA } from '@/lib/services/gallery/galleryRequests'
import { ACCEPTED_FILE_TYPES } from '@/lib/services/medias/constants'
import {
  type GalleryMediaSort,
  type GalleryShow,
  MEDIA_SUBJECT_CATEGORIES,
  type MediaSubjectCategory
} from '@/lib/types/database/gallery'

import { GalleryAddToAlbumDialog } from './GalleryAddToAlbumDialog'
import {
  GALLERY_SELECTION_BAR_ID,
  GallerySelectionBar
} from './GallerySelectionBar'

interface Props {
  actorId: string
  initialCategory: MediaSubjectCategory | null
  initialShow: GalleryShow
  initialPage: GalleryMediaPage
  /** False when the instance has no media storage: nothing can be added. */
  isMediaUploadEnabled?: boolean
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
  not_posted: 'No photos waiting to be posted',
  not_in_album: 'Every photo is in an album'
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

/** All media has no album to skip: nothing is blocked from a range. */
const NO_BLOCKED: ReadonlySet<string> = new Set()

/**
 * The query context a day's hydration pages with (whatever `loadDayItems`
 * reads). The day selection snapshots it when a hydration starts and hands
 * it back on every retry, so a later filter or sort change never moves the
 * read to a query the picked ids do not match.
 */
interface DayHydrationQuery {
  query: GalleryMediaQuery
  filter: Filter
  show: GalleryShow
}

export const GalleryAllMediaView: FC<Props> = ({
  actorId,
  initialCategory,
  initialShow,
  initialPage,
  isMediaUploadEnabled: isUploadEnabled = true
}) => {
  const [filter, setFilterState] = useState<Filter>(initialCategory ?? 'all')
  const startFilter = initialCategory ?? 'all'
  const [show, setShowState] = useState<GalleryShow>(initialShow)
  const [filters, setFilters] = useState<GalleryMediaFilterState>(
    EMPTY_GALLERY_FILTERS
  )
  const [query, setQuery] = useState<GalleryMediaQuery>({ sort: 'taken_desc' })
  // The grid's day grouping and the Select day fetches follow this sort.
  const sort = query.sort ?? 'taken_desc'
  const [total, setTotal] = useState<number | null>(initialPage?.total ?? null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const gridController = useRef<GalleryPagedGridController | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  // In the order they were picked: the first is the cover of a new album.
  const [selected, setSelected] = useState<string[]>([])
  const [hydratingIds, setHydratingIds] = useState<ReadonlySet<string>>(
    new Set()
  )
  const [loaded, setLoaded] = useState<GalleryItemEntity[]>([])
  const [seen, setSeen] = useState<ReadonlyMap<string, GalleryItemEntity>>(
    new Map()
  )
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
  const [facetsReloadKey, setFacetsReloadKey] = useState(0)
  const { facets, error: facetsError } = useGalleryMediaFacets(
    show,
    gridNonce + facetsReloadKey
  )
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  // The page the server rendered is only the first list this view shows: once
  // the owner has switched filters (or edited anything) it is stale, so a later
  // return to the starting filter loads its own.
  const [reuseInitialPage, setReuseInitialPage] = useState(true)

  const filterBarRef = useRef<HTMLDivElement>(null)
  const scrollToTop = useCallback(
    () => scrollToResultsStart(filterBarRef.current),
    []
  )

  const handleFilterChange = useCallback(
    (next: GalleryMediaFilterState) => {
      setReuseInitialPage(false)
      setFilters(next)
      setQuery(toGalleryMediaQuery(next, new Date()))
      scrollToTop()
    },
    [scrollToTop]
  )

  const countDraft = useCallback(
    (draft: GalleryMediaFilterState) =>
      countGalleryMedia(actorId, {
        ...toGalleryMediaQuery(draft, new Date()),
        category: filter === 'all' ? undefined : filter,
        show
      }),
    [actorId, filter, show]
  )

  const selectButton = useRef<HTMLButtonElement>(null)
  // Set when an add or create finished, so the dialog that closes hands focus
  // to the Select button: the bar that had it is gone with select mode.
  const finished = useRef(false)

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const selectedItems = useMemo(
    () => selected.flatMap((id) => seen.get(id) ?? []),
    [selected, seen]
  )
  // The photos Edit details was opened for: fixed while the dialog is open, so
  // a tile that drops out of the list after a save does not pull the item from
  // under it.
  const [editItems, setEditItems] = useState<GalleryItemEntity[]>([])

  const loadDayItems = useCallback(
    async (
      dayKey: GalleryDayKey,
      mediaIds: string[],
      isStale: () => boolean,
      signal: AbortSignal,
      resume?: GalleryHydrationResume,
      sortOverride?: GalleryMediaSort,
      queryOverride?: DayHydrationQuery
    ) => {
      // A retry hydrates with the query context the day key was learned
      // under, so a filter or sort change since the pick cannot move the
      // read to a query the picked ids do not match.
      const hydrateSort = sortOverride ?? sort
      const hydrateQuery = queryOverride?.query ?? query
      const hydrateFilter = queryOverride?.filter ?? filter
      const hydrateShow = queryOverride?.show ?? show
      const wanted = new Set(mediaIds)
      const found = new Map<string, GalleryItemEntity>()
      setHydratingIds((current) => new Set([...current, ...mediaIds]))
      // A retry continues from where the last read stopped, not page 1.
      let cursor: string | undefined = resume?.from
      let hasMore = true
      let pages = 0
      // shortcut: A requested photo can sit beyond the current loaded pages.
      try {
        while (hasMore && found.size < wanted.size && pages < 50) {
          if (isStale()) break
          const page = await getGalleryMedia(actorId, {
            limit: 60,
            ...hydrateQuery,
            sort: hydrateSort,
            category: hydrateFilter === 'all' ? undefined : hydrateFilter,
            show: hydrateShow,
            dayKey,
            signal,
            ...(hydrateSort === 'uploaded' ? { maxId: cursor } : { cursor })
          })
          if (isStale()) break
          pages += 1
          for (const item of page.items) {
            if (wanted.has(item.mediaId)) found.set(item.mediaId, item)
          }
          cursor =
            hydrateSort === 'uploaded'
              ? (page.nextMaxId ?? undefined)
              : (page.nextCursor ?? undefined)
          hasMore = Boolean(cursor)
        }
        // The page bound stopped the read: report the cursor a retry
        // continues from, so it does not re-scan the pages before it.
        if (resume && pages === 50 && hasMore && found.size < wanted.size) {
          resume.stoppedAt = cursor
        }
        const items = mediaIds.flatMap((id) => {
          const item = found.get(id)
          return item ? [item] : []
        })
        if (!isStale()) {
          setSeen((current) => {
            const next = new Map(current)
            for (const item of items) next.set(item.mediaId, item)
            return next
          })
        }
        return items
      } finally {
        setHydratingIds((current) => {
          const next = new Set(current)
          for (const id of mediaIds) next.delete(id)
          return next
        })
      }
    },
    [actorId, query, filter, show, sort]
  )
  const handleDayItemsLoaded = useCallback((items: GalleryItemEntity[]) => {
    setSeen((current) => {
      const next = new Map(current)
      for (const item of items) next.set(item.mediaId, item)
      return next
    })
  }, [])

  // Select day / Deselect day for the day headers. All media has no album
  // capacity, so `room` is null. A context change (selection mode, sort,
  // filters, list) drops pending day-id reads and the stale toast and error.
  const day = useDaySelection({
    selected,
    onChange: setSelected,
    sort,
    room: null,
    ownerKey: actorId,
    resetKey: [
      actorId,
      isSelecting ? 'select' : 'view',
      sort,
      show,
      filter,
      JSON.stringify(query)
    ].join('|'),
    fetchIds: (dayKey, limit, offset) =>
      getGalleryMediaIds(actorId, {
        ...query,
        category: filter === 'all' ? undefined : filter,
        show,
        dayKey,
        limit,
        ...(offset !== undefined ? { offset } : null)
      }),
    loadItems: loadDayItems,
    querySnapshot: (): DayHydrationQuery => ({ query, filter, show }),
    onItemsLoaded: handleDayItemsLoaded
  })
  // The range anchor for Shift-click / Shift+Space, and the announcement the
  // sr-only live region reads after a range.
  const [anchor, setAnchor] = useState<string | null>(null)
  const [rangeAnnouncement, setRangeAnnouncement] = useState('')

  // Entering Select mode changes the day selection's resetKey, which clears
  // what it has learned about the loaded tiles, without reloading the grid:
  // re-learn them so the day headers keep counting picks per day.
  const loadedRef = useRef(loaded)
  useEffect(() => {
    loadedRef.current = loaded
  }, [loaded])
  const noteItemsRef = useRef(day.noteItems)
  noteItemsRef.current = day.noteItems
  const wasSelectingRef = useRef(isSelecting)
  useEffect(() => {
    if (isSelecting && !wasSelectingRef.current) {
      noteItemsRef.current(loadedRef.current)
    }
    wasSelectingRef.current = isSelecting
  }, [isSelecting])

  // Display order of the loaded tiles, grouped by day exactly as the grid
  // groups them, so a range spans the same tiles the owner sees.
  const displayIds = useMemo(
    () =>
      groupGalleryItemsByDay(loaded, sort).flatMap((group) =>
        group.items.map((item) => item.mediaId)
      ),
    [loaded, sort]
  )

  const setFilter = (next: Filter) => {
    setReuseInitialPage(false)
    setFilterState(next)
    scrollToTop()
  }

  const setShow = (next: GalleryShow) => {
    setReuseInitialPage(false)
    setShowState(next)
    scrollToTop()
  }

  const handleItemsChange = useCallback(
    (items: GalleryItemEntity[]) => {
      setLoaded(items)
      // Select day counts picks per day from the tiles it has seen.
      day.noteItems(items)
      setSeen((current) => {
        const next = new Map(current)
        for (const item of items) {
          next.set(item.mediaId, item)
        }
        return next
      })
    },
    [day.noteItems]
  )

  const dropMediaIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const dropSet = new Set(ids)
    setSelected((current) => current.filter((id) => !dropSet.has(id)))
    setSeen((current) => {
      let changed = false
      const next = new Map(current)
      for (const id of ids) {
        if (next.delete(id)) changed = true
      }
      return changed ? next : current
    })
  }, [])

  const toggle = useCallback(
    (item: GalleryItemEntity, modifiers?: { shiftKey: boolean }) => {
      // A range needs an anchor still on screen: after a filter change the
      // old anchor is gone, and a Shift-toggle then flips one tile and
      // becomes the anchor itself.
      if (
        modifiers?.shiftKey &&
        anchor !== null &&
        displayIds.includes(anchor)
      ) {
        const result = applyRangeSelection({
          order: displayIds,
          anchorId: anchor,
          targetId: item.mediaId,
          // The anchor's state after its own toggle decides the range's.
          select: selectedSet.has(anchor),
          selected: selectedSet,
          blocked: NO_BLOCKED,
          room: Infinity
        })
        const removed = new Set(result.removed)
        setSelected((current) =>
          [...current, ...result.added].filter((id) => !removed.has(id))
        )
        setRangeAnnouncement(describeRangeResult(result))
        return
      }
      setSelected((current) =>
        current.includes(item.mediaId)
          ? current.filter((id) => id !== item.mediaId)
          : [...current, item.mediaId]
      )
      setAnchor(item.mediaId)
    },
    [anchor, displayIds, selectedSet]
  )
  const selection = useMemo(
    () =>
      isSelecting
        ? { selected: selectedSet, onToggle: toggle, anchorId: anchor }
        : undefined,
    [isSelecting, selectedSet, toggle, anchor]
  )

  const stopSelecting = () => {
    setIsSelecting(false)
    setSelected([])
    setAnchor(null)
    day.dismissToast()
    setRangeAnnouncement('')
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
    setFilters(EMPTY_GALLERY_FILTERS)
    setQuery({ sort: 'taken_desc' })
    setReuseInitialPage(false)
    setGridNonce((nonce) => nonce + 1)
    setSelected([])
    setToast({
      id: Date.now(),
      message: `${mediaIds.length} added to your gallery.`,
      mediaIds
    })
  }, [])

  // A dialog being open (Add, edit, delete, album, or the viewer and the Edit
  // details inside the grid) means a drop is not for this page: it would
  // replace the files being added or open Add on top of unsaved edits. The
  // drop is still taken (default prevented), or the browser would open the
  // file in this tab and lose what the dialog holds.
  const dialogOpen =
    addFiles !== null ||
    isEditOpen ||
    isAddOpen ||
    isCreateOpen ||
    deleteIds !== null
  const dialogOpenRef = useRef(dialogOpen)
  useEffect(() => {
    dialogOpenRef.current = dialogOpen
  }, [dialogOpen])

  // Dropping files anywhere on the page adds them. The overlay says so while
  // files are dragged over the window; a drag of anything else is left alone.
  useEffect(() => {
    if (!isUploadEnabled) return
    let depth = 0
    const isDialogOpen = () =>
      dialogOpenRef.current ||
      document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
    const enter = (event: DragEvent) => {
      if (!hasFiles(event) || isDialogOpen()) return
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
      if (isDialogOpen()) return
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
  }, [startAdd, isUploadEnabled])

  const allUnposted =
    selectedItems.length > 0 &&
    selectedItems.every((item) => item.posted === false)
  const missingSelectedCount = selected.length - selectedItems.length
  const isHydratingSelected = selected.some(
    (id) => !seen.has(id) && hydratingIds.has(id)
  )
  const hydrationMessage =
    missingSelectedCount === 0
      ? undefined
      : isHydratingSelected
        ? `Loading ${missingSelectedCount} selected photos…`
        : "Some selected photos couldn't be loaded"

  const finish = (result: Outcome) => {
    finished.current = true
    setOutcome(result)
    stopSelecting()
  }

  // One sticky header per day, with the Select day button in Select mode.
  // Memoised: the grid re-renders on every tick otherwise.
  const renderGroups = useCallback(
    (
      items: GalleryItemEntity[],
      days: Record<GalleryDayKey, GalleryDayStats>
    ) =>
      groupGalleryItemsByDay(items, sort).map((group) => ({
        key: group.key,
        items: group.items,
        header: (
          <GalleryDayHeader
            as="h2"
            dayKey={group.key}
            stats={days[group.key]}
            loadedCount={group.items.length}
            loadedInAlbum={0}
            picked={day.pickedInDay(group.key)}
            selecting={isSelecting}
            hasAlbum={false}
            room={null}
            busyKey={day.busyKey}
            busyCount={day.busyKey === group.key ? day.busyCount : 0}
            onSelectDay={day.selectDay}
            onDeselectDay={day.deselectDay}
            className="bg-background top-[calc(56px+env(safe-area-inset-top,0px)+var(--status-strip-h,0px))] md:top-[79px]"
          />
        )
      })),
    [
      sort,
      isSelecting,
      day.pickedInDay,
      day.selectDay,
      day.deselectDay,
      day.busyKey,
      day.busyCount
    ]
  )

  const hasFilters = countActiveFilters(filters) > 0
  const isDefaultFiltersAndSort = !hasFilters && filters.sort === 'taken_desc'

  return (
    <div className="space-y-6">
      <PageHeader
        title="All media"
        description="Every photo and video you've posted or added"
        actions={
          <div className="flex items-center gap-2">
            {isUploadEnabled ? (
              <>
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
              </>
            ) : null}
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
      <div ref={filterBarRef} className="md:scroll-mt-24">
        <GalleryMediaFilterBar
          idPrefix="all-media"
          leading={
            <>
              <SectionNavSelect
                label="Category"
                tabs={FILTER_TABS}
                active={filter}
                onChange={setFilter}
              />
              <GalleryShowSelect value={show} onChange={setShow} />
            </>
          }
          filters={filters}
          onChange={handleFilterChange}
          facets={facets}
          facetsError={facetsError}
          onRetryFacets={() => setFacetsReloadKey((key) => key + 1)}
          total={total}
          countDraft={countDraft}
        />
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
      <div
        role="status"
        aria-live="polite"
        data-testid="added-announcement"
        className="sr-only"
      >
        {[
          toast
            ? toast.mediaIds.length > maxMediaAttachments
              ? `${toast.message} Up to ${maxMediaAttachments} per post: select some to post.`
              : toast.message
            : '',
          day.announcement,
          rangeAnnouncement
        ]
          .filter(Boolean)
          .join(' ')}
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
        key={`${filter}:${show}:${JSON.stringify(query)}:${gridNonce}`}
        actorId={actorId}
        category={filter === 'all' ? undefined : filter}
        show={show}
        query={query}
        includeDays
        renderGroups={renderGroups}
        initialPage={
          reuseInitialPage &&
          filter === startFilter &&
          show === initialShow &&
          isDefaultFiltersAndSort
            ? initialPage
            : undefined
        }
        controllerRef={gridController}
        emptyTitle={
          filter === 'all'
            ? EMPTY_TITLES[show]
            : `No ${GALLERY_CATEGORY_LABELS[filter].toLowerCase()} yet`
        }
        emptyState={
          hasFilters ? (
            <GalleryMediaFilterEmpty
              filters={filters}
              facets={facets}
              onChange={handleFilterChange}
            />
          ) : undefined
        }
        selection={selection}
        albumsOwnerId={actorId}
        onPostItems={postMedia}
        onItemsDeleted={(ids) => {
          dropMediaIds(ids)
          setOutcome({ message: describeDeleted(ids.length) })
        }}
        onItemsChange={handleItemsChange}
        onTotalChange={setTotal}
        onAlbumsChanged={
          show === 'not_in_album'
            ? () => {
                setReuseInitialPage(false)
                setGridNonce((nonce) => nonce + 1)
              }
            : undefined
        }
      />
      {isSelecting ? (
        <div
          data-testid="day-selection-stack"
          className="sticky bottom-3 z-20 flex flex-col gap-2 max-sm:bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]"
        >
          {day.toast || day.error ? (
            <div
              data-testid="day-selection-feedback"
              className="flex w-full flex-col gap-2"
            >
              {day.toast ? (
                <div
                  data-testid="day-undo-toast-container"
                  className="pointer-events-none flex justify-center px-4"
                >
                  <AlbumUndoToast
                    toast={day.toast}
                    onDismiss={day.dismissToast}
                    className="pointer-events-auto max-w-full"
                  />
                </div>
              ) : null}
              {day.error ? (
                <Alert title={day.error} onRetry={day.retry} />
              ) : null}
            </div>
          ) : null}
          <GallerySelectionBar
            sticky={false}
            count={selected.length}
            loadedCount={loaded.length}
            loadedSelectedCount={
              loaded.filter((item) => selectedSet.has(item.mediaId)).length
            }
            onSelectAllLoaded={selectAllLoaded}
            onClear={() => setSelected([])}
            onAddToAlbum={() => setIsAddOpen(true)}
            onEditDetails={() => {
              setEditItems(selectedItems)
              setIsEditOpen(true)
            }}
            allUnposted={allUnposted}
            maxPostAttachments={maxMediaAttachments}
            onPost={() => postMedia(selectedItems.map((item) => item.mediaId))}
            onDelete={() =>
              setDeleteIds(selectedItems.map((item) => item.mediaId))
            }
            actionCount={selectedItems.length}
            selectionIncomplete={missingSelectedCount > 0}
            hydrationPending={missingSelectedCount > 0 && isHydratingSelected}
            hydrationMessage={hydrationMessage}
            onRetryLoading={day.retryHydration}
          />
        </div>
      ) : null}

      {isEditOpen && editItems.length > 0 ? (
        <GalleryEditDetailsDialog
          items={editItems}
          initialMediaId={editItems[0].mediaId}
          ownerId={actorId}
          onClose={() => setIsEditOpen(false)}
          onSaved={(saved) => {
            setSeen((current) => {
              const next = new Map(current)
              for (const item of saved) {
                next.set(item.mediaId, item)
              }
              return next
            })
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
            dropMediaIds(ids)
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
            dropMediaIds(gone)
            gridController.current?.removeItems(gone)
          }}
          onDeleted={(gone) => {
            dropMediaIds(gone)
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
            // More than one post holds: choose some in Select mode instead.
            disabled: toast.mediaIds.length > maxMediaAttachments,
            hint: `Up to ${maxMediaAttachments} per post`,
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
        mediaIds={selected}
        onOpenChange={setIsAddOpen}
        onNewAlbum={() => {
          setIsAddOpen(false)
          setIsCreateOpen(true)
        }}
        onAdded={(result) => {
          if (show === 'not_in_album') {
            setReuseInitialPage(false)
            setGridNonce((nonce) => nonce + 1)
          }
          finish(result)
        }}
        onCloseAutoFocus={restoreFocus}
      />
      <GalleryAlbumFormDialog
        open={isCreateOpen}
        ownerId={actorId}
        intent="create"
        initialMediaIds={selected}
        initialItems={selectedItems}
        onOpenChange={setIsCreateOpen}
        onCloseAutoFocus={restoreFocus}
        onSaved={(albumId) => {
          if (show === 'not_in_album') {
            setReuseInitialPage(false)
            setGridNonce((nonce) => nonce + 1)
          }
          finish({
            albumId,
            message: 'Album created.'
          })
        }}
      />
    </div>
  )
}

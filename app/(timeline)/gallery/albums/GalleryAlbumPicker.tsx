'use client'

import { Images } from 'lucide-react'
import Link from 'next/link'
import {
  type Dispatch,
  type FC,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  countGalleryMedia,
  getGalleryMedia,
  getGalleryMediaIds
} from '@/lib/client'
import { AlbumUndoToast } from '@/lib/components/gallery/AlbumUndoToast'
import { GalleryDayHeader } from '@/lib/components/gallery/GalleryDayHeader'
import { GalleryMediaFilterBar } from '@/lib/components/gallery/filters/GalleryMediaFilterBar'
import { GalleryMediaFilterEmpty } from '@/lib/components/gallery/filters/GalleryMediaFilterEmpty'
import {
  EMPTY_GALLERY_FILTERS,
  type GalleryMediaFilterState,
  countActiveFilters,
  toGalleryMediaQuery
} from '@/lib/components/gallery/filters/galleryMediaFilterState'
import { useGalleryMediaFacets } from '@/lib/components/gallery/filters/useGalleryMediaFacets'
import { groupGalleryItemsByDay } from '@/lib/components/gallery/galleryDayGroups'
import {
  applyRangeSelection,
  describeRangeResult
} from '@/lib/components/gallery/gallerySelectionKeys'
import {
  type GalleryHydrationResume,
  useDaySelection
} from '@/lib/components/gallery/useDaySelection'
import { useRovingGridFocus } from '@/lib/components/gallery/useRovingGridFocus'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import type {
  GalleryDayKey,
  GalleryDayStats,
  GalleryItemEntity
} from '@/lib/services/gallery/galleryEntities'
import type {
  GalleryMediaSort,
  GalleryShow
} from '@/lib/types/database/gallery'
import { cn } from '@/lib/utils'

import { GalleryAlbumPickerTile } from './GalleryAlbumPickerTile'
import { scrollToResultsStart } from './galleryAlbumPickerUi'

export interface GalleryAlbumPickerProps {
  ownerId: string
  /** Media ids in the order they were picked; the first is the cover. */
  selected: string[]
  onChange: Dispatch<SetStateAction<string[]>>
  /** The first picked photo (the cover), or null when none is picked. */
  onFirstItemChange?: (item: GalleryItemEntity | null) => void
  /** How many more photos the album can take. */
  capacity: number
  /** Media ids already in the album: shown as such and not pickable. */
  existingIds?: readonly string[]
  /**
   * Photos the caller already holds (the ones it preselected), so the cover
   * shows even when they are not in the pages loaded here.
   */
  seedItems?: readonly GalleryItemEntity[]
  disabled?: boolean
  columns?: 4 | 5
  albumId?: string
  /** The filters the picker opens with (Add photos seeds the album's dates). */
  initialFilters?: GalleryMediaFilterState
  /** Every photo the picker has loaded, as pages land (the dialog's strip shows thumbs from these). */
  onItemsLoaded?: (items: GalleryItemEntity[]) => void
}

const PAGE_SIZE = 60

/**
 * The query context a day's hydration pages with (whatever `loadDayItems`
 * reads). The day selection snapshots it when a hydration starts and hands
 * it back on every retry, so a later filter or sort change never moves the
 * read to a query the picked ids do not match.
 */
interface DayHydrationQuery {
  filters: GalleryMediaFilterState
  show: GalleryShow
  albumId?: string
}

/**
 * The "From gallery" picker: the owner's own photos, filtered and sorted by
 * server queries via the filter bar.
 */
export const GalleryAlbumPicker: FC<GalleryAlbumPickerProps> = ({
  ownerId,
  selected,
  onChange,
  onFirstItemChange,
  capacity,
  existingIds,
  seedItems,
  disabled = false,
  columns = 4,
  albumId,
  initialFilters,
  onItemsLoaded
}) => {
  const [filters, setFilters] = useState<GalleryMediaFilterState>(
    initialFilters ?? EMPTY_GALLERY_FILTERS
  )
  const show: GalleryShow = filters.notInAlbum ? 'not_in_album' : 'all'
  const [facetsReloadKey, setFacetsReloadKey] = useState(0)
  const { facets, error: facetsError } = useGalleryMediaFacets(
    show,
    facetsReloadKey
  )
  const retryFacets = useCallback(
    () => setFacetsReloadKey((key) => key + 1),
    []
  )
  // Menus open inside the dialog (when there is one), or they would sit
  // outside its focus trap.
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  )

  const [items, setItems] = useState<GalleryItemEntity[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [nextMaxId, setNextMaxId] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [inAlbumTotal, setInAlbumTotal] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The query the items on screen answer; null until the first answer lands.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  // Per-day server stats (owner, include_days), merged across pages.
  const [days, setDays] = useState<Record<GalleryDayKey, GalleryDayStats>>({})
  // The range anchor and the live-region message of the last range change.
  const [anchor, setAnchor] = useState<string | null>(null)
  const [rangeAnnouncement, setRangeAnnouncement] = useState('')

  // Bumped by every restart so a slow answer to an older query is dropped.
  const generation = useRef(0)
  // Every photo this picker has shown, so a pick survives a filter change.
  const seen = useRef(
    new Map<string, GalleryItemEntity>(
      (seedItems ?? []).map((item) => [item.mediaId, item])
    )
  )
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setPortalContainer(
      rootRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null
    )
  }, [])

  const isLoadingRef = useRef(isLoading)
  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])

  const existingSet = useMemo(() => new Set(existingIds), [existingIds])
  // Never negative: room 0 means "Album full", a negative room would read as
  // "Select -N (room left)".
  const room = Math.max(capacity - selected.length, 0)

  const queryKey = useMemo(
    () =>
      JSON.stringify({
        filters,
        show,
        ownerId,
        albumId
      }),
    [filters, show, ownerId, albumId]
  )

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
      const hydrateSort = sortOverride ?? filters.sort
      const hydrateFilters = queryOverride?.filters ?? filters
      const hydrateShow = queryOverride?.show ?? show
      const hydrateAlbumId = queryOverride?.albumId ?? albumId
      const wanted = new Set(mediaIds)
      const found = new Map<string, GalleryItemEntity>()
      const query = toGalleryMediaQuery(
        { ...hydrateFilters, sort: hydrateSort },
        new Date()
      )
      // A retry continues from where the last read stopped, not page 1.
      let cursor: string | undefined = resume?.from
      let hasMore = true
      let pages = 0
      // shortcut: A requested photo can sit beyond the current loaded pages.
      while (hasMore && found.size < wanted.size && pages < 50) {
        if (isStale()) break
        const page = await getGalleryMedia(ownerId, {
          limit: PAGE_SIZE,
          show: hydrateShow,
          albumId: hydrateAlbumId,
          dayKey,
          signal,
          ...query,
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
      return mediaIds.flatMap((id) => {
        const item = found.get(id)
        return item ? [item] : []
      })
    },
    [filters, ownerId, show, albumId]
  )

  const handleDayItemsLoaded = useCallback(
    (items: GalleryItemEntity[]) => {
      for (const item of items) seen.current.set(item.mediaId, item)
      onItemsLoaded?.(items)
    },
    [onItemsLoaded]
  )

  const day = useDaySelection({
    selected,
    onChange,
    sort: filters.sort,
    existingIds: existingSet,
    room,
    ownerKey: ownerId,
    fetchIds: (dayKey, limit, offset) =>
      getGalleryMediaIds(ownerId, {
        ...toGalleryMediaQuery(filters, new Date()),
        show,
        albumId,
        dayKey,
        limit,
        ...(offset !== undefined ? { offset } : null)
      }),
    loadItems: loadDayItems,
    querySnapshot: (): DayHydrationQuery => ({ filters, show, albumId }),
    onItemsLoaded: handleDayItemsLoaded,
    resetKey: queryKey,
    disabled
  })
  const { noteItems } = day

  // Pre-seeded photos (Add photos) count towards their day before their page
  // loads.
  useEffect(() => {
    if (seedItems && seedItems.length > 0) noteItems([...seedItems])
  }, [noteItems, seedItems])

  const load = useCallback(
    async (restart: boolean, cursorParam?: string) => {
      const current = restart ? ++generation.current : generation.current
      isLoadingRef.current = true
      setIsLoading(true)
      setError(null)
      if (restart) {
        // The old query's tiles and cursors must not stay actionable, and a
        // failed restart must retry as a restart.
        setItems([])
        setNextCursor(null)
        setNextMaxId(null)
        setTotal(null)
        setInAlbumTotal(null)
        setDays({})
        setAnchor(null)
        setRangeAnnouncement('')
      }
      try {
        const query = toGalleryMediaQuery(filters, new Date())
        const page = await getGalleryMedia(ownerId, {
          limit: PAGE_SIZE,
          includeDays: true,
          ...(restart ? { includeTotal: true } : {}),
          show,
          ...(albumId ? { albumId } : {}),
          ...query,
          ...(filters.sort === 'uploaded'
            ? { maxId: cursorParam }
            : { cursor: cursorParam })
        })
        if (current !== generation.current) return
        for (const item of page.items) seen.current.set(item.mediaId, item)
        onItemsLoaded?.(page.items)
        noteItems(page.items)
        const pageDays = page.days
        if (pageDays) setDays((current) => ({ ...current, ...pageDays }))
        setItems((existing) => {
          const base = restart ? [] : existing
          const seenIds = new Set(base.map((item) => item.mediaId))
          return [
            ...base,
            ...page.items.filter((item) => !seenIds.has(item.mediaId))
          ]
        })
        setNextMaxId(page.nextMaxId ?? null)
        setNextCursor(page.nextCursor ?? null)
        if (restart) {
          setTotal(page.total ?? null)
          setInAlbumTotal(page.inAlbumTotal ?? null)
        }
        setLoadedKey(queryKey)
      } catch (loadError) {
        if (current !== generation.current) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load photos.'
        )
      } finally {
        if (current === generation.current) {
          isLoadingRef.current = false
          setIsLoading(false)
        }
      }
    },
    [ownerId, show, albumId, filters, noteItems, queryKey, onItemsLoaded]
  )

  useEffect(() => {
    void load(true)
  }, [load])

  const groups = useMemo(
    () => groupGalleryItemsByDay(items, filters.sort),
    [items, filters.sort]
  )
  const groupSizes = useMemo(
    () => groups.map((group) => group.items.length),
    [groups]
  )
  const groupStarts = useMemo(() => {
    const starts: number[] = []
    let offset = 0
    for (const group of groups) {
      starts.push(offset)
      offset += group.items.length
    }
    return starts
  }, [groups])
  // Display (grouped) order: what the range and roving navigation use.
  const displayIds = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => item.mediaId)),
    [groups]
  )
  const roving = useRovingGridFocus({
    enabled: !disabled,
    count: displayIds.length,
    groupSizes
  })

  const hasMore =
    filters.sort === 'uploaded' ? Boolean(nextMaxId) : Boolean(nextCursor)
  const cursorParam =
    (filters.sort === 'uploaded' ? nextMaxId : nextCursor) ?? undefined

  const { loadMoreRef } = useLoadMoreOnVisible({
    enabled: hasMore && !error && !isLoading,
    onLoadMore: useCallback(() => {
      if (!isLoadingRef.current && cursorParam) {
        void load(false, cursorParam)
      }
    }, [load, cursorParam])
  })

  const firstSelected = selected[0] ?? null
  useEffect(() => {
    onFirstItemChange?.(
      firstSelected ? (seen.current.get(firstSelected) ?? null) : null
    )
  }, [firstSelected, onFirstItemChange])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const isFull = selected.length >= capacity

  const toggle = (
    mediaId: string,
    modifiers: { shiftKey: boolean } = { shiftKey: false }
  ) => {
    if (disabled) return
    if (modifiers.shiftKey && anchor !== null && displayIds.includes(anchor)) {
      // The target may itself be blocked (in album, or the album is full):
      // the range still applies up to it — the blocked target stays
      // unpicked and the anchor does not move — like ranges already skip
      // blocked tiles in the middle.
      const result = applyRangeSelection({
        order: displayIds,
        anchorId: anchor,
        targetId: mediaId,
        select: selectedSet.has(anchor),
        selected: selectedSet,
        blocked: existingSet,
        room
      })
      const removedSet = new Set(result.removed)
      onChange(
        [...selected, ...result.added].filter((id) => !removedSet.has(id))
      )
      setRangeAnnouncement(describeRangeResult(result))
      return
    }

    if (existingSet.has(mediaId)) return

    if (selectedSet.has(mediaId)) {
      onChange(selected.filter((id) => id !== mediaId))
      setAnchor(mediaId)
      setRangeAnnouncement('')
    } else if (!isFull) {
      onChange([...selected, mediaId])
      setAnchor(mediaId)
      setRangeAnnouncement('')
    }
  }

  const selectAllShown = () => {
    const room = capacity - selected.length
    const additions = items
      .map((item) => item.mediaId)
      .filter((id) => !selectedSet.has(id) && !existingSet.has(id))
      .slice(0, Math.max(room, 0))
    if (additions.length > 0) onChange([...selected, ...additions])
  }

  const countDraft = useCallback(
    (d: GalleryMediaFilterState) =>
      countGalleryMedia(ownerId, {
        ...toGalleryMediaQuery(d, new Date()),
        show: d.notInAlbum ? 'not_in_album' : 'all',
        albumId
      }),
    [ownerId, albumId]
  )

  const handleFilterChange = (next: GalleryMediaFilterState) => {
    setFilters(next)
    scrollToResultsStart(rootRef.current)
  }

  const isCurrent = loadedKey === queryKey
  const isGalleryEmpty =
    isCurrent &&
    !isLoading &&
    items.length === 0 &&
    countActiveFilters(filters) === 0 &&
    !filters.notInAlbum &&
    !error

  if (isGalleryEmpty) {
    return (
      <div className="bg-muted/40 flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
        <span
          aria-hidden="true"
          className="bg-background flex size-10 items-center justify-center rounded-lg border"
        >
          <Images className="text-muted-foreground size-5" />
        </span>
        <div>
          <p className="text-sm font-semibold">No photos yet</p>
          <p className="text-muted-foreground text-sm">
            Photos you post, or add in Gallery, show up here.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/gallery/media" prefetch={false}>
            Go to All media
          </Link>
        </Button>
      </div>
    )
  }

  const skeletonCount = columns === 5 ? 5 : 4

  return (
    <div ref={rootRef} onKeyDown={roving.onKeyDown} className="space-y-3">
      <GalleryMediaFilterBar
        idPrefix="album-picker"
        filters={filters}
        onChange={handleFilterChange}
        facets={facets}
        facetsError={facetsError}
        onRetryFacets={retryFacets}
        portalContainer={portalContainer}
        showNotInAlbumToggle
        total={total}
        inAlbumTotal={inAlbumTotal}
        countDraft={countDraft}
        disabled={disabled}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={selectAllShown}
          className="pointer-coarse:h-10"
          disabled={
            disabled ||
            isFull ||
            items.every(
              (item) =>
                selectedSet.has(item.mediaId) || existingSet.has(item.mediaId)
            )
          }
        >
          Select all shown
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="pointer-coarse:h-10"
          onClick={() => onChange([])}
          disabled={disabled || selected.length === 0}
        >
          Clear selection
        </Button>
      </div>

      <div role="status" className="sr-only">
        {[
          isLoading && items.length > 0 ? 'Loading more photos' : '',
          day.announcement,
          rangeAnnouncement
        ]
          .filter(Boolean)
          .join('. ')}
      </div>

      {items.length === 0 && !error && (isLoading || !isCurrent) ? (
        <div
          className={cn(
            'grid grid-cols-3 gap-1',
            columns === 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
          )}
          aria-busy="true"
        >
          <span className="sr-only">Loading photos</span>
          {Array.from({ length: 12 }, (_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="skeleton aspect-square rounded-md"
            />
          ))}
        </div>
      ) : items.length > 0 ? (
        groups.map((group, groupIndex) => (
          <section key={group.key} className="space-y-2">
            <GalleryDayHeader
              dayKey={group.key}
              stats={days[group.key]}
              loadedCount={group.items.length}
              loadedInAlbum={
                group.items.filter((item) => existingSet.has(item.mediaId))
                  .length
              }
              picked={day.pickedInDay(group.key)}
              selecting
              hasAlbum={Boolean(albumId)}
              room={room}
              busyKey={day.busyKey}
              busyCount={day.busyKey === group.key ? day.busyCount : 0}
              disabled={disabled}
              onSelectDay={day.selectDay}
              onDeselectDay={day.deselectDay}
              as="h3"
              className="-top-1.5 bg-background dark:bg-card"
            />
            <ul
              className={cn(
                'grid grid-cols-3 gap-1',
                columns === 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
              )}
              data-grid
              aria-busy={isLoading}
            >
              {group.items.map((item, itemIndex) => {
                const flatIndex = groupStarts[groupIndex] + itemIndex
                return (
                  <li key={item.mediaId} className="min-w-0">
                    <GalleryAlbumPickerTile
                      item={item}
                      index={flatIndex}
                      isSelected={selectedSet.has(item.mediaId)}
                      isMember={existingSet.has(item.mediaId)}
                      isBlocked={!selectedSet.has(item.mediaId) && isFull}
                      disabled={disabled}
                      showCaption
                      showCaptionDate={false}
                      tabIndex={roving.getTabIndex(flatIndex)}
                      onFocus={() => roving.onFocusTile(flatIndex)}
                      isAnchor={anchor === item.mediaId}
                      onToggle={toggle}
                    />
                  </li>
                )
              })}
              {isLoading && items.length > 0 && groupIndex === groups.length - 1
                ? Array.from({ length: skeletonCount }, (_, index) => (
                    <li
                      key={`skeleton-${index}`}
                      aria-hidden="true"
                      className={index >= 3 ? 'hidden sm:block' : undefined}
                    >
                      <div className="skeleton aspect-square rounded-md" />
                    </li>
                  ))
                : null}
            </ul>
          </section>
        ))
      ) : error ? null : (
        <GalleryMediaFilterEmpty
          filters={filters}
          facets={facets}
          onChange={handleFilterChange}
        />
      )}

      {hasMore && !error ? (
        <div ref={loadMoreRef} aria-hidden="true" className="h-px" />
      ) : null}

      {error ? <Alert title={error} /> : null}
      {error && cursorParam && items.length > 0 ? (
        <LoadMoreButton onClick={() => void load(false, cursorParam)}>
          Try again
        </LoadMoreButton>
      ) : error && items.length === 0 ? (
        <LoadMoreButton onClick={() => void load(true)}>
          Try again
        </LoadMoreButton>
      ) : null}

      {day.toast || day.error ? (
        <div
          data-testid="day-feedback-container"
          className="sticky -bottom-1.5 z-20 space-y-2 border-t bg-background p-2 dark:bg-card"
        >
          {day.toast ? (
            <AlbumUndoToast
              toast={day.toast}
              onDismiss={day.dismissToast}
              className="w-fit max-w-full"
            />
          ) : null}
          {day.error ? <Alert title={day.error} onRetry={day.retry} /> : null}
        </div>
      ) : null}
    </div>
  )
}

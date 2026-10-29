'use client'

import { Images } from 'lucide-react'
import {
  FC,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'

import { getGalleryMedia } from '@/lib/client'
import {
  GalleryGrid,
  type GalleryGridGroup,
  type GalleryGridSelection
} from '@/lib/components/gallery/GalleryGrid'
import { GalleryGridSkeleton } from '@/lib/components/gallery/GalleryGridSkeleton'
import type { GalleryMediaQuery } from '@/lib/components/gallery/galleryMediaQuery'
import {
  LOAD_MORE_CONTAINER_CLASS,
  LoadMoreButton
} from '@/lib/components/load-more-button/load-more-button'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import type {
  GalleryDayKey,
  GalleryDayStats,
  GalleryItemEntity,
  GalleryMediaPage
} from '@/lib/services/gallery/galleryEntities'
import type {
  GalleryMediaSort,
  GalleryShow,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'

/** What a page holding the grid can do to the photos it has loaded. */
export interface GalleryPagedGridController {
  /**
   * Replaces loaded tiles with their edited copies (matched by media id), for
   * an edit made outside the grid, such as Select mode's Edit details. A tile
   * that no longer belongs under the grid's `show` filter leaves the list.
   */
  updateItems: (items: GalleryItemEntity[]) => void
  /** Drops loaded tiles by media id, for photos deleted outside the grid. */
  removeItems: (mediaIds: string[]) => void
}

export interface GalleryPagedGridProps {
  actorId: string
  /** A `toSubjectKey` key. */
  subject?: string
  category?: MediaSubjectCategory
  /** Owner only: one camera or lens. */
  gearId?: string
  /**
   * Owner only: `all` media (posted or added), just the `hidden` ones, the
   * `in_gallery` ones or those `not_posted` yet. Left out, the server lists the
   * gallery's photos.
   */
  show?: GalleryShow
  sort?: GalleryMediaSort
  query?: GalleryMediaQuery
  albumId?: string
  /** A page the server already loaded; without it the grid loads its own. */
  initialPage?: GalleryMediaPage
  emptyTitle?: string
  emptyState?: ReactNode
  showCaption?: boolean
  /** Select mode (owner views): tiles toggle instead of opening the viewer. */
  selection?: GalleryGridSelection
  /**
   * The hidden badge on each tile: on by default. A host whose filter already
   * screens for hidden photos turns it off (see `GalleryGrid`).
   */
  showHiddenBadge?: boolean
  /** Owner only: ask for per-day stats (`days`) on every page request. */
  includeDays?: boolean
  /**
   * Renders the loaded items as day groups (headers included). When given,
   * the grid receives the groups and their items flattened in order.
   */
  renderGroups?: (
    items: GalleryItemEntity[],
    days: Record<GalleryDayKey, GalleryDayStats>
  ) => GalleryGridGroup[]
  /** The signed-in owner's actor id when these are their own photos. */
  albumsOwnerId?: string | null
  /** Owner views: Post… from Edit details over the viewer (see `GalleryGrid`). */
  onPostItems?: (mediaIds: string[]) => void
  /** Told the photos Edit details deleted, once they are gone from the grid. */
  onItemsDeleted?: (mediaIds: string[]) => void
  /** Told the photos loaded so far each time they change. */
  onItemsChange?: (items: GalleryItemEntity[]) => void
  /** Called from the first page, including initialPage.total */
  onTotalChange?: (total: number | null) => void
  /** Lets the page update tiles it edited itself. */
  controllerRef?: RefObject<GalleryPagedGridController | null>
  /** Told which albums had photos added/removed when the viewer closes. */
  onAlbumsChanged?: (albumIds: string[]) => void
}

const PAGE_SIZE = 24
// The server caps how much it scans per request, so a rare subject can come
// back as an empty page that still carries `nextMaxId`. Follow such a cursor
// this many more times on its own, then leave "Load more" to the reader.
const MAX_AUTO_CONTINUES = 2

const appendUnique = (
  current: GalleryItemEntity[],
  next: GalleryItemEntity[]
) => {
  const seen = new Set(current.map((item) => item.mediaId))
  return [...current, ...next.filter((item) => !seen.has(item.mediaId))]
}

// The UTC calendar day of an ISO timestamp; null when unparsable. The
// day-key rule lives in the gallery's day-grouping module, but the route JS
// budget keeps the module out of this file, so the few lines the edit path
// needs are local.
const utcDayOf = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`
}

// The day key one item is grouped under (see `GalleryDayKey`): the UTC
// camera day of a dated photo under a date sort, otherwise its UTC upload
// day with the `uploaded:` prefix.
const dayKeyOfItem = (
  item: GalleryItemEntity,
  sort: GalleryMediaSort
): GalleryDayKey | null => {
  if (
    sort !== 'uploaded' &&
    item.takenAt !== null &&
    item.takenAt !== undefined
  ) {
    const day = utcDayOf(item.takenAt)
    if (day) return day
  }
  const uploadedDay = utcDayOf(item.uploadedAt ?? null)
  return uploadedDay ? `uploaded:${uploadedDay}` : null
}

/**
 * A gallery grid that pages through `getGalleryMedia` with `nextMaxId`. The
 * query is fixed for the life of the component: mount it with a `key` that
 * changes with the query.
 */
export const GalleryPagedGrid: FC<GalleryPagedGridProps> = ({
  actorId,
  subject,
  category,
  gearId,
  show,
  sort,
  query,
  albumId,
  initialPage,
  emptyTitle = 'No photos in your gallery yet',
  emptyState,
  showCaption = true,
  selection,
  showHiddenBadge,
  includeDays = false,
  renderGroups,
  albumsOwnerId,
  onPostItems,
  onItemsDeleted,
  onItemsChange,
  onTotalChange,
  controllerRef,
  onAlbumsChanged
}) => {
  const [items, setItems] = useState<GalleryItemEntity[]>(
    initialPage?.items ?? []
  )
  const [nextMaxId, setNextMaxId] = useState<string | null>(
    initialPage?.nextMaxId ?? null
  )
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialPage?.nextCursor ?? null
  )
  const [isLoading, setIsLoading] = useState(!initialPage)
  const [error, setError] = useState<string | null>(null)
  // Per-day stats, seeded from the server page and merged as pages land; a
  // day that spans pages is answered twice with the same numbers.
  const [days, setDays] = useState<Record<GalleryDayKey, GalleryDayStats>>(
    initialPage?.days ?? {}
  )
  // The sort the server orders and day-keys this grid's reads by; All media
  // carries its filter state's sort inside `query`.
  const effectiveSort: GalleryMediaSort = query?.sort ?? sort ?? 'uploaded'
  const isMounted = useRef(true)

  // The items as last rendered: an edit compares its copy against these to
  // learn the day it moved from.
  const itemsRef = useRef(items)
  itemsRef.current = items

  const isLoadingRef = useRef(false)

  const onTotalChangeRef = useRef(onTotalChange)
  useEffect(() => {
    onTotalChangeRef.current = onTotalChange
  }, [onTotalChange])

  const load = useCallback(
    async (paging?: string | { cursor?: string; maxId?: string }) => {
      if (isLoadingRef.current) return
      isLoadingRef.current = true
      setIsLoading(true)
      setError(null)
      let isFirstPage = false
      try {
        const pagingOptions =
          typeof paging === 'string' ? { maxId: paging } : paging
        let cursor = pagingOptions?.cursor
        let maxId = pagingOptions?.maxId
        let replace = !cursor && !maxId
        for (let attempt = 0; ; attempt += 1) {
          isFirstPage = attempt === 0 && replace
          const page = await getGalleryMedia(actorId, {
            limit: PAGE_SIZE,
            ...(isFirstPage && onTotalChangeRef.current
              ? { includeTotal: true }
              : {}),
            ...(includeDays ? { includeDays: true } : {}),
            ...(cursor ? { cursor } : {}),
            ...(maxId ? { maxId } : {}),
            subject,
            category,
            gearId,
            show,
            sort,
            albumId,
            ...query
          })
          if (!isMounted.current) return
          if (isFirstPage) {
            onTotalChangeRef.current?.(page.total ?? null)
          }
          if (page.days) {
            setDays((current) => ({ ...current, ...page.days }))
          }
          const append = !replace
          setItems((current) =>
            append ? appendUnique(current, page.items) : page.items
          )
          setNextCursor(page.nextCursor ?? null)
          setNextMaxId(page.nextMaxId ?? null)
          const nextPageHasMore = Boolean(page.nextCursor || page.nextMaxId)
          if (
            page.items.length > 0 ||
            !nextPageHasMore ||
            attempt >= MAX_AUTO_CONTINUES
          ) {
            break
          }
          if (page.nextCursor) {
            cursor = page.nextCursor
            maxId = undefined
          } else if (page.nextMaxId) {
            maxId = page.nextMaxId
            cursor = undefined
          }
          replace = false
        }
      } catch (loadError) {
        if (!isMounted.current) return
        // A failed first page must not leave the previous query's count up.
        if (isFirstPage) onTotalChangeRef.current?.(null)
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load photos.'
        )
      } finally {
        if (isMounted.current) {
          isLoadingRef.current = false
          setIsLoading(false)
        }
      }
    },
    [
      actorId,
      subject,
      category,
      gearId,
      show,
      sort,
      albumId,
      query,
      includeDays
    ]
  )

  // An edit that changes a photo's day or place changes the server's day
  // stats for both the day it left and the day it joined. The owner's list
  // read answers one day's stats (`day_key` with `include_days`), so ask
  // for each affected key and merge what it returns into `days`; a key the
  // response no longer reports is dropped and its header falls back to the
  // loaded count. Best effort: a failed refresh keeps the stats it had.
  const refreshDayStats = useCallback(
    async (dayKey: GalleryDayKey) => {
      try {
        const page = await getGalleryMedia(actorId, {
          limit: 1,
          includeDays: true,
          dayKey,
          subject,
          category,
          gearId,
          show,
          sort,
          albumId,
          ...query
        })
        if (!isMounted.current) return
        setDays((current) => {
          const stats = page.days?.[dayKey]
          if (stats === undefined) {
            if (!(dayKey in current)) return current
            const next = { ...current }
            delete next[dayKey]
            return next
          }
          return { ...current, [dayKey]: stats }
        })
      } catch {
        // Keep the stats the last page carried.
      }
    },
    [actorId, subject, category, gearId, show, sort, albumId, query]
  )

  // An edit can move a photo out of the list this grid shows (hidden under
  // "In gallery", back in the gallery under "Hidden from gallery"). It is
  // dropped from the list only once told to, so the viewer a tile was edited
  // from keeps the photos it is paging through.
  const belongsHere = useCallback(
    (item: GalleryItemEntity) => {
      // Without a `show` the server lists the gallery's photos (the subject and
      // gear pages), so that is what an edited tile must still be.
      const list = show ?? 'in_gallery'
      return list === 'in_gallery'
        ? item.inGallery !== false
        : list === 'hidden'
          ? item.inGallery !== true
          : list === 'not_posted'
            ? item.posted === false
            : list === 'not_in_album'
              ? (item.albumCount ?? 0) === 0
              : true
    },
    [show]
  )
  const replaceItems = useCallback(
    (edited: GalleryItemEntity[]) => {
      const byId = new Map(edited.map((item) => [item.mediaId, item]))
      // Only the owner's day-grouped grids carry server day stats, and only
      // an edit that changes a photo's day or place name changes them. A
      // photo the grid has not loaded has no old day to refresh.
      if (includeDays) {
        const touched = new Set<GalleryDayKey>()
        for (const item of edited) {
          const previous = itemsRef.current.find(
            (loaded) => loaded.mediaId === item.mediaId
          )
          if (!previous) continue
          const placeChanged =
            (previous.place?.name ?? null) !== (item.place?.name ?? null)
          if (previous.takenAt === item.takenAt && !placeChanged) continue
          for (const key of [
            dayKeyOfItem(previous, effectiveSort),
            dayKeyOfItem(item, effectiveSort)
          ]) {
            if (key !== null) touched.add(key)
          }
        }
        for (const key of touched) void refreshDayStats(key)
      }
      setItems((current) =>
        current.map((item) => byId.get(item.mediaId) ?? item)
      )
    },
    [includeDays, effectiveSort, refreshDayStats]
  )
  const removeItems = useCallback(
    (mediaIds: string[]) => {
      const gone = new Set(mediaIds)
      // A deleted photo changes the server's day stats for its day (the
      // count, and possibly the place or activity that leads it). Refresh
      // each removed photo's day like the edit path does; only the owner's
      // day-grouped grids carry server day stats.
      if (includeDays) {
        const touched = new Set<GalleryDayKey>()
        for (const item of itemsRef.current) {
          if (!gone.has(item.mediaId)) continue
          const key = dayKeyOfItem(item, effectiveSort)
          if (key !== null) touched.add(key)
        }
        for (const key of touched) void refreshDayStats(key)
      }
      setItems((current) => current.filter((item) => !gone.has(item.mediaId)))
    },
    [includeDays, effectiveSort, refreshDayStats]
  )
  const dropMisfiled = useCallback(
    () =>
      setItems((current) =>
        current.every(belongsHere) ? current : current.filter(belongsHere)
      ),
    [belongsHere]
  )
  useImperativeHandle(
    controllerRef,
    () => ({
      updateItems: (edited) => {
        replaceItems(edited)
        dropMisfiled()
      },
      removeItems
    }),
    [replaceItems, dropMisfiled, removeItems]
  )

  // A ref, so a parent that passes a new callback each render does not make
  // the effect below fire again.
  const onItemsChangeRef = useRef(onItemsChange)
  useEffect(() => {
    onItemsChangeRef.current = onItemsChange
  }, [onItemsChange])
  useEffect(() => {
    onItemsChangeRef.current?.(items)
  }, [items])

  useEffect(() => {
    isMounted.current = true
    if (initialPage) {
      onTotalChangeRef.current?.(initialPage.total ?? null)
    } else {
      void load()
    }
    return () => {
      isMounted.current = false
    }
    // Loads once per mount: the query is fixed for this component's life.
  }, [])

  const hasNext = Boolean(nextCursor || nextMaxId)

  // Memoised by the host: a new callback each render would re-render the grid
  // on every tick.
  const groups = useMemo(
    () => (renderGroups ? renderGroups(items, days) : undefined),
    [renderGroups, items, days]
  )
  // Stable across renders while the groups are, so the grid can tie its
  // in-place edits to this list.
  const gridItems = useMemo(
    () => (groups ? groups.flatMap((group) => group.items) : items),
    [groups, items]
  )

  const loadMore = useCallback(() => {
    if (isLoadingRef.current) return
    if (nextCursor) {
      void load({ cursor: nextCursor })
    } else if (nextMaxId) {
      void load({ maxId: nextMaxId })
    }
  }, [load, nextCursor, nextMaxId])

  const { loadMoreRef } = useLoadMoreOnVisible({
    enabled: hasNext,
    onLoadMore: loadMore
  })

  if (isLoading && items.length === 0) {
    return <GalleryGridSkeleton label="Loading photos" />
  }

  return (
    <div className="space-y-4">
      {items.length > 0 ? (
        <GalleryGrid
          items={gridItems}
          groups={groups}
          showCaption={showCaption}
          selection={selection}
          showHiddenBadge={showHiddenBadge}
          albumsOwnerId={albumsOwnerId}
          onItemEdited={(item) => replaceItems([item])}
          onPostItems={onPostItems}
          onItemsDeleted={
            onItemsDeleted
              ? (ids) => {
                  removeItems(ids)
                  onItemsDeleted(ids)
                }
              : undefined
          }
          onViewerClosed={dropMisfiled}
          onAlbumsChanged={onAlbumsChanged}
        />
      ) : error || hasNext || isLoading ? null : (
        (emptyState ?? <EmptyState icon={Images} title={emptyTitle} />)
      )}
      {error ? <Alert title={error} /> : null}
      {hasNext ? (
        <LoadMoreButton
          containerRef={loadMoreRef}
          isLoading={isLoading}
          loadingText="Loading more"
          onClick={loadMore}
        />
      ) : error && items.length === 0 ? (
        <LoadMoreButton
          containerClassName={LOAD_MORE_CONTAINER_CLASS}
          onClick={() => void load()}
        >
          Try again
        </LoadMoreButton>
      ) : null}
    </div>
  )
}

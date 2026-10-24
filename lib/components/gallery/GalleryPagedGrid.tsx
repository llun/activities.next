'use client'

import { Images } from 'lucide-react'
import {
  FC,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'

import { getGalleryMedia } from '@/lib/client'
import {
  GalleryGrid,
  type GalleryGridSelection
} from '@/lib/components/gallery/GalleryGrid'
import { GalleryGridSkeleton } from '@/lib/components/gallery/GalleryGridSkeleton'
import type { GalleryMediaQuery } from '@/lib/components/gallery/filters/galleryMediaFilterState'
import {
  LOAD_MORE_CONTAINER_CLASS,
  LoadMoreButton
} from '@/lib/components/load-more-button/load-more-button'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import type {
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
  const isMounted = useRef(true)

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
  const replaceItems = useCallback((edited: GalleryItemEntity[]) => {
    const byId = new Map(edited.map((item) => [item.mediaId, item]))
    setItems((current) => current.map((item) => byId.get(item.mediaId) ?? item))
  }, [])
  const removeItems = useCallback((mediaIds: string[]) => {
    const gone = new Set(mediaIds)
    setItems((current) => current.filter((item) => !gone.has(item.mediaId)))
  }, [])
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
          items={items}
          showCaption={showCaption}
          selection={selection}
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

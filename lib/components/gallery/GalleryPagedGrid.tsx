'use client'

import { Images } from 'lucide-react'
import {
  FC,
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
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import type {
  GalleryItemEntity,
  GalleryMediaPage
} from '@/lib/services/gallery/galleryEntities'
import type {
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
}

interface Props {
  actorId: string
  /** A `toSubjectKey` key. */
  subject?: string
  category?: MediaSubjectCategory
  /** Owner only: one camera or lens. */
  gearId?: string
  /** Owner only: `all` posted media, or just the `hidden` ones. */
  show?: GalleryShow
  /** A page the server already loaded; without it the grid loads its own. */
  initialPage?: GalleryMediaPage
  emptyTitle?: string
  showCaption?: boolean
  /** Select mode (owner views): tiles toggle instead of opening the viewer. */
  selection?: GalleryGridSelection
  /** The signed-in owner's actor id when these are their own photos. */
  albumsOwnerId?: string | null
  /** Told the photos loaded so far each time they change. */
  onItemsChange?: (items: GalleryItemEntity[]) => void
  /** Lets the page update tiles it edited itself. */
  controllerRef?: RefObject<GalleryPagedGridController | null>
}

const PAGE_SIZE = 30
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
export const GalleryPagedGrid: FC<Props> = ({
  actorId,
  subject,
  category,
  gearId,
  show,
  initialPage,
  emptyTitle = 'No photos in your gallery yet',
  showCaption = true,
  selection,
  albumsOwnerId,
  onItemsChange,
  controllerRef
}) => {
  const [items, setItems] = useState<GalleryItemEntity[]>(
    initialPage?.items ?? []
  )
  const [nextMaxId, setNextMaxId] = useState<string | null>(
    initialPage?.nextMaxId ?? null
  )
  const [isLoading, setIsLoading] = useState(!initialPage)
  const [error, setError] = useState<string | null>(null)
  const isMounted = useRef(true)

  const load = useCallback(
    async (maxId?: string) => {
      setIsLoading(true)
      setError(null)
      try {
        let cursor = maxId
        let replace = !maxId
        for (let attempt = 0; ; attempt += 1) {
          const page = await getGalleryMedia(actorId, {
            limit: PAGE_SIZE,
            maxId: cursor,
            subject,
            category,
            gearId,
            show
          })
          if (!isMounted.current) return
          const append = !replace
          setItems((current) =>
            append ? appendUnique(current, page.items) : page.items
          )
          setNextMaxId(page.nextMaxId)
          if (
            page.items.length > 0 ||
            !page.nextMaxId ||
            attempt >= MAX_AUTO_CONTINUES
          ) {
            break
          }
          cursor = page.nextMaxId
          replace = false
        }
      } catch (loadError) {
        if (!isMounted.current) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load photos.'
        )
      } finally {
        if (isMounted.current) setIsLoading(false)
      }
    },
    [actorId, subject, category, gearId, show]
  )

  // An edit can move a photo out of the list this grid shows (hidden under
  // "In gallery", back in the gallery under "Hidden from gallery"). It is
  // dropped from the list only once told to, so the viewer a tile was edited
  // from keeps the photos it is paging through.
  const belongsHere = useCallback(
    (item: GalleryItemEntity) =>
      show === 'in_gallery'
        ? item.inGallery !== false
        : show === 'hidden'
          ? item.inGallery !== true
          : true,
    [show]
  )
  const replaceItems = useCallback((edited: GalleryItemEntity[]) => {
    const byId = new Map(edited.map((item) => [item.mediaId, item]))
    setItems((current) => current.map((item) => byId.get(item.mediaId) ?? item))
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
      }
    }),
    [replaceItems, dropMisfiled]
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
    if (!initialPage) void load()
    return () => {
      isMounted.current = false
    }
    // Loads once per mount: the query is fixed for this component's life.
  }, [])

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
          onViewerClosed={dropMisfiled}
        />
      ) : error || nextMaxId ? null : (
        <EmptyState icon={Images} title={emptyTitle} />
      )}
      {error ? <Alert title={error} /> : null}
      {nextMaxId ? (
        <LoadMoreButton
          isLoading={isLoading}
          loadingText="Loading more"
          onClick={() => void load(nextMaxId)}
        />
      ) : error && items.length === 0 ? (
        <LoadMoreButton onClick={() => void load()}>Try again</LoadMoreButton>
      ) : null}
    </div>
  )
}

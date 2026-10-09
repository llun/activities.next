'use client'

import { Images } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'

import { getGalleryMedia } from '@/lib/client'
import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import {
  GalleryGrid,
  type GalleryGridSelection
} from '@/lib/components/gallery/GalleryGrid'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import type {
  GalleryItemEntity,
  GalleryMediaPage
} from '@/lib/services/gallery/galleryEntities'
import type { MediaSubjectCategory } from '@/lib/types/database/gallery'

interface Props {
  actorId: string
  /** A `toSubjectKey` key. */
  subject?: string
  category?: MediaSubjectCategory
  /** Owner only: one camera or lens. */
  gearId?: string
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
  initialPage,
  emptyTitle = 'No photos in your gallery yet',
  showCaption = true,
  selection,
  albumsOwnerId,
  onItemsChange
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
            gearId
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
    [actorId, subject, category, gearId]
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
    return (
      <div
        className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2"
        aria-busy="true"
      >
        <span className="sr-only">Loading photos</span>
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            aria-hidden="true"
            className="skeleton aspect-square rounded-md"
          />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {items.length > 0 ? (
        <GalleryGrid
          items={items}
          showCaption={showCaption}
          selection={selection}
          albumsOwnerId={albumsOwnerId}
        />
      ) : error || nextMaxId ? null : (
        <FitnessEmptyState icon={Images} title={emptyTitle} />
      )}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
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

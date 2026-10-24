'use client'

import { Images } from 'lucide-react'
import Link from 'next/link'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { countGalleryMedia, getGalleryMedia } from '@/lib/client'
import { GalleryMediaFilterBar } from '@/lib/components/gallery/filters/GalleryMediaFilterBar'
import { GalleryMediaFilterEmpty } from '@/lib/components/gallery/filters/GalleryMediaFilterEmpty'
import {
  EMPTY_GALLERY_FILTERS,
  type GalleryMediaFilterState,
  countActiveFilters,
  toGalleryMediaQuery
} from '@/lib/components/gallery/filters/galleryMediaFilterState'
import { useGalleryMediaFacets } from '@/lib/components/gallery/filters/useGalleryMediaFacets'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import type { GalleryShow } from '@/lib/types/database/gallery'
import { cn } from '@/lib/utils'

import { GalleryAlbumPickerTile } from './GalleryAlbumPickerTile'
import { scrollToResultsStart } from './galleryAlbumPickerUi'

export interface GalleryAlbumPickerProps {
  ownerId: string
  /** Media ids in the order they were picked; the first is the cover. */
  selected: string[]
  onChange: (selected: string[]) => void
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
}

const PAGE_SIZE = 60

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
  albumId
}) => {
  const [filters, setFilters] = useState<GalleryMediaFilterState>(
    EMPTY_GALLERY_FILTERS
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
      }
      try {
        const query = toGalleryMediaQuery(filters, new Date())
        const page = await getGalleryMedia(ownerId, {
          limit: PAGE_SIZE,
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
    [ownerId, show, albumId, filters, queryKey]
  )

  useEffect(() => {
    void load(true)
  }, [load])

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
  const existingSet = useMemo(() => new Set(existingIds), [existingIds])
  const isFull = selected.length >= capacity

  const toggle = (mediaId: string) => {
    if (disabled) return
    if (selectedSet.has(mediaId)) {
      onChange(selected.filter((id) => id !== mediaId))
    } else if (!isFull) {
      onChange([...selected, mediaId])
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
    <div ref={rootRef} className="space-y-3">
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
        {isLoading && items.length > 0 ? 'Loading more photos' : ''}
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
        <ul
          className={cn(
            'grid grid-cols-3 gap-1',
            columns === 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
          )}
          aria-busy={isLoading}
        >
          {items.map((item, index) => (
            <li key={item.mediaId} className="min-w-0">
              <GalleryAlbumPickerTile
                item={item}
                index={index}
                isSelected={selectedSet.has(item.mediaId)}
                isMember={existingSet.has(item.mediaId)}
                isBlocked={!selectedSet.has(item.mediaId) && isFull}
                disabled={disabled}
                showCaption
                onToggle={toggle}
              />
            </li>
          ))}
          {isLoading && items.length > 0
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
    </div>
  )
}

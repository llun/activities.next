'use client'

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getGalleryAlbumSuggestionMedia } from '@/lib/client'
import { GALLERY_ALBUM_ITEMS_BATCH } from '@/lib/client/galleryAlbums'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { Button } from '@/lib/components/ui/button'
import type { GalleryAlbumSuggestionEntity } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { MAX_GALLERY_ALBUM_ITEMS } from '@/lib/types/database/galleryAlbums'

import { GalleryAlbumPickerTile } from './GalleryAlbumPickerTile'

interface Props {
  suggestion: GalleryAlbumSuggestionEntity
  /** Media ids in the order they were picked; the first is the cover. */
  selected: string[]
  onChange: (selected: string[]) => void
  /** Reports the photos read, so the dialog can show the cover. */
  onItemsLoaded?: (items: GalleryItemEntity[]) => void
  capacity?: number
  disabled?: boolean
}

// 60 photos a page: a whole number of rows at 3 and 4 across, and at most the
// 100 ids one request takes.
const PAGE_SIZE = Math.min(60, GALLERY_ALBUM_ITEMS_BATCH)

/**
 * "Review and trim": the photos of the suggestion in use, a page at a time, each
 * a toggle on the dialog's selection. Unticking a photo only changes what the
 * dialog would add; nothing is saved here.
 */
export const GalleryAlbumSuggestionReview: FC<Props> = ({
  suggestion,
  selected,
  onChange,
  onItemsLoaded,
  capacity = MAX_GALLERY_ALBUM_ITEMS,
  disabled = false
}) => {
  const [items, setItems] = useState<GalleryItemEntity[]>([])
  const [loadedCount, setLoadedCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Bumped by every restart so a slow answer for an older suggestion is dropped.
  const generation = useRef(0)
  const onItemsLoadedRef = useRef(onItemsLoaded)
  useEffect(() => {
    onItemsLoadedRef.current = onItemsLoaded
  }, [onItemsLoaded])

  const { mediaIds } = suggestion

  const loadPage = useCallback(
    async (offset: number) => {
      const current = offset === 0 ? ++generation.current : generation.current
      if (offset === 0) {
        setItems([])
        setLoadedCount(0)
      }
      setIsLoading(true)
      setError(null)
      try {
        const ids = mediaIds.slice(offset, offset + PAGE_SIZE)
        const page = await getGalleryAlbumSuggestionMedia(ids)
        if (current !== generation.current) return
        setItems((existing) => {
          const base = offset === 0 ? [] : existing
          const known = new Set(base.map((item) => item.mediaId))
          return [
            ...base,
            ...page.items.filter((item) => !known.has(item.mediaId))
          ]
        })
        setLoadedCount(offset + ids.length)
        onItemsLoadedRef.current?.(page.items)
      } catch (loadError) {
        if (current !== generation.current) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load photos.'
        )
      } finally {
        if (current === generation.current) setIsLoading(false)
      }
    },
    [mediaIds]
  )

  useEffect(() => {
    void loadPage(0)
  }, [loadPage])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const isFull = selected.length >= capacity
  const hasMore = loadedCount < mediaIds.length
  const allSelected = mediaIds
    .slice(0, capacity)
    .every((id) => selectedSet.has(id))

  const toggle = (mediaId: string) => {
    if (disabled) return
    if (selectedSet.has(mediaId)) {
      onChange(selected.filter((id) => id !== mediaId))
    } else if (!isFull) {
      onChange([...selected, mediaId])
    }
  }

  const photoCount = suggestion.photoCount.toLocaleString('en-US')

  return (
    <section
      aria-labelledby="album-suggestion-review-heading"
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="album-suggestion-review-heading"
          className="text-sm leading-5 font-medium"
        >
          Review and trim the {photoCount} photos
        </h3>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="pointer-coarse:h-10"
            disabled={disabled || allSelected}
            onClick={() => onChange(mediaIds.slice(0, capacity))}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="pointer-coarse:h-10"
            disabled={disabled || selected.length === 0}
            onClick={() => onChange([])}
          >
            Clear selection
          </Button>
        </div>
      </div>
      {suggestion.truncated ? (
        <p className="text-muted-foreground text-xs">
          An album holds at most{' '}
          {MAX_GALLERY_ALBUM_ITEMS.toLocaleString('en-US')} photos, so this
          suggestion is the newest {mediaIds.length.toLocaleString('en-US')} of
          the {photoCount}.
        </p>
      ) : null}

      {isLoading && items.length === 0 ? (
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-4" aria-busy="true">
          <span className="sr-only">Loading photos</span>
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="skeleton aspect-square rounded-md"
            />
          ))}
        </div>
      ) : (
        <ul
          className="grid grid-cols-3 gap-1 sm:grid-cols-4"
          aria-busy={isLoading}
        >
          {items.map((item, index) => (
            <li key={item.mediaId} className="min-w-0">
              <GalleryAlbumPickerTile
                item={item}
                index={index}
                isSelected={selectedSet.has(item.mediaId)}
                isBlocked={!selectedSet.has(item.mediaId) && isFull}
                disabled={disabled}
                onToggle={toggle}
              />
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {error && items.length === 0 ? (
        <LoadMoreButton onClick={() => void loadPage(0)}>
          Try again
        </LoadMoreButton>
      ) : hasMore ? (
        <LoadMoreButton
          isLoading={isLoading}
          loadingText="Loading more"
          onClick={() => void loadPage(loadedCount)}
        />
      ) : null}
    </section>
  )
}

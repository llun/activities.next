'use client'

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getGalleryAlbumSuggestionMedia } from '@/lib/client'
import { GALLERY_ALBUM_ITEMS_BATCH } from '@/lib/client/galleryAlbums'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import type { GalleryAlbumSuggestionEntity } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { MAX_GALLERY_ALBUM_ITEMS } from '@/lib/types/database/galleryAlbums'

import { GalleryAlbumPickerTile } from './GalleryAlbumPickerTile'
import {
  filterPickerItems,
  getPickerPlaceNames,
  getPickerSubjectNames,
  ignoreEnter
} from './galleryAlbumPickerUi'

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
 * dialog would add; nothing is saved here. Species, place and date filters run
 * over the photos loaded so far.
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
  const [species, setSpecies] = useState('')
  const [place, setPlace] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
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

  const speciesNames = useMemo(() => getPickerSubjectNames(items), [items])
  const placeNames = useMemo(() => getPickerPlaceNames(items), [items])
  const visible = useMemo(
    () => filterPickerItems(items, { species, place, from, to }),
    [items, species, place, from, to]
  )
  const hasFilters = Boolean(species || place || from || to)
  const clearFilters = () => {
    setSpecies('')
    setPlace('')
    setFrom('')
    setTo('')
  }

  // Adds to the picks, never replaces them: the owner's other picks and the
  // cover (the first pick) stay as they are. With no filter it is the whole
  // suggestion, with one only the photos shown.
  const toAdd = (hasFilters ? visible.map((item) => item.mediaId) : mediaIds)
    .filter((id) => !selectedSet.has(id))
    .slice(0, Math.max(capacity - selected.length, 0))

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
            disabled={disabled || toAdd.length === 0}
            onClick={() => onChange([...selected, ...toAdd])}
          >
            {hasFilters ? 'Select all shown' : 'Select all'}
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
      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="album-review-species" className="text-xs">
              Species
            </Label>
            <Select
              id="album-review-species"
              value={species}
              onChange={(event) => setSpecies(event.target.value)}
              disabled={disabled}
            >
              <option value="">Any species</option>
              {speciesNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="album-review-place" className="text-xs">
              Place
            </Label>
            <Select
              id="album-review-place"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
              disabled={disabled}
            >
              <option value="">Any place</option>
              {placeNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-0 space-y-1 max-sm:col-span-2">
            <Label htmlFor="album-review-from" className="text-xs">
              Taken from
            </Label>
            <Input
              id="album-review-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              onKeyDown={ignoreEnter}
              disabled={disabled}
            />
          </div>
          <div className="min-w-0 space-y-1 max-sm:col-span-2">
            <Label htmlFor="album-review-to" className="text-xs">
              Taken to
            </Label>
            <Input
              id="album-review-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              onKeyDown={ignoreEnter}
              disabled={disabled}
            />
          </div>
        </div>
      ) : null}
      {hasFilters ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="pointer-coarse:h-10"
            onClick={clearFilters}
            disabled={disabled}
          >
            Clear filters
          </Button>
        </div>
      ) : null}
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
      ) : visible.length === 0 && items.length > 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {hasMore
            ? 'Nothing matches in the photos loaded so far.'
            : 'No photos match these filters.'}
        </p>
      ) : (
        <ul
          className="grid grid-cols-3 gap-1 sm:grid-cols-4"
          aria-busy={isLoading}
        >
          {visible.map((item, index) => (
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

'use client'

import { Check, Images } from 'lucide-react'
import Link from 'next/link'
import {
  FC,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { getGalleryMedia, getGallerySubjects } from '@/lib/client'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

import { GalleryAlbumThumb } from './GalleryAlbumThumb'
import { filterPickerItems, getPickerPlaceNames } from './galleryAlbumPickerUi'
import { getAlbumTileLabel } from './galleryAlbumsUi'

interface Props {
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
}

const PAGE_SIZE = 60
// A date or place filter runs over the pages already loaded; while it leaves
// few photos on screen the picker reads on by itself, this many pages at a time.
const MIN_VISIBLE = 12
const MAX_AUTO_PAGES = 5

interface SubjectOption {
  key: string
  label: string
}

// A date field submits its form on Enter; here Enter must not save an album
// the owner has not finished picking for.
const ignoreEnter = (event: KeyboardEvent) => {
  if (event.key === 'Enter') event.preventDefault()
}

/**
 * The "From gallery" picker: the owner's own photos, newest upload first,
 * filtered by species (asked of the server), date and place (over the photos
 * loaded so far). It only reports what is ticked; the dialog saves.
 */
export const GalleryAlbumPicker: FC<Props> = ({
  ownerId,
  selected,
  onChange,
  onFirstItemChange,
  capacity,
  existingIds,
  seedItems,
  disabled = false
}) => {
  const [items, setItems] = useState<GalleryItemEntity[]>([])
  const [nextMaxId, setNextMaxId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [subjectKey, setSubjectKey] = useState('')
  const [place, setPlace] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  // Bumped by every restart so a slow answer to an older query is dropped.
  const generation = useRef(0)
  // Every photo this picker has shown, so a pick survives a filter change.
  const seen = useRef(
    new Map<string, GalleryItemEntity>(
      (seedItems ?? []).map((item) => [item.mediaId, item])
    )
  )

  const load = useCallback(
    async (restart: boolean, cursor?: string) => {
      const current = restart ? ++generation.current : generation.current
      setIsLoading(true)
      setError(null)
      try {
        const page = await getGalleryMedia(ownerId, {
          limit: PAGE_SIZE,
          maxId: cursor,
          subject: subjectKey || undefined
        })
        if (current !== generation.current) return
        for (const item of page.items) seen.current.set(item.mediaId, item)
        setItems((existing) => {
          const base = restart ? [] : existing
          const seen = new Set(base.map((item) => item.mediaId))
          return [
            ...base,
            ...page.items.filter((item) => !seen.has(item.mediaId))
          ]
        })
        setNextMaxId(page.nextMaxId)
        setHasLoadedOnce(true)
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
    [ownerId, subjectKey]
  )

  useEffect(() => {
    void load(true)
  }, [load])

  useEffect(() => {
    let cancelled = false
    getGallerySubjects(ownerId)
      .then((response) => {
        if (cancelled) return
        setSubjects(
          response.groups.flatMap((group) =>
            group.subjects.map((subject) => ({
              key: subject.key,
              label: subject.name ?? subject.scientificName ?? 'Unnamed'
            }))
          )
        )
      })
      .catch(() => {
        // The species filter is a convenience; the picker works without it.
      })
    return () => {
      cancelled = true
    }
  }, [ownerId])

  const placeNames = useMemo(() => getPickerPlaceNames(items), [items])
  const visible = useMemo(
    () => filterPickerItems(items, { place, from, to }),
    [items, place, from, to]
  )
  const isClientFiltered = Boolean(place || from || to)

  // Keep reading while a client-side filter leaves the grid nearly empty.
  const autoPages = useRef(0)
  useEffect(() => {
    if (!isClientFiltered) {
      autoPages.current = 0
      return
    }
    if (
      isLoading ||
      error ||
      !nextMaxId ||
      visible.length >= MIN_VISIBLE ||
      autoPages.current >= MAX_AUTO_PAGES
    ) {
      return
    }
    autoPages.current += 1
    void load(false, nextMaxId)
  }, [isClientFiltered, isLoading, error, nextMaxId, visible.length, load])

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
    const additions = visible
      .map((item) => item.mediaId)
      .filter((id) => !selectedSet.has(id) && !existingSet.has(id))
      .slice(0, Math.max(room, 0))
    if (additions.length > 0) onChange([...selected, ...additions])
  }

  const hasFilters = Boolean(subjectKey || isClientFiltered)
  const clearFilters = () => {
    setSubjectKey('')
    setPlace('')
    setFrom('')
    setTo('')
  }

  const isGalleryEmpty =
    hasLoadedOnce && !isLoading && items.length === 0 && !hasFilters && !error

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
          <p className="text-sm font-semibold">No photos to add yet</p>
          <p className="text-muted-foreground text-sm">
            Photos you post with a species or place show up here. You can come
            back and add them any time.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/gallery/recent" prefetch={false}>
            Go to Recent
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="album-picker-species" className="text-xs">
            Species
          </Label>
          <Select
            id="album-picker-species"
            value={subjectKey}
            onChange={(event) => setSubjectKey(event.target.value)}
            disabled={disabled}
          >
            <option value="">Any species</option>
            {subjects.map((subject) => (
              <option key={subject.key} value={subject.key}>
                {subject.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="album-picker-place" className="text-xs">
            Place
          </Label>
          <Select
            id="album-picker-place"
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
          <Label htmlFor="album-picker-from" className="text-xs">
            Taken from
          </Label>
          <Input
            id="album-picker-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            onKeyDown={ignoreEnter}
            disabled={disabled}
          />
        </div>
        <div className="min-w-0 space-y-1 max-sm:col-span-2">
          <Label htmlFor="album-picker-to" className="text-xs">
            Taken to
          </Label>
          <Input
            id="album-picker-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            onKeyDown={ignoreEnter}
            disabled={disabled}
          />
        </div>
      </div>

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
            visible.every((item) => existingSet.has(item.mediaId))
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
        {hasFilters ? (
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
        ) : null}
      </div>

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
      ) : visible.length > 0 ? (
        <ul
          className="grid grid-cols-3 gap-1 sm:grid-cols-4"
          aria-busy={isLoading}
        >
          {visible.map((item, index) => {
            const isSelected = selectedSet.has(item.mediaId)
            const isMember = existingSet.has(item.mediaId)
            const blocked = !isSelected && isFull
            return (
              <li key={item.mediaId} className="min-w-0">
                <button
                  type="button"
                  aria-pressed={isMember ? undefined : isSelected}
                  aria-label={
                    isMember
                      ? `${getAlbumTileLabel(item, index)}, already in the album`
                      : `Select ${getAlbumTileLabel(item, index)}`
                  }
                  disabled={disabled || isMember || blocked}
                  onClick={() => toggle(item.mediaId)}
                  className={cn(
                    'focus-visible:outline-primary bg-muted/20 relative block aspect-square w-full overflow-hidden rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:cursor-not-allowed',
                    isMember ? 'disabled:opacity-60' : 'disabled:opacity-40',
                    isSelected && 'ring-primary ring-2 ring-inset'
                  )}
                >
                  <GalleryAlbumThumb item={item} />
                  {isMember ? (
                    <span
                      aria-hidden="true"
                      className="absolute right-1 bottom-1 left-1 flex items-center justify-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white"
                    >
                      <Check className="size-3 shrink-0" />
                      <span className="truncate">In album</span>
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full border border-white/80 bg-black/30 text-white',
                        isSelected && 'bg-primary border-primary'
                      )}
                    >
                      {isSelected ? <Check className="size-3.5" /> : null}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      ) : error ? null : (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {nextMaxId
            ? 'Nothing matches in the photos loaded so far.'
            : 'No photos match these filters.'}
        </p>
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
          onClick={() => void load(false, nextMaxId)}
        />
      ) : error && items.length === 0 ? (
        <LoadMoreButton onClick={() => void load(true)}>
          Try again
        </LoadMoreButton>
      ) : null}
    </div>
  )
}

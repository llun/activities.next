'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type FC, useEffect, useRef, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Switch } from '@/lib/components/ui/switch'
import type { GalleryMediaFacetsResponse } from '@/lib/services/gallery/galleryEntities'
import { GALLERY_FILTER_NONE } from '@/lib/types/database/gallery'

import { GalleryDateFilterPanel } from './GalleryDateFilterPanel'
import { GalleryFilterOptionList } from './GalleryFilterOptionList'
import {
  formatActivitySubtitle,
  formatActivityTitle,
  formatDateFilterChipLabel,
  formatPlaceLabel,
  formatSpeciesLabel
} from './galleryMediaFilterLabels'
import {
  type GalleryMediaFilterState,
  clearGalleryFilters,
  setGalleryFilter
} from './galleryMediaFilterState'

export interface GalleryMediaFilterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: GalleryMediaFilterState
  facets: GalleryMediaFacetsResponse | null
  showNotInAlbumToggle?: boolean
  countDraft?: (draft: GalleryMediaFilterState) => Promise<number>
  onApply: (next: GalleryMediaFilterState) => void
}

type FilterSheetView = 'main' | 'species' | 'place' | 'date' | 'activity'

const SUBVIEW_TITLES: Record<Exclude<FilterSheetView, 'main'>, string> = {
  species: 'Species',
  place: 'Place',
  date: 'Date taken',
  activity: 'Activity'
}

export const GalleryMediaFilterSheet: FC<GalleryMediaFilterSheetProps> = ({
  open,
  onOpenChange,
  filters,
  facets,
  showNotInAlbumToggle = false,
  countDraft,
  onApply
}) => {
  const [draft, setDraft] = useState<GalleryMediaFilterState>(filters)
  const [view, setView] = useState<FilterSheetView>('main')
  const [pendingCount, setPendingCount] = useState(false)
  const [matchCount, setMatchCount] = useState<number | null>(
    () => facets?.total ?? null
  )

  const prevOpenRef = useRef(false)

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setDraft(filters)
      setView('main')
    }
    prevOpenRef.current = open
  }, [open, filters])

  useEffect(() => {
    if (!open) {
      setPendingCount(false)
      return
    }

    if (!countDraft) {
      setMatchCount(facets?.total ?? null)
      setPendingCount(false)
      return
    }

    let cancelled = false
    setPendingCount(true)

    countDraft(draft)
      .then((count) => {
        if (!cancelled) {
          setMatchCount(count)
          setPendingCount(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Drop the stale number: "Show" alone is honest when counting failed.
          setMatchCount(null)
          setPendingCount(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, draft, countDraft, facets?.total])

  const speciesFacet = facets?.species?.find((f) => f.key === draft.species)
  const speciesValue = draft.species
    ? formatSpeciesLabel(speciesFacet, draft.species)
    : 'Any'

  const placeValue = draft.place ? formatPlaceLabel(draft.place) : 'Any'

  const dateValue = draft.date ? formatDateFilterChipLabel(draft.date) : 'Any'

  const activityFacet = facets?.activities?.find((f) => f.id === draft.activity)
  const activityValue = draft.activity
    ? formatActivityTitle(activityFacet, draft.activity)
    : 'Any'

  const showButtonText =
    pendingCount || matchCount === null
      ? 'Show'
      : `Show ${matchCount.toLocaleString('en-US')}`
  const facetsLoading = facets === null

  // A pick in a list is one choice: apply it to the draft, back to the rows.
  const pick = (next: GalleryMediaFilterState) => {
    setDraft(next)
    setView('main')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="bg-background dark:bg-card data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 motion-reduce:data-[state=open]:slide-in-from-bottom-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-48px)] w-full flex-col rounded-t-2xl border-t shadow-lg duration-200 ease-out outline-none"
        >
          <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
            <div
              aria-hidden="true"
              className="bg-muted-foreground/30 mx-auto mt-2 h-1 w-9 shrink-0 rounded-full"
            />

            <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
              {view === 'main' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft(clearGalleryFilters(draft))}
                  className="text-muted-foreground hover:text-foreground h-8 px-2 text-sm font-normal"
                >
                  Clear all
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setView('main')}
                  aria-label="Back to filters"
                  className="text-muted-foreground hover:text-foreground -ml-2 h-8 px-2 text-sm font-medium"
                >
                  <ChevronLeft className="mr-1 size-4" />
                  Filters
                </Button>
              )}

              <DialogTitle className="text-base font-semibold">
                {view === 'main' ? 'Filters' : SUBVIEW_TITLES[view]}
              </DialogTitle>

              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  onApply(draft)
                  onOpenChange(false)
                }}
                className="rounded-lg text-sm font-medium"
              >
                {showButtonText}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {view === 'main' ? (
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => setView('species')}
                    disabled={facetsLoading}
                    className="hover:bg-muted/50 flex min-h-10 w-full cursor-pointer items-center justify-between border-b px-4 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-50"
                  >
                    <span className="text-sm font-medium">Species</span>{' '}
                    <span className="text-muted-foreground flex items-center text-sm">
                      <span className="max-w-[200px] truncate">
                        {speciesValue}
                      </span>
                      <ChevronRight className="text-muted-foreground ml-1 size-4 shrink-0" />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setView('place')}
                    disabled={facetsLoading}
                    className="hover:bg-muted/50 flex min-h-10 w-full cursor-pointer items-center justify-between border-b px-4 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-50"
                  >
                    <span className="text-sm font-medium">Place</span>{' '}
                    <span className="text-muted-foreground flex items-center text-sm">
                      <span className="max-w-[200px] truncate">
                        {placeValue}
                      </span>
                      <ChevronRight className="text-muted-foreground ml-1 size-4 shrink-0" />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setView('date')}
                    disabled={facetsLoading}
                    className="hover:bg-muted/50 flex min-h-10 w-full cursor-pointer items-center justify-between border-b px-4 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-50"
                  >
                    <span className="text-sm font-medium">Date taken</span>{' '}
                    <span className="text-muted-foreground flex items-center text-sm">
                      <span className="max-w-[200px] truncate">
                        {dateValue}
                      </span>
                      <ChevronRight className="text-muted-foreground ml-1 size-4 shrink-0" />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setView('activity')}
                    disabled={facetsLoading}
                    className="hover:bg-muted/50 flex min-h-10 w-full cursor-pointer items-center justify-between border-b px-4 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-50"
                  >
                    <span className="text-sm font-medium">Activity</span>{' '}
                    <span className="text-muted-foreground flex items-center text-sm">
                      <span className="max-w-[200px] truncate">
                        {activityValue}
                      </span>
                      <ChevronRight className="text-muted-foreground ml-1 size-4 shrink-0" />
                    </span>
                  </button>

                  {showNotInAlbumToggle ? (
                    <div className="flex min-h-10 items-center justify-between border-b px-4 py-2">
                      <label
                        htmlFor="filter-sheet-not-in-album"
                        className="cursor-pointer text-sm font-medium"
                      >
                        Not in an album
                      </label>
                      <Switch
                        id="filter-sheet-not-in-album"
                        aria-label="Not in an album"
                        checked={draft.notInAlbum}
                        onCheckedChange={(checked) =>
                          setDraft(
                            setGalleryFilter(draft, 'notInAlbum', checked)
                          )
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {view === 'species' ? (
                <GalleryFilterOptionList
                  searchPlaceholder="Search species"
                  searchAriaLabel="Search species"
                  anyOption={{
                    label: 'Any species',
                    count: facets?.total,
                    active: draft.species === null,
                    onSelect: () =>
                      pick(setGalleryFilter(draft, 'species', null))
                  }}
                  items={
                    facets?.species?.map((facet) => ({
                      id: facet.key,
                      label: facet.name ?? facet.scientificName ?? facet.key,
                      subLabel:
                        facet.name && facet.scientificName
                          ? facet.scientificName
                          : null,
                      count: facet.count,
                      active: draft.species === facet.key,
                      onSelect: () =>
                        pick(setGalleryFilter(draft, 'species', facet.key)),
                      searchTerms: facet.scientificName
                        ? [facet.scientificName]
                        : undefined
                    })) ?? []
                  }
                />
              ) : null}

              {view === 'place' ? (
                <GalleryFilterOptionList
                  searchPlaceholder="Search places"
                  searchAriaLabel="Search places"
                  anyOption={{
                    label: 'Any place',
                    count: facets?.total,
                    active: draft.place === null,
                    onSelect: () => pick(setGalleryFilter(draft, 'place', null))
                  }}
                  items={
                    facets?.places?.map((facet) => ({
                      id: facet.name,
                      label: facet.name,
                      count: facet.count,
                      active: draft.place === facet.name,
                      onSelect: () =>
                        pick(setGalleryFilter(draft, 'place', facet.name))
                    })) ?? []
                  }
                  noneOption={{
                    label: 'No place',
                    count: facets?.noPlaceCount,
                    active: draft.place === GALLERY_FILTER_NONE,
                    onSelect: () =>
                      pick(
                        setGalleryFilter(draft, 'place', GALLERY_FILTER_NONE)
                      )
                  }}
                />
              ) : null}

              {view === 'date' ? (
                <GalleryDateFilterPanel
                  value={draft.date}
                  months={facets?.months ?? []}
                  onSelect={(dateFilter) =>
                    pick(setGalleryFilter(draft, 'date', dateFilter))
                  }
                />
              ) : null}

              {view === 'activity' ? (
                <GalleryFilterOptionList
                  searchPlaceholder="Search activities"
                  searchAriaLabel="Search activities"
                  anyOption={{
                    label: 'Any activity',
                    count: facets?.total,
                    active: draft.activity === null,
                    onSelect: () =>
                      pick(setGalleryFilter(draft, 'activity', null))
                  }}
                  items={
                    facets?.activities?.map((facet) => ({
                      id: facet.id,
                      label: formatActivityTitle(facet, facet.id),
                      subLabel: formatActivitySubtitle(facet),
                      count: facet.count,
                      active: draft.activity === facet.id,
                      onSelect: () =>
                        pick(setGalleryFilter(draft, 'activity', facet.id))
                    })) ?? []
                  }
                  noneOption={{
                    label: 'Not from an activity',
                    count: facets?.notFromActivityCount,
                    active: draft.activity === GALLERY_FILTER_NONE,
                    onSelect: () =>
                      pick(
                        setGalleryFilter(draft, 'activity', GALLERY_FILTER_NONE)
                      )
                  }}
                />
              ) : null}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}

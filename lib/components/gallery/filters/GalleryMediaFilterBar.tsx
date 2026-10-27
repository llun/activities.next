'use client'

import { X } from 'lucide-react'
import { type FC, type ReactNode, useState } from 'react'

import { pluralize } from '@/lib/components/gallery/galleryCategories'
import { Alert } from '@/lib/components/surface/Alert'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { Button } from '@/lib/components/ui/button'
import type { GalleryMediaFacetsResponse } from '@/lib/services/gallery/galleryEntities'
import { GALLERY_FILTER_NONE } from '@/lib/types/database/gallery'
import { cn } from '@/lib/utils'

import { GalleryDateFilterPanel } from './GalleryDateFilterPanel'
import { GalleryFilterMenu } from './GalleryFilterMenu'
import { GalleryFilterOptionList } from './GalleryFilterOptionList'
import { GalleryMediaFilterSheet } from './GalleryMediaFilterSheet'
import { GallerySortMenu } from './GallerySortMenu'
import {
  formatActivitySubtitle,
  formatActivityTitle,
  formatDateFilterChipLabel,
  formatFilterActiveValue,
  formatPlaceLabel,
  formatSpeciesLabel
} from './galleryMediaFilterLabels'
import {
  type GalleryMediaFilterState,
  clearGalleryFilters,
  countActiveFilters,
  setGalleryFilter
} from './galleryMediaFilterState'

export interface GalleryMediaFilterBarProps {
  idPrefix: string
  filters: GalleryMediaFilterState
  onChange: (next: GalleryMediaFilterState) => void
  facets: GalleryMediaFacetsResponse | null
  facetsError?: string | null
  /** Shows a "Try again" button on the facets error; hosts bump the facets `reloadKey` here. */
  onRetryFacets?: () => void
  /** Render the filter lists here (a modal's content) instead of the body, so a Radix scroll lock does not cancel their scrolling. */
  portalContainer?: HTMLElement | null
  showNotInAlbumToggle?: boolean
  total: number | null
  inAlbumTotal?: number | null
  countDraft?: (draft: GalleryMediaFilterState) => Promise<number>
  leading?: ReactNode
  disabled?: boolean
  className?: string
}

export const GalleryMediaFilterBar: FC<GalleryMediaFilterBarProps> = ({
  idPrefix,
  filters,
  onChange,
  facets,
  facetsError,
  onRetryFacets,
  portalContainer,
  showNotInAlbumToggle = false,
  total,
  inAlbumTotal,
  countDraft,
  leading,
  disabled = false,
  className
}) => {
  const [sheetOpen, setSheetOpen] = useState(false)
  const activeFilterCount = countActiveFilters(filters)
  const facetsLoading = facets === null && !facetsError
  const menusDisabled = disabled || facets === null

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {facetsError ? (
        <Alert
          tone="error"
          title={facetsError}
          className="mb-2"
          action={
            onRetryFacets ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetryFacets}
              >
                Try again
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {/* Desktop layout */}
      <div
        data-testid={`${idPrefix}-desktop-filters`}
        className="hidden sm:flex flex-wrap items-center gap-2"
      >
        {leading}

        {facetsLoading ? (
          <div
            role="status"
            aria-label="Loading filters"
            className="flex items-center gap-2"
          >
            <span className="sr-only">Loading filters</span>
            <SkeletonBar className="h-10 w-28 rounded-lg" />
            <SkeletonBar className="h-10 w-28 rounded-lg" />
            <SkeletonBar className="h-10 w-28 rounded-lg" />
            <SkeletonBar className="h-10 w-28 rounded-lg" />
          </div>
        ) : (
          <>
            {/* Species menu */}
            <GalleryFilterMenu
              idPrefix={idPrefix}
              label="Species"
              inactiveTriggerText="Any species"
              active={Boolean(filters.species)}
              activeLabel={formatSpeciesLabel(
                facets?.species?.find((f) => f.key === filters.species),
                filters.species
              )}
              onClear={() =>
                onChange(setGalleryFilter(filters, 'species', null))
              }
              disabled={menusDisabled}
              portalContainer={portalContainer}
            >
              {({ close }) => (
                <GalleryFilterOptionList
                  searchPlaceholder="Search species"
                  searchAriaLabel="Search species"
                  anyOption={{
                    label: 'Any species',
                    count: facets?.total,
                    active: filters.species === null,
                    onSelect: () => {
                      onChange(setGalleryFilter(filters, 'species', null))
                      close()
                    }
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
                      active: filters.species === facet.key,
                      onSelect: () => {
                        onChange(
                          setGalleryFilter(filters, 'species', facet.key)
                        )
                        close()
                      },
                      searchTerms: facet.scientificName
                        ? [facet.scientificName]
                        : undefined
                    })) ?? []
                  }
                />
              )}
            </GalleryFilterMenu>

            {/* Place menu */}
            <GalleryFilterMenu
              idPrefix={idPrefix}
              label="Place"
              inactiveTriggerText="Any place"
              active={Boolean(filters.place)}
              activeLabel={formatPlaceLabel(filters.place)}
              onClear={() => onChange(setGalleryFilter(filters, 'place', null))}
              disabled={menusDisabled}
              portalContainer={portalContainer}
            >
              {({ close }) => (
                <GalleryFilterOptionList
                  searchPlaceholder="Search places"
                  searchAriaLabel="Search places"
                  anyOption={{
                    label: 'Any place',
                    count: facets?.total,
                    active: filters.place === null,
                    onSelect: () => {
                      onChange(setGalleryFilter(filters, 'place', null))
                      close()
                    }
                  }}
                  items={
                    facets?.places?.map((facet) => ({
                      id: facet.name,
                      label: facet.name,
                      count: facet.count,
                      active: filters.place === facet.name,
                      onSelect: () => {
                        onChange(setGalleryFilter(filters, 'place', facet.name))
                        close()
                      }
                    })) ?? []
                  }
                  noneOption={{
                    label: 'No place',
                    count: facets?.noPlaceCount,
                    active: filters.place === GALLERY_FILTER_NONE,
                    onSelect: () => {
                      onChange(
                        setGalleryFilter(filters, 'place', GALLERY_FILTER_NONE)
                      )
                      close()
                    }
                  }}
                />
              )}
            </GalleryFilterMenu>

            {/* Date taken menu */}
            <GalleryFilterMenu
              idPrefix={idPrefix}
              label="Date taken"
              inactiveTriggerText="Any time"
              active={Boolean(filters.date)}
              activeLabel={formatDateFilterChipLabel(filters.date)}
              activeLabelClassName={
                filters.date?.kind === 'custom' &&
                filters.date.label?.startsWith('Album dates ·')
                  ? 'sm:max-w-none'
                  : undefined
              }
              onClear={() => onChange(setGalleryFilter(filters, 'date', null))}
              disabled={menusDisabled}
              portalContainer={portalContainer}
            >
              {({ close }) => (
                <GalleryDateFilterPanel
                  value={filters.date}
                  months={facets?.months ?? []}
                  onSelect={(dateFilter) => {
                    onChange(setGalleryFilter(filters, 'date', dateFilter))
                    close()
                  }}
                />
              )}
            </GalleryFilterMenu>

            {/* Activity menu */}
            <GalleryFilterMenu
              idPrefix={idPrefix}
              label="Activity"
              inactiveTriggerText="Any activity"
              active={Boolean(filters.activity)}
              activeLabel={formatActivityTitle(
                facets?.activities?.find((f) => f.id === filters.activity),
                filters.activity
              )}
              onClear={() =>
                onChange(setGalleryFilter(filters, 'activity', null))
              }
              disabled={menusDisabled}
              portalContainer={portalContainer}
            >
              {({ close }) => (
                <GalleryFilterOptionList
                  searchPlaceholder="Search activities"
                  searchAriaLabel="Search activities"
                  anyOption={{
                    label: 'Any activity',
                    count: facets?.total,
                    active: filters.activity === null,
                    onSelect: () => {
                      onChange(setGalleryFilter(filters, 'activity', null))
                      close()
                    }
                  }}
                  items={
                    facets?.activities?.map((facet) => ({
                      id: facet.id,
                      label: formatActivityTitle(facet, facet.id),
                      subLabel: formatActivitySubtitle(facet),
                      count: facet.count,
                      active: filters.activity === facet.id,
                      onSelect: () => {
                        onChange(
                          setGalleryFilter(filters, 'activity', facet.id)
                        )
                        close()
                      }
                    })) ?? []
                  }
                  noneOption={{
                    label: 'Not from an activity',
                    count: facets?.notFromActivityCount,
                    active: filters.activity === GALLERY_FILTER_NONE,
                    onSelect: () => {
                      onChange(
                        setGalleryFilter(
                          filters,
                          'activity',
                          GALLERY_FILTER_NONE
                        )
                      )
                      close()
                    }
                  }}
                />
              )}
            </GalleryFilterMenu>
          </>
        )}

        {/* Not in an album toggle */}
        {showNotInAlbumToggle ? (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-pressed={filters.notInAlbum}
            onClick={() =>
              onChange(
                setGalleryFilter(filters, 'notInAlbum', !filters.notInAlbum)
              )
            }
            className={cn(
              'h-10 rounded-lg font-normal',
              filters.notInAlbum &&
                'border-primary bg-primary/10 text-primary-text hover:bg-primary/15 font-medium'
            )}
          >
            Not in an album
          </Button>
        ) : null}

        {/* Sort menu */}
        <GallerySortMenu
          value={filters.sort}
          onChange={(sort) => onChange({ ...filters, sort })}
          compact={false}
          disabled={disabled}
          className="ml-auto"
        />
      </div>

      {/* Mobile layout */}
      <div
        data-testid={`${idPrefix}-mobile-filters`}
        className="flex flex-col gap-2 sm:hidden"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {leading}
            <Button
              type="button"
              variant="outline"
              disabled={menusDisabled}
              onClick={() => setSheetOpen(true)}
              className="h-10 rounded-lg font-normal"
            >
              {activeFilterCount > 0
                ? `Filters · ${activeFilterCount}`
                : 'Filters'}
            </Button>
          </div>
          <GallerySortMenu
            value={filters.sort}
            onChange={(sort) => onChange({ ...filters, sort })}
            compact={true}
            disabled={disabled}
          />
        </div>

        {/* Active chips row */}
        {filters.order.length > 0 ? (
          <div className="flex items-center gap-2 overflow-x-auto py-1">
            {filters.order.map((key) => {
              const label = formatFilterActiveValue(filters, key, facets)
              return (
                <div
                  key={key}
                  className="border-primary bg-primary/10 text-primary-text inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium"
                >
                  <span>{label}</span>
                  <button
                    type="button"
                    aria-label={`Clear ${label} filter`}
                    disabled={disabled}
                    onClick={() =>
                      onChange(
                        setGalleryFilter(
                          filters,
                          key,
                          (key === 'notInAlbum' ? false : null) as never
                        )
                      )
                    }
                    className="hover:bg-primary/20 focus-visible:ring-primary/50 flex size-4 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <X className="size-3 shrink-0" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}

        {/* Sheet instance */}
        <GalleryMediaFilterSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          filters={filters}
          facets={facets}
          showNotInAlbumToggle={showNotInAlbumToggle}
          countDraft={countDraft}
          onApply={onChange}
        />
      </div>

      {/* Count line under filters; the button stays outside the live region */}
      <div
        data-testid={`${idPrefix}-count-line`}
        className="text-muted-foreground flex items-center justify-between text-sm"
      >
        <div role="status" aria-live="polite">
          {total !== null ? (
            <>
              <span className="hidden sm:inline">
                {pluralize(total, 'photo')}
                {typeof inAlbumTotal === 'number'
                  ? ` · ${inAlbumTotal.toLocaleString('en-US')} already in this album`
                  : ''}
              </span>
              <span className="sm:hidden">{pluralize(total, 'photo')}</span>
            </>
          ) : null}
        </div>

        {activeFilterCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange(clearGalleryFilters(filters))}
            className="text-muted-foreground hover:text-foreground h-auto p-0 font-normal hover:bg-transparent"
          >
            <span className="hidden sm:inline">Clear filters</span>
            <span className="sm:hidden">Clear</span>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

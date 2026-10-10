'use client'

import { Images, ListChecks, MapPin, Shapes } from 'lucide-react'
import Link from 'next/link'
import { FC, useMemo, useState } from 'react'

import { GalleryCategorySection } from '@/lib/components/gallery/GalleryCategorySection'
import { GALLERY_CATEGORY_LABELS } from '@/lib/components/gallery/galleryCategories'
import { formatCountryCount } from '@/lib/components/gallery/galleryTaxonomy'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { StatCell } from '@/lib/components/surface/StatCell'
import { StatStrip } from '@/lib/components/surface/StatStrip'
import type {
  GallerySubjectGroupCategory,
  GallerySubjectsResponse
} from '@/lib/services/gallery/galleryEntities'
import { cn } from '@/lib/utils'

interface Props {
  data: GallerySubjectsResponse
  /** Owner pages link each card to its subject page. */
  linkSubjects?: boolean
  /** The profile tab filters in place instead. */
  onSelectSubject?: (key: string, label: string) => void
  /** Owner pages: "See all" goes to All media filtered by the category. */
  getSeeAllHref?: (category: GallerySubjectGroupCategory) => string | undefined
  /** Profile tab: "See all" switches to the Recent subview. */
  onSeeAll?: (category: GallerySubjectGroupCategory) => void
  /** Owner pages: where the Places cell's "Open map" goes. */
  mapHref?: string
  /** Profile tab: "Open map" switches to the Map subview instead. */
  onOpenMap?: () => void
}

const numberFormat = new Intl.NumberFormat('en-US')

const CHIP_CLASS =
  'rounded-full border px-3 py-1 text-sm font-medium transition-colors'

/**
 * The subjects overview shared by `/gallery` and the profile Gallery tab: a
 * totals strip, category chips and one section per category.
 */
export const GallerySubjectsOverview: FC<Props> = ({
  data,
  linkSubjects = false,
  onSelectSubject,
  getSeeAllHref,
  onSeeAll,
  mapHref,
  onOpenMap
}) => {
  const [filter, setFilter] = useState<GallerySubjectGroupCategory | 'all'>(
    'all'
  )

  const totals = useMemo(() => {
    let photos = data.unidentifiedCount
    let species = 0
    for (const group of data.groups) {
      for (const subject of group.subjects) {
        photos += subject.count
        if (group.category !== 'landscape') species += 1
      }
    }
    return { photos, species }
  }, [data])

  // Already in category order, `unidentified` last.
  const groups = data.groups

  if (data.groups.length === 0 && data.unidentifiedCount === 0) {
    return (
      <EmptyState icon={Images} title="No photos in your gallery yet">
        Photos and videos you post with “Add to gallery” on will appear here.
      </EmptyState>
    )
  }

  const suffix = data.truncated ? '+' : ''
  // Left out, not 0, when no place the viewer may see has a country.
  const showPlaces = data.countryCount !== null
  const openMapClass =
    'text-primary-text block text-sm font-medium whitespace-nowrap hover:underline'
  const visibleGroups =
    filter === 'all' ? groups : groups.filter((g) => g.category === filter)

  return (
    <div className="space-y-6">
      <StatStrip variant="summary" columns={showPlaces ? 4 : 3}>
        <StatCell
          label="Photos and videos"
          icon={Images}
          value={`${numberFormat.format(totals.photos)}${suffix}`}
        />
        <StatCell
          label="Species"
          icon={ListChecks}
          value={`${numberFormat.format(totals.species)}${suffix}`}
        />
        <StatCell
          label="Without a subject"
          icon={Shapes}
          value={numberFormat.format(data.unidentifiedCount)}
        />
        {data.countryCount !== null ? (
          <StatCell
            label="Places"
            icon={MapPin}
            value={
              <>
                <span className="whitespace-nowrap">
                  {formatCountryCount(data.countryCount)}
                </span>
                {mapHref ? (
                  <Link
                    href={mapHref}
                    prefetch={false}
                    className={openMapClass}
                  >
                    Open map ›
                  </Link>
                ) : onOpenMap ? (
                  <button
                    type="button"
                    className={openMapClass}
                    onClick={onOpenMap}
                  >
                    Open map ›
                  </button>
                ) : null}
              </>
            }
          />
        ) : null}
      </StatStrip>

      {groups.length > 1 ? (
        <div
          role="group"
          aria-label="Filter by category"
          className="flex flex-wrap gap-2"
        >
          <button
            type="button"
            aria-pressed={filter === 'all'}
            className={cn(
              CHIP_CLASS,
              filter === 'all'
                ? 'border-primary bg-primary/10 text-primary-text'
                : 'text-muted-foreground hover:bg-muted/50'
            )}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          {groups.map((group) => (
            <button
              key={group.category}
              type="button"
              aria-pressed={filter === group.category}
              className={cn(
                CHIP_CLASS,
                filter === group.category
                  ? 'border-primary bg-primary/10 text-primary-text'
                  : 'text-muted-foreground hover:bg-muted/50'
              )}
              onClick={() => setFilter(group.category)}
            >
              {GALLERY_CATEGORY_LABELS[group.category]}{' '}
              <span className="tabular-nums">
                {group.category === 'landscape'
                  ? group.subjects.reduce((n, s) => n + s.count, 0)
                  : group.subjects.length}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {visibleGroups.map((group) => (
        <GalleryCategorySection
          key={group.category}
          category={group.category}
          subjects={group.subjects}
          linkSubjects={linkSubjects}
          onSelectSubject={onSelectSubject}
          seeAllHref={
            group.category === 'unidentified'
              ? undefined
              : getSeeAllHref?.(group.category)
          }
          onSeeAll={
            onSeeAll && group.category !== 'unidentified'
              ? () => onSeeAll(group.category)
              : undefined
          }
        />
      ))}

      {data.truncated ? (
        <p className="text-muted-foreground text-xs">
          Showing the most recent part of a large gallery. Counts are a lower
          bound.
        </p>
      ) : null}
    </div>
  )
}

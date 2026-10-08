'use client'

import { Images, ListChecks, Shapes } from 'lucide-react'
import { FC, useMemo, useState } from 'react'

import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import { FITNESS_STAT_STRIP_CLASS } from '@/lib/components/fitness/FitnessStatCell'
import { FitnessStatCell } from '@/lib/components/fitness/FitnessStatCell'
import { FitnessStatGrid } from '@/lib/components/fitness/FitnessStatGrid'
import { GalleryCategorySection } from '@/lib/components/gallery/GalleryCategorySection'
import { GALLERY_CATEGORY_LABELS } from '@/lib/components/gallery/galleryCategories'
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
  /** Owner pages: "See all" goes to Recent filtered by the category. */
  getSeeAllHref?: (category: GallerySubjectGroupCategory) => string | undefined
  /** Profile tab: "See all" switches to the Recent subview. */
  onSeeAll?: (category: GallerySubjectGroupCategory) => void
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
  onSeeAll
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
      <FitnessEmptyState icon={Images} title="No photos in your gallery yet">
        Photos and videos you post with “Add to gallery” on will appear here.
      </FitnessEmptyState>
    )
  }

  const suffix = data.truncated ? '+' : ''
  const visibleGroups =
    filter === 'all' ? groups : groups.filter((g) => g.category === filter)

  return (
    <div className="space-y-6">
      <FitnessStatGrid
        variant="summary"
        columns={3}
        className={FITNESS_STAT_STRIP_CLASS}
      >
        <FitnessStatCell
          label="Photos and videos"
          icon={Images}
          value={`${numberFormat.format(totals.photos)}${suffix}`}
        />
        <FitnessStatCell
          label="Species"
          icon={ListChecks}
          value={`${numberFormat.format(totals.species)}${suffix}`}
        />
        <FitnessStatCell
          label="Without a subject"
          icon={Shapes}
          value={numberFormat.format(data.unidentifiedCount)}
        />
      </FitnessStatGrid>

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

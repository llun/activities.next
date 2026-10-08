'use client'

import { Images, ListChecks } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { FITNESS_TABLE_HEAD_ROW_CLASS } from '@/lib/components/fitness/FitnessSection'
import { FitnessStatCell } from '@/lib/components/fitness/FitnessStatCell'
import { FITNESS_STAT_STRIP_CLASS } from '@/lib/components/fitness/FitnessStatCell'
import { FitnessStatGrid } from '@/lib/components/fitness/FitnessStatGrid'
import { getGallerySubjectHref } from '@/lib/components/gallery/GallerySubjectCard'
import {
  GALLERY_CATEGORY_ICONS,
  GALLERY_CATEGORY_LABELS,
  formatGalleryDate
} from '@/lib/components/gallery/galleryCategories'
import type { GalleryLifeListResponse } from '@/lib/services/gallery/galleryEntities'
import type { MediaSubjectCategory } from '@/lib/types/database/gallery'

interface Props {
  data: GalleryLifeListResponse
  /** Link names to subject pages (owner pages). */
  linkSubjects?: boolean
  /** Filter in place (profile tab). */
  onSelectSubject?: (key: string, label: string) => void
}

const numberFormat = new Intl.NumberFormat('en-US')

/**
 * The life list: a totals strip (species, photos and the biggest categories)
 * over a table of every species, first sighting first.
 */
export const GalleryLifeListTable: FC<Props> = ({
  data,
  linkSubjects = false,
  onSelectSubject
}) => {
  const photos = data.entries.reduce((total, entry) => total + entry.count, 0)
  const topCategories = (
    Object.entries(data.byCategory) as [MediaSubjectCategory, number][]
  )
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
  const columns = (2 + topCategories.length) as 2 | 3 | 4
  const suffix = data.truncated ? '+' : ''

  return (
    <div className="space-y-4">
      <FitnessStatGrid
        variant="summary"
        columns={columns}
        className={FITNESS_STAT_STRIP_CLASS}
      >
        <FitnessStatCell
          label="Species"
          icon={ListChecks}
          value={`${numberFormat.format(data.total)}${suffix}`}
        />
        <FitnessStatCell
          label="Photos"
          icon={Images}
          value={`${numberFormat.format(photos)}${suffix}`}
        />
        {topCategories.map(([category, count]) => (
          <FitnessStatCell
            key={category}
            label={GALLERY_CATEGORY_LABELS[category]}
            icon={GALLERY_CATEGORY_ICONS[category]}
            value={numberFormat.format(count)}
          />
        ))}
      </FitnessStatGrid>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">Species, first sighting first</caption>
          <thead>
            <tr className={FITNESS_TABLE_HEAD_ROW_CLASS}>
              <th
                scope="col"
                className="w-10 px-2 py-2 font-medium sm:w-12 sm:px-3"
              >
                #
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Name
              </th>
              <th
                scope="col"
                className="hidden px-3 py-2 font-medium sm:table-cell"
              >
                Scientific name
              </th>
              <th
                scope="col"
                className="hidden px-3 py-2 font-medium sm:table-cell"
              >
                First seen
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Photos
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.entries.map((entry, index) => {
              const name = entry.name ?? entry.scientificName ?? 'Unnamed'
              return (
                <tr key={entry.key}>
                  <td className="text-muted-foreground px-2 py-2 tabular-nums sm:px-3">
                    {index + 1}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {linkSubjects ? (
                      <Link
                        href={getGallerySubjectHref(entry.key)}
                        prefetch={false}
                        className="hover:underline"
                      >
                        {name}
                      </Link>
                    ) : onSelectSubject ? (
                      <button
                        type="button"
                        className="text-left font-medium hover:underline"
                        onClick={() => onSelectSubject(entry.key, name)}
                      >
                        {name}
                      </button>
                    ) : (
                      name
                    )}
                    {/* The First seen column is hidden below `sm`, so the date
                        sits under the name and Photos stays on screen. */}
                    <span className="text-muted-foreground block text-xs font-normal sm:hidden">
                      First seen {formatGalleryDate(entry.firstSeenAt)}
                    </span>
                  </td>
                  <td className="text-muted-foreground hidden px-3 py-2 italic sm:table-cell">
                    {entry.name ? (entry.scientificName ?? '') : ''}
                  </td>
                  <td className="text-muted-foreground hidden px-3 py-2 whitespace-nowrap sm:table-cell">
                    {formatGalleryDate(entry.firstSeenAt)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {entry.count}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {data.truncated ? (
        <p className="text-muted-foreground text-xs">
          Showing the most recent part of a large gallery. Counts are a lower
          bound.
        </p>
      ) : null}
    </div>
  )
}

'use client'

import { CircleHelp, Images, Layers, ListChecks } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import { getGallerySubjectHref } from '@/lib/components/gallery/GallerySubjectCard'
import {
  GALLERY_CATEGORY_ICONS,
  GALLERY_CATEGORY_LABELS,
  formatGalleryDate
} from '@/lib/components/gallery/galleryCategories'
import { StatCell } from '@/lib/components/surface/StatCell'
import { StatStrip } from '@/lib/components/surface/StatStrip'
import { TABLE_HEAD_ROW_CLASS } from '@/lib/components/surface/TableFrame'
import { Badge } from '@/lib/components/ui/badge'
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
 * Confirmed species, groups and unconfirmed subjects, first sighting first.
 */
export const GalleryLifeListTable: FC<Props> = ({
  data,
  linkSubjects = false,
  onSelectSubject
}) => {
  const photos = data.entries.reduce((total, entry) => total + entry.count, 0)
  const counts = data.counts ?? { species: 0, groups: 0, unknown: data.total }
  const topCategories = (
    Object.entries(data.counts ? (data.countsByCategory ?? {}) : {}).map(
      ([category, value]) => [category, value.species]
    ) as [MediaSubjectCategory, number][]
  )
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
  let speciesNumber = 0
  const suffix = data.truncated ? '+' : ''

  return (
    <div className="space-y-4">
      <StatStrip variant="summary" columns={4}>
        <StatCell
          label="Species"
          icon={ListChecks}
          value={`${numberFormat.format(counts.species)}${suffix}`}
        />
        <StatCell
          label="Groups"
          icon={Layers}
          value={`${numberFormat.format(counts.groups)}${suffix}`}
        />
        <StatCell
          label="Unconfirmed"
          icon={CircleHelp}
          value={`${numberFormat.format(counts.unknown)}${suffix}`}
        />
        <StatCell
          label="Photos"
          icon={Images}
          value={`${numberFormat.format(photos)}${suffix}`}
        />
      </StatStrip>
      {topCategories.length > 0 ? (
        <StatStrip variant="summary" columns={topCategories.length as 1 | 2}>
          {topCategories.map(([category, count]) => (
            <StatCell
              key={category}
              label={GALLERY_CATEGORY_LABELS[category]}
              icon={GALLERY_CATEGORY_ICONS[category]}
              value={numberFormat.format(count)}
            />
          ))}
        </StatStrip>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Species, groups and unconfirmed subjects, first sighting first
          </caption>
          <thead>
            <tr className={TABLE_HEAD_ROW_CLASS}>
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
              <th
                scope="col"
                className="hidden px-3 py-2 font-medium sm:table-cell"
              >
                Where
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Photos
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.entries.map((entry) => {
              const level = data.counts
                ? (entry.identificationLevel ?? 'unknown')
                : 'unknown'
              const ordinal = level === 'species' ? ++speciesNumber : null
              const rankLabel =
                level === 'group' && entry.taxonRank
                  ? entry.taxonRank[0] + entry.taxonRank.slice(1).toLowerCase()
                  : 'Unconfirmed'
              const name = entry.name ?? entry.scientificName ?? 'Unnamed'
              return (
                <tr key={entry.key}>
                  <td className="text-muted-foreground px-2 py-2 font-mono tabular-nums sm:px-3">
                    {ordinal ?? (
                      <>
                        <span aria-hidden="true">–</span>
                        <span className="sr-only">Not a confirmed species</span>
                      </>
                    )}
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
                    {level !== 'species' ? (
                      <Badge className="ml-2">{rankLabel}</Badge>
                    ) : null}
                    {/* The First seen and Where columns are hidden below `sm`, so
                        the date (and place) sit under the name and Photos stays
                        on screen. */}
                    <span className="text-muted-foreground block text-xs font-normal sm:hidden">
                      First seen {formatGalleryDate(entry.firstSeenAt)}
                      {entry.firstPlaceName ? ` · ${entry.firstPlaceName}` : ''}
                    </span>
                  </td>
                  <td className="text-muted-foreground hidden px-3 py-2 italic sm:table-cell">
                    {entry.name ? (entry.scientificName ?? '') : ''}
                  </td>
                  <td className="text-muted-foreground hidden px-3 py-2 whitespace-nowrap sm:table-cell">
                    {formatGalleryDate(entry.firstSeenAt)}
                  </td>
                  <td className="text-muted-foreground hidden px-3 py-2 sm:table-cell">
                    {entry.firstPlaceName ?? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">No place</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
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

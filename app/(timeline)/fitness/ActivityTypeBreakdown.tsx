'use client'

import Link from 'next/link'
import { FC, useId, useMemo } from 'react'

import { formatDistance, formatDuration } from '@/lib/fitness/calendar/format'
import type { FitnessActivitySummary } from '@/lib/fitness/calendar/types'
import {
  buildActivityTypeLabels,
  formatActivityTypeLabel,
  getActivityPresentation
} from '@/lib/services/fitness-files/activityPresentation'
import { cn } from '@/lib/utils'

import { getActivityFilterHref } from './activityFilter'

/** React key of the row for activities that carry no type. */
const UNTYPED_ROW_KEY = '__untyped__'

const SKELETON_ROWS = 3

interface Props {
  /** The summary rows for the applied range; `null` type = untyped. */
  summary: readonly FitnessActivitySummary[]
  /**
   * The stored `activityType` the recent-activities feed below is filtered to,
   * straight off the page's `?activity=` search param. Owned by the URL rather
   * than by the dashboard so the server render that filters the feed and the
   * row that reads as selected can never disagree.
   */
  selectedActivityType?: string
  /** Keep the table's shape with skeleton rows while the range loads. */
  loading?: boolean
}

/**
 * The applied range's totals per activity type, longest distance first.
 *
 * Each typed row's name links to the recent-activities filter (`?activity=`,
 * read by the page and passed to the server-filtered feed); clicking the row
 * already filtered to clears it. Untyped activities are counted like any other
 * but get a plain "Workout" row: `?activity=` only accepts a stored type, and a
 * sentinel for "no type" would widen that contract.
 */
export const ActivityTypeBreakdown: FC<Props> = ({
  summary,
  selectedActivityType,
  loading = false
}) => {
  const headingId = useId()
  const rows = useMemo(
    () =>
      [...summary].sort(
        (first, second) =>
          second.totalDistanceMeters - first.totalDistanceMeters ||
          second.count - first.count
      ),
    [summary]
  )

  // Labels are built over the whole set, not per row: two stored spellings that
  // differ only in case fold onto one label, and this is what tells the reader
  // which of the two rows their filter will actually follow.
  const activityLabels = useMemo(
    () =>
      buildActivityTypeLabels(
        rows
          .map((item) => item.activityType)
          .filter((type): type is string => type !== null)
      ),
    [rows]
  )

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-base font-semibold">
        Activity types
      </h2>
      {/* A free-form activity type is stored verbatim, so the numbers keep
          their own width (`whitespace-nowrap`) and only the name wraps, with
          the whole table free to scroll rather than push the card wider than
          the column.

          `break-words` on that name, NOT the `wrap-anywhere` the gear tables
          use: this table auto-sizes rather than snapping, and breaking
          anywhere drops the name column's min-content contribution to one
          character, which is what let table layout squeeze "Walk" into
          "Wal / k" on a phone. Keeping whole words as the floor makes the
          column overflow into the scroller instead. */}
      <div
        className="overflow-x-auto rounded-lg border"
        aria-busy={loading || undefined}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Activity
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">
                Count
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">
                Duration
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Distance
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Shimmering skeleton bars (the shared `.skeleton`). Their widths
                are PERCENTAGES capped at the old pixel widths: a percentage
                width adds nothing to a table cell's minimum width, so the
                skeleton table is never wider than its header and the card (a
                fixed `w-28 + w-6 + w-14 + w-16` made it 368px and clipped
                "Distance" in a 358px phone column). */}
            {loading
              ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <tr
                    key={index}
                    aria-hidden="true"
                    className="border-b last:border-b-0"
                  >
                    <td className="px-4 py-3.5">
                      <span className="block h-3.5 w-3/4 max-w-28 rounded skeleton" />
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="ml-auto block h-3.5 w-full max-w-6 rounded skeleton" />
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="ml-auto block h-3.5 w-full max-w-14 rounded skeleton" />
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="ml-auto block h-3.5 w-full max-w-16 rounded skeleton" />
                    </td>
                  </tr>
                ))
              : rows.map((item) => {
                  const { activityType } = item
                  const { emoji, label: untypedLabel } =
                    getActivityPresentation(activityType)
                  const label =
                    activityType === null
                      ? untypedLabel
                      : (activityLabels.get(activityType) ??
                        formatActivityTypeLabel(activityType))
                  const isSelected =
                    activityType !== null &&
                    selectedActivityType === activityType
                  return (
                    <tr
                      key={activityType ?? UNTYPED_ROW_KEY}
                      className="border-b last:border-b-0"
                    >
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span aria-hidden="true" className="shrink-0">
                            {emoji}
                          </span>
                          {activityType === null ? (
                            <span className="font-medium break-words">
                              {label}
                            </span>
                          ) : (
                            // `prefetch={false}`: one link per activity type
                            // pointing at this same `force-dynamic` page, so
                            // prefetching them would re-run the whole
                            // overview render once per row on screen.
                            <Link
                              href={getActivityFilterHref(
                                activityType,
                                isSelected
                              )}
                              prefetch={false}
                              scroll={false}
                              aria-current={isSelected ? 'true' : undefined}
                              title={
                                isSelected
                                  ? 'Clear filter'
                                  : `Show recent ${label} activities`
                              }
                              className={cn(
                                'text-primary-text font-medium break-words hover:underline',
                                isSelected && 'underline'
                              )}
                            >
                              {label}
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                        {item.count}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                        {formatDuration(item.totalDurationSeconds)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                        {formatDistance(item.totalDistanceMeters)}
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

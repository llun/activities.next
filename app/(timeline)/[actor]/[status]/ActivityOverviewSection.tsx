import { Map as MapIcon } from 'lucide-react'
import { FC, ReactNode } from 'react'

import {
  ANALYSIS_SERIES_COLOURS,
  type AnalysisSeriesKey
} from '@/lib/components/fitness/palette'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { cn } from '@/lib/utils'

export interface OverviewRow {
  label: string
  /** Null hides the row: the file has nothing for it. */
  value: string | null
  /** Whether to render a placeholder row while route data is pending or failed. */
  reserveWhenLoading?: boolean
}

export interface OverviewGroup {
  key: string
  title: string
  /** The series colour on the group's band, tying it to the chart's line. */
  colour: AnalysisSeriesKey
  rows: OverviewRow[]
}

/** The groups with their empty rows dropped, and groups left empty dropped. */
export const getVisibleOverviewGroups = (
  groups: OverviewGroup[]
): OverviewGroup[] =>
  groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => row.value !== null)
    }))
    .filter((group) => group.rows.length > 0)

const OverviewGroupFrame: FC<{
  group: OverviewGroup
  reserveRows: boolean
  isFailed: boolean
}> = ({ group, reserveRows, isFailed }) => (
  <div data-testid={`overview-group-${group.key}`}>
    <Frame className="overflow-hidden">
      <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span
          aria-hidden="true"
          className={cn(
            'size-2 shrink-0 rounded-full',
            ANALYSIS_SERIES_COLOURS[group.colour].dot
          )}
        />
        <h3>{group.title}</h3>
      </div>
      <dl className="divide-y">
        {group.rows.map((row) =>
          row.value !== null ? (
            <div
              key={row.label}
              className="flex justify-between gap-2 px-3 py-[7px] tabular-nums"
            >
              <dt className="min-w-0 text-muted-foreground">{row.label}</dt>
              <dd className="font-semibold whitespace-nowrap">{row.value}</dd>
            </div>
          ) : reserveRows && row.reserveWhenLoading ? (
            <div
              key={row.label}
              aria-hidden="true"
              data-testid="overview-placeholder-row"
              data-metric={row.label}
              className="flex items-center justify-between gap-2 px-3 py-[7px]"
            >
              <SkeletonBar animated={!isFailed} className="h-5 w-20" />
              <SkeletonBar animated={!isFailed} className="h-5 w-14" />
            </div>
          ) : null
        )}
      </dl>
    </Frame>
  </div>
)

export interface ActivityOverviewSectionProps {
  /** "28.8 km · 1:15:03 elapsed". */
  meta?: string
  /** The route map, or null when the activity has no route. */
  map: ReactNode | null
  groups: OverviewGroup[]
  reserveRows?: boolean
  isFailed?: boolean
}

/**
 * The route map beside the activity's figures, in groups (the ride, power,
 * heart rate, cadence and weather). Side by side once the column is 820px
 * wide; below that the map spans the column above the groups, which pair up
 * from 520px.
 */
export const ActivityOverviewSection: FC<ActivityOverviewSectionProps> = ({
  meta,
  map,
  groups,
  reserveRows = false,
  isFailed = false
}) => {
  const visibleGroups = reserveRows
    ? groups
        .map((group) => ({
          ...group,
          rows: group.rows.filter(
            (row) => row.value !== null || Boolean(row.reserveWhenLoading)
          )
        }))
        .filter((group) => group.rows.length > 0)
    : getVisibleOverviewGroups(groups)
  if (!map && visibleGroups.length === 0) return null
  return (
    <Section id="overview" title="Overview" icon={MapIcon} meta={meta}>
      <div
        className={cn(
          'grid gap-3',
          map && '@min-[820px]:grid-cols-2 @min-[820px]:items-start'
        )}
      >
        {map ? <div className="min-w-0">{map}</div> : null}
        {visibleGroups.length > 0 ? (
          <div className="grid min-w-0 gap-3 @min-[520px]:grid-cols-2">
            {visibleGroups.map((group) => (
              <OverviewGroupFrame
                key={group.key}
                group={group}
                reserveRows={reserveRows}
                isFailed={isFailed}
              />
            ))}
          </div>
        ) : null}
      </div>
    </Section>
  )
}

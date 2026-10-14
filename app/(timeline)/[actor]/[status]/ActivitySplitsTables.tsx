import { Flag, Mountain } from 'lucide-react'
import { FC } from 'react'

import {
  GEAR_TABLE_SCROLLER,
  STICKY_CLICKABLE_COLUMN,
  STICKY_HEAD_CELL
} from '@/app/(timeline)/fitness/gear/gearUi'
import { ANALYSIS_SERIES_COLOURS } from '@/lib/components/fitness/palette'
import { Section } from '@/lib/components/surface/Section'
import { TABLE_HEAD_ROW_CLASS } from '@/lib/components/surface/TableFrame'
import { cn } from '@/lib/utils'
import { formatFitnessPace } from '@/lib/utils/fitness'

import type { ActivitySplit } from './fitnessActivityMetrics'
import { formatDuration } from './fitnessChartData'

export type SplitColumnKey =
  | 'time'
  | 'distance'
  | 'speed'
  | 'power'
  | 'heartRate'
  | 'cadence'
  | 'gain'
  | 'grade'

const COLUMN_ORDER: SplitColumnKey[] = [
  'time',
  'distance',
  'speed',
  'power',
  'heartRate',
  'cadence',
  'gain',
  'grade'
]

const COLUMN_VALUE: Record<
  SplitColumnKey,
  (split: ActivitySplit) => number | null
> = {
  time: (split) => split.durationSeconds,
  distance: (split) => split.distanceMeters,
  speed: (split) => split.avgSpeedKmh,
  power: (split) => split.avgPower,
  heartRate: (split) => split.avgHeartRate,
  cadence: (split) => split.avgCadence,
  gain: (split) => split.gainMeters,
  grade: (split) => split.gradePercent
}

/**
 * The columns both tables show: every column that has a value in either one.
 * Laps and Climbs share it so their columns line up, the way the gear page's
 * tables do; a column neither table can fill (no power meter, no altitude) is
 * left out of both.
 */
export const getSplitColumns = (
  ...tables: ActivitySplit[][]
): SplitColumnKey[] =>
  COLUMN_ORDER.filter((column) =>
    tables.some((rows) =>
      rows.some((row) => COLUMN_VALUE[column](row) !== null)
    )
  )

const FIRST_COLUMN_WIDTH = 22

interface SplitsTableProps {
  id: string
  title: string
  icon: typeof Flag
  meta: string
  firstHeader: string
  rows: ActivitySplit[]
  columns: SplitColumnKey[]
  /** Pace (min/km) instead of speed, for runs and walks. */
  usesPace: boolean
  selectedKey: string | null
  onSelect: (key: string) => void
  /** The highest average power across both tables, for the power bars. */
  peakPower: number
}

const SplitsTable: FC<SplitsTableProps> = ({
  id,
  title,
  icon,
  meta,
  firstHeader,
  rows,
  columns,
  usesPace,
  selectedKey,
  onSelect,
  peakPower
}) => {
  const columnWidth = (100 - FIRST_COLUMN_WIDTH) / Math.max(1, columns.length)
  const headers: Record<SplitColumnKey, string> = {
    time: 'Time',
    distance: 'Distance',
    speed: usesPace ? 'Pace' : 'Speed',
    power: 'Power',
    heartRate: 'HR',
    cadence: 'Cadence',
    gain: 'Gain',
    grade: 'Grade'
  }
  const renderValue = (column: SplitColumnKey, split: ActivitySplit) => {
    const value = COLUMN_VALUE[column](split)
    if (value === null) return '–'
    switch (column) {
      case 'time':
        return formatDuration(Math.round(value))
      case 'distance':
        return `${(value / 1000).toFixed(1)} km`
      case 'speed':
        return usesPace
          ? (formatFitnessPace(value > 0 ? 3600 / value : undefined) ?? '–')
          : `${value.toFixed(1)} km/h`
      case 'power':
        return (
          <>
            <span
              aria-hidden="true"
              className={cn(
                'mr-2 inline-block h-1.5 rounded-full align-middle opacity-80',
                ANALYSIS_SERIES_COLOURS.power.dot
              )}
              style={{ width: Math.round((value / peakPower) * 24) }}
            />
            {Math.round(value)} W
          </>
        )
      case 'heartRate':
      case 'cadence':
        return `${Math.round(value)}`
      case 'gain':
        return `${Math.round(value)} m`
      case 'grade':
        return `${value.toFixed(1)} %`
    }
  }

  return (
    <Section id={id} title={title} icon={icon} meta={meta}>
      <div className={GEAR_TABLE_SCROLLER}>
        <table className="w-full min-w-[720px] table-fixed text-sm tabular-nums">
          <colgroup>
            <col style={{ width: `${FIRST_COLUMN_WIDTH}%` }} />
            {columns.map((column) => (
              <col key={column} style={{ width: `${columnWidth}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr className={TABLE_HEAD_ROW_CLASS}>
              <th
                className={cn(
                  STICKY_CLICKABLE_COLUMN,
                  STICKY_HEAD_CELL,
                  'px-4 py-2.5 font-medium'
                )}
              >
                {firstHeader}
              </th>
              {columns.map((column) => (
                <th
                  key={column}
                  className="px-3 py-2.5 text-right font-medium whitespace-nowrap"
                >
                  {headers[column]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((split) => {
              const isSelected = split.key === selectedKey
              return (
                <tr
                  key={split.key}
                  data-selected={isSelected ? 'true' : undefined}
                  className={cn(
                    'group cursor-pointer border-t hover:bg-muted',
                    isSelected && 'bg-muted'
                  )}
                  onClick={() => onSelect(split.key)}
                >
                  <td
                    className={cn(
                      STICKY_CLICKABLE_COLUMN,
                      'truncate px-4 py-3 align-middle',
                      isSelected && 'bg-muted'
                    )}
                  >
                    {/* A real button so the row is reachable by keyboard; the
                        row's own onClick is the pointer affordance. */}
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelect(split.key)
                      }}
                      className="block max-w-full truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {split.label}
                    </button>
                    {split.subline ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {split.subline}
                      </div>
                    ) : null}
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column}
                      className={cn(
                        'px-3 py-3 text-right align-middle whitespace-nowrap',
                        column === 'power' && 'font-semibold'
                      )}
                    >
                      {renderValue(column, split)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

export interface ActivitySplitsTablesProps {
  laps: ActivitySplit[]
  climbs: ActivitySplit[]
  /** "6 · every 5 km": the Laps heading's note. */
  lapsMeta: string
  usesPace: boolean
  selectedKey: string | null
  onSelect: (key: string) => void
}

/**
 * The Laps and Climbs tables, laid out like the gear page's: a scroller with a
 * sticky first column (the name over a muted subline), right-aligned figures,
 * and rows that pick that stretch on the chart and the map.
 */
export const ActivitySplitsTables: FC<ActivitySplitsTablesProps> = ({
  laps,
  climbs,
  lapsMeta,
  usesPace,
  selectedKey,
  onSelect
}) => {
  if (laps.length === 0 && climbs.length === 0) return null
  const columns = getSplitColumns(laps, climbs)
  const peakPower = Math.max(
    1,
    ...[...laps, ...climbs].map((split) => split.avgPower ?? 0)
  )
  const shared = { columns, usesPace, selectedKey, onSelect, peakPower }
  return (
    <>
      {laps.length > 0 ? (
        <SplitsTable
          id="laps"
          title="Laps"
          icon={Flag}
          meta={lapsMeta}
          firstHeader="Lap"
          rows={laps}
          {...shared}
        />
      ) : null}
      {climbs.length > 0 ? (
        <SplitsTable
          id="climbs"
          title="Climbs"
          icon={Mountain}
          meta={`${climbs.length} · found from elevation`}
          firstHeader="Climb"
          rows={climbs}
          {...shared}
        />
      ) : null}
    </>
  )
}

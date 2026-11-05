'use client'

import { Trophy } from 'lucide-react'
import Link from 'next/link'
import { FC, useEffect, useState } from 'react'

import { formatEffortDuration } from '@/app/(timeline)/[actor]/[status]/ActivityBestEfforts'
import { getFitnessRecords } from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import type {
  FitnessRecordEntry,
  FitnessRecords,
  FitnessRecordsRange
} from '@/lib/fitness/bestEfforts'
import { cn } from '@/lib/utils'
import { formatFitnessDuration } from '@/lib/utils/fitness'

const RANGE_ITEMS: Array<{ value: FitnessRecordsRange; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: 'year', label: 'This year' },
  { value: '90d', label: 'Last 90 days' }
]

const DISTANCE_LABELS: Record<number, string> = {
  1000: '1 km',
  5000: '5 km',
  10000: '10 km',
  21097.5: 'Half marathon',
  42195: 'Marathon'
}

// Rendered only after the client fetch, so the viewer's own zone is safe here.
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})

const RecordRow: FC<{
  label: string
  entry: FitnessRecordEntry
  formatValue: (value: number) => string
  missingText: string
}> = ({ label, entry, formatValue, missingText }) => (
  <FramedListItem className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
    <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
    {entry.value !== null && entry.activity ? (
      <>
        <span className="w-20 shrink-0 font-semibold tabular-nums">
          {formatValue(entry.value)}
        </span>
        <Link
          href={entry.activity.statusPath}
          prefetch={false}
          className="min-w-0 flex-1 truncate hover:underline"
        >
          {entry.activity.title}
        </Link>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {dateFormatter.format(entry.activity.activityDate)}
        </span>
      </>
    ) : (
      <span className="flex-1 text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="ml-3">{missingText}</span>
      </span>
    )}
  </FramedListItem>
)

export const RecordsSkeleton: FC = () => (
  <div className="space-y-6">
    <p role="status" className="sr-only">
      Loading records
    </p>
    {[5, 5].map((rows, section) => (
      <div key={section} aria-hidden="true" className="space-y-3">
        <SkeletonBar className="h-5 w-40" />
        <div className="divide-y rounded-lg border">
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex items-center gap-4 px-4 py-3">
              <SkeletonBar className="h-4 w-20" />
              <SkeletonBar className="h-4 w-16" />
              <SkeletonBar className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
)

/**
 * The owner's records: best power per duration from rides (any activity with
 * power) and fastest times per distance from runs, over a chosen range.
 */
export const PersonalRecordsView: FC = () => {
  const [range, setRange] = useState<FitnessRecordsRange>('all')
  const [records, setRecords] = useState<FitnessRecords | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    getFitnessRecords(range)
      .then((loaded) => {
        if (cancelled) return
        setRecords(loaded)
        setError(null)
      })
      .catch((loadError) => {
        if (cancelled) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load records.'
        )
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [range, reloadToken])

  const isEmpty =
    records !== null &&
    [...records.power, ...records.distance].every(
      (entry) => entry.value === null
    )

  return (
    <div className="space-y-6">
      <SegmentedControl
        aria-label="Records range"
        items={RANGE_ITEMS}
        value={range}
        onValueChange={(value) => setRange(value as FitnessRecordsRange)}
      />
      {error ? (
        <Alert
          title="We couldn’t load your records"
          onRetry={() => setReloadToken((token) => token + 1)}
        >
          {error}
        </Alert>
      ) : null}
      {records === null ? (
        error ? null : (
          <RecordsSkeleton />
        )
      ) : (
        <div
          className={cn(
            'space-y-6 transition-opacity duration-150',
            isLoading && 'opacity-60'
          )}
          aria-busy={isLoading}
        >
          {isEmpty ? (
            <EmptyState
              icon={Trophy}
              title={
                range === 'all' ? 'No records yet' : 'No records in this range'
              }
            >
              Records come from activities with power or from runs. Upload or
              import one and its best efforts show up here.
            </EmptyState>
          ) : (
            <>
              <Section title="Ride · best power">
                <FramedList aria-label="Best power">
                  {records.power.map((entry) => (
                    <RecordRow
                      key={entry.key}
                      label={formatEffortDuration(entry.key)}
                      entry={entry}
                      formatValue={(watts) => `${Math.round(watts)} W`}
                      missingText="No power data yet"
                    />
                  ))}
                </FramedList>
              </Section>
              <Section title="Run · fastest">
                <FramedList aria-label="Fastest runs">
                  {records.distance.map((entry) => (
                    <RecordRow
                      key={entry.key}
                      label={DISTANCE_LABELS[entry.key] ?? `${entry.key} m`}
                      entry={entry}
                      formatValue={(seconds) =>
                        formatFitnessDuration(seconds) ?? '—'
                      }
                      missingText="No run long enough yet"
                    />
                  ))}
                </FramedList>
              </Section>
            </>
          )}
        </div>
      )}
    </div>
  )
}

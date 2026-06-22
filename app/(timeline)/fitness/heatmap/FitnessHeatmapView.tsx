'use client'

import { Flame } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  FitnessRouteHeatmapData,
  FitnessRouteHeatmapSummaryData,
  deleteFitnessRouteHeatmap,
  getDistinctFitnessActivityTypes,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmaps,
  triggerFitnessRouteHeatmap
} from '@/lib/client'
import {
  HeatmapRegionPicker,
  PickerRegion,
  RegionDisplayStatus,
  toHeatmapRegion,
  withRegionIds
} from '@/lib/components/fitness/HeatmapRegionPicker'
import { RegionHeatmapDetail } from '@/lib/components/fitness/RegionHeatmapDetail'
import { Select } from '@/lib/components/ui/select'
import {
  HeatmapRegion,
  deserializeRegions,
  serializeRegion
} from '@/lib/fitness/regions'
import { formatRelativeTime } from '@/lib/fitness/relativeTime'

// Re-exported so existing imports/tests keep resolving the route map from here.
export {
  RouteHeatmapMap,
  downsampleSegments
} from '@/lib/components/fitness/RouteHeatmapMap'
export type { RouteHeatmapMapProps } from '@/lib/components/fitness/RouteHeatmapMap'

type PeriodType = 'all_time' | 'yearly' | 'monthly'

interface Props {
  actorId: string
  mapboxAccessToken?: string
}

const currentYear = new Date().getUTCFullYear()
const ROUTE_HEATMAP_POLLING_INTERVAL_MS = 5000
const STALLED_POLLING_LIMIT = 30
// Keep recent background jobs live while ignoring restored/stuck rows that are days old.
const STALE_IN_FLIGHT_HEATMAP_MS = 15 * 60_000

const WORLD_REGION: PickerRegion = { id: 'world', type: 'world' }

const formatActivityLabel = (type?: string): string =>
  type
    ? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'All activities'

const formatPeriodLabel = (periodType: string, periodKey: string): string =>
  periodType === 'all_time' ? 'All time' : periodKey

/** Progress percent (0–100) from scanned/total, or null when the total is unknown. */
const computeProgressPercent = (
  totalCount: number,
  cursorOffset: number
): number | null => {
  if (totalCount <= 0) return null
  const cappedScanned = Math.min(cursorOffset, totalCount)
  return Math.max(
    0,
    Math.min(100, Math.round((cappedScanned / totalCount) * 100))
  )
}

const isRouteHeatmapInFlight = (status?: string): boolean =>
  status === 'generating' || status === 'pending'

const generateYearOptions = (): number[] => {
  const years: number[] = []
  for (let y = currentYear; y >= currentYear - 10; y--) {
    years.push(y)
  }
  return years
}

const generateMonthOptions = (year: number): string[] => {
  const months: string[] = []
  const now = new Date()
  const maxMonth = year === now.getUTCFullYear() ? now.getUTCMonth() : 11
  for (let m = maxMonth; m >= 0; m--) {
    months.push(`${year}-${String(m + 1).padStart(2, '0')}`)
  }
  return months
}

/** Maps a region's matching heatmap summary into a display status atom. */
const summaryToStatus = (
  summary: FitnessRouteHeatmapSummaryData,
  currentTime: number
): RegionDisplayStatus => {
  if (summary.status === 'generating') {
    return {
      state: 'generating',
      progressPercent: computeProgressPercent(
        summary.totalCount,
        summary.cursorOffset
      )
    }
  }
  if (summary.status === 'pending') return { state: 'pending' }
  if (summary.status === 'failed') return { state: 'failed' }
  if (summary.status === 'completed') {
    return {
      state: summary.isPartial ? 'partial' : 'completed',
      generatedLabel: formatRelativeTime(currentTime - summary.updatedAt)
    }
  }
  return { state: 'idle' }
}

/**
 * Seeds the curated region list with any distinct regions found across the
 * actor's existing heatmaps (so previously generated regions reappear), keeping
 * the whole-world entry first. Legacy multi-region keys split into their
 * individual regions; duplicates (by canonical key) are dropped.
 */
const mergeDiscoveredRegions = (
  current: PickerRegion[],
  heatmaps: FitnessRouteHeatmapSummaryData[]
): PickerRegion[] => {
  const seen = new Set(
    current.map((region) => serializeRegion(toHeatmapRegion(region)))
  )
  const additions: HeatmapRegion[] = []
  for (const heatmap of heatmaps) {
    for (const region of deserializeRegions(heatmap.region ?? '')) {
      const key = serializeRegion(region)
      if (seen.has(key)) continue
      seen.add(key)
      additions.push(region)
    }
  }
  return additions.length ? [...current, ...withRegionIds(additions)] : current
}

export const FitnessHeatmapView: FC<Props> = ({
  actorId,
  mapboxAccessToken
}) => {
  const [activityTypes, setActivityTypes] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState<string>('')
  const [periodType, setPeriodType] = useState<PeriodType>('all_time')
  const [periodKey, setPeriodKey] = useState<string>('all')
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)
  // Static id for the default so the initial SSR render and client hydration
  // produce identical state (a dynamically generated id would differ).
  const [regions, setRegions] = useState<PickerRegion[]>(() => [WORLD_REGION])
  const [openRegionId, setOpenRegionId] = useState<string | null>(null)

  const [heatmaps, setHeatmaps] = useState<FitnessRouteHeatmapSummaryData[]>([])
  const [heatmapData, setHeatmapData] =
    useState<FitnessRouteHeatmapData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generationPending, setGenerationPending] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [pollingStalled, setPollingStalled] = useState(false)
  const [currentTime, setCurrentTime] = useState<number>(() => Date.now())

  const focusKeyRef = useRef<string>('')
  const fetchRequestIdRef = useRef(0)
  const pollingProgressRef = useRef<{
    key: string
    fingerprint: string
    stalledCycles: number
  } | null>(null)

  useEffect(() => {
    const id = setInterval(() => setCurrentTime(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    getDistinctFitnessActivityTypes({ actorId })
      .then(setActivityTypes)
      .catch(() => {})
  }, [actorId])

  // Initial load: reset to the default region list for this actor, then pull
  // the actor's heatmaps and seed in any previously generated regions. This
  // effect runs once per actorId, so the merge happens once (and is idempotent
  // — it dedupes by canonical region key).
  useEffect(() => {
    setRegions([WORLD_REGION])
    setOpenRegionId(null)

    let cancelled = false
    getFitnessRouteHeatmaps({ actorId })
      .then((all) => {
        if (cancelled) return
        setHeatmaps(all)
        setRegions((current) => mergeDiscoveredRegions(current, all))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [actorId])

  const selectedActivityType = selectedType || undefined
  const effectivePeriodKey = useMemo(() => {
    if (periodType === 'all_time') return 'all'
    if (periodType === 'yearly') return `${selectedYear}`
    return periodKey
  }, [periodType, selectedYear, periodKey])

  const openRegion = useMemo(
    () => regions.find((region) => region.id === openRegionId) ?? null,
    [regions, openRegionId]
  )
  const openRegionKey = openRegion
    ? serializeRegion(toHeatmapRegion(openRegion))
    : null

  const focusKey = openRegion
    ? `${actorId}:${selectedActivityType ?? ''}:${periodType}:${effectivePeriodKey}:${openRegionKey}`
    : ''

  useEffect(() => {
    focusKeyRef.current = focusKey
  }, [focusKey])

  // Reset the focused state whenever the focused selection changes (including
  // closing the detail), so a stale map/status never carries across regions.
  useEffect(() => {
    setHeatmapData(null)
    setGenerationPending(false)
    setPollingStalled(false)
    pollingProgressRef.current = null
  }, [focusKey])

  const sourceMatch = useCallback(
    (heatmap: FitnessRouteHeatmapSummaryData): boolean =>
      (heatmap.activityType ?? '') === (selectedActivityType ?? '') &&
      heatmap.periodType === periodType &&
      heatmap.periodKey === effectivePeriodKey,
    [selectedActivityType, periodType, effectivePeriodKey]
  )

  const heatmapForRegion = useCallback(
    (region: PickerRegion): FitnessRouteHeatmapSummaryData | null => {
      const key = serializeRegion(toHeatmapRegion(region))
      return (
        heatmaps.find(
          (heatmap) => sourceMatch(heatmap) && (heatmap.region ?? '') === key
        ) ?? null
      )
    },
    [heatmaps, sourceMatch]
  )

  const getRegionStatus = useCallback(
    (region: PickerRegion): RegionDisplayStatus => {
      const summary = heatmapForRegion(region)
      return summary ? summaryToStatus(summary, currentTime) : { state: 'idle' }
    },
    [heatmapForRegion, currentTime]
  )

  const fetchFocused = useCallback(async () => {
    if (!openRegionId || openRegionKey === null) return
    const requestId = fetchRequestIdRef.current + 1
    fetchRequestIdRef.current = requestId
    const key = focusKeyRef.current
    const isCurrent = () =>
      fetchRequestIdRef.current === requestId && focusKeyRef.current === key

    setIsLoading(true)
    setError(null)
    try {
      const [heatmap, allHeatmaps] = await Promise.all([
        getFitnessRouteHeatmap({
          actorId,
          activityType: selectedActivityType,
          periodType,
          periodKey: effectivePeriodKey,
          region: openRegionKey || undefined
        }),
        getFitnessRouteHeatmaps({ actorId })
      ])
      if (!isCurrent()) return
      setHeatmapData(heatmap)
      setHeatmaps(allHeatmaps)
    } catch (err) {
      if (!isCurrent()) return
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load route heatmap data.'
      )
    } finally {
      if (isCurrent()) setIsLoading(false)
    }
  }, [
    actorId,
    selectedActivityType,
    periodType,
    effectivePeriodKey,
    openRegionId,
    openRegionKey
  ])

  useEffect(() => {
    fetchFocused()
  }, [fetchFocused])

  const focusedInFlight =
    generationPending || isRouteHeatmapInFlight(heatmapData?.status)
  const shouldPollFocused =
    Boolean(openRegionId) && focusedInFlight && !pollingStalled
  // The focused region runs its own stall-aware polling, so exclude it here.
  // Otherwise a stuck focused job keeps the list-poll alive, which would reset
  // the focused region's stalled state every tick (an infinite poll loop).
  const hasAnyListInFlight = useMemo(
    () =>
      heatmaps.some(
        (heatmap) =>
          sourceMatch(heatmap) &&
          isRouteHeatmapInFlight(heatmap.status) &&
          currentTime - heatmap.updatedAt <= STALE_IN_FLIGHT_HEATMAP_MS &&
          (openRegionKey === null || (heatmap.region ?? '') !== openRegionKey)
      ),
    [heatmaps, sourceMatch, currentTime, openRegionKey]
  )

  useEffect(() => {
    if (!shouldPollFocused && !hasAnyListInFlight) return

    const id = setInterval(() => {
      if (!shouldPollFocused) {
        // List-only refresh: keep other regions' statuses current. It must NOT
        // touch the focused region's stalled state (that is owned by the
        // focused-poll branch / focusKey reset), or a stalled focused job would
        // be un-stalled every tick.
        getFitnessRouteHeatmaps({ actorId })
          .then(setHeatmaps)
          .catch(() => {})
        return
      }

      Promise.all([
        getFitnessRouteHeatmap({
          actorId,
          activityType: selectedActivityType,
          periodType,
          periodKey: effectivePeriodKey,
          region: openRegionKey || undefined
        }),
        getFitnessRouteHeatmaps({ actorId })
      ])
        .then(([heatmap, allHeatmaps]) => {
          if (focusKeyRef.current !== focusKey) return

          setHeatmapData(heatmap)
          setHeatmaps(allHeatmaps)

          if (heatmap && !isRouteHeatmapInFlight(heatmap.status)) {
            setGenerationPending(false)
          }

          const nextFocusedInFlight =
            isRouteHeatmapInFlight(heatmap?.status) ||
            (generationPending && heatmap === null)
          if (!nextFocusedInFlight) {
            pollingProgressRef.current = null
            setPollingStalled(false)
            return
          }

          const fingerprint = heatmap
            ? `${heatmap.id}:${heatmap.status}:${heatmap.updatedAt}`
            : 'missing'
          const previous = pollingProgressRef.current
          if (
            !previous ||
            previous.key !== focusKey ||
            previous.fingerprint !== fingerprint
          ) {
            pollingProgressRef.current = {
              key: focusKey,
              fingerprint,
              stalledCycles: 0
            }
            return
          }

          const stalledCycles = previous.stalledCycles + 1
          pollingProgressRef.current = { ...previous, stalledCycles }
          if (stalledCycles >= STALLED_POLLING_LIMIT) {
            setGenerationPending(false)
            setPollingStalled(true)
          }
        })
        .catch(() => {
          // A persistently failing poll must still self-terminate: count each
          // failed request toward the stall limit so the spinner doesn't run
          // forever when the endpoint keeps erroring.
          if (focusKeyRef.current !== focusKey) return
          const previous = pollingProgressRef.current
          const stalledCycles = (previous?.stalledCycles ?? 0) + 1
          pollingProgressRef.current = {
            key: focusKey,
            fingerprint: previous?.fingerprint ?? 'error',
            stalledCycles
          }
          if (stalledCycles >= STALLED_POLLING_LIMIT) {
            setGenerationPending(false)
            setPollingStalled(true)
          }
        })
    }, ROUTE_HEATMAP_POLLING_INTERVAL_MS)

    return () => clearInterval(id)
  }, [
    shouldPollFocused,
    hasAnyListInFlight,
    actorId,
    selectedActivityType,
    periodType,
    effectivePeriodKey,
    openRegionKey,
    focusKey,
    generationPending
  ])

  const yearOptions = useMemo(() => generateYearOptions(), [])
  const monthOptions = useMemo(
    () => generateMonthOptions(selectedYear),
    [selectedYear]
  )

  const handlePeriodTypeChange = (newType: PeriodType) => {
    setPeriodType(newType)
    if (newType === 'all_time') {
      setPeriodKey('all')
    } else if (newType === 'yearly') {
      setPeriodKey(`${selectedYear}`)
    } else {
      const month = String(new Date().getUTCMonth() + 1).padStart(2, '0')
      setPeriodKey(`${selectedYear}-${month}`)
    }
  }

  const handleYearChange = (year: number) => {
    setSelectedYear(year)
    if (periodType === 'yearly') {
      setPeriodKey(`${year}`)
      return
    }
    if (periodType === 'monthly') {
      const currentMonth = periodKey.split('-')[1] ?? '01'
      const newKey = `${year}-${currentMonth}`
      const options = generateMonthOptions(year)
      setPeriodKey(options.includes(newKey) ? newKey : options[0])
    }
  }

  const enqueueGeneration = useCallback(
    async (retry: boolean) => {
      if (!openRegionId || openRegionKey === null) return
      const key = focusKeyRef.current
      const success = await triggerFitnessRouteHeatmap({
        actorId,
        activityType: selectedActivityType,
        periodType,
        periodKey: effectivePeriodKey,
        region: openRegionKey || undefined,
        retry
      })
      if (!success) {
        throw new Error('Failed to enqueue route heatmap refresh.')
      }
      if (focusKeyRef.current !== key) return
      setGenerationPending(true)
      setPollingStalled(false)
      pollingProgressRef.current = null
      getFitnessRouteHeatmaps({ actorId })
        .then(setHeatmaps)
        .catch(() => {})
    },
    [
      actorId,
      selectedActivityType,
      periodType,
      effectivePeriodKey,
      openRegionId,
      openRegionKey
    ]
  )

  const runGeneration = useCallback(async () => {
    setIsRetrying(true)
    setError(null)
    try {
      // A failed/in-flight/partial run resumes the existing row; a fresh or
      // fully-completed region starts a brand-new run.
      const retry =
        heatmapData?.status === 'failed' ||
        heatmapData?.status === 'generating' ||
        Boolean(heatmapData?.status === 'completed' && heatmapData?.isPartial)
      await enqueueGeneration(retry)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to enqueue route heatmap refresh.'
      )
    } finally {
      setIsRetrying(false)
    }
  }, [heatmapData, enqueueGeneration])

  const handleRegionRemoved = useCallback(
    async (region: PickerRegion) => {
      // The picker (and so the remove control) only renders in the master view,
      // where no region is open — so there is no open-detail to close here.
      setError(null)
      const key = serializeRegion(toHeatmapRegion(region))
      // Optimistically prune the region's heatmap for the current source so a
      // removed region doesn't reappear from a stale cache row.
      setHeatmaps((current) =>
        current.filter(
          (heatmap) => !(sourceMatch(heatmap) && (heatmap.region ?? '') === key)
        )
      )
      try {
        await deleteFitnessRouteHeatmap({
          actorId,
          activityType: selectedActivityType,
          periodType,
          periodKey: effectivePeriodKey,
          region: key || undefined
        })
      } catch (err) {
        // The region has already left the list (the user's curation), but the
        // server-side cache deletion failed — surface it so the user knows the
        // region may reappear after a refresh, rather than failing silently.
        setError(
          err instanceof Error
            ? `Couldn't remove the cached heatmap: ${err.message}`
            : "Couldn't remove the cached heatmap. It may reappear after a refresh."
        )
      }
    },
    [actorId, selectedActivityType, periodType, effectivePeriodKey, sourceMatch]
  )

  const focusedProgressPercent = heatmapData
    ? computeProgressPercent(heatmapData.totalCount, heatmapData.cursorOffset)
    : null

  if (openRegion) {
    return (
      <RegionHeatmapDetail
        region={openRegion}
        meta={{
          activity: formatActivityLabel(selectedActivityType),
          period: formatPeriodLabel(periodType, effectivePeriodKey)
        }}
        heatmap={heatmapData}
        mapboxAccessToken={mapboxAccessToken}
        currentTime={currentTime}
        isLoading={isLoading}
        busy={focusedInFlight && !pollingStalled}
        pollingStalled={pollingStalled}
        progressPercent={focusedProgressPercent}
        isRetrying={isRetrying}
        generationQueued={generationPending}
        error={error}
        onBack={() => setOpenRegionId(null)}
        onGenerate={runGeneration}
        onRetry={runGeneration}
      />
    )
  }

  const generatedCount = regions.filter((region) => {
    const summary = heatmapForRegion(region)
    return summary?.status === 'completed'
  }).length

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Heatmap source — applies to every region you generate below. */}
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Flame className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold">Heatmap source</div>
            <div className="text-[11px] text-muted-foreground">
              Applies to every region you generate below.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground">
              Activity
            </span>
            <Select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
            >
              <option value="">All activities</option>
              {activityTypes.map((type) => (
                <option key={type} value={type}>
                  {formatActivityLabel(type)}
                </option>
              ))}
            </Select>
          </label>

          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground">
              Period
            </span>
            <Select
              value={periodType}
              onChange={(e) =>
                handlePeriodTypeChange(e.target.value as PeriodType)
              }
            >
              <option value="all_time">All time</option>
              <option value="yearly">Yearly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </label>

          {periodType !== 'all_time' && (
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">
                Year
              </span>
              <Select
                value={selectedYear}
                onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            </label>
          )}

          {periodType === 'monthly' && (
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">
                Month
              </span>
              <Select
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
              >
                {monthOptions.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
      </section>

      {/* Region list — each opens its own heatmap page. */}
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3">
          <div className="text-sm font-semibold">Regions</div>
          <div className="text-[11px] text-muted-foreground">
            {regions.length} region{regions.length === 1 ? '' : 's'} ·{' '}
            {generatedCount} generated. Open one to view its heatmap &amp;
            generate.
          </div>
        </div>
        <HeatmapRegionPicker
          value={regions}
          onChange={setRegions}
          mapboxAccessToken={mapboxAccessToken}
          onOpen={(region) => setOpenRegionId(region.id)}
          getRegionStatus={getRegionStatus}
          onRegionRemoved={handleRegionRemoved}
        />
      </section>
    </div>
  )
}

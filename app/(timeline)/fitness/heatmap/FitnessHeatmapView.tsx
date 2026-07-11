'use client'

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  FitnessRouteHeatmapData,
  FitnessRouteHeatmapRegionNameData,
  FitnessRouteHeatmapSummaryData,
  cancelFitnessRouteHeatmap,
  deleteFitnessRouteHeatmap,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmapRegionNames,
  getFitnessRouteHeatmaps,
  setFitnessRouteHeatmapRegionName,
  shareFitnessRouteHeatmap,
  triggerFitnessRouteHeatmap,
  unshareFitnessRouteHeatmap
} from '@/lib/client'
import {
  HeatmapRegionPicker,
  PickerRegion,
  RegionDisplayStatus,
  toHeatmapRegion,
  withRegionIds
} from '@/lib/components/fitness/HeatmapRegionPicker'
import { RegionHeatmapDetail } from '@/lib/components/fitness/RegionHeatmapDetail'
import {
  HeatmapRegion,
  deserializeRegions,
  serializeRegion
} from '@/lib/fitness/regions'
import { formatRelativeTime } from '@/lib/fitness/relativeTime'
import type { PublicMapProvider } from '@/lib/utils/mapProvider'

// Re-exported so existing imports/tests keep resolving the route map from here.
export { RouteHeatmapMap } from '@/lib/components/fitness/RouteHeatmapMap'
export type { RouteHeatmapMapProps } from '@/lib/components/fitness/RouteHeatmapMap'

type PeriodType = 'all_time' | 'yearly' | 'monthly'

interface Props {
  actorId: string
  /** Which map backend renders the region maps. */
  mapProvider: PublicMapProvider
  /** Server-computed origin for embed share links (avoids a `window` SSR gap). */
  embedOrigin: string
}

const ROUTE_HEATMAP_POLLING_INTERVAL_MS = 5000
const STALLED_POLLING_LIMIT = 30
// Keep recent background jobs live while ignoring restored/stuck rows that are days old.
const STALE_IN_FLIGHT_HEATMAP_MS = 15 * 60_000

const WORLD_REGION: PickerRegion = { id: 'world', type: 'world' }

// The Activity + Period source selectors were removed from this page, so the
// heatmap source is fixed: all activities, all time. These are module constants
// (not per-render state) so they are evaluated once and stay out of the hook
// dependency arrays, while the existing source-keyed fetch/poll/share/remove
// logic — and the detail page's "All activities / All time" meta chips — keep
// working unchanged.
const SELECTED_ACTIVITY_TYPE: string | undefined = undefined
const PERIOD_TYPE: PeriodType = 'all_time'
const EFFECTIVE_PERIOD_KEY = 'all'

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
  if (summary.status === 'cancelled') return { state: 'cancelled' }
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

/**
 * Seeds saved region labels (keyed by canonical region key) onto a region list,
 * so a region rediscovered from its heatmap regains its user-given name instead
 * of falling back to the generic "Map area". World regions are unnamed.
 *
 * Only fills in a name when the region doesn't already have one: this runs once
 * on the initial load, and the names snapshot is captured when the fetch starts,
 * so a label a user set in-session while that fetch was still in flight must not
 * be reverted to the (now-stale) stored value.
 */
const applyRegionNames = (
  regions: PickerRegion[],
  names: FitnessRouteHeatmapRegionNameData[]
): PickerRegion[] => {
  if (names.length === 0) return regions
  const nameByKey = new Map(names.map((entry) => [entry.region, entry.name]))
  return regions.map((region) => {
    if (region.type !== 'rect' || region.name) return region
    const name = nameByKey.get(serializeRegion(toHeatmapRegion(region)))
    return name ? { ...region, name } : region
  })
}

export const FitnessHeatmapView: FC<Props> = ({
  actorId,
  mapProvider,
  embedOrigin
}) => {
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
  const [isCancelling, setIsCancelling] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
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

  // Initial load: reset to the default region list for this actor, then pull
  // the actor's heatmaps and seed in any previously generated regions. This
  // effect runs once per actorId, so the merge happens once (and is idempotent
  // — it dedupes by canonical region key).
  useEffect(() => {
    setRegions([WORLD_REGION])
    setOpenRegionId(null)

    let cancelled = false
    Promise.all([
      getFitnessRouteHeatmaps({ actorId }),
      // Labels are non-critical metadata: a failed names fetch must not block the
      // heatmaps from loading, so it degrades to "no saved labels".
      getFitnessRouteHeatmapRegionNames({ actorId }).catch(() => [])
    ])
      .then(([all, names]) => {
        if (cancelled) return
        setHeatmaps(all)
        setRegions((current) =>
          applyRegionNames(mergeDiscoveredRegions(current, all), names)
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [actorId])

  const openRegion = useMemo(
    () => regions.find((region) => region.id === openRegionId) ?? null,
    [regions, openRegionId]
  )
  const openRegionKey = openRegion
    ? serializeRegion(toHeatmapRegion(openRegion))
    : null

  const focusKey = openRegion
    ? `${actorId}:${SELECTED_ACTIVITY_TYPE ?? ''}:${PERIOD_TYPE}:${EFFECTIVE_PERIOD_KEY}:${openRegionKey}`
    : ''

  useEffect(() => {
    focusKeyRef.current = focusKey
  }, [focusKey])

  // Reset the focused state whenever the focused selection changes (including
  // closing the detail), so a stale map/status never carries across regions.
  // isRetrying/isCancelling are component-wide, so clearing them here keeps an
  // enqueue/cancel that was still in flight when the user switched regions from
  // wedging the next region's Generate/Cancel button disabled.
  useEffect(() => {
    setHeatmapData(null)
    setGenerationPending(false)
    setPollingStalled(false)
    setIsRetrying(false)
    setIsCancelling(false)
    pollingProgressRef.current = null
  }, [focusKey])

  const sourceMatch = useCallback(
    (heatmap: FitnessRouteHeatmapSummaryData): boolean =>
      (heatmap.activityType ?? '') === (SELECTED_ACTIVITY_TYPE ?? '') &&
      heatmap.periodType === PERIOD_TYPE &&
      heatmap.periodKey === EFFECTIVE_PERIOD_KEY,
    []
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
          activityType: SELECTED_ACTIVITY_TYPE,
          periodType: PERIOD_TYPE,
          periodKey: EFFECTIVE_PERIOD_KEY,
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
  }, [actorId, openRegionId, openRegionKey])

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
          activityType: SELECTED_ACTIVITY_TYPE,
          periodType: PERIOD_TYPE,
          periodKey: EFFECTIVE_PERIOD_KEY,
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
    openRegionKey,
    focusKey,
    generationPending
  ])

  const enqueueGeneration = useCallback(
    async (retry: boolean) => {
      if (!openRegionId || openRegionKey === null) return
      const key = focusKeyRef.current
      const success = await triggerFitnessRouteHeatmap({
        actorId,
        activityType: SELECTED_ACTIVITY_TYPE,
        periodType: PERIOD_TYPE,
        periodKey: EFFECTIVE_PERIOD_KEY,
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
    [actorId, openRegionId, openRegionKey]
  )

  const runGeneration = useCallback(async () => {
    // Capture the focused selection so a slow enqueue that resolves after the
    // user switched/closed regions neither surfaces its error on, nor clears the
    // retry flag of, a different region.
    const key = focusKeyRef.current
    setIsRetrying(true)
    setError(null)
    try {
      // A failed/in-flight/partial/cancelled run reuses the existing row; a fresh
      // or fully-completed region starts a brand-new run. Retrying a cancelled
      // run gets a fresh job id so the queue can't dedupe it away.
      const retry =
        heatmapData?.status === 'failed' ||
        heatmapData?.status === 'generating' ||
        heatmapData?.status === 'cancelled' ||
        Boolean(heatmapData?.status === 'completed' && heatmapData?.isPartial)
      await enqueueGeneration(retry)
    } catch (err) {
      if (focusKeyRef.current === key) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to enqueue route heatmap refresh.'
        )
      }
    } finally {
      if (focusKeyRef.current === key) setIsRetrying(false)
    }
  }, [heatmapData, enqueueGeneration])

  const handleCancel = useCallback(async () => {
    if (!openRegionId || openRegionKey === null) return
    // Capture the focused selection so a slow request that resolves after the
    // user switched/closed regions does not apply its result elsewhere.
    const key = focusKeyRef.current
    setIsCancelling(true)
    setError(null)
    try {
      await cancelFitnessRouteHeatmap({
        actorId,
        activityType: SELECTED_ACTIVITY_TYPE,
        periodType: PERIOD_TYPE,
        periodKey: EFFECTIVE_PERIOD_KEY,
        region: openRegionKey || undefined
      })
      // Only apply the result to the region still in focus.
      if (focusKeyRef.current === key) {
        setGenerationPending(false)
        setPollingStalled(false)
        pollingProgressRef.current = null
        // Refetch so the focused row + list flip to the cancelled state and the
        // in-flight spinner stops.
        await fetchFocused()
      }
    } catch (err) {
      if (focusKeyRef.current === key) {
        setError(
          err instanceof Error ? err.message : 'Failed to cancel generation.'
        )
      }
    } finally {
      // Only clear it for the still-focused region. Switching regions mid-cancel
      // is handled by the focusKey reset effect (which clears it there), so a
      // late-settling cancel for a region the user already left can't flip the
      // flag off underneath a cancel that's now in flight for the new region.
      if (focusKeyRef.current === key) setIsCancelling(false)
    }
  }, [actorId, openRegionId, openRegionKey, fetchFocused])

  const handleShare = useCallback(async () => {
    if (!openRegionId || openRegionKey === null) return
    // Capture the focused selection so a slow request that resolves after the
    // user switched/closed regions does not apply its result to another region.
    const key = focusKeyRef.current
    setIsSharing(true)
    setError(null)
    try {
      const shareToken = await shareFitnessRouteHeatmap({
        actorId,
        activityType: SELECTED_ACTIVITY_TYPE,
        periodType: PERIOD_TYPE,
        periodKey: EFFECTIVE_PERIOD_KEY,
        region: openRegionKey || undefined
      })
      if (focusKeyRef.current !== key) return
      setHeatmapData((current) =>
        current ? { ...current, shareToken } : current
      )
    } catch (err) {
      if (focusKeyRef.current !== key) return
      setError(
        err instanceof Error ? err.message : 'Failed to create the embed link.'
      )
    } finally {
      setIsSharing(false)
    }
  }, [actorId, openRegionId, openRegionKey])

  const handleUnshare = useCallback(async () => {
    if (!openRegionId || openRegionKey === null) return
    const key = focusKeyRef.current
    setIsSharing(true)
    setError(null)
    try {
      await unshareFitnessRouteHeatmap({
        actorId,
        activityType: SELECTED_ACTIVITY_TYPE,
        periodType: PERIOD_TYPE,
        periodKey: EFFECTIVE_PERIOD_KEY,
        region: openRegionKey || undefined
      })
      if (focusKeyRef.current !== key) return
      setHeatmapData((current) =>
        current ? { ...current, shareToken: null } : current
      )
    } catch (err) {
      if (focusKeyRef.current !== key) return
      setError(err instanceof Error ? err.message : 'Failed to stop sharing.')
    } finally {
      setIsSharing(false)
    }
  }, [actorId, openRegionId, openRegionKey])

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
          activityType: SELECTED_ACTIVITY_TYPE,
          periodType: PERIOD_TYPE,
          periodKey: EFFECTIVE_PERIOD_KEY,
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
    [actorId, sourceMatch]
  )

  const handleRegionSaved = useCallback(
    async (region: PickerRegion) => {
      // Only drawn areas carry a label; the world-wide region (empty key) is
      // never named.
      if (region.type !== 'rect') return
      const key = serializeRegion(toHeatmapRegion(region))
      if (!key) return
      let saved: boolean
      try {
        saved = await setFitnessRouteHeatmapRegionName({
          actorId,
          region: key,
          name: region.name ?? null
        })
      } catch {
        saved = false
      }
      if (!saved) {
        // The name is already shown in-session; surface the failure so the user
        // knows it may not survive a refresh rather than failing silently.
        setError(
          "Couldn't save the region name. It may not persist after a refresh."
        )
      } else {
        // Clear any stale error from a prior failed save once one succeeds.
        setError(null)
      }
    },
    [actorId]
  )

  const handleRegionRenamed = useCallback(
    (region: PickerRegion, name: string) => {
      // Only drawn areas are renameable; the whole-world region is never named.
      if (region.type !== 'rect') return
      const trimmed = name.trim() || undefined
      // Reflect the new name immediately — the open detail page reads its title
      // from this list, so the heading updates without a refetch (the region key
      // is coordinate-only, so the heatmap link is unaffected).
      setRegions((current) =>
        current.map((entry) =>
          entry.id === region.id ? { ...entry, name: trimmed } : entry
        )
      )
      // Persist by canonical region key, reusing the picker's save path (which
      // also surfaces a save failure).
      void handleRegionSaved({ ...region, name: trimmed })
    },
    [handleRegionSaved]
  )

  const focusedProgressPercent = heatmapData
    ? computeProgressPercent(heatmapData.totalCount, heatmapData.cursorOffset)
    : null

  if (openRegion) {
    return (
      <RegionHeatmapDetail
        region={openRegion}
        meta={{
          activity: formatActivityLabel(SELECTED_ACTIVITY_TYPE),
          period: formatPeriodLabel(PERIOD_TYPE, EFFECTIVE_PERIOD_KEY)
        }}
        heatmap={heatmapData}
        mapProvider={mapProvider}
        embedOrigin={embedOrigin}
        isSharing={isSharing}
        onShare={handleShare}
        onUnshare={handleUnshare}
        currentTime={currentTime}
        isLoading={isLoading}
        busy={focusedInFlight && !pollingStalled}
        pollingStalled={pollingStalled}
        progressPercent={focusedProgressPercent}
        isRetrying={isRetrying}
        isCancelling={isCancelling}
        generationQueued={generationPending}
        error={error}
        onBack={() => setOpenRegionId(null)}
        onGenerate={runGeneration}
        onRetry={runGeneration}
        onCancel={handleCancel}
        onRename={handleRegionRenamed}
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
          mapProvider={mapProvider}
          onOpen={(region) => setOpenRegionId(region.id)}
          getRegionStatus={getRegionStatus}
          onRegionRemoved={handleRegionRemoved}
          onRegionSaved={handleRegionSaved}
        />
      </section>
    </div>
  )
}

'use client'

import { RefreshCw, Map as MapIcon, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  FitnessCalendarDay,
  FitnessHeatmapData,
  getDistinctFitnessActivityTypes,
  getFitnessCalendarData,
  getFitnessHeatmap,
  getFitnessHeatmaps,
  getFitnessHeatmapGeoJSON,
  triggerFitnessHeatmap
} from '@/lib/client'
import {
  CalendarMetric,
  FitnessCalendarHeatmap
} from '@/lib/components/fitness/FitnessCalendarHeatmap'
import { RegionSelector } from '@/lib/components/fitness/RegionSelector'
import { InteractiveHeatmapMap } from '@/lib/components/fitness/InteractiveHeatmapMap'
import { deserializeRegions, serializeRegions } from '@/lib/fitness/regions'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/lib/components/ui/card'

type PeriodType = 'all_time' | 'yearly' | 'monthly'

interface Props {
  actorId: string
  mapboxAccessToken?: string
}

const METRIC_LABELS: Record<CalendarMetric, string> = {
  count: 'Count',
  distance: 'Distance',
  duration: 'Duration'
}

const currentYear = new Date().getUTCFullYear()

const getCalendarDateRange = (
  periodType: PeriodType,
  periodKey: string
): { startDate: number; endDate: number } => {
  if (periodType === 'yearly') {
    const year = parseInt(periodKey, 10)
    return {
      startDate: Date.UTC(year, 0, 1),
      endDate: Date.UTC(year + 1, 0, 1)
    }
  }

  if (periodType === 'monthly') {
    const [yearStr, monthStr] = periodKey.split('-')
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10) - 1
    return {
      startDate: Date.UTC(year, month, 1),
      endDate: Date.UTC(year, month + 1, 1)
    }
  }

  // all_time: last 12 months
  const now = new Date()
  const start = Date.UTC(
    now.getUTCFullYear() - 1,
    now.getUTCMonth(),
    now.getUTCDate()
  )
  return { startDate: start, endDate: now.getTime() }
}

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

export const FitnessHeatmapView: FC<Props> = ({ actorId, mapboxAccessToken }) => {
  const [activityTypes, setActivityTypes] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState<string>('')
  const [periodType, setPeriodType] = useState<PeriodType>('all_time')
  const [periodKey, setPeriodKey] = useState<string>('all')
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('count')
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([])

  const [heatmapData, setHeatmapData] = useState<FitnessHeatmapData | null>(
    null
  )
  const [geojson, setGeojson] = useState<any | null>(null)
  const [calendarDays, setCalendarDays] = useState<FitnessCalendarDay[]>([])
  const [isLoadingGeoJSON, setIsLoadingGeoJSON] = useState(false)
  const [generationPending, setGenerationPending] = useState(false)
  // Tracks the combination of params for which generation was triggered so we
  // don't fire duplicate POST requests on every fetchData re-run.
  const generationKeyRef = useRef<string | null>(null)

  const [heatmaps, setHeatmaps] = useState<FitnessHeatmapData[]>([])

  useEffect(() => {
    getDistinctFitnessActivityTypes({ actorId })
      .then(setActivityTypes)
      .catch(() => {
        // Activity types are non-critical, just use empty list
      })
  }, [actorId])

  const effectivePeriodKey = useMemo(() => {
    if (periodType === 'all_time') return 'all'
    if (periodType === 'yearly') return `${selectedYear}`
    return periodKey
  }, [periodType, selectedYear, periodKey])

  // Serialize selected regions to a canonical string (sorted, deduped).
  const serializedRegion = useMemo(
    () =>
      selectedRegionIds.length > 0 ? serializeRegions(selectedRegionIds) : null,
    [selectedRegionIds]
  )

  const fetchGeoJSON = useCallback(async () => {
    setIsLoadingGeoJSON(true)
    try {
      const activityType = selectedType || undefined
      const data = await getFitnessHeatmapGeoJSON({
        actorId,
        activityType,
        periodType,
        periodKey: effectivePeriodKey,
        region: serializedRegion
      })
      setGeojson(data)
    } catch {
      // Non-fatal
    } finally {
      setIsLoadingGeoJSON(false)
    }
  }, [actorId, selectedType, periodType, effectivePeriodKey, serializedRegion])

  const fetchData = useCallback(async () => {
    try {
      const activityType = selectedType || undefined
      const { startDate, endDate } = getCalendarDateRange(
        periodType,
        effectivePeriodKey
      )

      const [heatmap, calendar, allHeatmaps] = await Promise.all([
        getFitnessHeatmap({
          actorId,
          activityType,
          periodType,
          periodKey: effectivePeriodKey,
          region: serializedRegion
        }),
        getFitnessCalendarData({
          actorId,
          startDate,
          endDate,
          activityType
        }),
        getFitnessHeatmaps({ actorId })
      ])

      setHeatmapData(heatmap)
      setCalendarDays(calendar)
      setHeatmaps(allHeatmaps)

      if (heatmap?.status === 'completed') {
        fetchGeoJSON()
      } else {
        setGeojson(null)
      }

      // If no heatmap exists yet and a region filter is active, trigger
      // on-demand generation (only once per unique param combination).
      if (heatmap === null && serializedRegion) {
        const genKey = `${actorId}:${activityType ?? ''}:${periodType}:${effectivePeriodKey}:${serializedRegion}`
        if (generationKeyRef.current !== genKey) {
          generationKeyRef.current = genKey
          setGenerationPending(true)
          triggerFitnessHeatmap({
            actorId,
            activityType,
            periodType,
            periodKey: effectivePeriodKey,
            region: serializedRegion
          }).catch(() => {
            // Non-fatal — user can retry manually
          })
        }
      }
    } catch {
      // Non-fatal
    }
  }, [actorId, selectedType, periodType, effectivePeriodKey, serializedRegion, fetchGeoJSON])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Stable boolean: true when any list entry is still in-flight.
  const hasAnyListInFlight = useMemo(
    () =>
      heatmaps.some((h) => h.status === 'generating' || h.status === 'pending'),
    [heatmaps]
  )

  // Poll every 5 s while a generation job is in flight
  useEffect(() => {
    const hasInFlight =
      generationPending ||
      heatmapData?.status === 'generating' ||
      heatmapData?.status === 'pending' ||
      hasAnyListInFlight
    if (!hasInFlight) return

    const id = setInterval(() => {
      getFitnessHeatmap({
        actorId,
        activityType: selectedType || undefined,
        periodType,
        periodKey: effectivePeriodKey,
        region: serializedRegion
      })
        .then((heatmap) => {
          setHeatmapData(heatmap)
          if (heatmap !== null && heatmap.status !== 'generating') {
            setGenerationPending(false)
            if (heatmap.status === 'completed') fetchGeoJSON()
          }
        })
        .catch(() => {
          // Ignore transient poll errors
        })
      getFitnessHeatmaps({ actorId })
        .then(setHeatmaps)
        .catch(() => {})
    }, 5000)

    return () => clearInterval(id)
  }, [
    generationPending,
    heatmapData?.status,
    hasAnyListInFlight,
    actorId,
    selectedType,
    periodType,
    effectivePeriodKey,
    serializedRegion,
    fetchGeoJSON
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
    } else if (periodType === 'monthly') {
      const currentMonth = periodKey.split('-')[1] ?? '01'
      const newKey = `${year}-${currentMonth}`
      const options = generateMonthOptions(year)
      setPeriodKey(options.includes(newKey) ? newKey : options[0])
    }
  }

  const handleSelectHeatmap = useCallback((h: FitnessHeatmapData) => {
    setSelectedType(h.activityType ?? '')
    setPeriodType(h.periodType as PeriodType)
    setPeriodKey(h.periodKey)
    if (h.periodType === 'yearly') setSelectedYear(parseInt(h.periodKey, 10))
    if (h.periodType === 'monthly')
      setSelectedYear(parseInt(h.periodKey.split('-')[0], 10))
    setSelectedRegionIds(h.region ? deserializeRegions(h.region) : [])
  }, [])

  const handleRetry = useCallback(
    async (h: FitnessHeatmapData) => {
      setGenerationPending(true)
      try {
        const success = await triggerFitnessHeatmap({
          actorId,
          activityType: h.activityType,
          periodType: h.periodType as PeriodType,
          periodKey: h.periodKey,
          region: h.region || undefined
        })
        if (!success) {
          throw new Error('Failed to enqueue retry. Please try again.')
        }
      } catch (err) {
        setGenerationPending(false)
        throw err instanceof Error
          ? err
          : new Error('Failed to enqueue retry. Please try again.')
      }
      getFitnessHeatmaps({ actorId })
        .then(setHeatmaps)
        .catch(() => {})
    },
    [actorId]
  )

  return (
    <div className="space-y-6 p-4">
      {/* Selectors */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-6">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Activity</label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All Activities</option>
                {activityTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Period Type</label>
              <select
                value={periodType}
                onChange={(e) => handlePeriodTypeChange(e.target.value as PeriodType)}
                className="block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all_time">All Time</option>
                <option value="yearly">Yearly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            {periodType !== 'all_time' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Year</label>
                <select
                  value={selectedYear}
                  onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
                  className="block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            {periodType === 'monthly' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Month</label>
                <select
                  value={periodKey}
                  onChange={(e) => setPeriodKey(e.target.value)}
                  className="block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1.5 min-w-[200px]">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Region Filter</label>
              <RegionSelector
                selectedIds={selectedRegionIds}
                onChange={setSelectedRegionIds}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar: Heatmap Gallery */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">My Heatmaps</h2>
            <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary text-primary-foreground hover:bg-primary/80">
              {heatmaps.length}
            </span>
          </div>
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {heatmaps.map((h) => {
              const isActive = h.activityType === (selectedType || null) &&
                             h.periodType === periodType &&
                             h.periodKey === effectivePeriodKey &&
                             h.region === (serializedRegion || '')
              return (
                <button
                  key={h.id}
                  onClick={() => handleSelectHeatmap(h)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    isActive ? 'bg-primary/5 border-primary ring-1 ring-primary' : 'bg-background hover:bg-muted/50 border-border'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-bold text-sm">
                      {h.activityType ? h.activityType.charAt(0).toUpperCase() + h.activityType.slice(1) : 'All Activities'}
                    </span>
                    {h.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> :
                     h.status === 'generating' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> :
                     <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
                  </div>
                  <div className="text-xs text-muted-foreground mb-2 capitalize">
                    {h.periodType.replace('_', ' ')}: {h.periodKey}
                    {h.region && ` • ${h.region}`}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase">
                    <MapIcon className="h-3 w-3" />
                    {h.activityCount} Activities
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Main: Interactive Map */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between py-4 border-b bg-muted/30">
              <div className="space-y-0.5">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapIcon className="h-4 w-4 text-primary" />
                  Interactive Heatmap
                </CardTitle>
                <CardDescription className="text-xs">
                  {selectedType || 'All activities'} for {periodType.replace('_', ' ')} ({effectivePeriodKey})
                </CardDescription>
              </div>
              {isLoadingGeoJSON && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </CardHeader>
            <CardContent className="p-0 relative">
              <InteractiveHeatmapMap
                mapboxAccessToken={mapboxAccessToken}
                geojson={geojson}
              />

              {!heatmapData && !generationPending && (
                <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-[2px] flex items-center justify-center p-6 text-center">
                  <div className="max-w-xs space-y-3">
                    <MapIcon className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                    <p className="text-sm font-medium text-muted-foreground">
                      No heatmap generated yet for this selection.
                    </p>
                    {selectedRegionIds.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Wait for the generation to complete or select another region.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {heatmapData && heatmapData.status === 'generating' && (
                <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-[2px] flex items-center justify-center p-6 text-center">
                  <div className="space-y-3">
                    <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
                    <p className="text-sm font-medium">Generating heatmap...</p>
                    <p className="text-xs text-muted-foreground">This may take a few moments depending on the number of activities.</p>
                  </div>
                </div>
              )}

              {heatmapData && heatmapData.status === 'failed' && (
                <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-[2px] flex items-center justify-center p-6 text-center">
                  <div className="space-y-3">
                    <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
                    <p className="text-sm font-medium">Generation Failed</p>
                    <p className="text-xs text-muted-foreground mb-3">{heatmapData.error}</p>
                    <button
                      onClick={() => handleRetry(heatmapData)}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Try Again
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity Calendar (preserved) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4 border-b">
              <CardTitle className="text-base">Activity Calendar</CardTitle>
              <div className="flex gap-1 rounded-md border p-0.5">
                {(Object.entries(METRIC_LABELS) as [CalendarMetric, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setCalendarMetric(key)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      calendarMetric === key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <FitnessCalendarHeatmap
                days={calendarDays}
                metric={calendarMetric}
                periodType={periodType}
                periodKey={effectivePeriodKey}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

#!/usr/bin/env -S node scripts/run.cjs
/**
 * Seeds a DETERMINISTIC set of fitness activities for the local mock user, so
 * the `/fitness` calendar, summary and day details can be checked against the
 * same edge cases every time: viewer-local day boundaries, daylight-saving
 * days, a leap day, year and month edges, a 22-activity day for pagination,
 * rows the dashboard must not count, and so on.
 *
 * Nothing here is random. Every number comes from a hash of the activity's
 * key, so two runs with the same flags write identical rows.
 *
 * Usage (local database only — it refuses anything else):
 *   set -a; . ./.env.local; set +a
 *   node scripts/run.cjs scripts/mock/createMockFitnessCalendarData.ts \
 *     --anchor 2026-10-04 --time-zone Europe/Amsterdam [--username testuser]
 *
 * `--anchor` is "today" for the seed (nothing is written after the start of
 * that day, plus five minutes) and `--time-zone` is the zone the wall-clock
 * times below are read in. Pass both or neither; the default is the pair above.
 *
 * Idempotent: every row this script writes has a path under `mock-calendar/`
 * (and every post carries the `mock-calendar` application name). A run deletes
 * the actor's rows under that prefix and their posts, then inserts the set
 * again. Run createMockUser.ts first.
 */
import crypto from 'crypto'
import type { Knex } from 'knex'
import { v5 as uuidV5 } from 'uuid'

import { getConfig } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import {
  DateKey,
  addDays,
  canonicalTimeZone,
  compareDateKeys,
  dateKeyParts,
  instantAtLocalWallTime,
  isValidTimeZone,
  parseDateKey,
  weekdayMon0
} from '@/lib/fitness/calendar/localDay'
import { getMention } from '@/lib/types/domain/actor'
import { getLocalStatusId } from '@/lib/utils/activitypubId'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { describeConnection } from '../fitness/describeConnection'

export const DEFAULT_ANCHOR = '2026-10-04'
export const DEFAULT_TIME_ZONE = 'Europe/Amsterdam'
export const MOCK_PATH_PREFIX = 'mock-calendar/'
export const MOCK_APPLICATION_NAME = 'mock-calendar'

const MS_PER_MINUTE = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
// Fixed namespace so a row's id is a pure function of the actor and the key.
const ID_NAMESPACE = 'b3a6f0e2-6f5e-4d6e-9c61-5f0a8d2c1e47'
const FIRST_FILLER_DAY = '2023-01-01' as DateKey
const EMPTY_MONTH_PREFIX = '2025-06-'

export type SeedActivityType =
  'run' | 'trail_run' | 'ride' | 'gravel_ride' | 'walk' | 'hike' | 'swim' | null

export interface SeedActivity {
  /** Unique and stable; ids and paths derive from it. */
  key: string
  /** The local day the activity is meant to land on (checked by the tests). */
  date: DateKey
  /** Local wall-clock time, `HH:MM`. */
  time: string
  /** Epoch milliseconds of the start. */
  startMs: number
  activityType: SeedActivityType
  distanceMeters: number | null
  durationSeconds: number | null
  elevationGainMeters: number | null
  avgHeartRate: number | null
  maxHeartRate: number | null
  avgPower: number | null
  maxPower: number | null
  totalWorkKj: number | null
  fileType: 'fit' | 'gpx'
  device: string
  /** HTML of the post this row owns, or null when it has no post. */
  postHtml: string | null
  /** Key of the activity whose post this row links to (itself, or a primary). */
  postFrom: string | null
  processingStatus: 'completed' | 'pending' | 'failed'
  isPrimary: boolean
  deleted: boolean
  importError: string | null
}

export interface SeedPlanOptions {
  anchor: DateKey
  timeZone: string
}

// ---------------------------------------------------------------------------
// Deterministic helpers

const unit = (key: string, salt: string): number =>
  crypto
    .createHash('sha256')
    .update(`${key}|${salt}`)
    .digest()
    .readUInt32BE(0) / 0x100000000

const pick = <T>(items: readonly T[], key: string, salt: string): T =>
  items[Math.min(items.length - 1, Math.floor(unit(key, salt) * items.length))]

const between = (key: string, salt: string, low: number, high: number) =>
  low + unit(key, salt) * (high - low)

const formatClock = (totalMinutes: number) =>
  `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`

// ---------------------------------------------------------------------------
// Activity metrics

interface TypeProfile {
  label: string
  emoji: string
  distancesKm: readonly number[]
  shortDistancesKm: readonly number[]
  /** Pace in seconds per km (runs, swims) or speed in km/h (rides, walks). */
  pace?: readonly [number, number]
  speedKmh?: readonly [number, number]
  elevationPerKm: readonly [number, number]
}

// Running paces sit at 5:00-6:30 /km and rides at 22-30 km/h, as the fitness
// views expect from a recreational athlete.
const PROFILES: Record<NonNullable<SeedActivityType>, TypeProfile> = {
  run: {
    label: 'Running',
    emoji: '🏃',
    distancesKm: [5, 6, 8, 10, 12, 15, 21.1],
    shortDistancesKm: [3, 4, 5],
    pace: [300, 390],
    elevationPerKm: [4, 14]
  },
  trail_run: {
    label: 'Trail running',
    emoji: '🏃',
    distancesKm: [7, 10, 14],
    shortDistancesKm: [4, 6],
    pace: [330, 390],
    elevationPerKm: [22, 40]
  },
  ride: {
    label: 'Cycling',
    emoji: '🚴',
    distancesKm: [25, 32, 45, 60, 80, 100],
    shortDistancesKm: [10, 15, 20],
    speedKmh: [22, 30],
    elevationPerKm: [5, 12]
  },
  gravel_ride: {
    label: 'Gravel cycling',
    emoji: '🚴',
    distancesKm: [30, 45, 60],
    shortDistancesKm: [12, 18],
    speedKmh: [22, 27],
    elevationPerKm: [8, 16]
  },
  walk: {
    label: 'Walking',
    emoji: '🚶',
    distancesKm: [2, 3, 4, 5, 6, 8],
    shortDistancesKm: [1, 2, 3],
    speedKmh: [4, 5.5],
    elevationPerKm: [2, 8]
  },
  hike: {
    label: 'Hiking',
    emoji: '🥾',
    distancesKm: [8, 11, 14, 18],
    shortDistancesKm: [4, 5, 6],
    speedKmh: [3, 4.5],
    elevationPerKm: [25, 60]
  },
  swim: {
    label: 'Swimming',
    emoji: '🏊',
    distancesKm: [1, 1.5, 2, 2.5],
    shortDistancesKm: [0.5, 1],
    // 1:45-2:30 per 100 m
    pace: [1050, 1500],
    elevationPerKm: [0, 0]
  }
}

const DEVICES = [
  { name: 'Garmin Forerunner 265', fileType: 'fit' as const },
  { name: 'Garmin Edge 840', fileType: 'fit' as const },
  { name: 'Wahoo ELEMNT Bolt', fileType: 'gpx' as const },
  { name: 'Apple Watch Ultra', fileType: 'gpx' as const },
  { name: 'Pixel Watch', fileType: 'gpx' as const },
  { name: 'Coros Pace 3', fileType: 'fit' as const }
]

interface Metrics {
  distanceMeters: number
  durationSeconds: number
  elevationGainMeters: number
  avgHeartRate: number
  maxHeartRate: number
  avgPower: number | null
  maxPower: number | null
  totalWorkKj: number | null
}

const buildMetrics = (
  key: string,
  type: SeedActivityType,
  short: boolean
): Metrics => {
  // An activity with no type behaves like an easy run of unknown origin.
  const profile = PROFILES[type ?? 'run']
  const baseKm = pick(
    short ? profile.shortDistancesKm : profile.distancesKm,
    key,
    'distance'
  )
  const distanceMeters =
    Math.round((baseKm * 1000 * between(key, 'dj', 0.94, 1.06)) / 10) * 10
  const km = distanceMeters / 1000

  let durationSeconds: number
  if (profile.speedKmh) {
    const [slow, fast] = profile.speedKmh
    durationSeconds = Math.round(
      (km / between(key, 'speed', slow, fast)) * 3600
    )
  } else {
    const [fast, slow] = profile.pace ?? [300, 390]
    durationSeconds = Math.round(km * between(key, 'pace', fast, slow))
  }

  const [lowElevation, highElevation] = profile.elevationPerKm
  const elevationGainMeters = Math.round(
    km * between(key, 'elevation', lowElevation, highElevation)
  )
  const isRide = type === 'ride' || type === 'gravel_ride'
  const avgPower = isRide ? Math.round(between(key, 'power', 160, 240)) : null
  const avgHeartRate = Math.round(
    type === 'walk'
      ? between(key, 'hr', 98, 118)
      : isRide
        ? between(key, 'hr', 124, 148)
        : between(key, 'hr', 140, 165)
  )
  return {
    distanceMeters,
    durationSeconds,
    elevationGainMeters,
    avgHeartRate,
    maxHeartRate: avgHeartRate + Math.round(between(key, 'hrmax', 14, 30)),
    avgPower,
    maxPower: avgPower === null ? null : Math.round(avgPower * 2.1),
    totalWorkKj:
      avgPower === null ? null : Math.round((avgPower * durationSeconds) / 1000)
  }
}

// ---------------------------------------------------------------------------
// Posts

const CUSTOM_TITLES: Record<string, readonly string[]> = {
  run: [
    'Morning loop around the lake',
    'Tempo intervals before work',
    'Easy recovery run',
    'Sunrise run along the canal',
    'Hill repeats at the park'
  ],
  ride: [
    'Sunday group ride',
    'Coffee ride to the coast',
    'Windy polder loop',
    'Commute the long way home'
  ],
  walk: [
    'Evening wind-down walk',
    'Lunch break stroll',
    'Walking the dog through the woods'
  ],
  other: ['Something different today', 'Out for a bit', 'Quick session']
}

const LONG_TITLE =
  'Sunday long ride into the hills with the whole club: rolled out of town ' +
  'before sunrise, regrouped at the windmill, fought a headwind the whole ' +
  'way along the dike, stopped for an unreasonably long coffee at the ' +
  'harbour, then flew home on the tailwind just before the rain arrived'

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(rest).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`
}

const summaryLine = (type: SeedActivityType, metrics: Metrics) => {
  const profile = type ? PROFILES[type] : null
  const lead = profile ? `${profile.emoji} ${profile.label}` : 'Activity'
  return `${lead} — ${(metrics.distanceMeters / 1000).toFixed(2)} km in ${formatDuration(metrics.durationSeconds)} min`
}

type PostChoice = 'auto' | 'none' | { html: string }

const buildPostHtml = (
  key: string,
  type: SeedActivityType,
  metrics: Metrics,
  choice: PostChoice
): string | null => {
  if (choice === 'none') return null
  if (typeof choice === 'object') return choice.html
  // About one activity in five has no post: it was imported without publishing.
  if (unit(key, 'post') >= 0.8) return null

  const summary = summaryLine(type, metrics)
  // Most posts carry the plain summary a real import writes; the rest lead
  // with a title of their own, sometimes behind an emoji.
  if (unit(key, 'custom') >= 0.35) return `<p>${summary}</p>`
  const titles =
    type === 'run' || type === 'trail_run'
      ? CUSTOM_TITLES.run
      : type === 'ride' || type === 'gravel_ride'
        ? CUSTOM_TITLES.ride
        : type === 'walk' || type === 'hike'
          ? CUSTOM_TITLES.walk
          : CUSTOM_TITLES.other
  const title = pick(titles, key, 'title')
  const emoji =
    type && unit(key, 'emoji') < 0.5 ? `${PROFILES[type].emoji} ` : ''
  return `<p>${emoji}${title}</p><p>${summary}</p>`
}

// ---------------------------------------------------------------------------
// The plan

interface ActOptions {
  key?: string
  /** Overrides the start instant (repeated hours, which a wall time can't say). */
  startMs?: number
  short?: boolean
  post?: PostChoice
}

export const buildSeedPlan = ({
  anchor,
  timeZone
}: SeedPlanOptions): SeedActivity[] => {
  const activities: SeedActivity[] = []
  const keys = new Set<string>()
  const reservedDays = new Set<string>()

  const add = (activity: SeedActivity) => {
    if (keys.has(activity.key)) {
      throw new Error(`Duplicate seed key: ${activity.key}`)
    }
    keys.add(activity.key)
    activities.push(activity)
  }

  const act = (
    date: string,
    time: string,
    type: SeedActivityType,
    options: ActOptions = {}
  ): SeedActivity => {
    const dateKey = parseDateKey(date)
    if (!dateKey) throw new Error(`Invalid seed date: ${date}`)
    const key =
      options.key ?? `${date}-${time.replace(':', '')}-${type ?? 'untyped'}`
    const metrics = buildMetrics(key, type, options.short ?? false)
    const device = pick(DEVICES, key, 'device')
    const postHtml = buildPostHtml(key, type, metrics, options.post ?? 'auto')
    const activity: SeedActivity = {
      key,
      date: dateKey,
      time,
      startMs:
        options.startMs ?? instantAtLocalWallTime(dateKey, time, timeZone),
      activityType: type,
      ...metrics,
      fileType: device.fileType,
      device: device.name,
      postHtml,
      postFrom: postHtml === null ? null : key,
      processingStatus: 'completed',
      isPrimary: true,
      deleted: false,
      importError: null
    }
    add(activity)
    reservedDays.add(date)
    return activity
  }

  // A row the dashboard must not count, written next to one it does.
  const excluded = (
    base: Partial<Omit<SeedActivity, 'date'>> &
      Pick<SeedActivity, 'key' | 'time'> & { date: string }
  ): SeedActivity => {
    const date = parseDateKey(base.date)
    if (!date) throw new Error(`Invalid seed date: ${base.date}`)
    const row: SeedActivity = {
      startMs: instantAtLocalWallTime(date, base.time, timeZone),
      activityType: null,
      distanceMeters: null,
      durationSeconds: null,
      elevationGainMeters: null,
      avgHeartRate: null,
      maxHeartRate: null,
      avgPower: null,
      maxPower: null,
      totalWorkKj: null,
      fileType: 'fit',
      device: 'Garmin Forerunner 265',
      postHtml: null,
      postFrom: null,
      processingStatus: 'completed',
      isPrimary: true,
      deleted: false,
      importError: null,
      ...base,
      date
    }
    add(row)
    reservedDays.add(row.date)
    return row
  }

  // --- Anchor day: just after midnight, local.
  act(anchor, '00:05', 'run', {
    key: `${anchor}-0005-anchor-run`,
    post: 'auto'
  })

  // --- Heat levels. 1 and 2 come from ordinary days; 3, 4 and 5 are pinned.
  act('2026-09-02', '06:40', 'run')
  act('2026-09-02', '12:30', 'walk')
  act('2026-09-02', '18:15', 'ride')
  act('2026-09-03', '07:05', 'run')
  act('2026-09-03', '18:40', 'walk')
  for (const [time, type] of [
    ['06:30', 'run'],
    ['09:10', 'walk'],
    ['13:00', 'ride'],
    ['17:45', 'run']
  ] as const) {
    act('2026-09-05', time, type)
  }
  // A 5-activity day (the "4+" level).
  for (const [time, type] of [
    ['06:20', 'run'],
    ['08:50', 'ride'],
    ['12:40', 'walk'],
    ['16:10', 'hike'],
    ['19:30', 'run']
  ] as const) {
    act('2026-09-26', time, type)
  }

  // --- A 22-activity day, to exercise pagination of the day details. Two of
  // the posts are missing.
  const crowdedTypes: SeedActivityType[] = [
    'run',
    'walk',
    'ride',
    'run',
    'hike',
    'walk',
    'run',
    null,
    'ride',
    'walk',
    'run'
  ]
  for (let index = 0; index < 22; index += 1) {
    act(
      '2026-09-12',
      formatClock(5 * 60 + 10 + index * 47),
      crowdedTypes[index % crowdedTypes.length],
      {
        short: true,
        post: index === 7 || index === 15 ? 'none' : 'auto'
      }
    )
  }

  // --- A first line over 200 characters.
  act('2026-08-23', '07:40', 'ride', {
    post: {
      html: `<p>${LONG_TITLE}</p><p>🚴 Cycling — 64.20 km in 2:31:08 min</p>`
    }
  })

  // --- Local day boundaries. 23:45 and 00:10 are 21:45Z and 22:10Z on the
  // SAME UTC day in Amsterdam (summer time), but different local days.
  act('2026-09-20', '23:45', 'run', { key: '2026-09-20-2345-boundary-run' })
  act('2026-09-21', '00:10', 'walk', { key: '2026-09-21-0010-boundary-walk' })
  // 00:30 Amsterdam is 22:30Z on the previous UTC day.
  act('2026-09-15', '00:30', 'run', { key: '2026-09-15-0030-after-midnight' })
  act('2026-09-15', '18:10', 'walk')

  // --- Month and year edges.
  act('2026-08-31', '23:59', 'run', { key: '2026-08-31-2359-month-end' })
  act('2026-09-01', '00:01', 'walk', { key: '2026-09-01-0001-month-start' })
  act('2023-01-01', '00:20', 'run', { key: '2023-01-01-0020-first-day' })
  act('2023-12-31', '23:40', 'walk', { key: '2023-12-31-2340-year-end' })
  act('2024-01-01', '00:10', 'run', { key: '2024-01-01-0010-year-start' })
  act('2024-12-31', '23:50', 'walk', { key: '2024-12-31-2350-year-end' })
  act('2025-01-01', '00:05', 'run', { key: '2025-01-01-0005-year-start' })
  act('2025-12-31', '23:55', 'run', { key: '2025-12-31-2355-year-end' })
  act('2026-01-01', '00:15', 'walk', { key: '2026-01-01-0015-year-start' })
  // Either side of the empty month. The July one is 22:10Z on 30 June, which
  // is the trap for anything that buckets by UTC.
  act('2025-05-31', '23:50', 'run', { key: '2025-05-31-2350-before-empty' })
  act('2025-07-01', '00:10', 'run', { key: '2025-07-01-0010-after-empty' })

  // --- Leap day.
  act('2024-02-29', '07:10', 'run', { key: '2024-02-29-0710-leap-run' })
  act('2024-02-29', '18:20', 'ride', { key: '2024-02-29-1820-leap-ride' })

  // --- Spring forward: 2026-03-29 has 23 local hours, and 02:00-02:59 does
  // not exist, so the wall times skip it.
  act('2026-03-29', '00:30', 'run')
  act('2026-03-29', '01:50', 'walk')
  act('2026-03-29', '03:10', 'ride')
  act('2026-03-29', '23:50', 'walk')

  // --- Fall back: the day has 25 local hours and 02:30 happens twice. The
  // helper returns the first pass; the second is exactly one hour later.
  // 2026-10-25 is the day the brief names, but it lies after the default anchor
  // and nothing may be in the future, so the previous year's change-over
  // (2025-10-26) stands in for it; with a later anchor both are seeded.
  for (const date of ['2025-10-26', '2026-10-25']) {
    act(date, '00:30', 'run')
    const firstPass = act(date, '02:30', 'ride', {
      key: `${date}-0230-first-pass`
    })
    act(date, '02:30', 'walk', {
      key: `${date}-0230-second-pass`,
      startMs: firstPass.startMs + MS_PER_HOUR
    })
    act(date, '08:15', 'run')
    act(date, '23:50', 'walk')
  }

  // --- Mixed types, including one with no type at all.
  act('2026-09-17', '12:20', null, { key: '2026-09-17-1220-untyped-manual' })
  act('2026-09-18', '07:00', 'swim')
  act('2026-09-16', '06:50', 'trail_run')
  act('2026-09-14', '09:30', 'gravel_ride')

  // --- Rows the dashboard must not count.
  // 08 Sep: nothing countable at all, only excluded rows (a rest day).
  excluded({
    key: '2026-09-08-0730-soft-deleted',
    date: '2026-09-08',
    time: '07:30',
    activityType: 'run',
    ...buildMetrics('2026-09-08-0730-soft-deleted', 'run', false),
    deleted: true
  })
  excluded({
    key: '2026-09-08-1000-failed',
    date: '2026-09-08',
    time: '10:00',
    processingStatus: 'failed',
    importError: 'Could not parse the uploaded file: unexpected end of data'
  })
  excluded({
    key: '2026-09-08-1630-pending',
    date: '2026-09-08',
    time: '16:30',
    processingStatus: 'pending'
  })
  // 09 Sep: a non-primary sibling of a merged ride (second device, same post).
  const merged = act('2026-09-09', '07:00', 'run')
  excluded({
    ...merged,
    key: '2026-09-09-0701-non-primary',
    time: '07:01',
    startMs: merged.startMs + MS_PER_MINUTE,
    device: 'Apple Watch Ultra',
    fileType: 'gpx',
    postHtml: null,
    postFrom: merged.postHtml === null ? null : merged.key,
    isPrimary: false
  })
  // 10 Sep and 11 Sep: a countable activity beside a failed / pending one.
  act('2026-09-10', '18:00', 'walk')
  excluded({
    key: '2026-09-10-0800-failed',
    date: '2026-09-10',
    time: '08:00',
    processingStatus: 'failed',
    importError: 'Unsupported file type'
  })
  act('2026-09-11', '06:45', 'run')
  excluded({
    key: '2026-09-11-0900-pending',
    date: '2026-09-11',
    time: '09:00',
    processingStatus: 'pending'
  })
  // A soft-deleted twin of an activity that still counts.
  act('2026-08-15', '08:00', 'ride')
  excluded({
    key: '2026-08-15-0802-soft-deleted',
    date: '2026-08-15',
    time: '08:02',
    activityType: 'ride',
    ...buildMetrics('2026-08-15-0802-soft-deleted', 'ride', false),
    deleted: true
  })

  // --- Filler: a believable training history from 2023 up to the anchor.
  const restWeeks = new Set([
    '2023-08-14',
    '2024-08-05',
    '2026-04-13',
    '2026-07-20'
  ])
  const sparseWeeks = new Set([
    '2023-12-18',
    '2024-11-04',
    '2025-03-10',
    '2026-05-04',
    '2026-08-24'
  ])
  const WEEKDAY_ODDS = [0.35, 0.5, 0.4, 0.5, 0.3, 0.7, 0.75]
  const YEAR_FACTOR: Record<number, number> = {
    2023: 0.55,
    2024: 0.8,
    2025: 0.9
  }
  const SLOTS = [
    [6 * 60, 8 * 60],
    [12 * 60, 13 * 60 + 30],
    [17 * 60 + 30, 19 * 60 + 30]
  ] as const

  for (
    let day = FIRST_FILLER_DAY;
    compareDateKeys(day, anchor) < 0;
    day = addDays(day, 1)
  ) {
    if (reservedDays.has(day) || day.startsWith(EMPTY_MONTH_PREFIX)) continue
    const { year, month } = dateKeyParts(day)
    const weekday = weekdayMon0(day)
    const monday = addDays(day, -weekday)
    if (restWeeks.has(monday)) continue

    const odds = Math.min(
      0.9,
      WEEKDAY_ODDS[weekday] *
        (YEAR_FACTOR[year] ?? 1) *
        (month === 12 || month <= 2 ? 0.75 : 1) *
        (sparseWeeks.has(monday) ? 0.2 : 1)
    )
    if (unit(day, 'active') >= odds) continue

    const extra = unit(day, 'extra')
    const count = extra < 0.03 ? 3 : extra < 0.15 ? 2 : 1
    for (let slot = 0; slot < count; slot += 1) {
      const slotKey = `${day}-s${slot}`
      const weekend = weekday >= 5
      const roll = unit(slotKey, 'type')
      let type: SeedActivityType
      if (roll < 0.04) type = null
      else if (weekend) {
        type =
          roll < 0.4
            ? 'ride'
            : roll < 0.52
              ? 'gravel_ride'
              : roll < 0.7
                ? 'run'
                : roll < 0.8
                  ? 'hike'
                  : roll < 0.86
                    ? 'trail_run'
                    : 'walk'
      } else {
        type =
          roll < 0.55
            ? 'run'
            : roll < 0.7
              ? 'walk'
              : roll < 0.86
                ? 'ride'
                : roll < 0.93
                  ? 'swim'
                  : 'trail_run'
      }
      const [from, to] =
        slot === 0 && weekend && (type === 'ride' || type === 'gravel_ride')
          ? [8 * 60, 10 * 60]
          : SLOTS[slot]
      const minute = from + Math.floor(unit(slotKey, 'minute') * (to - from))
      act(day, formatClock(minute), type)
    }
  }

  // --- Nothing in the future: the anchor day's 00:05 is the last instant.
  const cutoffMs = instantAtLocalWallTime(anchor, '00:05', timeZone)
  return activities
    .filter((activity) => activity.startMs <= cutoffMs)
    .sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : 1))
}

// ---------------------------------------------------------------------------
// Command line

export interface CliOptions {
  anchor: DateKey
  timeZone: string
  username: string
}

const USAGE =
  'Usage: node scripts/run.cjs scripts/mock/createMockFitnessCalendarData.ts ' +
  '[--anchor YYYY-MM-DD --time-zone <IANA zone>] [--username <name>]\n' +
  `Pass --anchor and --time-zone together, or neither (defaults: ${DEFAULT_ANCHOR}, ${DEFAULT_TIME_ZONE}).`

export const parseCliOptions = (argv: readonly string[]): CliOptions => {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const equals = arg.indexOf('=')
    const name = equals === -1 ? arg : arg.slice(0, equals)
    if (
      name !== '--anchor' &&
      name !== '--time-zone' &&
      name !== '--username'
    ) {
      throw new Error(`Unknown argument: ${arg}\n${USAGE}`)
    }
    const value = equals === -1 ? argv[(index += 1)] : arg.slice(equals + 1)
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${name}\n${USAGE}`)
    }
    values.set(name, value)
  }

  const rawAnchor = values.get('--anchor')
  const rawZone = values.get('--time-zone')
  if ((rawAnchor === undefined) !== (rawZone === undefined)) {
    throw new Error(`--anchor and --time-zone go together.\n${USAGE}`)
  }

  const anchor = parseDateKey(rawAnchor ?? DEFAULT_ANCHOR)
  if (!anchor) {
    throw new Error(`--anchor must be a real YYYY-MM-DD date: ${rawAnchor}`)
  }
  const zone = rawZone ?? DEFAULT_TIME_ZONE
  if (!isValidTimeZone(zone)) {
    throw new Error(`--time-zone is not a known IANA zone: ${zone}`)
  }
  return {
    anchor,
    timeZone: canonicalTimeZone(zone),
    username: values.get('--username') ?? 'testuser'
  }
}

// ---------------------------------------------------------------------------
// Database

export const fileIdFor = (actorId: string, key: string) =>
  uuidV5(`${actorId}|${key}`, ID_NAMESPACE)

/** A UUIDv7-shaped public id that is a pure function of the actor and key. */
export const publicIdFor = (actorId: string, key: string, startMs: number) => {
  const hash = crypto
    .createHash('sha256')
    .update(`${actorId}|${key}|post`)
    .digest('hex')
  const time = Math.max(0, Math.floor(startMs)).toString(16).padStart(12, '0')
  const variant = '89ab'[parseInt(hash[3], 16) % 4]
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${hash.slice(0, 3)}-${variant}${hash.slice(4, 7)}-${hash.slice(7, 19)}`
}

const elevationSeries = (key: string) =>
  JSON.stringify(
    Array.from({ length: 60 }, (_, i) =>
      Math.round(
        20 +
          between(key, 'base', 10, 40) +
          between(key, 'amp', 8, 30) * Math.sin(i / between(key, 'freq', 4, 7))
      )
    )
  )

const removeSeededRows = async (
  database: NonNullable<ReturnType<typeof getDatabase>>,
  knex: Knex,
  actorId: string
) => {
  const files = (await knex('fitness_files')
    .where('actorId', actorId)
    .where('path', 'like', `${MOCK_PATH_PREFIX}%`)
    .select('statusId')) as Array<{ statusId: string | null }>
  const marked = (await knex('statuses')
    .where({ actorId, applicationName: MOCK_APPLICATION_NAME })
    .select('id')) as Array<{ id: string }>

  const statusIds = new Set<string>(marked.map((row) => row.id))
  for (const file of files) if (file.statusId) statusIds.add(file.statusId)

  await knex('fitness_files')
    .where('actorId', actorId)
    .where('path', 'like', `${MOCK_PATH_PREFIX}%`)
    .delete()
  for (const statusId of statusIds) await database.deleteStatus({ statusId })
  return { files: files.length, statuses: statusIds.size }
}

const canonicalValue = (value: unknown): unknown => {
  if (value instanceof Date) return value.getTime()
  if (Buffer.isBuffer(value)) return value.toString('hex')
  return value
}

/** Checksum of every row this script owns, as stored. */
const checksumSeededRows = async (knex: Knex, actorId: string) => {
  const files = await knex('fitness_files')
    .where('actorId', actorId)
    .where('path', 'like', `${MOCK_PATH_PREFIX}%`)
    .orderBy('path')
  const statuses = await knex('statuses')
    .where({ actorId, applicationName: MOCK_APPLICATION_NAME })
    .orderBy('id')
  const statusIds = statuses.map((row) => row.id as string)
  // Recipient rows get random ids and write-time timestamps, so only what they
  // say is part of the checksum.
  const recipients: Array<Record<string, unknown>> = []
  for (let offset = 0; offset < statusIds.length; offset += 200) {
    recipients.push(
      ...(await knex('recipients')
        .whereIn('statusId', statusIds.slice(offset, offset + 200))
        .select('statusId', 'actorId', 'type'))
    )
  }
  recipients.sort((a, b) =>
    `${a.statusId}|${a.type}|${a.actorId}`.localeCompare(
      `${b.statusId}|${b.type}|${b.actorId}`
    )
  )

  const digest = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({ files, statuses, recipients }, (_key, value) =>
        canonicalValue(value)
      )
    )
    .digest('hex')
  return {
    digest,
    files: files.length,
    statuses: statuses.length,
    recipients: recipients.length
  }
}

async function createMockFitnessCalendarData() {
  const options = parseCliOptions(process.argv.slice(2))

  // Say which database this is before touching it, and stop for anything that
  // is not local. The mock scripts do not load .env.local on their own, so a
  // missing export would otherwise fall through to whatever the shell has.
  const connection = describeConnection()
  console.log(`Database: ${connection.client} — ${connection.target}`)
  if (!connection.isLocal) {
    console.error(
      'Refusing to seed: this is not a local database target. ' +
        'The calendar seed only runs against local SQLite or a local PostgreSQL.'
    )
    process.exit(1)
  }

  const database = getDatabase()
  if (!database) {
    console.error('Database not available')
    process.exit(1)
  }
  const knex = getKnex()

  const config = getConfig()
  const domain = config.host
  console.log(`Looking for user ${options.username} on ${domain}...`)
  const actor = await database.getActorFromUsername({
    username: options.username,
    domain
  })
  if (!actor) {
    console.error('Test user not found. Run createMockUser.ts first.')
    process.exit(1)
  }

  const plan = buildSeedPlan({
    anchor: options.anchor,
    timeZone: options.timeZone
  })
  console.log(
    `Anchor ${options.anchor} (${options.timeZone}): ${plan.length} rows planned.`
  )

  const removed = await removeSeededRows(database, knex, actor.id)
  console.log(
    `Removed ${removed.files} earlier rows and ${removed.statuses} posts under ${MOCK_PATH_PREFIX}.`
  )

  const statusIds = new Map<string, string>()
  for (const activity of plan) {
    if (activity.postHtml === null) continue
    const publicId = publicIdFor(actor.id, activity.key, activity.startMs)
    const id = getLocalStatusId({ actorId: actor.id, statusId: publicId })
    await database.createNote({
      id,
      publicId,
      actorId: actor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [actor.followersUrl],
      url: `https://${actor.domain}/${getMention(actor)}/${publicId}`,
      text: activity.postHtml,
      createdAt: activity.startMs,
      applicationName: MOCK_APPLICATION_NAME
    })
    // createNote stamps updatedAt with the wall clock; pin it so reruns match.
    await knex('statuses')
      .where({ id })
      .update({ updatedAt: new Date(activity.startMs) })
    statusIds.set(activity.key, id)
  }

  for (const activity of plan) {
    const startedAt = new Date(activity.startMs)
    const fileName = `${activity.key}.${activity.fileType}`
    const completed = activity.processingStatus === 'completed'
    await knex('fitness_files').insert({
      id: fileIdFor(actor.id, activity.key),
      actorId: actor.id,
      statusId: activity.postFrom
        ? (statusIds.get(activity.postFrom) ?? null)
        : null,
      path: `${MOCK_PATH_PREFIX}${fileName}`,
      fileName,
      fileType: activity.fileType,
      mimeType: 'application/octet-stream',
      bytes: 120000 + Math.round(unit(activity.key, 'bytes') * 120000),
      description: activity.device,
      hasMapData: completed && activity.fileType === 'gpx',
      mapImagePath: null,
      isPrimary: activity.isPrimary,
      importBatchId: null,
      importStatus: activity.processingStatus === 'failed' ? 'failed' : null,
      importError: activity.importError,
      processingStatus: activity.processingStatus,
      totalDistanceMeters: activity.distanceMeters,
      totalDurationSeconds: activity.durationSeconds,
      movingTimeSeconds:
        activity.durationSeconds === null
          ? null
          : Math.round(activity.durationSeconds * 0.97),
      elevationGainMeters: activity.elevationGainMeters,
      avgPower: activity.avgPower,
      maxPower: activity.maxPower,
      avgHeartRate: activity.avgHeartRate,
      maxHeartRate: activity.maxHeartRate,
      totalWorkKj: activity.totalWorkKj,
      elevationSeries:
        completed && activity.distanceMeters !== null
          ? elevationSeries(activity.key)
          : null,
      activityType: activity.activityType,
      activityStartTime: startedAt,
      createdAt: startedAt,
      updatedAt: startedAt,
      deletedAt: activity.deleted
        ? new Date(activity.startMs + 24 * MS_PER_HOUR)
        : null
    })
  }

  const countable = plan.filter(
    (activity) =>
      activity.processingStatus === 'completed' &&
      activity.isPrimary &&
      !activity.deleted
  )
  const days = new Set(countable.map((activity) => activity.date))
  const byYear = new Map<string, number>()
  for (const activity of countable) {
    const year = activity.date.slice(0, 4)
    byYear.set(year, (byYear.get(year) ?? 0) + 1)
  }
  const checksum = await checksumSeededRows(knex, actor.id)

  console.log(`✅ Seeded ${plan.length} fitness rows for ${options.username}.`)
  console.log(
    `   ${countable.length} countable on ${days.size} local days ` +
      `(${[...byYear].map(([year, count]) => `${year}: ${count}`).join(', ')}).`
  )
  console.log(
    `   ${plan.length - countable.length} excluded (non-primary, failed, pending, soft-deleted).`
  )
  console.log(
    `Rows: fitness_files=${checksum.files} statuses=${checksum.statuses} recipients=${checksum.recipients}`
  )
  console.log(`Checksum: ${checksum.digest}`)
  process.exit(0)
}

if (require.main === module) {
  createMockFitnessCalendarData().catch((error) => {
    console.error('Error creating mock fitness calendar data:', error)
    process.exit(1)
  })
}

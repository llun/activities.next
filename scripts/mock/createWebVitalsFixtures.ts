#!/usr/bin/env -S node scripts/run.cjs
/**
 * Seeds a deterministic fixture set for repeatable Web Vitals measurements
 * (Lighthouse / trace runs) of the public pages. Run it ONCE against a freshly
 * migrated, EMPTY local SQLite database; it refuses everything else.
 *
 * What it creates (all local, nothing federated; `globalThis.fetch` is also
 * kept off the external network while offline map tiles are on, the default):
 *   - main actor `vitals` (email test@example.com, password testpassword123)
 *     and 30 extra local actors with local avatars, following each other
 *     (`Accepted` follows in both directions) so /followers and /following
 *     are populated
 *   - public photo posts rendered with sharp (known sizes, non-trivial
 *     blurhash): single landscape / portrait / square / panorama, and 2-, 4-
 *     and 7-image posts; text-only posts; #vitalsphoto posts with a consistent
 *     hashtag counter
 *   - a public gallery album with 17 items, and public posts (one with a photo)
 *     by 4 of the extra local actors
 *   - fitness posts imported through the real pipeline (saveFitnessFile +
 *     importFitnessFilesJob, public visibility): a dense TCX ride (3,700
 *     trackpoints, GPS/HR/cadence/power, 6 laps), a sparse ride (8 points), an
 *     indoor ride (no GPS), and a garbage `.fit` that fails to import; then the
 *     all-activities / all-time route heatmap (with its tile pyramid) and a
 *     fixed share token so /u/heatmaps/<token> and /embed/heatmap/<token> work
 *
 * Landing variants (`--landing`): the landing page previews the public feed
 * only once the server holds LANDING_FEED_MIN_POSTS local public posts
 * (app/(timeline)/(home)/page.tsx), and that count is cached per process. So
 * seed two separate database files + storage directories:
 *   --landing hero   fewer than 100 local public posts  -> brand hero
 *   --landing feed   at least 120 local public posts, images among the newest
 *                    15 (the main actor's list, then the extra actors'
 *                    photo posts)                        -> public feed
 *
 * OFFLINE MAP TILES (`--offline-map-tiles`, default ON; `--no-offline-map-tiles`
 * to disable): the server-side static route map is rendered from
 * https://tile.openstreetmap.org tiles. Inside THIS script's process only, a
 * wrapper around `globalThis.fetch` answers those tile URLs with a
 * deterministic 256x256 PNG generated with sharp, so the real map attachment is
 * produced offline and reproducibly. Any other non-loopback request made
 * through `globalThis.fetch` is rejected, but ONLY while the flag is on (only the
 * origin and path are logged and recorded; query strings can carry tokens).
 * With the flag off no wrapper is installed: `globalThis.fetch` is untouched, so
 * real OpenStreetMap tile requests go out over the network. Other
 * HTTP clients are NOT intercepted; the target guard instead refuses every
 * configuration that would send this script's traffic elsewhere (non-OSM map
 * provider, non-local storage, non-inline queue, non-loopback host). The
 * running app server is NOT affected: it never fetches tiles at request time
 * (the map image is stored).
 * The browser-side basemap (tiles.openfreemap.org) is out of scope here; the
 * measurement harness blocks or stubs it separately.
 *
 * Determinism: every timestamp derives from FIXED_BASE_MS, post/actor names,
 * public ids, tokens and image/TCX bytes come from fixed values and a seeded
 * PRNG (identical bytes on identical sharp/libvips builds). Random by design
 * (database / storage layer): account, album, heatmap and fitness
 * file UUIDs, the public ids of the three fitness posts, stored media file
 * names, and actor/account `createdAt`. They are listed in the manifest `ids`
 * and excluded from `identityHash`.
 *
 * See docs/maintenance.md ("Create Web Vitals Fixtures") for the full guide.
 *
 * Usage (local SQLite only; ACTIVITIES_DATABASE must be empty):
 *   export ACTIVITIES_DATABASE= ACTIVITIES_DATABASE_CLIENT=better-sqlite3 \
 *     ACTIVITIES_DATABASE_SQLITE_FILENAME=/abs/path/vitals.sqlite3 \
 *     ACTIVITIES_HOST=localhost:3210 ACTIVITIES_INSECURE_AUTH=true \
 *     ACTIVITIES_SECRET_PHASE=<32+ chars> ACTIVITIES_MEDIA_STORAGE_TYPE=fs \
 *     ACTIVITIES_MEDIA_STORAGE_PATH=/abs/path/storage
 *   yarn migrate
 *   node scripts/run.cjs scripts/mock/createWebVitalsFixtures.ts \
 *     --landing hero|feed --manifest /abs/path/manifest.json
 */
import * as bcrypt from 'bcrypt'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { v7 as uuidv7 } from 'uuid'

import { getConfig } from '@/lib/config'
import { getMapProviderConfig } from '@/lib/config/mapProvider'
import { getDatabase } from '@/lib/database'
import type { Database } from '@/lib/database/types'
import { generateFitnessRouteHeatmapJob } from '@/lib/jobs/generateFitnessRouteHeatmapJob'
import { importFitnessFilesJob } from '@/lib/jobs/importFitnessFilesJob'
import {
  GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
  IMPORT_FITNESS_FILES_JOB_NAME
} from '@/lib/jobs/names'
import {
  getEffectiveFitnessStorageConfig,
  saveFitnessFile
} from '@/lib/services/fitness-files'
import { saveMedia } from '@/lib/services/medias'
import { getSavedMediaAttachmentMetadata } from '@/lib/services/medias/attachmentMediaMetadata'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Actor, getMention } from '@/lib/types/domain/actor'
import { getLocalStatusId } from '@/lib/utils/activitypubId'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getClientStatusId } from '@/lib/utils/publicId'
import { generateKeyPair } from '@/lib/utils/signature'
import { getHashtags } from '@/lib/utils/text/getHashtags'

// 2026-09-01T12:00:00Z. The newest fixture post is stamped with this instant.
export const FIXED_BASE_MS = Date.UTC(2026, 8, 1, 12, 0, 0)
export const MAIN_USERNAME = 'vitals'
export const MAIN_EMAIL = 'test@example.com'
export const MAIN_PASSWORD = 'testpassword123'
export const EXTRA_ACTOR_COUNT = 30
export const HEATMAP_SHARE_TOKEN = 'vitals-fixture-heatmap'
export const HASHTAG = 'vitalsphoto'
// Mirrors LANDING_FEED_MIN_POSTS in app/(timeline)/(home)/page.tsx (not
// imported so the script does not pull page code).
export const LANDING_FEED_MIN_POSTS = 100
export const HERO_MAX_POSTS = LANDING_FEED_MIN_POSTS - 1
export const FEED_MIN_POSTS = 120
const POST_STEP_MS = 17 * 60 * 1000
const FILLER_STEP_MS = 20 * 60 * 1000
const FIXTURE_BATCH_ID = 'web-vitals-fixture'

// --- pure helpers (exported for the co-located test) -----------------------

/** mulberry32: small, fast, deterministic PRNG returning floats in [0, 1). */
export const createRng = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const sha256 = (data: Buffer | string) =>
  crypto.createHash('sha256').update(data).digest('hex')

/** A UUIDv7 whose timestamp is `msecs` and whose other bits are seeded. */
export const deterministicPublicId = (msecs: number, seed: number) => {
  const rng = createRng(seed)
  const random = new Uint8Array(16)
  for (let i = 0; i < random.length; i += 1) random[i] = Math.floor(rng() * 256)
  return uuidv7({ msecs, seq: seed & 0x7fffffff, random })
}

const hsl = (h: number, s: number, l: number) =>
  `hsl(${Math.round(h) % 360} ${Math.round(s)}% ${Math.round(l)}%)`

export interface FixtureImageSpec {
  seed: number
  width: number
  height: number
  quality?: number
}

/**
 * A gradient + translucent shapes + light grain JPEG. Varied hues and shapes
 * keep the blurhash non-trivial; the grain keeps the file size realistic.
 */
export const renderFixtureImage = async ({
  seed,
  width,
  height,
  quality = 82
}: FixtureImageSpec): Promise<Buffer> => {
  const rng = createRng(seed)
  const hue = rng() * 360
  const stops = [
    hsl(hue, 70, 58),
    hsl(hue + 40 + rng() * 60, 65, 42),
    hsl(hue + 160 + rng() * 80, 60, 30)
  ]
  const shapes: string[] = []
  const shapeCount = 12 + Math.floor(rng() * 8)
  for (let i = 0; i < shapeCount; i += 1) {
    const fill = hsl(hue + rng() * 300, 55 + rng() * 30, 35 + rng() * 40)
    const opacity = (0.18 + rng() * 0.4).toFixed(2)
    const x = (rng() * width).toFixed(1)
    const y = (rng() * height).toFixed(1)
    const size = (Math.min(width, height) * (0.08 + rng() * 0.3)).toFixed(1)
    const kind = Math.floor(rng() * 3)
    if (kind === 0) {
      shapes.push(
        `<circle cx="${x}" cy="${y}" r="${size}" fill="${fill}" opacity="${opacity}"/>`
      )
    } else if (kind === 1) {
      shapes.push(
        `<rect x="${x}" y="${y}" width="${size}" height="${(Number(size) * (0.4 + rng())).toFixed(1)}" fill="${fill}" opacity="${opacity}" transform="rotate(${Math.round(rng() * 90)} ${x} ${y})"/>`
      )
    } else {
      const dx = Number(size)
      shapes.push(
        `<polygon points="${x},${y} ${(Number(x) + dx).toFixed(1)},${(Number(y) + dx * 0.4).toFixed(1)} ${(Number(x) + dx * 0.3).toFixed(1)},${(Number(y) + dx).toFixed(1)}" fill="${fill}" opacity="${opacity}"/>`
      )
    }
  }
  const angle = Math.round(rng() * 360)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)">` +
    `<stop offset="0" stop-color="${stops[0]}"/><stop offset=".55" stop-color="${stops[1]}"/><stop offset="1" stop-color="${stops[2]}"/>` +
    `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${shapes.join('')}</svg>`

  // Low-amplitude 4x4-block grain: enough texture that the stored near-lossless
  // WebP lands in the few-hundred-KB range of a real 1600px photo, where
  // per-pixel noise would make it several times heavier.
  const block = 4
  const gw = Math.ceil(width / block)
  const gh = Math.ceil(height / block)
  const cells = new Uint8Array(gw * gh)
  for (let i = 0; i < cells.length; i += 1) cells[i] = Math.floor(rng() * 256)
  const grain = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const value = cells[Math.floor(y / block) * gw + Math.floor(x / block)]
      grain[offset] = value
      grain[offset + 1] = value
      grain[offset + 2] = value
      grain[offset + 3] = 14
    }
  }
  return sharp(Buffer.from(svg))
    .composite([
      {
        input: grain,
        raw: { width, height, channels: 4 },
        blend: 'over'
      }
    ])
    .jpeg({ quality })
    .toBuffer()
}

/** Deterministic 256x256 OSM-style tile, varied per z/x/y so the map looks real. */
export const renderOfflineTile = async (tileKey: string): Promise<Buffer> => {
  const digest = crypto.createHash('sha256').update(tileKey).digest()
  const hue = 80 + (digest[0] % 60)
  const lightness = 88 + (digest[1] % 6)
  const roadY = 40 + (digest[2] % 170)
  const roadX = 40 + (digest[3] % 170)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">` +
    `<rect width="256" height="256" fill="${hsl(hue, 35, lightness)}"/>` +
    `<rect x="${digest[4] % 120}" y="${digest[5] % 120}" width="${60 + (digest[6] % 90)}" height="${60 + (digest[7] % 90)}" fill="${hsl(200, 40, 82)}" opacity="0.7"/>` +
    `<path d="M0 ${roadY} L256 ${roadY + 12}" stroke="#ffffff" stroke-width="7"/>` +
    `<path d="M${roadX} 0 L${roadX + 10} 256" stroke="#fde68a" stroke-width="5"/>` +
    `<path d="M0 0H256V256H0Z" fill="none" stroke="#d4d4d8" stroke-width="1"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

interface TcxSample {
  elapsedSeconds: number
  lat?: number
  lng?: number
  altitude?: number
  distance?: number
  heartRate?: number
  cadence?: number
  watts?: number
  speed?: number
}

const EARTH_RADIUS_M = 6371000
const haversine = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

const round = (value: number, digits: number) =>
  Number(value.toFixed(digits)).toString()

const buildTcx = ({
  startMs,
  sport,
  samples,
  lapStartIndexes
}: {
  startMs: number
  sport: string
  samples: TcxSample[]
  lapStartIndexes: number[]
}): string => {
  const iso = (elapsedSeconds: number) =>
    new Date(startMs + elapsedSeconds * 1000).toISOString()
  const laps = lapStartIndexes.map((startIndex, lapIndex) => {
    const endIndex =
      lapIndex + 1 < lapStartIndexes.length
        ? lapStartIndexes[lapIndex + 1]
        : samples.length
    const lapSamples = samples.slice(startIndex, endIndex)
    const first = lapSamples[0]
    const last = lapSamples[lapSamples.length - 1]
    const duration = Math.max(1, last.elapsedSeconds - first.elapsedSeconds + 1)
    const distance = Math.max(0, (last.distance ?? 0) - (first.distance ?? 0))
    const heartRates = lapSamples
      .map((sample) => sample.heartRate)
      .filter((value): value is number => typeof value === 'number')
    const avgHr = heartRates.length
      ? Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length)
      : undefined
    const maxHr = heartRates.length ? Math.max(...heartRates) : undefined
    const watts = lapSamples
      .map((sample) => sample.watts)
      .filter((value): value is number => typeof value === 'number')
    const avgWatts = watts.length
      ? Math.round(watts.reduce((a, b) => a + b, 0) / watts.length)
      : undefined
    const points = lapSamples
      .map((sample) => {
        const position =
          typeof sample.lat === 'number' && typeof sample.lng === 'number'
            ? `<Position><LatitudeDegrees>${round(sample.lat, 6)}</LatitudeDegrees><LongitudeDegrees>${round(sample.lng, 6)}</LongitudeDegrees></Position>`
            : ''
        const altitude =
          typeof sample.altitude === 'number'
            ? `<AltitudeMeters>${round(sample.altitude, 1)}</AltitudeMeters>`
            : ''
        const distanceTag =
          typeof sample.distance === 'number'
            ? `<DistanceMeters>${round(sample.distance, 1)}</DistanceMeters>`
            : ''
        const hr =
          typeof sample.heartRate === 'number'
            ? `<HeartRateBpm><Value>${sample.heartRate}</Value></HeartRateBpm>`
            : ''
        const cadence =
          typeof sample.cadence === 'number'
            ? `<Cadence>${sample.cadence}</Cadence>`
            : ''
        const tpx =
          typeof sample.watts === 'number' || typeof sample.speed === 'number'
            ? `<Extensions><ns3:TPX>${
                typeof sample.speed === 'number'
                  ? `<ns3:Speed>${round(sample.speed, 2)}</ns3:Speed>`
                  : ''
              }${
                typeof sample.watts === 'number'
                  ? `<ns3:Watts>${sample.watts}</ns3:Watts>`
                  : ''
              }</ns3:TPX></Extensions>`
            : ''
        return `<Trackpoint><Time>${iso(sample.elapsedSeconds)}</Time>${position}${altitude}${distanceTag}${hr}${cadence}${tpx}</Trackpoint>`
      })
      .join('')
    const lx =
      typeof avgWatts === 'number'
        ? `<Extensions><ns3:LX><ns3:AvgWatts>${avgWatts}</ns3:AvgWatts></ns3:LX></Extensions>`
        : ''
    return (
      `<Lap StartTime="${iso(first.elapsedSeconds)}">` +
      `<TotalTimeSeconds>${duration}</TotalTimeSeconds>` +
      `<DistanceMeters>${round(distance, 1)}</DistanceMeters>` +
      `<Calories>${Math.round(duration * 0.28)}</Calories>` +
      (typeof avgHr === 'number'
        ? `<AverageHeartRateBpm><Value>${avgHr}</Value></AverageHeartRateBpm>`
        : '') +
      (typeof maxHr === 'number'
        ? `<MaximumHeartRateBpm><Value>${maxHr}</Value></MaximumHeartRateBpm>`
        : '') +
      `<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>` +
      `<Track>${points}</Track>${lx}</Lap>`
    )
  })

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">` +
    `<Activities><Activity Sport="${sport}"><Id>${iso(0)}</Id>${laps.join('')}</Activity></Activities>` +
    `</TrainingCenterDatabase>\n`
  )
}

const ROUTE_CENTER = { lat: 52.3702, lng: 4.8952 }

const projectOffset = (eastMeters: number, northMeters: number) => ({
  lat: ROUTE_CENTER.lat + northMeters / 111320,
  lng:
    ROUTE_CENTER.lng +
    eastMeters / (111320 * Math.cos((ROUTE_CENTER.lat * Math.PI) / 180))
})

export const DENSE_RIDE_POINTS = 3700
export const DENSE_RIDE_LAPS = 6
export const SPARSE_RIDE_POINTS = 8
export const INDOOR_RIDE_POINTS = 3000

/** A ~28 km wobbly loop ridden at 1 Hz with GPS, HR, cadence and power. */
export const buildDenseRideTcx = (startMs: number) => {
  const rng = createRng(0xd3a5e01)
  const samples: TcxSample[] = []
  let distance = 0
  let previous: { lat: number; lng: number } | null = null
  for (let t = 0; t < DENSE_RIDE_POINTS; t += 1) {
    const progress =
      t / DENSE_RIDE_POINTS +
      0.012 * Math.sin((8 * Math.PI * t) / DENSE_RIDE_POINTS)
    const theta = 2 * Math.PI * progress
    const radius =
      4300 * (1 + 0.22 * Math.sin(3 * theta) + 0.1 * Math.sin(5 * theta + 1))
    const point = projectOffset(
      radius * Math.cos(theta) * 1.25,
      radius * Math.sin(theta)
    )
    if (previous) distance += haversine(previous, point)
    previous = point
    const effort = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 420 + 1.3)
    samples.push({
      elapsedSeconds: t,
      ...point,
      altitude: 6 + 22 * (0.5 + 0.5 * Math.sin(theta * 2 + 0.4)) + rng() * 0.6,
      distance,
      heartRate: Math.round(118 + 52 * effort + rng() * 4),
      cadence: Math.round(78 + 16 * effort + rng() * 3),
      watts: Math.round(150 + 140 * effort + rng() * 20),
      speed: 6.2 + 2.6 * effort + rng() * 0.3
    })
  }
  const lapSize = Math.ceil(DENSE_RIDE_POINTS / DENSE_RIDE_LAPS)
  return buildTcx({
    startMs,
    sport: 'Biking',
    samples,
    lapStartIndexes: Array.from(
      { length: DENSE_RIDE_LAPS },
      (_, index) => index * lapSize
    )
  })
}

/** Eight GPS points five minutes apart on one lap, no sensors. */
export const buildSparseRideTcx = (startMs: number) => {
  const samples: TcxSample[] = []
  let distance = 0
  let previous: { lat: number; lng: number } | null = null
  for (let i = 0; i < SPARSE_RIDE_POINTS; i += 1) {
    const point = projectOffset(
      -3200 + i * 900,
      -1500 + i * 520 + 380 * Math.sin(i * 0.9)
    )
    if (previous) distance += haversine(previous, point)
    previous = point
    samples.push({
      elapsedSeconds: i * 300,
      ...point,
      altitude: 4 + i,
      distance
    })
  }
  return buildTcx({
    startMs,
    sport: 'Biking',
    samples,
    lapStartIndexes: [0]
  })
}

/** A trainer ride: HR, cadence and power but no GPS, in 4 laps. */
export const buildIndoorRideTcx = (startMs: number) => {
  const rng = createRng(0x1d00a)
  const samples: TcxSample[] = []
  let distance = 0
  for (let t = 0; t < INDOOR_RIDE_POINTS; t += 1) {
    const block = Math.floor(t / 600)
    const effort = 0.35 + 0.18 * block + 0.1 * Math.sin(t / 45)
    const speed = 7 + 3 * effort
    distance += speed
    samples.push({
      elapsedSeconds: t,
      distance,
      heartRate: Math.round(110 + 60 * effort + rng() * 3),
      cadence: Math.round(82 + 14 * effort + rng() * 3),
      watts: Math.round(120 + 200 * effort + rng() * 15),
      speed
    })
  }
  return buildTcx({
    startMs,
    sport: 'Biking',
    samples,
    lapStartIndexes: [0, 750, 1500, 2250]
  })
}

export const buildGarbageFitBytes = () =>
  Buffer.from(
    Array.from({ length: 512 }, (_, index) => (index * 37 + 11) & 0xff)
  )

// --- fixture plan -----------------------------------------------------------

export type PostShape =
  'landscape' | 'portrait' | 'square' | 'panorama' | 'text'

const IMAGE_SIZES: Record<
  Exclude<PostShape, 'text'>,
  { width: number; height: number }
> = {
  landscape: { width: 1600, height: 1067 },
  portrait: { width: 1067, height: 1600 },
  square: { width: 1200, height: 1200 },
  panorama: { width: 2400, height: 800 }
}

export interface PlannedPost {
  key: string
  text: string
  /** One entry per attached image. */
  images: Exclude<PostShape, 'text'>[]
  tagged: boolean
}

/**
 * The newest-first post plan for the main actor. The first seven entries are
 * the photo posts the pages are measured on; the landing feed's newest 15 are
 * this whole list, followed by the extra actors' posts.
 */
export const buildMainPostPlan = (): PlannedPost[] => {
  const photo = (
    key: string,
    text: string,
    images: PlannedPost['images'],
    tagged = false
  ): PlannedPost => ({
    key,
    text: tagged ? `${text} #${HASHTAG}` : text,
    images,
    tagged
  })
  const plan: PlannedPost[] = [
    photo(
      'single-landscape',
      'Golden hour over the canal, shot on the long lens.',
      ['landscape'],
      true
    ),
    photo('single-portrait', 'The old tower from the courtyard.', ['portrait']),
    photo(
      'two-images',
      'Two frames from the morning walk.',
      ['landscape', 'portrait'],
      true
    ),
    photo(
      'four-images',
      'Market day in four frames.',
      ['landscape', 'square', 'portrait', 'panorama'],
      true
    ),
    photo(
      'seven-images',
      'Photo dump from the weekend trip, seven favourites.',
      [
        'landscape',
        'portrait',
        'square',
        'landscape',
        'panorama',
        'portrait',
        'square'
      ],
      true
    ),
    photo('single-square', 'Square crop of the harbour lights.', ['square']),
    photo(
      'single-panorama',
      'Ridge line panorama before the storm.',
      ['panorama'],
      true
    )
  ]
  const textOnly = [
    'Coffee first, then the long ride.',
    'Reading week: three books down, two to go.',
    'Notes on keeping a training log that survives a bad month.',
    'Gear check before the weekend: tyres, bottles, lights.',
    'The best part of a rainy day is the dry kit afterwards.',
    'Finally fixed the squeak in the bottom bracket.',
    'Planning a loop through the polders next Saturday.',
    'Quiet evening, tea, and the map spread out on the table.'
  ]
  textOnly.forEach((text, index) => {
    plan.push({
      key: `text-${index + 1}`,
      text:
        index % 3 === 0
          ? `${text} Sharing a few frames soon #${HASHTAG}`
          : text,
      images: [],
      tagged: index % 3 === 0
    })
  })
  return plan
}

export const MEMBER_POSTS = [
  'Sunrise ride along the river, nobody else out yet.',
  'Trying a new route home through the park.',
  'Weekend plans: long loop, short coffee stop.'
]

const FILLER_PHRASES = [
  'Another quiet morning on the towpath.',
  'Legs felt good today, kept it steady.',
  'Found a new bakery on the route.',
  'Headwind all the way back, worth it.',
  'Evening spin before the rain arrived.',
  'Cleaned the drivetrain, smooth again.',
  'Short loop, long chat with a neighbour.',
  'Bridges, canals and a lot of sky.',
  'Spring clothes in autumn, the weather was kind.',
  'Counting the days to the next long ride.'
]

export const buildFillerPlan = (count: number): PlannedPost[] => {
  const rng = createRng(0xf111e4)
  return Array.from({ length: count }, (_, index) => {
    const phrase = FILLER_PHRASES[Math.floor(rng() * FILLER_PHRASES.length)]
    return {
      key: `filler-${index + 1}`,
      text: `${phrase} (${index + 1})`,
      images: index % 2 === 0 ? ['landscape'] : [],
      tagged: false
    }
  })
}

// --- script -----------------------------------------------------------------

interface CliOptions {
  landing: 'hero' | 'feed'
  manifest: string
  offlineMapTiles: boolean
}

export const parseCliOptions = (args: string[]): CliOptions => {
  let landing: string | undefined
  let manifest: string | undefined
  let offlineMapTiles = true
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const equalsIndex = arg.indexOf('=')
    const key = equalsIndex < 0 ? arg : arg.slice(0, equalsIndex)
    const inline = equalsIndex < 0 ? undefined : arg.slice(equalsIndex + 1)
    if (key === '--offline-map-tiles') {
      if (inline !== undefined && inline !== 'true' && inline !== 'false') {
        throw new Error(
          `Invalid value for --offline-map-tiles: ${inline} (use true or false)`
        )
      }
      offlineMapTiles = inline !== 'false'
    } else if (key === '--no-offline-map-tiles') {
      offlineMapTiles = false
    } else if (key === '--landing' || key === '--manifest') {
      const value = inline ?? args[(index += 1)]
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${key}`)
      }
      if (key === '--landing') landing = value
      else manifest = value
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (landing !== 'hero' && landing !== 'feed') {
    throw new Error('--landing hero|feed is required')
  }
  if (!manifest || !path.isAbsolute(manifest)) {
    throw new Error('--manifest <absolute file path> is required')
  }
  return { landing, manifest, offlineMapTiles }
}

export interface FixtureTargetInput {
  databaseClient?: string
  sqliteFilename?: string
  host: string
  mediaStorage?: { type?: string; path?: string } | null
  fitnessStorage?: { type?: string; path?: string } | null
  queueRunsInline: boolean
  mapProviderType: string
  fileExists?: (file: string) => boolean
}

/**
 * Pure safety check for the seeding target: returns the resolved paths or
 * throws a "Refusing to run" error.
 */
export const checkFixtureTarget = ({
  databaseClient,
  sqliteFilename,
  host,
  mediaStorage,
  fitnessStorage,
  queueRunsInline,
  mapProviderType,
  fileExists = fs.existsSync
}: FixtureTargetInput): {
  filename: string
  storage: string
  fitnessPath: string
} => {
  if (databaseClient !== 'better-sqlite3') {
    throw new Error(
      `Refusing to run: database client is "${databaseClient}", expected better-sqlite3 (local SQLite file only)`
    )
  }
  if (
    !sqliteFilename ||
    sqliteFilename === ':memory:' ||
    !path.isAbsolute(sqliteFilename) ||
    !fileExists(sqliteFilename)
  ) {
    throw new Error(
      'Refusing to run: ACTIVITIES_DATABASE_SQLITE_FILENAME must be an absolute path to an existing, migrated SQLite file'
    )
  }
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    throw new Error(
      `Refusing to run: ACTIVITIES_HOST "${host}" is not a loopback host`
    )
  }
  if (!mediaStorage || mediaStorage.type !== 'fs' || !mediaStorage.path) {
    throw new Error(
      'Refusing to run: ACTIVITIES_MEDIA_STORAGE_TYPE=fs and an absolute ACTIVITIES_MEDIA_STORAGE_PATH are required'
    )
  }
  if (!path.isAbsolute(mediaStorage.path)) {
    throw new Error(
      'Refusing to run: ACTIVITIES_MEDIA_STORAGE_PATH must be absolute'
    )
  }
  if (
    !fitnessStorage ||
    fitnessStorage.type !== 'fs' ||
    !fitnessStorage.path ||
    !path.isAbsolute(fitnessStorage.path)
  ) {
    throw new Error(
      `Refusing to run: fitness storage must be local fs with an absolute path (got ${fitnessStorage?.type ?? 'none'}); unset ACTIVITIES_FITNESS_STORAGE_TYPE or set it to fs`
    )
  }
  const relativeFitness = path.relative(
    path.resolve(mediaStorage.path),
    path.resolve(fitnessStorage.path)
  )
  if (relativeFitness.startsWith('..') || path.isAbsolute(relativeFitness)) {
    throw new Error(
      'Refusing to run: the fitness storage path must be inside ACTIVITIES_MEDIA_STORAGE_PATH'
    )
  }
  if (!queueRunsInline) {
    throw new Error(
      'Refusing to run: a real job queue is configured; unset ACTIVITIES_QUEUE_* so jobs run inline'
    )
  }
  if (mapProviderType !== 'osm') {
    throw new Error(
      `Refusing to run: map provider is "${mapProviderType}", expected osm (unset ACTIVITIES_FITNESS_MAP_PROVIDER and the Mapbox/Apple Maps credentials)`
    )
  }
  return {
    filename: sqliteFilename,
    storage: mediaStorage.path,
    fitnessPath: fitnessStorage.path
  }
}

const assertLocalFixtureTarget = () => {
  const config = getConfig()
  const database = config.database as {
    client?: string
    connection?: { filename?: string }
  }
  console.log(
    `Database: ${database.client} — ${database.connection?.filename ?? '(no filename)'} (host ${config.host})`
  )
  return checkFixtureTarget({
    databaseClient: database.client,
    sqliteFilename: database.connection?.filename,
    host: config.host,
    mediaStorage: config.mediaStorage as {
      type?: string
      path?: string
    } | null,
    fitnessStorage: getEffectiveFitnessStorageConfig() as {
      type?: string
      path?: string
    } | null,
    queueRunsInline: getQueue().runsInline,
    mapProviderType: getMapProviderConfig().type
  })
}

/** Origin + path only: query strings and fragments can carry tokens. */
export const redactUrl = (url: string): string => {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '(unparseable url)'
  }
}

const installOfflineFetch = () => {
  const realFetch = globalThis.fetch
  const tiles = new Map<string, Buffer>()
  const blocked: string[] = []
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const tileMatch = url.match(
      /^https:\/\/tile\.openstreetmap\.org\/(\d+\/\d+\/\d+)\.png$/
    )
    if (tileMatch) {
      let tile = tiles.get(tileMatch[1])
      if (!tile) {
        tile = await renderOfflineTile(tileMatch[1])
        tiles.set(tileMatch[1], tile)
      }
      return new Response(new Uint8Array(tile), {
        status: 200,
        headers: { 'content-type': 'image/png' }
      })
    }
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      // Unparseable or relative: treated as external below.
    }
    if (host !== 'localhost' && host !== '127.0.0.1') {
      const safeUrl = redactUrl(url)
      blocked.push(safeUrl)
      throw new Error(
        `Blocked external request while seeding fixtures: ${safeUrl}`
      )
    }
    return realFetch(input, init)
  }) as typeof fetch
  return { tiles, blocked }
}

const mimeForImage = 'image/jpeg'

interface SavedImage {
  mediaId: string
  url: string
  width: number
  height: number
  blurhash: string | null
  sha256: string
  attachmentMetadata: ReturnType<typeof getSavedMediaAttachmentMetadata>
}

const requireActor = async (
  database: Database,
  username: string,
  domain: string
): Promise<Actor> => {
  const actor = await database.getActorFromUsername({ username, domain })
  if (!actor || !actor.account) {
    throw new Error(`Actor ${username}@${domain} was not created`)
  }
  return actor
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2))
  const { filename, storage, fitnessPath } = assertLocalFixtureTarget()
  const config = getConfig()
  const domain = config.host
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')
  if (
    (await database.getAllAccounts({ limit: 1, offset: 0 })).total > 0 ||
    (await database.getLocalPublicStatusesCount(1)) > 0 ||
    (await database.isUsernameExists({ username: MAIN_USERNAME, domain }))
  ) {
    throw new Error(
      'Refusing to run: the database already holds accounts or local public posts; seed a fresh, empty, migrated database'
    )
  }

  const offline = options.offlineMapTiles ? installOfflineFetch() : null
  const imageHashes: Record<string, string> = {}
  const log = (message: string) => console.log(message)

  log(
    `Seeding ${options.landing} fixture into ${filename} (storage ${storage}, fitness ${fitnessPath})`
  )

  // --- accounts ------------------------------------------------------------
  const keyPair = await generateKeyPair(config.secretPhase)
  const passwordHash = await bcrypt.hash(MAIN_PASSWORD, 4)
  const createAccount = async ({
    username,
    email,
    name,
    summary
  }: {
    username: string
    email: string
    name: string
    summary: string
  }) => {
    await database.createAccount({
      domain,
      email,
      username,
      name,
      passwordHash,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey
    })
    const actor = await requireActor(database, username, domain)
    await database.updateActor({ actorId: actor.id, name, summary })
    return requireActor(database, username, domain)
  }

  const saveImage = async ({
    owner,
    spec,
    name,
    description,
    inGallery
  }: {
    owner: Actor
    spec: FixtureImageSpec
    name: string
    description: string
    inGallery: boolean
  }): Promise<SavedImage> => {
    const buffer = await renderFixtureImage(spec)
    const imageSha = sha256(buffer)
    imageHashes[name] = imageSha
    const saved = await saveMedia(database, owner, {
      file: new File([new Uint8Array(buffer)], name, { type: mimeForImage }),
      description
    })
    if (!saved) throw new Error(`Failed to store ${name}`)
    if (inGallery) {
      await database.updateMedia({
        mediaId: saved.id,
        accountId: owner.account?.id as string,
        actorId: owner.id,
        details: { inGallery: true }
      })
    }
    return {
      mediaId: saved.id,
      url: saved.url,
      width: saved.meta.original.width,
      height: saved.meta.original.height,
      blurhash: saved.blurhash ?? null,
      sha256: imageSha,
      attachmentMetadata: getSavedMediaAttachmentMetadata(saved)
    }
  }

  const main = await createAccount({
    username: MAIN_USERNAME,
    email: MAIN_EMAIL,
    name: 'Vitals Fixture',
    summary:
      'Deterministic account for repeatable Web Vitals measurements. Photos, rides and a heatmap.'
  })
  const mainAvatar = await saveImage({
    owner: main,
    spec: { seed: 9001, width: 512, height: 512, quality: 80 },
    name: 'vitals-avatar.jpg',
    description: 'Vitals Fixture avatar',
    inGallery: false
  })
  const mainHeader = await saveImage({
    owner: main,
    spec: { seed: 9002, width: 1500, height: 500, quality: 80 },
    name: 'vitals-header.jpg',
    description: 'Vitals Fixture header',
    inGallery: false
  })
  await database.updateActor({
    actorId: main.id,
    iconUrl: mainAvatar.url,
    headerImageUrl: mainHeader.url
  })

  const extras: Actor[] = []
  for (let index = 1; index <= EXTRA_ACTOR_COUNT; index += 1) {
    const label = String(index).padStart(2, '0')
    const actor = await createAccount({
      username: `fixture${label}`,
      email: `vitals-extra-${label}@example.test`,
      name: `Fixture Follower ${label}`,
      summary: `Fixture account ${label}.`
    })
    const avatar = await saveImage({
      owner: actor,
      spec: { seed: 9100 + index, width: 256, height: 256, quality: 78 },
      name: `fixture${label}-avatar.jpg`,
      description: `Avatar of Fixture Follower ${label}`,
      inGallery: false
    })
    await database.updateActor({ actorId: actor.id, iconUrl: avatar.url })
    extras.push(await requireActor(database, actor.username, domain))
  }
  log(`Created ${1 + extras.length} local accounts`)

  // The extra actors whose own public posts follow the main actor's.
  const memberActors = extras.slice(0, 4)

  // --- posts -----------------------------------------------------------------
  let postSequence = 0
  const taggedStatusIds: string[] = []
  const createPost = async ({
    author,
    text,
    createdAt,
    images
  }: {
    author: Actor
    text: string
    createdAt: number
    images: SavedImage[]
  }) => {
    postSequence += 1
    const publicId = deterministicPublicId(createdAt, 0x5100 + postSequence)
    const id = getLocalStatusId({ actorId: author.id, statusId: publicId })
    const status = await database.createNote({
      id,
      publicId,
      actorId: author.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [author.followersUrl],
      url: `https://${author.domain}/${getMention(author)}/${publicId}`,
      text,
      createdAt
    })
    const hashtags = getHashtags(text, author.domain)
    for (const hashtag of hashtags) {
      await database.createTag({
        statusId: id,
        name: hashtag.name,
        value: hashtag.value,
        type: 'hashtag',
        skipSearchIndex: true
      })
      await database.increaseHashtagCounter({ hashtag: hashtag.name })
    }
    if (hashtags.length > 0) {
      await database.indexHashtagSearchDocuments({
        hashtags: hashtags.map((hashtag) => hashtag.name)
      })
      taggedStatusIds.push(id)
    }
    for (const [index, image] of images.entries()) {
      await database.createAttachment({
        createdAt: createdAt + index,
        actorId: author.id,
        statusId: id,
        mediaType: mimeForImage,
        url: image.url,
        width: image.width,
        height: image.height,
        name: `Fixture photo ${index + 1}`,
        mediaId: image.mediaId,
        ...image.attachmentMetadata
      })
    }
    await addStatusToTimelines(database, status)
    return { id, publicId }
  }

  const mainPlan = buildMainPostPlan()
  const postedMain: {
    plan: PlannedPost
    id: string
    publicId: string
    images: SavedImage[]
  }[] = []
  let imageSeed = 100
  for (const [index, plan] of mainPlan.entries()) {
    const images: SavedImage[] = []
    for (const [imageIndex, shape] of plan.images.entries()) {
      imageSeed += 1
      images.push(
        await saveImage({
          owner: main,
          spec: { seed: imageSeed, ...IMAGE_SIZES[shape] },
          name: `${plan.key}-${imageIndex + 1}.jpg`,
          description: `Fixture photo ${imageIndex + 1} of "${plan.key}" (${shape})`,
          inGallery: true
        })
      )
    }
    const created = await createPost({
      author: main,
      text: plan.text,
      createdAt: FIXED_BASE_MS - index * POST_STEP_MS,
      images
    })
    postedMain.push({ plan, ...created, images })
  }
  log(`Created ${postedMain.length} posts for ${MAIN_USERNAME}`)

  const memberPostIds: string[] = []
  for (const [memberIndex, member] of memberActors.entries()) {
    for (const [postIndex, text] of MEMBER_POSTS.entries()) {
      const withImage = postIndex === 0
      imageSeed += 1
      const images = withImage
        ? [
            await saveImage({
              owner: member,
              spec: { seed: imageSeed, ...IMAGE_SIZES.landscape },
              name: `${member.username}-post.jpg`,
              description: `Fixture photo by ${member.username}`,
              inGallery: false
            })
          ]
        : []
      const created = await createPost({
        author: member,
        text: `${text} (${member.username})`,
        createdAt:
          FIXED_BASE_MS -
          (mainPlan.length + 2 + memberIndex * 3 + postIndex) * POST_STEP_MS,
        images
      })
      memberPostIds.push(created.publicId)
    }
  }

  if (options.landing === 'feed') {
    const filler = buildFillerPlan(100)
    const fillerStart = FIXED_BASE_MS - 24 * POST_STEP_MS
    for (const [index, plan] of filler.entries()) {
      const images: SavedImage[] = []
      for (const [imageIndex] of plan.images.entries()) {
        imageSeed += 1
        images.push(
          await saveImage({
            owner: main,
            spec: { seed: imageSeed, width: 1200, height: 800, quality: 78 },
            name: `${plan.key}-${imageIndex + 1}.jpg`,
            description: `Fixture filler photo ${index + 1}`,
            inGallery: false
          })
        )
      }
      await createPost({
        author: main,
        text: plan.text,
        createdAt: fillerStart - index * FILLER_STEP_MS,
        images
      })
    }
    log(`Created ${filler.length} filler posts for the landing feed`)
  }

  // --- follows ---------------------------------------------------------------
  for (const extra of extras) {
    await database.createFollow({
      actorId: extra.id,
      targetActorId: main.id,
      status: 'Accepted',
      inbox: extra.inboxUrl,
      sharedInbox: extra.sharedInboxUrl
    })
    await database.createFollow({
      actorId: main.id,
      targetActorId: extra.id,
      status: 'Accepted',
      inbox: main.inboxUrl,
      sharedInbox: main.sharedInboxUrl
    })
  }

  // --- album -----------------------------------------------------------------
  const galleryMediaIds = postedMain.flatMap((post) =>
    post.images.map((image) => image.mediaId)
  )
  const albumResult = await database.createGalleryAlbumWithinLimit({
    actorId: main.id,
    title: 'Vitals Fixture Album',
    description: 'Public album with every photo from the fixture posts.',
    visibility: 'public',
    limit: 100
  })
  if (albumResult.status !== 'created') {
    throw new Error('Could not create the fixture album')
  }
  const album = albumResult.album
  const addResult = await database.addGalleryAlbumItems({
    albumId: album.id,
    actorId: main.id,
    mediaIds: galleryMediaIds,
    limit: 500
  })
  if (addResult.status !== 'added') {
    throw new Error(`Could not fill the fixture album (${addResult.status})`)
  }

  // --- fitness ---------------------------------------------------------------
  const fitnessFiles: {
    key: string
    fileId: string
    expectFailed: boolean
    sha256: string
  }[] = []
  const rideSpecs: {
    key: string
    fileName: string
    startMs: number
    build: (startMs: number) => string
    description: string
  }[] = [
    {
      key: 'dense',
      fileName: 'vitals-dense-ride.tcx',
      startMs: Date.UTC(2026, 7, 22, 6, 30, 0),
      build: buildDenseRideTcx,
      description: 'Dense outdoor ride with GPS, HR, cadence, power, 6 laps'
    },
    {
      key: 'sparse',
      fileName: 'vitals-sparse-ride.tcx',
      startMs: Date.UTC(2026, 7, 24, 17, 10, 0),
      build: buildSparseRideTcx,
      description: 'Sparse ride, eight GPS points'
    },
    {
      key: 'indoor',
      fileName: 'vitals-indoor-ride.tcx',
      startMs: Date.UTC(2026, 7, 26, 18, 0, 0),
      build: buildIndoorRideTcx,
      description: 'Indoor trainer ride, no GPS'
    }
  ]
  const runImport = async (fileId: string) => {
    try {
      await importFitnessFilesJob(database, {
        id: getHashFromString(`${FIXTURE_BATCH_ID}:${fileId}`),
        name: IMPORT_FITNESS_FILES_JOB_NAME,
        data: {
          actorId: main.id,
          batchId: FIXTURE_BATCH_ID,
          fitnessFileIds: [fileId],
          overlapFitnessFileIds: [],
          visibility: 'public'
        }
      })
    } catch (error) {
      log(`Import job threw for ${fileId}: ${(error as Error).message}`)
    }
  }
  for (const ride of rideSpecs) {
    const tcx = ride.build(ride.startMs)
    const saved = await saveFitnessFile(database, main, {
      file: new File([tcx], ride.fileName, {
        type: 'application/vnd.garmin.tcx+xml'
      }),
      description: ride.description,
      importBatchId: FIXTURE_BATCH_ID
    })
    if (!saved) throw new Error(`Could not store ${ride.fileName}`)
    fitnessFiles.push({
      key: ride.key,
      fileId: saved.id,
      expectFailed: false,
      sha256: sha256(tcx)
    })
    await runImport(saved.id)
  }
  const garbage = buildGarbageFitBytes()
  const failedSaved = await saveFitnessFile(database, main, {
    file: new File([new Uint8Array(garbage)], 'vitals-corrupt.fit', {
      type: 'application/octet-stream'
    }),
    description: 'Deliberately corrupt file',
    importBatchId: FIXTURE_BATCH_ID
  })
  if (!failedSaved) throw new Error('Could not store the corrupt fixture')
  fitnessFiles.push({
    key: 'failed',
    fileId: failedSaved.id,
    expectFailed: true,
    sha256: sha256(garbage)
  })
  await runImport(failedSaved.id)

  const fitnessResults: Record<
    string,
    {
      fileId: string
      statusId: string | null
      publicId: string | null
      processingStatus: string | null
      importStatus: string | null
      hasMapData: boolean
      mapImagePath: string | null
      importError: string | null
      sha256: string
    }
  > = {}
  for (const entry of fitnessFiles) {
    const row = await database.getFitnessFile({ id: entry.fileId })
    let publicId: string | null = null
    if (row?.statusId) {
      const status = await database.getStatus({
        statusId: row.statusId,
        withReplies: false
      })
      publicId = status ? getClientStatusId(status) : null
    }
    fitnessResults[entry.key] = {
      fileId: entry.fileId,
      statusId: row?.statusId ?? null,
      publicId,
      processingStatus: row?.processingStatus ?? null,
      importStatus: row?.importStatus ?? null,
      hasMapData: Boolean(row?.hasMapData),
      mapImagePath: row?.mapImagePath ?? null,
      importError: row?.importError ?? null,
      sha256: entry.sha256
    }
  }
  for (const key of ['dense', 'sparse', 'indoor']) {
    const result = fitnessResults[key]
    if (!result.publicId || result.processingStatus !== 'completed') {
      throw new Error(
        `Fitness fixture "${key}" did not import cleanly: ${JSON.stringify(result)}`
      )
    }
  }
  if (
    !fitnessResults.dense.mapImagePath ||
    !fitnessResults.sparse.mapImagePath
  ) {
    throw new Error('Expected route map images for the dense and sparse rides')
  }
  if (fitnessResults.failed.importStatus !== 'failed') {
    throw new Error(
      `Expected the corrupt file to fail: ${JSON.stringify(fitnessResults.failed)}`
    )
  }

  // --- heatmap ---------------------------------------------------------------
  await generateFitnessRouteHeatmapJob(database, {
    id: getHashFromString(`${FIXTURE_BATCH_ID}:heatmap`),
    name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
    data: {
      actorId: main.id,
      activityType: null,
      periodType: 'all_time',
      periodKey: 'all',
      region: ''
    }
  })
  const heatmap = await database.getFitnessRouteHeatmapByKey({
    actorId: main.id,
    activityType: null,
    periodType: 'all_time',
    periodKey: 'all',
    region: ''
  })
  if (!heatmap || heatmap.status !== 'completed') {
    throw new Error(
      `Heatmap did not complete: ${JSON.stringify(heatmap && { status: heatmap.status, error: heatmap.error })}`
    )
  }
  const shared = await database.setFitnessRouteHeatmapShareToken({
    actorId: main.id,
    id: heatmap.id,
    shareToken: HEATMAP_SHARE_TOKEN
  })
  if (!shared) throw new Error('Could not set the heatmap share token')
  const pyramid = await database.getFitnessRouteHeatmapPyramid({
    actorId: main.id
  })

  // --- verification ----------------------------------------------------------
  const publicCount = await database.getLocalPublicStatusesCount(1000)
  if (options.landing === 'hero' && publicCount > HERO_MAX_POSTS) {
    throw new Error(
      `Hero landing needs <= ${HERO_MAX_POSTS} public posts, found ${publicCount}`
    )
  }
  if (options.landing === 'feed' && publicCount < FEED_MIN_POSTS) {
    throw new Error(
      `Feed landing needs >= ${FEED_MIN_POSTS} public posts, found ${publicCount}`
    )
  }
  const tagCount = taggedStatusIds.length

  // --- manifest ---------------------------------------------------------------
  const handle = `@${MAIN_USERNAME}@${domain}`
  const statusPath = (publicId: string) => `/@${MAIN_USERNAME}/${publicId}`
  const planned = (key: string) => {
    const entry = postedMain.find((post) => post.plan.key === key)
    if (!entry) throw new Error(`Missing planned post ${key}`)
    return entry
  }
  const forbidden = [
    'Application error',
    'Server error',
    'This page could not be found',
    'Something went wrong',
    'Nothing public yet'
  ]
  const photoStatusPage = (
    key: string,
    description: string,
    postKey: string,
    core: boolean
  ) => {
    const post = planned(postKey)
    return {
      key,
      core,
      description,
      path: statusPath(post.publicId),
      markers: {
        text: [post.plan.text.replace(` #${HASHTAG}`, '')],
        mediaImages: post.images.length,
        forbidText: forbidden
      }
    }
  }
  const fitnessPage = (
    key: 'dense' | 'sparse' | 'indoor',
    label: string,
    core: boolean,
    text: string[]
  ) => {
    const result = fitnessResults[key]
    return {
      key: `fitness-${key}`,
      core,
      description: label,
      path: statusPath(result.publicId ?? ''),
      markers: {
        text,
        // The static route map and the pre-parsed route data are both fetched.
        resources: [
          ...(result.mapImagePath
            ? [`/api/v1/files/${result.mapImagePath}`]
            : []),
          ...(result.hasMapData
            ? [`/api/v1/fitness-files/${result.fileId}/route-data`]
            : [])
        ],
        forbidText: forbidden
      }
    }
  }
  const pages = [
    options.landing === 'hero'
      ? {
          key: 'landing-hero',
          core: true,
          description: `Logged-out landing, brand hero (< ${LANDING_FEED_MIN_POSTS} public posts)`,
          path: '/',
          markers: {
            text: ['Sign in'],
            absentText: ['Recent posts on this server'],
            forbidText: forbidden
          }
        }
      : {
          key: 'landing-feed',
          core: true,
          description: `Logged-out landing, public feed preview (>= ${FEED_MIN_POSTS} public posts)`,
          path: '/',
          markers: {
            text: ['Recent posts on this server', 'Golden hour over the canal'],
            mediaImagesMin: 3,
            forbidText: forbidden
          }
        },
    {
      key: 'profile',
      core: true,
      description: 'Public profile',
      path: `/@${MAIN_USERNAME}`,
      markers: {
        text: ['Vitals Fixture', 'Golden hour over the canal'],
        mediaImagesMin: 5,
        forbidText: forbidden
      }
    },
    photoStatusPage(
      'status-single-image',
      'Single landscape image status',
      'single-landscape',
      true
    ),
    photoStatusPage(
      'status-multi-image',
      'Seven image status',
      'seven-images',
      true
    ),
    photoStatusPage(
      'status-multi-image-4',
      'Four image status',
      'four-images',
      false
    ),
    photoStatusPage(
      'status-portrait',
      'Single portrait image status',
      'single-portrait',
      false
    ),
    {
      key: 'status-text-only',
      core: false,
      description: 'Text-only status',
      path: statusPath(planned('text-2').publicId),
      markers: {
        text: ['Reading week: three books down, two to go.'],
        mediaImages: 0,
        forbidText: forbidden
      }
    },
    {
      key: 'tag',
      core: true,
      description: `Hashtag page /tags/${HASHTAG}`,
      path: `/tags/${HASHTAG}`,
      markers: {
        text: [`#${HASHTAG}`, 'Golden hour over the canal'],
        mediaImagesMin: 3,
        forbidText: forbidden
      }
    },
    {
      key: 'album',
      core: true,
      description: 'Public gallery album',
      path: `/@${MAIN_USERNAME}/albums/${album.id}`,
      markers: {
        text: ['Vitals Fixture Album'],
        mediaImagesMin: 12,
        forbidText: forbidden
      }
    },
    {
      key: 'followers',
      core: true,
      description: 'Followers list',
      path: `/@${MAIN_USERNAME}/followers`,
      markers: {
        text: ['30 accounts', 'Fixture Follower 01'],
        forbidText: forbidden
      }
    },
    {
      key: 'following',
      core: true,
      description: 'Following list',
      path: `/@${MAIN_USERNAME}/following`,
      markers: {
        text: ['30 accounts', 'Fixture Follower 01'],
        forbidText: forbidden
      }
    },
    {
      key: 'heatmap-public',
      core: true,
      description: 'Public shared route heatmap',
      path: `/u/heatmaps/${HEATMAP_SHARE_TOKEN}`,
      markers: {
        text: ['Public heatmap', `@${MAIN_USERNAME}@${domain}`],
        forbidText: forbidden
      }
    },
    {
      key: 'heatmap-embed',
      core: true,
      description: 'Embeddable route heatmap',
      path: `/embed/heatmap/${HEATMAP_SHARE_TOKEN}`,
      markers: {
        text: [] as string[],
        // The tile batch for the first viewport comes from the first-party
        // tiles route; the basemap itself is third-party (see header).
        resources: [`/embed/heatmap/${HEATMAP_SHARE_TOKEN}/tiles`],
        forbidText: forbidden
      }
    },
    fitnessPage('dense', 'Dense ride status (real pipeline)', true, [
      'Overview',
      'Laps',
      'Heart rate',
      '6 graphs from the TCX file'
    ]),
    fitnessPage('sparse', 'Sparse ride status', false, ['Overview']),
    fitnessPage('indoor', 'Indoor ride status (no GPS)', false, ['Overview'])
  ]

  const identity = {
    version: 1,
    landing: options.landing,
    baseMs: FIXED_BASE_MS,
    posts: postedMain.map((post) => ({
      key: post.plan.key,
      publicId: post.publicId,
      text: post.plan.text,
      images: post.images.map((image) => image.sha256)
    })),
    memberPostPublicIds: memberPostIds,
    imageHashes,
    fitnessSha256: Object.fromEntries(
      Object.entries(fitnessResults).map(([key, value]) => [key, value.sha256])
    ),
    heatmapToken: HEATMAP_SHARE_TOKEN,
    counts: {
      localPublicPosts: publicCount,
      accounts: 1 + extras.length,
      albumItems: galleryMediaIds.length,
      taggedPosts: tagCount
    }
  }
  const manifest = {
    schema: 'web-vitals-fixtures/1',
    landing: options.landing,
    host: domain,
    database: filename,
    storage,
    fitnessStorage: fitnessPath,
    offlineMapTiles: options.offlineMapTiles,
    offlineTilesServed: offline?.tiles.size ?? 0,
    blockedExternalRequests: offline?.blocked ?? [],
    identityHash: sha256(JSON.stringify(identity)),
    actor: {
      handle,
      username: MAIN_USERNAME,
      id: main.id,
      email: MAIN_EMAIL,
      password: MAIN_PASSWORD
    },
    ids: {
      accountId: main.account?.id,
      albumId: album.id,
      heatmapId: heatmap.id,
      heatmapShareToken: HEATMAP_SHARE_TOKEN,
      hashtag: HASHTAG,
      fitness: fitnessResults,
      memberPostPublicIds: memberPostIds
    },
    counts: identity.counts,
    pyramid: pyramid
      ? { status: pyramid.status, version: pyramid.version }
      : null,
    pages,
    identity
  }
  fs.mkdirSync(path.dirname(options.manifest), { recursive: true })
  fs.writeFileSync(options.manifest, JSON.stringify(manifest, null, 2) + '\n')
  log(
    `Done: ${publicCount} local public posts, identityHash ${manifest.identityHash}`
  )
  log(`Manifest written to ${options.manifest}`)
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Failed to create Web Vitals fixtures:', error)
      process.exit(1)
    })
}

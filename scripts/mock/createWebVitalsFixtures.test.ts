import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'
import { isPublicId } from '@/lib/utils/publicId'

import {
  DENSE_RIDE_LAPS,
  DENSE_RIDE_POINTS,
  FIXED_BASE_MS,
  type FixtureTargetInput,
  HASHTAG,
  INDOOR_RIDE_POINTS,
  SPARSE_RIDE_POINTS,
  buildDenseRideTcx,
  buildIndoorRideTcx,
  buildMainPostPlan,
  buildSparseRideTcx,
  checkFixtureTarget,
  createRng,
  deterministicPublicId,
  parseCliOptions,
  redactUrl,
  renderFixtureImage
} from './createWebVitalsFixtures'

const parse = (tcx: string) =>
  parseFitnessFile({ fileType: 'tcx', buffer: Buffer.from(tcx) })

describe('createRng', () => {
  it('repeats for the same seed and differs between seeds', () => {
    const a = createRng(7)
    const b = createRng(7)
    const first = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(first)
    expect(createRng(8)()).not.toBe(first[0])
  })
})

describe('deterministicPublicId', () => {
  it('is a stable, valid public id for a given time and seed', () => {
    const id = deterministicPublicId(FIXED_BASE_MS, 1)
    expect(id).toBe(deterministicPublicId(FIXED_BASE_MS, 1))
    expect(isPublicId(id)).toBe(true)
    expect(id).not.toBe(deterministicPublicId(FIXED_BASE_MS, 2))
  })
})

describe('TCX generators', () => {
  it('builds a dense ride that the real parser reads in full', async () => {
    const data = await parse(buildDenseRideTcx(Date.UTC(2026, 7, 22, 6, 30)))
    expect(data.trackPoints.length).toBeGreaterThanOrEqual(3600)
    expect(data.trackPoints.length).toBe(DENSE_RIDE_POINTS)
    expect(data.laps).toHaveLength(DENSE_RIDE_LAPS)
    expect(data.powerSeries?.length).toBe(DENSE_RIDE_POINTS)
    expect(data.heartRateSeries?.length).toBe(DENSE_RIDE_POINTS)
    expect(data.totalDistanceMeters).toBeGreaterThan(20000)
  })

  it('is byte-identical on every call', () => {
    const start = Date.UTC(2026, 7, 22, 6, 30)
    expect(buildDenseRideTcx(start)).toBe(buildDenseRideTcx(start))
    expect(buildIndoorRideTcx(start)).toBe(buildIndoorRideTcx(start))
  })

  it('builds a sparse ride with eight GPS points', async () => {
    const data = await parse(buildSparseRideTcx(Date.UTC(2026, 7, 24, 17, 10)))
    expect(data.coordinates).toHaveLength(SPARSE_RIDE_POINTS)
  })

  it('builds an indoor ride with sensors and no GPS', async () => {
    const data = await parse(buildIndoorRideTcx(Date.UTC(2026, 7, 26, 18)))
    expect(data.coordinates).toHaveLength(0)
    expect(data.powerSeries?.length).toBe(INDOOR_RIDE_POINTS)
    expect(data.heartRateSeries?.length).toBe(INDOOR_RIDE_POINTS)
  })
})

describe('buildMainPostPlan', () => {
  const plan = buildMainPostPlan()

  it('leads with the photo posts of every shape', () => {
    const counts = Object.fromEntries(
      plan.slice(0, 7).map((post) => [post.key, post.images.length])
    )
    expect(counts).toMatchObject({
      'single-landscape': 1,
      'single-portrait': 1,
      'two-images': 2,
      'four-images': 4,
      'seven-images': 7
    })
  })

  it('carries the hashtag in the text of every tagged post', () => {
    const tagged = plan.filter((post) => post.tagged)
    expect(tagged.length).toBeGreaterThan(0)
    for (const post of tagged) expect(post.text).toContain(`#${HASHTAG}`)
    for (const post of plan.filter((post) => !post.tagged)) {
      expect(post.text).not.toContain(`#${HASHTAG}`)
    }
  })
})

describe('renderFixtureImage', () => {
  it('is deterministic and keeps the requested size', async () => {
    const spec = { seed: 5, width: 160, height: 107 }
    const first = await renderFixtureImage(spec)
    expect((await renderFixtureImage(spec)).equals(first)).toBe(true)
    expect((await renderFixtureImage({ ...spec, seed: 6 })).equals(first)).toBe(
      false
    )
  })
})

describe('parseCliOptions', () => {
  it('requires a landing mode and an absolute manifest path', () => {
    expect(() => parseCliOptions([])).toThrow('--landing')
    expect(() => parseCliOptions(['--landing', 'feed'])).toThrow('--manifest')
    expect(() =>
      parseCliOptions(['--landing', 'feed', '--manifest', 'relative.json'])
    ).toThrow('--manifest')
  })

  it('turns offline map tiles on by default', () => {
    const base = ['--landing', 'hero', '--manifest', '/tmp/m.json']
    expect(parseCliOptions(base).offlineMapTiles).toBe(true)
    expect(
      parseCliOptions([...base, '--no-offline-map-tiles']).offlineMapTiles
    ).toBe(false)
  })

  it('splits at the first = only', () => {
    const base = ['--landing', 'hero']
    expect(parseCliOptions([...base, '--manifest=/x/a=b.json']).manifest).toBe(
      '/x/a=b.json'
    )
  })

  it('reads --offline-map-tiles=false', () => {
    const base = ['--landing=hero', '--manifest=/tmp/m.json']
    expect(
      parseCliOptions([...base, '--offline-map-tiles=false']).offlineMapTiles
    ).toBe(false)
    expect(
      parseCliOptions([...base, '--offline-map-tiles=true']).offlineMapTiles
    ).toBe(true)
  })

  it('rejects unknown arguments', () => {
    expect(() =>
      parseCliOptions(['--landing', 'hero', '--manifest', '/m.json', '--bogus'])
    ).toThrow('Unknown argument: --bogus')
  })
})

describe('checkFixtureTarget', () => {
  const valid: FixtureTargetInput = {
    databaseClient: 'better-sqlite3',
    sqliteFilename: '/data/vitals.sqlite3',
    host: 'localhost:3210',
    mediaStorage: { type: 'fs', path: '/data/storage' },
    fitnessStorage: { type: 'fs', path: '/data/storage/fitness' },
    queueRunsInline: true,
    mapProviderType: 'osm',
    fileExists: () => true
  }

  it('accepts a local, loopback, inline, OSM target', () => {
    expect(checkFixtureTarget(valid)).toEqual({
      filename: '/data/vitals.sqlite3',
      storage: '/data/storage',
      fitnessPath: '/data/storage/fitness'
    })
  })

  it.each<[string, Partial<FixtureTargetInput>, string]>([
    ['pg client', { databaseClient: 'pg' }, 'better-sqlite3'],
    [':memory:', { sqliteFilename: ':memory:' }, 'absolute path'],
    ['relative file', { sqliteFilename: 'vitals.sqlite3' }, 'absolute path'],
    ['missing file', { fileExists: () => false }, 'existing, migrated'],
    ['non-loopback host', { host: 'example.com' }, 'loopback'],
    ['no media storage', { mediaStorage: null }, 'ACTIVITIES_MEDIA_STORAGE'],
    [
      's3 media storage',
      { mediaStorage: { type: 's3', path: undefined } },
      'ACTIVITIES_MEDIA_STORAGE'
    ],
    [
      'relative media storage',
      { mediaStorage: { type: 'fs', path: 'storage' } },
      'must be absolute'
    ],
    [
      's3 fitness storage',
      { fitnessStorage: { type: 's3' } },
      'fitness storage must be local fs'
    ],
    ['no fitness storage', { fitnessStorage: null }, 'fitness storage'],
    [
      'relative fitness storage',
      { fitnessStorage: { type: 'fs', path: 'fitness' } },
      'fitness storage must be local fs'
    ],
    [
      'fitness storage outside media storage',
      { fitnessStorage: { type: 'fs', path: '/elsewhere/fitness' } },
      'inside ACTIVITIES_MEDIA_STORAGE_PATH'
    ],
    ['non-inline queue', { queueRunsInline: false }, 'job queue'],
    ['non-osm map provider', { mapProviderType: 'mapbox' }, 'expected osm']
  ])('refuses %s', (_name, override, message) => {
    expect(() => checkFixtureTarget({ ...valid, ...override })).toThrow(message)
  })
})

describe('redactUrl', () => {
  it('keeps only origin and path', () => {
    expect(redactUrl('https://a.example/p/q.png?token=secret#x')).toBe(
      'https://a.example/p/q.png'
    )
    expect(redactUrl('not a url')).toBe('(unparseable url)')
  })
})

import { getDatabase } from '@/lib/database'
import { getGearKindForActivityType } from '@/lib/services/fitness-files/sportTypes'

import {
  NormalizableFitnessFile,
  normalizeFitnessActivityTypesScript,
  parseArgs,
  planActivityTypeNormalization,
  summarizeRewrites
} from './normalizeFitnessActivityTypes'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('./describeConnection', () => ({
  printDatabaseBanner: vi.fn()
}))

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>

const ACTOR_ID = 'https://llun.social/users/ride'

/** The script's own page size — a page shorter than this ends the scan. */
const SCAN_PAGE_SIZE = 200

const rowsFor = (types: Array<string | null>, offset = 0) =>
  types.map((activityType, index) => ({
    id: `file-${offset + index}`,
    fileName: `file-${offset + index}.fit`,
    activityType
  }))

/**
 * A stubbed database for the script's own `main()`.
 *
 * Every collaborator is overridable, so a test needing a missing actor or a
 * failing scan configures it here rather than reaching past the cast to
 * reassign a property afterwards. By default the first page carries `types` and
 * the next is empty, which ends the scan.
 */
const stubDatabase = ({
  types = [],
  updateFitnessFileActivityData = vi.fn().mockResolvedValue(undefined),
  getActorFromId = vi.fn().mockResolvedValue({ id: ACTOR_ID }),
  getFitnessFilesByActor = vi
    .fn()
    .mockImplementation(({ offset }: { offset: number }) =>
      Promise.resolve(offset === 0 ? rowsFor(types) : [])
    )
}: {
  types?: Array<string | null>
  updateFitnessFileActivityData?: ReturnType<typeof vi.fn>
  getActorFromId?: ReturnType<typeof vi.fn>
  getFitnessFilesByActor?: ReturnType<typeof vi.fn>
} = {}) =>
  ({
    getActorFromId,
    getFitnessFilesByActor,
    updateFitnessFileActivityData,
    destroy: vi.fn().mockResolvedValue(undefined)
  }) as unknown as ReturnType<typeof getDatabase>

const file = (
  id: string,
  activityType?: string | null
): NormalizableFitnessFile => ({
  id,
  fileName: `${id}.fit`,
  activityType
})

describe('normalizeFitnessActivityTypes parseArgs', () => {
  it('requires an actor id', () => {
    expect(() => parseArgs([])).toThrow()
  })

  it('writes nothing unless --apply is given', () => {
    expect(parseArgs(['--actor-id', 'actor-1'])).toEqual({
      actorId: 'actor-1',
      apply: false
    })
  })

  it('accepts bare, inline, and space-separated forms of --apply', () => {
    expect(parseArgs(['--actor-id', 'actor-1', '--apply'])).toEqual({
      actorId: 'actor-1',
      apply: true
    })
    expect(parseArgs(['--actor-id', 'actor-1', '--apply=false'])).toEqual({
      actorId: 'actor-1',
      apply: false
    })
    expect(parseArgs(['--apply', 'true', '--actor-id', 'actor-1'])).toEqual({
      actorId: 'actor-1',
      apply: true
    })
  })

  it('rejects an invalid boolean value', () => {
    expect(() =>
      parseArgs(['--actor-id', 'actor-1', '--apply', 'maybe'])
    ).toThrow('Invalid boolean value: maybe. Use true or false.')
  })

  it('explains itself when handed --dry-run instead of eating the next argument', () => {
    expect(() => parseArgs(['--dry-run', '--actor-id', 'actor-1'])).toThrow(
      'This script is a dry run by default; pass --apply to write.'
    )
  })

  it('rejects an unexpected positional argument', () => {
    expect(() => parseArgs(['actor-1'])).toThrow('Unexpected argument: actor-1')
  })
})

describe('planActivityTypeNormalization', () => {
  it.each([
    // FIT sport / sub_sport
    { description: 'FIT cycling', from: 'cycling', to: 'ride' },
    {
      description: 'FIT gravel_cycling',
      from: 'gravel_cycling',
      to: 'gravel_ride'
    },
    {
      description: 'FIT indoor_cycling',
      from: 'indoor_cycling',
      to: 'virtual_ride'
    },
    {
      description: 'FIT mountain_biking',
      from: 'mountain_biking',
      to: 'mountain_bike_ride'
    },
    { description: 'FIT running', from: 'running', to: 'run' },
    { description: 'FIT hiking', from: 'hiking', to: 'hike' },
    // Garmin TCX Sport attribute
    { description: 'TCX Biking', from: 'Biking', to: 'ride' },
    { description: 'TCX Running', from: 'Running', to: 'run' },
    // Strava sport_type, as written into the TCX built for an import
    { description: 'Strava Ride', from: 'Ride', to: 'ride' },
    { description: 'Strava GravelRide', from: 'GravelRide', to: 'gravel_ride' },
    {
      description: 'Strava VirtualRide',
      from: 'VirtualRide',
      to: 'virtual_ride'
    },
    { description: 'Strava EBikeRide', from: 'EBikeRide', to: 'ebike_ride' },
    // Free-form GPX <trk><type>
    { description: 'GPX free text', from: 'Road cycling', to: 'ride' }
  ])('rewrites $description to its sport key', ({ from, to }) => {
    const plan = planActivityTypeNormalization([file('file-1', from)])

    expect(plan.rewrites).toEqual([
      { fileId: 'file-1', fileName: 'file-1.fit', from, to }
    ])
  })

  it('collapses the four vocabularies for one sport onto a single value', () => {
    // This is the whole point: `cycling`, `Biking` and `Ride` are the same ride
    // recorded three ways, and the overview breakdown counted them separately.
    const plan = planActivityTypeNormalization([
      file('file-1', 'cycling'),
      file('file-2', 'Biking'),
      file('file-3', 'Ride')
    ])

    expect(plan.rewrites.map((rewrite) => rewrite.to)).toEqual([
      'ride',
      'ride',
      'ride'
    ])
  })

  it('leaves a row already stored as its sport key alone', () => {
    const plan = planActivityTypeNormalization([
      file('file-1', 'ride'),
      file('file-2', 'gravel_ride'),
      file('file-3', 'trail_run')
    ])

    expect(plan.rewrites).toEqual([])
    expect(plan.alreadyNormalized).toBe(3)
  })

  it('is idempotent: re-planning its own output finds nothing to do', () => {
    const first = planActivityTypeNormalization([
      file('file-1', 'cycling'),
      file('file-2', 'GravelRide')
    ])
    const second = planActivityTypeNormalization(
      first.rewrites.map((rewrite) => file(rewrite.fileId, rewrite.to))
    )

    expect(second.rewrites).toEqual([])
    expect(second.alreadyNormalized).toBe(2)
  })

  it('reports unmodelled types without rewriting them', () => {
    // Swims and gym work have no gear kind to attribute them to, but they are
    // still activities the breakdown and the calendar filter must go on
    // showing. Dropping or blanking them would erase them from every rollup.
    const plan = planActivityTypeNormalization([
      file('file-1', 'swimming'),
      file('file-2', 'swimming'),
      file('file-3', 'Other')
    ])

    expect(plan.rewrites).toEqual([])
    expect([...plan.unmapped.entries()]).toEqual([
      ['swimming', 2],
      ['Other', 1]
    ])
  })

  it('does not trim an unmodelled value it is otherwise leaving alone', () => {
    const plan = planActivityTypeNormalization([file('file-1', '  Other  ')])

    expect(plan.rewrites).toEqual([])
    expect([...plan.unmapped.keys()]).toEqual(['  Other  '])
  })

  it('counts rows carrying no activity type', () => {
    const plan = planActivityTypeNormalization([
      file('file-1', null),
      file('file-2', undefined),
      file('file-3', '')
    ])

    expect(plan.rewrites).toEqual([])
    expect(plan.missingType).toBe(3)
  })

  it('folds successive pages into one shared plan', () => {
    const plan = planActivityTypeNormalization([file('file-1', 'cycling')])
    planActivityTypeNormalization([file('file-2', 'Biking')], plan)

    expect(plan.rewrites.map((rewrite) => rewrite.fileId)).toEqual([
      'file-1',
      'file-2'
    ])
  })

  it('never changes the gear kind an activity resolves to', () => {
    // Auto-assign reads the column through `normalizeActivityTypeToSportKey`,
    // so the rewrite is only safe on live data if it cannot move an activity
    // between bike and shoes.
    //
    // The oracle is HARDCODED rather than derived from the plan. Comparing
    // `normalize(rewrite.to)` against `normalize(rewrite.from)` looks like the
    // same assertion but proves nothing: `to` is defined as
    // `normalize(from)`, so it reduces to `normalize(normalize(x))
    // === normalize(x)` and holds for any deterministic function — including
    // one that classified every activity as a walk.
    const EXPECTED_KIND: Record<string, 'bike' | 'shoes'> = {
      cycling: 'bike',
      gravel_cycling: 'bike',
      indoor_cycling: 'bike',
      mountain_biking: 'bike',
      Biking: 'bike',
      Ride: 'bike',
      GravelRide: 'bike',
      VirtualRide: 'bike',
      EBikeRide: 'bike',
      running: 'shoes',
      trail_running: 'shoes',
      walking: 'shoes',
      hiking: 'shoes'
    }
    const raws = Object.keys(EXPECTED_KIND)
    const plan = planActivityTypeNormalization(
      raws.map((raw, index) => file(`file-${index}`, raw))
    )

    expect(plan.rewrites).toHaveLength(raws.length)
    for (const rewrite of plan.rewrites) {
      expect(getGearKindForActivityType(rewrite.to)).toBe(
        EXPECTED_KIND[rewrite.from]
      )
    }
  })
})

describe('summarizeRewrites', () => {
  it('groups transitions and orders them by how many rows each covers', () => {
    const plan = planActivityTypeNormalization([
      file('file-1', 'cycling'),
      file('file-2', 'cycling'),
      file('file-3', 'cycling'),
      file('file-4', 'running'),
      file('file-5', 'Biking')
    ])

    expect(summarizeRewrites(plan.rewrites)).toEqual([
      { from: 'cycling', to: 'ride', count: 3 },
      { from: 'Biking', to: 'ride', count: 1 },
      { from: 'running', to: 'run', count: 1 }
    ])
  })

  it('keeps distinct sources apart even when they land on the same key', () => {
    const plan = planActivityTypeNormalization([
      file('file-1', 'cycling'),
      file('file-2', 'Ride')
    ])

    // Tied on count, so ordered by `localeCompare`, which collates
    // case-insensitively: `cycling` before `Ride`.
    expect(summarizeRewrites(plan.rewrites)).toEqual([
      { from: 'cycling', to: 'ride', count: 1 },
      { from: 'Ride', to: 'ride', count: 1 }
    ])
  })

  it('answers an empty list for no rewrites', () => {
    expect(summarizeRewrites([])).toEqual([])
  })
})

describe('normalizeFitnessActivityTypesScript', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes nothing without --apply', async () => {
    const updateFitnessFileActivityData = vi.fn()
    mockGetDatabase.mockReturnValue(
      stubDatabase({
        types: ['cycling', 'Biking'],
        updateFitnessFileActivityData
      })
    )

    const exitCode = await normalizeFitnessActivityTypesScript([
      '--actor-id',
      ACTOR_ID
    ])

    expect(exitCode).toBe(0)
    expect(updateFitnessFileActivityData).not.toHaveBeenCalled()
  })

  it('writes the sport key, not the value it replaced', async () => {
    // The one line that actually mutates production rows. A transposed
    // `rewrite.from` here would write `cycling` back over every row and no
    // other test in this file would notice.
    const updateFitnessFileActivityData = vi.fn().mockResolvedValue(undefined)
    mockGetDatabase.mockReturnValue(
      stubDatabase({
        types: ['cycling', 'GravelRide'],
        updateFitnessFileActivityData
      })
    )

    const exitCode = await normalizeFitnessActivityTypesScript([
      '--actor-id',
      ACTOR_ID,
      '--apply'
    ])

    expect(exitCode).toBe(0)
    expect(updateFitnessFileActivityData).toHaveBeenCalledTimes(2)
    expect(updateFitnessFileActivityData).toHaveBeenCalledWith('file-0', {
      activityType: 'ride'
    })
    expect(updateFitnessFileActivityData).toHaveBeenCalledWith('file-1', {
      activityType: 'gravel_ride'
    })
  })

  it('leaves canonical and unmodelled rows untouched under --apply', async () => {
    const updateFitnessFileActivityData = vi.fn().mockResolvedValue(undefined)
    mockGetDatabase.mockReturnValue(
      stubDatabase({
        types: ['ride', 'swimming', null, 'cycling'],
        updateFitnessFileActivityData
      })
    )

    await normalizeFitnessActivityTypesScript([
      '--actor-id',
      ACTOR_ID,
      '--apply'
    ])

    expect(updateFitnessFileActivityData).toHaveBeenCalledTimes(1)
    expect(updateFitnessFileActivityData).toHaveBeenCalledWith('file-3', {
      activityType: 'ride'
    })
  })

  it('carries on past a failed row and reports it in the exit code', async () => {
    // A bulk mutation that aborts halfway leaves the actor's history in two
    // vocabularies at once, which is worse than the state it started in.
    const updateFitnessFileActivityData = vi
      .fn()
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValue(undefined)
    mockGetDatabase.mockReturnValue(
      stubDatabase({
        types: ['cycling', 'Biking', 'running'],
        updateFitnessFileActivityData
      })
    )

    const exitCode = await normalizeFitnessActivityTypesScript([
      '--actor-id',
      ACTOR_ID,
      '--apply'
    ])

    expect(exitCode).toBe(1)
    expect(updateFitnessFileActivityData).toHaveBeenCalledTimes(3)
  })

  it('keeps paging while a page comes back full', async () => {
    // The scan stops on a SHORT page, so a full one must be followed by another
    // fetch at the next offset. Every other test here supplies a handful of
    // rows and so ends the scan on the first iteration — which leaves both
    // common pagination typos (an offset that never advances, and an
    // off-by-one in the break) passing the whole file. An actor with 200+
    // activities is the normal case for the history this script exists to fix.
    const firstPage = rowsFor(Array(SCAN_PAGE_SIZE).fill('cycling'))
    const secondPage = rowsFor(['Biking'], SCAN_PAGE_SIZE)
    // Capped, because the scan only ends on a short page: an offset that never
    // advances would be handed the same full page forever and HANG the suite
    // rather than fail an assertion. The cap lets the loop terminate so the
    // call-count assertion below is what reports the bug.
    let calls = 0
    const getFitnessFilesByActor = vi
      .fn()
      .mockImplementation(({ offset }: { offset: number }) => {
        calls += 1
        if (calls > 4) return Promise.resolve([])
        if (offset === 0) return Promise.resolve(firstPage)
        if (offset === SCAN_PAGE_SIZE) return Promise.resolve(secondPage)
        return Promise.resolve([])
      })
    const updateFitnessFileActivityData = vi.fn().mockResolvedValue(undefined)
    mockGetDatabase.mockReturnValue(
      stubDatabase({ getFitnessFilesByActor, updateFitnessFileActivityData })
    )

    const exitCode = await normalizeFitnessActivityTypesScript([
      '--actor-id',
      ACTOR_ID,
      '--apply'
    ])

    expect(exitCode).toBe(0)
    expect(getFitnessFilesByActor).toHaveBeenCalledTimes(2)
    expect(getFitnessFilesByActor).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ offset: 0, limit: SCAN_PAGE_SIZE })
    )
    expect(getFitnessFilesByActor).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offset: SCAN_PAGE_SIZE, limit: SCAN_PAGE_SIZE })
    )
    // Every row across both pages, so a truncated scan cannot pass.
    expect(updateFitnessFileActivityData).toHaveBeenCalledTimes(
      SCAN_PAGE_SIZE + 1
    )
    expect(updateFitnessFileActivityData).toHaveBeenCalledWith(
      `file-${SCAN_PAGE_SIZE}`,
      { activityType: 'ride' }
    )
  })

  it('does not claim heatmaps are stale when every write failed', async () => {
    // Nothing moved, so nothing was invalidated. Printing the rebuild command
    // here sends an operator to redo work in response to a run that changed
    // no rows — and the exit code alone does not stop them pasting it.
    mockGetDatabase.mockReturnValue(
      stubDatabase({
        types: ['cycling', 'Biking'],
        updateFitnessFileActivityData: vi
          .fn()
          .mockRejectedValue(new Error('connection terminated'))
      })
    )

    const exitCode = await normalizeFitnessActivityTypesScript([
      '--actor-id',
      ACTOR_ID,
      '--apply'
    ])

    expect(exitCode).toBe(1)
    const printed = (
      console.log as unknown as ReturnType<typeof vi.fn>
    ).mock.calls
      .flat()
      .join('\n')
    expect(printed).not.toContain('recreateFitnessRouteHeatmaps')
  })

  it('names only the values a row actually moved away from', async () => {
    // A partially failed run invalidates only the caches whose rows changed.
    mockGetDatabase.mockReturnValue(
      stubDatabase({
        types: ['cycling', 'Biking'],
        updateFitnessFileActivityData: vi
          .fn()
          .mockImplementation((fileId: string) =>
            fileId === 'file-0'
              ? Promise.reject(new Error('deadlock detected'))
              : Promise.resolve(undefined)
          )
      })
    )

    const exitCode = await normalizeFitnessActivityTypesScript([
      '--actor-id',
      ACTOR_ID,
      '--apply'
    ])

    expect(exitCode).toBe(1)
    const printed = (
      console.log as unknown as ReturnType<typeof vi.fn>
    ).mock.calls
      .flat()
      .join('\n')
    const advice = printed.slice(printed.indexOf('route heatmaps cached under'))
    expect(advice).toContain('"Biking"')
    expect(advice).not.toContain('"cycling"')
  })

  it('reports an actor that does not exist rather than scanning', async () => {
    const getFitnessFilesByActor = vi.fn()
    mockGetDatabase.mockReturnValue(
      stubDatabase({
        getActorFromId: vi.fn().mockResolvedValue(null),
        getFitnessFilesByActor
      })
    )

    const exitCode = await normalizeFitnessActivityTypesScript([
      '--actor-id',
      ACTOR_ID
    ])

    expect(exitCode).toBe(1)
    expect(getFitnessFilesByActor).not.toHaveBeenCalled()
  })

  it('closes the database even when the scan throws', async () => {
    const database = stubDatabase({
      getFitnessFilesByActor: vi.fn().mockRejectedValue(new Error('gone'))
    })
    mockGetDatabase.mockReturnValue(database)

    await expect(
      normalizeFitnessActivityTypesScript(['--actor-id', ACTOR_ID])
    ).rejects.toThrow('gone')
    expect(database?.destroy).toHaveBeenCalled()
  })
})

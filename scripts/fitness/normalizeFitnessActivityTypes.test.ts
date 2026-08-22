import { normalizeActivityTypeToSportKey } from '@/lib/services/fitness-files/sportTypes'

import {
  NormalizableFitnessFile,
  parseArgs,
  planActivityTypeNormalization,
  summarizeRewrites
} from './normalizeFitnessActivityTypes'

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

  it('never changes an activity sport key, so gear cannot be reattributed', () => {
    // Auto-assign reads the column through `normalizeActivityTypeToSportKey`,
    // so the rewrite is only safe on live data because every value written is
    // a fixed point of that function. Assert it rather than trust it.
    const raws = [
      'cycling',
      'gravel_cycling',
      'indoor_cycling',
      'mountain_biking',
      'Biking',
      'Ride',
      'GravelRide',
      'VirtualRide',
      'EBikeRide',
      'running',
      'trail_running',
      'walking',
      'hiking'
    ]
    const plan = planActivityTypeNormalization(
      raws.map((raw, index) => file(`file-${index}`, raw))
    )

    expect(plan.rewrites).toHaveLength(raws.length)
    for (const rewrite of plan.rewrites) {
      expect(normalizeActivityTypeToSportKey(rewrite.to)).toBe(
        normalizeActivityTypeToSportKey(rewrite.from)
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

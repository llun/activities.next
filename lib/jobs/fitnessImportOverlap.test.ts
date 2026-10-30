import { FitnessFile } from '@/lib/types/database/fitnessFile'

import {
  FitnessOverlapActivity,
  assignActivitiesToStatusIds,
  getOverlapContextFitnessFileIds,
  groupFitnessActivitiesByOverlap,
  selectMostOverlappingStatusId
} from './fitnessImportOverlap'

describe('groupFitnessActivitiesByOverlap', () => {
  const build = (
    id: string,
    startSeconds: number,
    durationSeconds: number
  ): FitnessOverlapActivity => ({
    id,
    startTimeMs: startSeconds * 1000,
    durationSeconds
  })

  it.each([
    { description: 'there is no overlap', second: build('b', 120, 100) },
    { description: 'overlap is only 50%', second: build('b', 50, 100) }
  ])('does not merge when $description', ({ second }) => {
    const groups = groupFitnessActivitiesByOverlap([build('a', 0, 100), second])

    expect(groups.map((group) => group.map((item) => item.id))).toEqual([
      ['a'],
      ['b']
    ])
  })

  it.each([
    {
      description: 'at the 80% overlap threshold',
      second: build('b', 20, 100)
    },
    { description: 'fully overlapping activities', second: build('b', 0, 100) }
  ])('merges $description', ({ second }) => {
    const groups = groupFitnessActivitiesByOverlap([build('a', 0, 100), second])

    expect(groups).toHaveLength(1)
    expect(groups[0].map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('merges transitively through overlap chain', () => {
    const groups = groupFitnessActivitiesByOverlap([
      build('a', 0, 100),
      build('b', 20, 100),
      build('c', 40, 100),
      build('d', 260, 90)
    ])

    expect(groups.map((group) => group.map((item) => item.id))).toEqual([
      ['a', 'b', 'c'],
      ['d']
    ])
  })
})

describe('selectMostOverlappingStatusId', () => {
  // 2026-10-30 18:09:09 CET: one GPS-less trainer recording covering a short
  // Rouvy warm-up route and the main Rouvy route ridden right after it.
  const indoorStart = Date.parse('2026-10-30T17:09:09.000Z')
  const indoor: FitnessOverlapActivity = {
    id: 'indoor',
    startTimeMs: indoorStart,
    durationSeconds: 6_154
  }
  const pukaki = {
    id: 'pukaki',
    statusId: 'status-pukaki',
    startTimeMs: Date.parse('2026-10-30T17:15:19.000Z'),
    durationSeconds: 161
  }
  const slovenia = {
    id: 'slovenia',
    statusId: 'status-slovenia',
    startTimeMs: Date.parse('2026-10-30T17:20:06.000Z'),
    durationSeconds: 5_428
  }

  it('picks the post the recording shares the most time with', () => {
    expect(
      selectMostOverlappingStatusId({
        activities: [indoor],
        candidates: [pukaki, slovenia]
      })
    ).toBe('status-slovenia')
  })

  it('gives a tie to the first candidate', () => {
    const whole = { id: 'whole', startTimeMs: 0, durationSeconds: 1_200 }
    expect(
      selectMostOverlappingStatusId({
        activities: [whole],
        candidates: [
          { id: 'a', statusId: 'first', startTimeMs: 0, durationSeconds: 600 },
          {
            id: 'b',
            statusId: 'second',
            startTimeMs: 600_000,
            durationSeconds: 600
          }
        ]
      })
    ).toBe('first')
  })

  it('does not count two recordings of the same post twice', () => {
    // The short post has two copies of the same 600 s; the other post has one
    // 900 s file. Summing per file would favour the duplicated post.
    expect(
      selectMostOverlappingStatusId({
        activities: [{ id: 'new', startTimeMs: 0, durationSeconds: 1_800 }],
        candidates: [
          { id: 'a1', statusId: 'short', startTimeMs: 0, durationSeconds: 600 },
          { id: 'a2', statusId: 'short', startTimeMs: 0, durationSeconds: 600 },
          {
            id: 'b',
            statusId: 'long',
            startTimeMs: 900_000,
            durationSeconds: 900
          }
        ]
      })
    ).toBe('long')
  })
})

describe('getOverlapContextFitnessFileIds', () => {
  const baseStart = Date.parse('2026-07-13T05:07:54.000Z')
  const durationSeconds = 5818

  const buildFile = (
    overrides: Partial<FitnessFile> & { id: string }
  ): Pick<
    FitnessFile,
    'id' | 'actorId' | 'statusId' | 'activityStartTime' | 'totalDurationSeconds'
  > => ({
    actorId: 'actor1',
    statusId: 'https://llun.test/users/test1/statuses/good-ride',
    activityStartTime: baseStart,
    totalDurationSeconds: durationSeconds,
    ...overrides
  })

  it('returns the sibling that already owns a status near the activity start', () => {
    expect(
      getOverlapContextFitnessFileIds({
        actorId: 'actor1',
        fitnessFileId: 'orphan',
        activityStartTime: baseStart,
        activityDurationSeconds: durationSeconds,
        files: [buildFile({ id: 'sibling' })]
      })
    ).toEqual(['sibling'])
  })

  it.each([
    ['the file itself', { id: 'orphan' }],
    ['another actor', { id: 'other-actor', actorId: 'actor2' }],
    ['a file without a status', { id: 'orphan-sibling', statusId: null }],
    [
      'a file with no positive duration',
      { id: 'zero-duration', totalDurationSeconds: 0 }
    ],
    [
      'a file far from the activity start',
      {
        id: 'far-away',
        activityStartTime: baseStart + 30 * 24 * 60 * 60 * 1000
      }
    ]
  ])('excludes %s', (_description, overrides) => {
    expect(
      getOverlapContextFitnessFileIds({
        actorId: 'actor1',
        fitnessFileId: 'orphan',
        activityStartTime: baseStart,
        activityDurationSeconds: durationSeconds,
        files: [buildFile(overrides as Partial<FitnessFile> & { id: string })]
      })
    ).toEqual([])
  })
})

describe('assignActivitiesToStatusIds', () => {
  const candidates = [
    {
      id: 'a',
      statusId: 'first',
      startTimeMs: 0,
      durationSeconds: 600
    },
    {
      id: 'b',
      statusId: 'second',
      startTimeMs: 600_000,
      durationSeconds: 1_200
    }
  ]

  it('gives each recording the post it overlaps most', () => {
    const result = assignActivitiesToStatusIds({
      activities: [{ id: 'new', startTimeMs: 0, durationSeconds: 1_800 }],
      candidates
    })
    expect(result.get('new')).toBe('second')
  })

  it('makes a recording with no overlap follow the combined pick', () => {
    const result = assignActivitiesToStatusIds({
      activities: [
        { id: 'covering', startTimeMs: 0, durationSeconds: 1_800 },
        { id: 'detached', startTimeMs: 5_000_000, durationSeconds: 600 }
      ],
      candidates
    })
    expect(result.get('covering')).toBe('second')
    expect(result.get('detached')).toBe('second')
  })

  it('returns null when there is no candidate', () => {
    const result = assignActivitiesToStatusIds({
      activities: [{ id: 'new', startTimeMs: 0, durationSeconds: 600 }],
      candidates: []
    })
    expect(result.get('new')).toBeNull()
  })
})

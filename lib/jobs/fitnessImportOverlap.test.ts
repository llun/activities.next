import { FitnessFile } from '@/lib/types/database/fitnessFile'

import {
  FitnessOverlapActivity,
  getOverlapContextFitnessFileIds,
  groupFitnessActivitiesByOverlap
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

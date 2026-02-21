import {
  FitnessOverlapActivity,
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

  it('does not merge when there is no overlap', () => {
    const groups = groupFitnessActivitiesByOverlap([
      build('a', 0, 100),
      build('b', 120, 100)
    ])

    expect(groups.map((group) => group.map((item) => item.id))).toEqual([
      ['a'],
      ['b']
    ])
  })

  it('does not merge at 50% overlap', () => {
    const groups = groupFitnessActivitiesByOverlap([
      build('a', 0, 100),
      build('b', 50, 100)
    ])

    expect(groups.map((group) => group.map((item) => item.id))).toEqual([
      ['a'],
      ['b']
    ])
  })

  it('merges at 80% overlap threshold', () => {
    const groups = groupFitnessActivitiesByOverlap([
      build('a', 0, 100),
      build('b', 20, 100)
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('merges fully overlapping activities', () => {
    const groups = groupFitnessActivitiesByOverlap([
      build('a', 0, 100),
      build('b', 0, 100)
    ])

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

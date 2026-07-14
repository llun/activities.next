import { FitnessFile } from '@/lib/types/database/fitnessFile'

import { buildStoredImportPlan } from './storedImportPlan'

describe('buildStoredImportPlan', () => {
  const baseStart = Date.parse('2026-07-13T05:07:54.000Z')
  const statusId = 'https://llun.test/users/test1/statuses/good-ride'

  const buildFile = (overrides: Partial<FitnessFile> & { id: string }) =>
    ({
      actorId: 'actor1',
      statusId: null,
      fileName: `${overrides.id}.tcx`,
      activityStartTime: baseStart,
      totalDurationSeconds: 5818,
      ...overrides
    }) as FitnessFile

  const orphan = buildFile({ id: 'orphan', fileName: 'strava-2.tcx' })
  const sibling = buildFile({
    id: 'sibling',
    fileName: 'strava-1.tcx',
    statusId,
    totalDurationSeconds: 5800
  })

  it('merges an orphan into the existing post of its same-ride sibling', () => {
    const plan = buildStoredImportPlan({
      targets: [orphan],
      contextFiles: [sibling]
    })

    expect(plan.overlapFitnessFileIds).toEqual(['sibling'])
    expect(plan.groups).toEqual([
      { targetFileNames: ['strava-2.tcx'], mergeStatusId: statusId }
    ])
  })

  it('creates a new post when the only sibling is a different ride', () => {
    const differentRide = buildFile({
      id: 'different',
      statusId,
      activityStartTime: baseStart + 3 * 60 * 60 * 1000,
      totalDurationSeconds: 1200
    })

    const plan = buildStoredImportPlan({
      targets: [orphan],
      contextFiles: [differentRide]
    })

    expect(plan.groups).toEqual([
      { targetFileNames: ['strava-2.tcx'], mergeStatusId: null }
    ])
  })

  it('gives a target with no usable start time or duration its own post', () => {
    const unparsed = buildFile({
      id: 'unparsed',
      fileName: 'unparsed.tcx',
      activityStartTime: undefined,
      totalDurationSeconds: undefined
    })

    const plan = buildStoredImportPlan({
      targets: [unparsed],
      contextFiles: [sibling]
    })

    expect(plan.groups).toEqual([
      { targetFileNames: ['unparsed.tcx'], mergeStatusId: null }
    ])
  })

  it('merges two orphans of one ride into a single new post', () => {
    const secondOrphan = buildFile({
      id: 'orphan2',
      fileName: 'strava-3.tcx',
      totalDurationSeconds: 5790
    })

    const plan = buildStoredImportPlan({
      targets: [orphan, secondOrphan],
      contextFiles: []
    })

    expect(plan.overlapFitnessFileIds).toEqual([])
    expect(plan.groups).toEqual([
      {
        targetFileNames: ['strava-2.tcx', 'strava-3.tcx'],
        mergeStatusId: null
      }
    ])
  })
})

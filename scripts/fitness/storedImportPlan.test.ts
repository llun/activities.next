import { FitnessFile } from '@/lib/types/database/fitnessFile'

import { buildStoredImportPlan } from './storedImportPlan'

describe('buildStoredImportPlan', () => {
  const baseStart = Date.parse('2026-07-13T05:07:54.000Z')
  const rideSeconds = 5818
  const statusId = 'https://llun.test/users/test1/statuses/good-ride'

  const buildFile = (overrides: Partial<FitnessFile> & { id: string }) =>
    ({
      actorId: 'actor1',
      statusId: null,
      fileName: `${overrides.id}.tcx`,
      ...overrides
    }) as FitnessFile

  // The failed twin. A file that never imported has NO stored activity data —
  // the job parses it, so the plan is built from the parsed values.
  const orphanFile = buildFile({ id: 'orphan', fileName: 'strava-failed.tcx' })
  const orphan = {
    file: orphanFile,
    startTimeMs: baseStart,
    durationSeconds: rideSeconds
  }

  // The successful twin: already owns the post, so it carries stored data.
  const sibling = buildFile({
    id: 'sibling',
    fileName: 'strava-good.tcx',
    statusId,
    activityStartTime: baseStart,
    totalDurationSeconds: 5800
  })

  it('merges an orphan into the existing post of its same-ride sibling', () => {
    const plan = buildStoredImportPlan({
      targets: [orphan],
      contextFiles: [sibling]
    })

    expect(plan.overlapFitnessFileIds).toEqual(['sibling'])
    expect(plan.groups).toEqual([
      { targetFileNames: ['strava-failed.tcx'], mergeStatusId: statusId }
    ])
  })

  it('merges even though the orphan row itself has no stored activity data', () => {
    // Regression: predicting from the row's empty activityStartTime made the dry
    // run report NEW post while the real import merged.
    expect(orphanFile.activityStartTime).toBeUndefined()
    expect(orphanFile.totalDurationSeconds).toBeUndefined()

    const plan = buildStoredImportPlan({
      targets: [orphan],
      contextFiles: [sibling]
    })

    expect(plan.groups[0].mergeStatusId).toBe(statusId)
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
      { targetFileNames: ['strava-failed.tcx'], mergeStatusId: null }
    ])
  })

  it('gives a target with no parsed start time or duration its own post', () => {
    const plan = buildStoredImportPlan({
      targets: [{ file: buildFile({ id: 'unparsed' }) }],
      contextFiles: [sibling]
    })

    expect(plan.groups).toEqual([
      { targetFileNames: ['unparsed.tcx'], mergeStatusId: null }
    ])
  })

  it('reports an unparseable target instead of planning a post for it', () => {
    const plan = buildStoredImportPlan({
      targets: [
        { file: buildFile({ id: 'broken' }), parseError: 'Invalid TCX file' }
      ],
      contextFiles: [sibling]
    })

    expect(plan.groups).toEqual([])
    expect(plan.unparseable).toEqual([
      { fileName: 'broken.tcx', error: 'Invalid TCX file' }
    ])
  })

  it('merges two orphans of one ride into a single new post', () => {
    const secondOrphan = {
      file: buildFile({ id: 'orphan2', fileName: 'strava-3.tcx' }),
      startTimeMs: baseStart,
      durationSeconds: 5790
    }

    const plan = buildStoredImportPlan({
      targets: [orphan, secondOrphan],
      contextFiles: []
    })

    expect(plan.overlapFitnessFileIds).toEqual([])
    expect(plan.groups).toEqual([
      {
        targetFileNames: ['strava-failed.tcx', 'strava-3.tcx'],
        mergeStatusId: null
      }
    ])
  })
})

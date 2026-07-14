import {
  FitnessOverlapActivity,
  getOverlapContextFitnessFileIds,
  groupFitnessActivitiesByOverlap
} from '@/lib/jobs/fitnessImportOverlap'
import { FitnessFile } from '@/lib/types/database/fitnessFile'

export interface StoredImportGroup {
  targetFileNames: string[]
  // The post these targets join. Null means importFitnessFilesJob creates one.
  mergeStatusId: string | null
}

export interface StoredImportPlan {
  overlapFitnessFileIds: string[]
  groups: StoredImportGroup[]
}

const toOverlapActivity = (
  file: FitnessFile
): FitnessOverlapActivity | null => {
  if (
    typeof file.activityStartTime !== 'number' ||
    typeof file.totalDurationSeconds !== 'number' ||
    file.totalDurationSeconds <= 0
  ) {
    return null
  }

  return {
    id: file.id,
    startTimeMs: file.activityStartTime,
    durationSeconds: file.totalDurationSeconds
  }
}

/**
 * Works out — without touching the database — which orphaned targets join an
 * existing post and which need a new one, mirroring how importFitnessFilesJob
 * groups them.
 *
 * `overlapFitnessFileIds` is the sibling context handed to that job: files that
 * ALREADY own a status. When a target overlaps one of them by >=80% on start +
 * duration, the job reuses the sibling's status (the sibling stays primary and
 * keeps its route map) instead of creating a duplicate post for the same ride.
 */
export const buildStoredImportPlan = ({
  targets,
  contextFiles
}: {
  targets: FitnessFile[]
  contextFiles: FitnessFile[]
}): StoredImportPlan => {
  const overlapFitnessFileIds = [
    ...new Set(
      targets.flatMap((target) =>
        getOverlapContextFitnessFileIds({
          actorId: target.actorId,
          fitnessFileId: target.id,
          activityDurationSeconds: target.totalDurationSeconds ?? 0,
          files: contextFiles,
          ...(typeof target.activityStartTime === 'number'
            ? { activityStartTime: target.activityStartTime }
            : null)
        })
      )
    )
  ]

  const targetById = new Map(targets.map((file) => [file.id, file]))
  const siblingById = new Map(
    contextFiles
      .filter((file) => overlapFitnessFileIds.includes(file.id))
      .map((file) => [file.id, file])
  )

  const activities = [...targets, ...siblingById.values()]
    .map(toOverlapActivity)
    .filter((activity): activity is FitnessOverlapActivity => activity !== null)

  const groups: StoredImportGroup[] = []
  for (const group of groupFitnessActivitiesByOverlap(activities, 0.8)) {
    const groupTargets = group
      .map((activity) => targetById.get(activity.id))
      .filter((file): file is FitnessFile => Boolean(file))

    // A group of siblings only, with no target in it, is an existing post that
    // this run does not touch.
    if (groupTargets.length === 0) continue

    const mergeStatusId =
      group
        .map((activity) => siblingById.get(activity.id))
        .find((file) => file?.statusId)?.statusId ?? null

    groups.push({
      targetFileNames: groupTargets.map((file) => file.fileName),
      mergeStatusId
    })
  }

  // A target the import could not parse a start time or duration for cannot be
  // grouped at all, so it always becomes its own post.
  for (const target of targets) {
    if (toOverlapActivity(target)) continue
    groups.push({ targetFileNames: [target.fileName], mergeStatusId: null })
  }

  return { overlapFitnessFileIds, groups }
}

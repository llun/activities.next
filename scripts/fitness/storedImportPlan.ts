import {
  FitnessOverlapActivity,
  getOverlapContextFitnessFileIds,
  groupFitnessActivitiesByOverlap
} from '@/lib/jobs/fitnessImportOverlap'
import { FitnessFile } from '@/lib/types/database/fitnessFile'

/**
 * A file to recover, with the activity data importFitnessFilesJob will see.
 *
 * The job PARSES each target before grouping it, so the plan must be built from
 * the parsed values, not the row's stored ones: a file that failed to import
 * never got activity data written, so its stored start time and duration are
 * empty and would make it look ungroupable. `parseError` marks a target the job
 * will reject outright.
 */
export interface StoredImportTarget {
  file: FitnessFile
  startTimeMs?: number
  durationSeconds?: number
  parseError?: string
}

export interface StoredImportGroup {
  targetFileNames: string[]
  // The post these targets join. Null means importFitnessFilesJob creates one.
  mergeStatusId: string | null
}

export interface StoredImportPlan {
  overlapFitnessFileIds: string[]
  groups: StoredImportGroup[]
  unparseable: { fileName: string; error: string }[]
}

const toOverlapActivity = (
  target: StoredImportTarget
): FitnessOverlapActivity | null => {
  if (
    typeof target.startTimeMs !== 'number' ||
    typeof target.durationSeconds !== 'number' ||
    target.durationSeconds <= 0
  ) {
    return null
  }

  return {
    id: target.file.id,
    startTimeMs: target.startTimeMs,
    durationSeconds: target.durationSeconds
  }
}

/**
 * Works out — without writing anything — which targets join an existing post and
 * which need a new one, mirroring how importFitnessFilesJob groups them.
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
  targets: StoredImportTarget[]
  contextFiles: FitnessFile[]
}): StoredImportPlan => {
  const importable = targets.filter((target) => !target.parseError)

  const overlapFitnessFileIds = [
    ...new Set(
      importable.flatMap((target) =>
        getOverlapContextFitnessFileIds({
          actorId: target.file.actorId,
          fitnessFileId: target.file.id,
          activityDurationSeconds: target.durationSeconds ?? 0,
          files: contextFiles,
          ...(typeof target.startTimeMs === 'number'
            ? { activityStartTime: target.startTimeMs }
            : null)
        })
      )
    )
  ]

  const targetById = new Map(
    importable.map((target) => [target.file.id, target.file])
  )
  const siblingById = new Map(
    contextFiles
      .filter((file) => overlapFitnessFileIds.includes(file.id))
      .map((file) => [file.id, file])
  )

  const siblingActivities = [...siblingById.values()]
    .map((file) =>
      toOverlapActivity({
        file,
        ...(typeof file.activityStartTime === 'number'
          ? { startTimeMs: file.activityStartTime }
          : null),
        ...(typeof file.totalDurationSeconds === 'number'
          ? { durationSeconds: file.totalDurationSeconds }
          : null)
      })
    )
    .filter((activity): activity is FitnessOverlapActivity => activity !== null)

  const activities = [
    ...importable
      .map(toOverlapActivity)
      .filter(
        (activity): activity is FitnessOverlapActivity => activity !== null
      ),
    ...siblingActivities
  ]

  const groups: StoredImportGroup[] = []
  for (const group of groupFitnessActivitiesByOverlap(activities, 0.8)) {
    const groupTargets = group
      .map((activity) => targetById.get(activity.id))
      .filter((file): file is FitnessFile => Boolean(file))

    // A group of siblings only, with no target in it, is an existing post this
    // run does not touch.
    if (groupTargets.length === 0) continue

    // The job picks the status from `orderedGroup`, which sortFilesByActivityStart
    // orders by start time then createdAt then id. Mirror that ordering, or a
    // group holding two siblings with DIFFERENT statuses (the duplicate-post case
    // this script repairs) would predict one post and merge into the other.
    const mergeStatusId =
      group
        .map((activity) => siblingById.get(activity.id))
        .filter((file): file is FitnessFile => Boolean(file?.statusId))
        .sort((first, second) => {
          const firstStart = first.activityStartTime ?? Number.MAX_SAFE_INTEGER
          const secondStart =
            second.activityStartTime ?? Number.MAX_SAFE_INTEGER
          if (firstStart !== secondStart) return firstStart - secondStart
          if (first.createdAt !== second.createdAt)
            return first.createdAt - second.createdAt
          return first.id.localeCompare(second.id)
        })[0]?.statusId ?? null

    groups.push({
      targetFileNames: groupTargets.map((file) => file.fileName),
      mergeStatusId
    })
  }

  // A target the parse found no start time or duration for cannot be grouped at
  // all, so the job always gives it its own post.
  for (const target of importable) {
    if (toOverlapActivity(target)) continue
    groups.push({
      targetFileNames: [target.file.fileName],
      mergeStatusId: null
    })
  }

  return {
    overlapFitnessFileIds,
    groups,
    unparseable: targets
      .filter((target) => target.parseError)
      .map((target) => ({
        fileName: target.file.fileName,
        error: target.parseError as string
      }))
  }
}

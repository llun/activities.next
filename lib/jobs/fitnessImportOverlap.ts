import { FitnessFile } from '@/lib/types/database/fitnessFile'

export interface FitnessOverlapActivity {
  id: string
  startTimeMs: number
  durationSeconds: number
}

/**
 * Recent-file window scanned for a same-ride sibling. One ride recorded on two
 * devices arrives as two activities moments apart, so the sibling is always
 * among the actor's most recent files.
 */
export const OVERLAP_CONTEXT_SCAN_LIMIT = 200

type OverlapContextFile = Pick<
  FitnessFile,
  'id' | 'actorId' | 'statusId' | 'activityStartTime' | 'totalDurationSeconds'
>

/**
 * Picks the actor's other fitness files that ALREADY own a status and sit near
 * this activity in time — the same-ride candidates. This only narrows the field;
 * the >=80% overlap decision belongs to `groupFitnessActivitiesByOverlap` via
 * importFitnessFilesJob, which uses these as `overlapFitnessFileIds` to merge a
 * file into an existing post instead of creating a duplicate one.
 */
export const getOverlapContextFitnessFileIds = ({
  actorId,
  fitnessFileId,
  activityStartTime,
  activityDurationSeconds,
  files
}: {
  actorId: string
  fitnessFileId: string
  activityStartTime?: number
  activityDurationSeconds: number
  files: OverlapContextFile[]
}) => {
  const sameActorFiles = files.filter(
    (
      file
    ): file is OverlapContextFile & {
      statusId: string
      activityStartTime: number
      totalDurationSeconds: number
    } =>
      file.actorId === actorId &&
      file.id !== fitnessFileId &&
      typeof file.statusId === 'string' &&
      typeof file.activityStartTime === 'number' &&
      typeof file.totalDurationSeconds === 'number' &&
      file.totalDurationSeconds > 0
  )

  if (
    typeof activityStartTime !== 'number' ||
    !Number.isFinite(activityStartTime) ||
    activityDurationSeconds <= 0
  ) {
    return sameActorFiles.map((file) => file.id)
  }

  // Keep overlap candidates close to the new activity's start time.
  const shortPeriodWindowMs = Math.max(
    activityDurationSeconds * 1000 * 2,
    60 * 60 * 1000
  )

  return sameActorFiles
    .filter((file) => {
      const existingStartTime = file.activityStartTime
      return (
        Math.abs(existingStartTime - activityStartTime) <= shortPeriodWindowMs
      )
    })
    .map((file) => file.id)
}

const getOverlapRatio = (
  first: FitnessOverlapActivity,
  second: FitnessOverlapActivity
) => {
  const firstDurationMs = Math.max(0, first.durationSeconds) * 1000
  const secondDurationMs = Math.max(0, second.durationSeconds) * 1000

  if (firstDurationMs <= 0 || secondDurationMs <= 0) {
    return 0
  }

  const firstEnd = first.startTimeMs + firstDurationMs
  const secondEnd = second.startTimeMs + secondDurationMs
  const overlapStart = Math.max(first.startTimeMs, second.startTimeMs)
  const overlapEnd = Math.min(firstEnd, secondEnd)
  const overlapDuration = Math.max(0, overlapEnd - overlapStart)

  if (overlapDuration <= 0) {
    return 0
  }

  const shortestDuration = Math.min(firstDurationMs, secondDurationMs)
  return overlapDuration / shortestDuration
}

class UnionFind {
  private readonly parent: number[]
  private readonly rank: number[]

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index)
    this.rank = Array.from({ length: size }, () => 0)
  }

  find(index: number): number {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index])
    }

    return this.parent[index]
  }

  union(first: number, second: number): void {
    const firstRoot = this.find(first)
    const secondRoot = this.find(second)

    if (firstRoot === secondRoot) return

    if (this.rank[firstRoot] < this.rank[secondRoot]) {
      this.parent[firstRoot] = secondRoot
      return
    }

    if (this.rank[firstRoot] > this.rank[secondRoot]) {
      this.parent[secondRoot] = firstRoot
      return
    }

    this.parent[secondRoot] = firstRoot
    this.rank[firstRoot] += 1
  }
}

export const groupFitnessActivitiesByOverlap = (
  activities: FitnessOverlapActivity[],
  threshold = 0.8
): FitnessOverlapActivity[][] => {
  if (activities.length === 0) {
    return []
  }

  const unionFind = new UnionFind(activities.length)

  for (let firstIndex = 0; firstIndex < activities.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < activities.length;
      secondIndex += 1
    ) {
      const ratio = getOverlapRatio(
        activities[firstIndex],
        activities[secondIndex]
      )
      if (ratio >= threshold) {
        unionFind.union(firstIndex, secondIndex)
      }
    }
  }

  const groupedByRoot = new Map<number, FitnessOverlapActivity[]>()
  activities.forEach((activity, index) => {
    const root = unionFind.find(index)
    const existing = groupedByRoot.get(root) ?? []
    existing.push(activity)
    groupedByRoot.set(root, existing)
  })

  return [...groupedByRoot.values()]
    .map((group) =>
      group.sort((first, second) => {
        if (first.startTimeMs === second.startTimeMs) {
          return first.id.localeCompare(second.id)
        }
        return first.startTimeMs - second.startTimeMs
      })
    )
    .sort((first, second) => {
      const firstStart = first[0]?.startTimeMs ?? Number.MAX_SAFE_INTEGER
      const secondStart = second[0]?.startTimeMs ?? Number.MAX_SAFE_INTEGER
      return firstStart - secondStart
    })
}

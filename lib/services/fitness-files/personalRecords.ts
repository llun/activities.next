import type { Database } from '@/lib/database/types'
import {
  BEST_EFFORT_DURATIONS,
  type FitnessRecordEntry,
  type FitnessRecords,
  type FitnessRecordsRange,
  RUN_EFFORT_DISTANCES
} from '@/lib/fitness/bestEfforts'
import { getActivityTitle } from '@/lib/services/fitness-files/activityTitle'
import { StatusType } from '@/lib/types/domain/status'
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Where a range starts: nothing for all time, 1 January (UTC) of the current
 * year, or 90 days back from now.
 */
export const getRecordsRangeStart = (
  range: FitnessRecordsRange,
  now: number
): number | null => {
  if (range === 'year') return Date.UTC(new Date(now).getUTCFullYear(), 0, 1)
  if (range === '90d') return now - 90 * DAY_MS
  return null
}

/**
 * The actor's own records over a range: every power duration and run distance
 * in order, each with its best value and the post it came from, or nulls when
 * nothing in the range has one. Owner-only by construction: it reads the
 * actor's own efforts and links only posts the actor wrote.
 */
export const getFitnessRecords = async (
  database: Pick<Database, 'getFitnessPersonalRecords' | 'getStatusesByIds'>,
  {
    actorId,
    range,
    now = Date.now()
  }: { actorId: string; range: FitnessRecordsRange; now?: number }
): Promise<FitnessRecords> => {
  const records = await database.getFitnessPersonalRecords({
    actorId,
    since: getRecordsRangeStart(range, now)
  })
  const statusIds = [...new Set(records.map((record) => record.statusId))]
  // The owner reads their own posts whatever their visibility, as the
  // calendar day details do.
  const statuses =
    statusIds.length > 0
      ? await database.getStatusesByIds({
          statusIds,
          currentActorId: actorId,
          withReplies: false
        })
      : []
  const statusesById = new Map(statuses.map((status) => [status.id, status]))

  const toEntries = (
    kind: 'power' | 'distance',
    keys: number[]
  ): FitnessRecordEntry[] =>
    keys.map((key) => {
      const record = records.find(
        (item) => item.kind === kind && item.key === key
      )
      const post = record ? statusesById.get(record.statusId) : undefined
      if (
        !record ||
        !post ||
        post.actorId !== actorId ||
        post.type === StatusType.enum.Announce
      ) {
        return { key, value: null, activity: null }
      }
      const statusPath = getStatusDetailPath(post)
      if (!statusPath) return { key, value: null, activity: null }
      return {
        key,
        value: record.value,
        activity: {
          statusId: post.id,
          statusPath,
          title: getActivityTitle({
            postSummary: post.summary,
            postText: post.text,
            description: record.description,
            fileName: record.fileName
          }),
          activityDate: record.activityDate
        }
      }
    })

  return {
    range,
    power: toEntries('power', BEST_EFFORT_DURATIONS),
    distance: toEntries('distance', RUN_EFFORT_DISTANCES)
  }
}

/**
 * For each of a post's files, the power durations where the file's own effort
 * equals the owner's all-time best: the activity page's PR badges. Read only
 * for the owner, and nothing else from the records leaves the server.
 */
export const getPersonalRecordDurations = async (
  database: Pick<
    Database,
    'getFitnessPersonalRecords' | 'getFitnessBestEfforts'
  >,
  { actorId, fitnessFileIds }: { actorId: string; fitnessFileIds: string[] }
): Promise<Record<string, number[]>> => {
  if (fitnessFileIds.length === 0) return {}
  const [records, efforts] = await Promise.all([
    database.getFitnessPersonalRecords({ actorId }),
    database.getFitnessBestEfforts({ fitnessFileIds })
  ])
  const result: Record<string, number[]> = {}
  for (const effort of efforts) {
    if (effort.kind !== 'power') continue
    const best = records.find(
      (record) => record.kind === 'power' && record.key === effort.key
    )
    if (!best || effort.value !== best.value) continue
    ;(result[effort.fitnessFileId] ??= []).push(effort.key)
  }
  return result
}

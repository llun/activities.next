import { z } from 'zod'

import { getMoveActivity } from '@/lib/activities/move'
import { Database } from '@/lib/database/types'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { isOutgoingMoveAuthorized } from '@/lib/jobs/isOutgoingMoveAuthorized'
import { getMoveFollowerJobId } from '@/lib/jobs/moveFollowerJob'
import { publishMoveRelationshipsJobs } from '@/lib/jobs/moveRelationshipsJob'
import {
  DELIVER_ACTIVITY_JOB_NAME,
  MOVE_FOLLOWER_JOB_NAME,
  SEND_MOVE_JOB_NAME
} from '@/lib/jobs/names'
import {
  MAX_CONCURRENT_DELIVERY_PUBLICATIONS,
  getDeliveryJobId,
  runWithConcurrencyLimit
} from '@/lib/jobs/sendNoteJob'
import { filterFederatedUrls } from '@/lib/services/federation/domainPolicy'
import { getQueue } from '@/lib/services/queue'
import { JobHandle, JobMessage } from '@/lib/services/queue/type'
import { withSpan } from '@/lib/utils/trace'

const JobData = z.object({
  migrationId: z.string(),
  originActorId: z.string(),
  targetActorId: z.string(),
  // The last follow id of the previous slice (followers are paged by id).
  cursor: z.string().optional()
})

// A run stops after the page that crosses this budget and hands the rest to a
// continuation, like bulkImportJob (QStash caps a job at 30s).
export const SEND_MOVE_JOB_TIME_BUDGET_MS = 20_000
const FOLLOWER_PAGE_SIZE = 100

export const getSendMoveContinueJobId = (migrationId: string, cursor: string) =>
  `${migrationId}:continue:${cursor}`

// Mastodon MoveService: MoveWorker for the origin's local followers (every
// target, local or remote) and MoveDistributionWorker for the Move sent to each
// remote follower inbox. Every published job id is deterministic, so a retry,
// or a republished page, is harmless. Deliveries are keyed on the migration
// rather than the slice, so a shared inbox seen on several pages gets one Move.
export const runSendMove = async (
  database: Database,
  message: JobMessage,
  {
    budgetMs = SEND_MOVE_JOB_TIME_BUDGET_MS,
    pageSize = FOLLOWER_PAGE_SIZE
  } = {}
): Promise<void> => {
  const deadline = Date.now() + budgetMs
  await withSpan('job', 'sendMove', {}, async (span) => {
    const parsed = JobData.safeParse(message.data)
    if (!parsed.success) {
      span.recordException(new Error('Malformed send move job data'))
      return
    }
    const { migrationId, originActorId, targetActorId } = parsed.data
    span.setAttribute('actorId', originActorId)

    const [origin, target] = await Promise.all([
      database.getActorFromId({ id: originActorId }),
      database.getActorFromId({ id: targetActorId })
    ])
    if (!origin?.privateKey || !target) return
    // A started move completes even if DELETE cleared `movedTo` since.
    if (
      !(await isOutgoingMoveAuthorized(
        database,
        origin,
        target.id,
        migrationId
      ))
    ) {
      return
    }

    const queue = getQueue()
    const activity = getMoveActivity({
      migrationId,
      originActorId: origin.id,
      targetActorId: target.id
    })
    let cursor = parsed.data.cursor

    if (!cursor) {
      const failures = await publishMoveRelationshipsJobs({
        database,
        originActorId: origin.id,
        targetActorId: target.id,
        migrationId
      })
      if (failures > 0) {
        throw new Error(
          `Move: ${failures} relationship carryover job(s) could not be queued`
        )
      }
    }

    for (;;) {
      const follows = await database.getFollowers({
        targetActorId: origin.id,
        limit: pageSize,
        maxId: cursor
      })
      if (follows.length === 0) return

      const actors = await database.getActorsFromIds({
        ids: [...new Set(follows.map((follow) => follow.actorId))]
      })
      const localIds = new Set(
        actors.filter((actor) => actor.privateKey).map((actor) => actor.id)
      )
      const localFollows = follows.filter((follow) =>
        localIds.has(follow.actorId)
      )
      const inboxes = await filterFederatedUrls(database, [
        ...new Set(
          follows
            .filter((follow) => !localIds.has(follow.actorId))
            .map((follow) => follow.sharedInbox || follow.inbox)
        )
      ])

      // A target that has itself moved on is not followed (as MoveActorJob).
      const rewire = target.movedTo ? [] : localFollows
      const jobs: JobMessage[] = [
        ...rewire.map((follow) => ({
          id: getMoveFollowerJobId(follow.id, target.id),
          name: MOVE_FOLLOWER_JOB_NAME,
          data: {
            followId: follow.id,
            targetActorId: target.id,
            migrationId
          }
        })),
        ...inboxes.map((inbox) => ({
          id: getDeliveryJobId(migrationId, inbox),
          name: DELIVER_ACTIVITY_JOB_NAME,
          data: { inbox, actorId: origin.id, activity }
        }))
      ]
      const results = await runWithConcurrencyLimit(
        jobs,
        MAX_CONCURRENT_DELIVERY_PUBLICATIONS,
        (job) => queue.publish(job)
      )
      const errors = results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected'
        )
        .map((result) =>
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason))
        )
      if (errors.length > 0) {
        // The in-process queue ran each job inline: one failing must not
        // block the rest. A real queue refused the job, so retry the page.
        if (!queue.runsInline) {
          throw new AggregateError(
            errors,
            `Failed to publish ${errors.length} move jobs`
          )
        }
        errors.forEach((error) => span.recordException(error))
      }

      cursor = follows[follows.length - 1].id
      if (follows.length < pageSize) return
      if (Date.now() >= deadline) {
        await queue.publish({
          id: getSendMoveContinueJobId(migrationId, cursor),
          name: SEND_MOVE_JOB_NAME,
          data: { migrationId, originActorId, targetActorId, cursor }
        })
        return
      }
    }
  })
}

export const sendMoveJob: JobHandle = createJobHandle(
  SEND_MOVE_JOB_NAME,
  (database, message) => runSendMove(database, message)
)

import { z } from 'zod'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { getQueue } from '@/lib/services/queue'
import { getAttachmentsFromMediaIds } from '@/lib/services/statuses/mediaIds'
import { scheduledDelaySeconds } from '@/lib/services/statuses/scheduledStatusSerializer'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { PUBLISH_SCHEDULED_STATUS_JOB_NAME } from './names'

// Publishes a stored scheduled status once its time arrives.
//
// Scheduling backends differ: QStash supports native message delays, so the
// enqueue carries `delaySeconds` and QStash fires the job at the right time.
// When QStash invokes the job the scheduled time has effectively arrived, so the
// time guard below is false and the status publishes. If the job ever runs early
// (clock skew, a manual replay), the >60s guard re-enqueues it with the
// remaining delay instead of posting ahead of time. The in-process NoQueue has
// no scheduler and drops delayed messages outright (see noqueue.ts), so under
// NoQueue scheduled statuses do not auto-fire and this job never recurses.
const PublishScheduledStatusData = z.object({
  scheduledStatusId: z.string(),
  // The scheduledAt this job was enqueued for. When the row has since been
  // rescheduled to a different time, the job is obsolete and discarded so a
  // reschedule-to-later does not leave the old job racing the new one.
  scheduledAt: z.number().optional()
})

// A job that fires more than this far before the scheduled time is treated as
// premature and re-enqueued instead of publishing.
const EARLY_THRESHOLD_MS = 60_000

export const publishScheduledStatusJob = createJobHandle(
  PUBLISH_SCHEDULED_STATUS_JOB_NAME,
  async (database, message) => {
    const parsed = PublishScheduledStatusData.safeParse(message.data)
    if (!parsed.success) return

    const { scheduledStatusId, scheduledAt } = parsed.data
    const row = await database.getScheduledStatusById({ id: scheduledStatusId })
    // Already published or deleted: nothing to do.
    if (!row) return

    // Obsolete job: the row was rescheduled to a different time after this job
    // was enqueued. Discard it so a reschedule-to-later does not leave the old
    // job (which would otherwise re-enqueue itself) racing the new one at the
    // new time. The current schedule's own job still fires.
    if (scheduledAt !== undefined && row.scheduledAt !== scheduledAt) return

    // Too early: re-enqueue with the remaining delay and skip publishing. This
    // is the path the in-process NoQueue always takes (it ignores delays).
    const remainingMs = row.scheduledAt - Date.now()
    if (remainingMs > EARLY_THRESHOLD_MS) {
      // Use a distinct dedup id from the original create/reschedule enqueue
      // (which is `${id}-${scheduledAt}`). QStash keeps the dedup window open
      // for ~1h even after a message is consumed, so reusing the same id here
      // would let QStash silently drop this re-enqueue and the status would
      // never fire. The payload carries the current scheduledAt so the
      // re-enqueued job stays valid against the obsolete-job check above.
      await getQueue().publish({
        id: getHashFromString(`${row.id}-${row.scheduledAt}-reenqueue`),
        name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
        data: { scheduledStatusId: row.id, scheduledAt: row.scheduledAt },
        delaySeconds: scheduledDelaySeconds(row.scheduledAt)
      })
      return
    }

    const actor = await database.getActorFromId({ id: row.actorId })
    // Actor gone: drop the orphaned scheduled row, nothing to publish.
    if (!actor) {
      logger.warn(
        { scheduledStatusId: row.id, actorId: row.actorId },
        'publishScheduledStatusJob: actor missing, dropping scheduled status'
      )
      await database.deleteScheduledStatus({ id: row.id, actorId: row.actorId })
      return
    }

    const { params } = row
    // Fall back to a key derived from the row id when the client supplied no
    // Idempotency-Key, so the job is idempotent by default: if it is retried
    // after the status was created but before the row was deleted, the retry
    // finds the existing mapping below and skips re-publishing rather than
    // posting a duplicate.
    const idempotencyKey = params.idempotency?.trim() || `scheduled-${row.id}`

    // Honor the Idempotency-Key the same way the POST route does: a key that
    // already maps to a status means this scheduled post was published already,
    // so just clean up the row.
    const existingStatusId = await database.getIdempotentStatusId({
      actorId: row.actorId,
      key: idempotencyKey
    })
    if (existingStatusId) {
      await database.deleteScheduledStatus({
        id: row.id,
        actorId: row.actorId
      })
      return
    }

    // Re-resolve the OAuth client stored at schedule time so the published
    // status keeps the same "posted via …" application attribution.
    const client = params.application_id
      ? await database.getClientFromId({ clientId: params.application_id })
      : null
    const application = client?.name
      ? { name: client.name, website: client.website ?? null }
      : undefined

    let status
    if (params.poll) {
      status = await createPollFromUserInput({
        text: params.text,
        summary: params.spoiler_text ?? undefined,
        replyStatusId: params.in_reply_to_id ?? undefined,
        currentActor: actor,
        choices: params.poll.options,
        endAt: Date.now() + params.poll.expires_in * 1000,
        pollType: params.poll.multiple ? 'anyOf' : 'oneOf',
        visibility: params.visibility,
        sensitive: params.sensitive ?? false,
        language: params.language ?? null,
        application,
        database
      })
    } else {
      const mediaIds = params.media_ids ?? []
      const attachments = await getAttachmentsFromMediaIds(
        database,
        actor,
        mediaIds
      )
      // Media that no longer resolves (deleted before the status fired) aborts
      // the publish but still clears the row so it is not retried forever.
      if (!attachments) {
        logger.warn(
          { scheduledStatusId: row.id, actorId: row.actorId },
          'publishScheduledStatusJob: media unresolved, dropping scheduled status'
        )
        await database.deleteScheduledStatus({
          id: row.id,
          actorId: row.actorId
        })
        return
      }
      status = await createNoteFromUserInput({
        currentActor: actor,
        text: params.text,
        summary: params.spoiler_text ?? undefined,
        replyNoteId: params.in_reply_to_id ?? undefined,
        visibility: params.visibility,
        attachments,
        sensitive: params.sensitive ?? false,
        language: params.language ?? null,
        application,
        database
      })
    }

    if (status) {
      await database.saveIdempotencyKey({
        actorId: row.actorId,
        key: idempotencyKey,
        statusId: status.id
      })
    }

    if (status) {
      logger.info(
        { statusId: status.id, scheduledStatusId: row.id },
        'publishScheduledStatusJob: published scheduled status'
      )
    } else {
      // createNote/createPoll returns null for an unpublishable status (e.g. a
      // direct-visibility post with no resolvable mentions). Drop the row like
      // the other terminal cases, but warn so it is not lost silently.
      logger.warn(
        { scheduledStatusId: row.id, actorId: row.actorId },
        'publishScheduledStatusJob: status creation returned null, dropping scheduled status'
      )
    }

    await database.deleteScheduledStatus({ id: row.id, actorId: row.actorId })
  }
)

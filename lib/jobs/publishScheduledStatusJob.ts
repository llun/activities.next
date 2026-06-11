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
  scheduledStatusId: z.string()
})

// A job that fires more than this far before the scheduled time is treated as
// premature and re-enqueued instead of publishing.
const EARLY_THRESHOLD_MS = 60_000

export const publishScheduledStatusJob = createJobHandle(
  PUBLISH_SCHEDULED_STATUS_JOB_NAME,
  async (database, message) => {
    const parsed = PublishScheduledStatusData.safeParse(message.data)
    if (!parsed.success) return

    const { scheduledStatusId } = parsed.data
    const row = await database.getScheduledStatusById({ id: scheduledStatusId })
    // Already published or deleted: nothing to do.
    if (!row) return

    // Too early: re-enqueue with the remaining delay and skip publishing. This
    // is the path the in-process NoQueue always takes (it ignores delays).
    const remainingMs = row.scheduledAt - Date.now()
    if (remainingMs > EARLY_THRESHOLD_MS) {
      await getQueue().publish({
        id: getHashFromString(`${row.id}-${row.scheduledAt}`),
        name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
        data: { scheduledStatusId: row.id },
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
    const idempotencyKey = params.idempotency?.trim() || null

    // Honor the stored Idempotency-Key the same way the POST route does: a key
    // that already maps to a status means this scheduled post was published
    // already, so just clean up the row.
    if (idempotencyKey) {
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
    }

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
        database
      })
    }

    if (status && idempotencyKey) {
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
    }

    await database.deleteScheduledStatus({ id: row.id, actorId: row.actorId })
  }
)

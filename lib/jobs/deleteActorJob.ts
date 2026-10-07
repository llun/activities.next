import { SpanStatusCode } from '@opentelemetry/api'
import { z } from 'zod'

import { deleteActor } from '@/lib/activities'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import {
  MAX_CONCURRENT_DELIVERY_PUBLICATIONS,
  runWithConcurrencyLimit
} from '@/lib/jobs/sendNoteJob'
import { sendMail } from '@/lib/services/email'
import { buildActorDeletedEmail } from '@/lib/services/email/templates/actorDeleted'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { getQueue } from '@/lib/services/queue'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

import { createJobHandle } from './createJobHandle'
import { DELETE_ACTOR_JOB_NAME } from './names'

const DeleteActorJobData = z.object({
  actorId: z.string(),
  // The `deletionScheduledAt` (epoch ms) the job was queued for. A job whose
  // value no longer matches the actor's was made obsolete by a cancel followed
  // by a new schedule, and is discarded.
  scheduledAt: z.number().optional()
})

// Tell remote servers the account is gone, so they drop its profile, posts
// and follow relationships instead of keeping a copy that only expires when
// a fetch finally answers 410. Reaches followers and accepted relays, the
// audience Mastodon uses. The Delete must be signed with the actor's key,
// which `deleteActorData` removes with the row, so the sends happen here and
// now rather than as queued deliveries that would find no key on retry.
// Best effort: a failure is logged and never stops the local deletion.
const federateActorDeletion = async (database: Database, actor: Actor) => {
  if (!actor.privateKey) return
  try {
    const [inboxes, localFollows] = await Promise.all([
      getFederatedStatusDeliveryInboxes({
        database,
        currentActor: actor,
        status: { to: [ACTIVITY_STREAM_PUBLIC], cc: [actor.followersUrl] }
      }),
      database.getLocalFollowersForActorId({ targetActorId: actor.id })
    ])
    // A local follower's inbox is this server. Delivering there would run the
    // inbound actor delete on the row this job is still emptying.
    const localInboxes = new Set(
      localFollows.flatMap((follow) =>
        [follow.inbox, follow.sharedInbox].filter(Boolean)
      )
    )
    const remoteInboxes = inboxes.filter((inbox) => !localInboxes.has(inbox))
    const results = await runWithConcurrencyLimit(
      remoteInboxes,
      MAX_CONCURRENT_DELIVERY_PUBLICATIONS,
      (inbox) => deleteActor({ currentActor: actor, inbox })
    )
    const delivered = results.filter(
      (result) => result.status === 'fulfilled' && result.value
    ).length
    logger.info({
      message: 'Federated actor deletion',
      actorId: actor.id,
      inboxCount: remoteInboxes.length,
      deliveredCount: delivered
    })
  } catch (err) {
    logger.error({
      message: 'Failed to federate actor deletion',
      actorId: actor.id,
      err: toLoggableError(err)
    })
  }
}

export const deleteActorJob = createJobHandle(
  DELETE_ACTOR_JOB_NAME,
  async (database, message) => {
    return withSpan('job', 'deleteActor', {}, async (span) => {
      logger.info({
        message: 'Delete actor job started',
        messageId: message.id,
        data: message.data
      })

      let data
      try {
        data = DeleteActorJobData.parse(message.data)
      } catch (err) {
        logger.error({
          message: 'Invalid delete actor job data',
          messageId: message.id,
          data: message.data,
          err: toLoggableError(err)
        })
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'Invalid job data'
        })
        span.recordException(
          err instanceof Error ? err : new Error(String(err))
        )
        throw err
      }

      const { actorId } = data
      span.setAttribute('actorId', actorId)
      logger.info({
        message: 'Processing delete actor job',
        actorId
      })

      // Get the actor before deletion to use for email
      let actor
      try {
        actor = await database.getActorFromId({ id: actorId })
        logger.debug({
          message: 'Retrieved actor for deletion',
          actorId,
          found: !!actor
        })
      } catch (err) {
        logger.error({
          message: 'Failed to get actor for deletion',
          actorId,
          err: toLoggableError(err)
        })
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'Failed to get actor'
        })
        span.recordException(
          err instanceof Error ? err : new Error(String(err))
        )
        throw err
      }

      if (!actor) {
        logger.warn({
          message: 'Actor not found for deletion job',
          actorId
        })
        span.setStatus({ code: SpanStatusCode.OK, message: 'Actor not found' })
        return
      }

      // Check if deletion was cancelled before proceeding
      if (actor.deletionStatus !== 'scheduled') {
        logger.info({
          message: 'Actor deletion was cancelled or already processed',
          actorId,
          currentStatus: actor.deletionStatus
        })
        span.setStatus({
          code: SpanStatusCode.OK,
          message: 'Deletion cancelled or processed'
        })
        return
      }

      // A delayed deletion must not run before its time: a job can be delivered
      // early (clock skew, a manual replay), and one queued for an earlier
      // schedule must not carry out a later one. Immediate deletions have no
      // `deletionScheduledAt` and fall straight through.
      const deletionStatus = await database.getActorDeletionStatus({
        id: actorId
      })
      const dueAt = deletionStatus?.scheduledAt ?? null
      if (
        data.scheduledAt !== undefined &&
        dueAt !== null &&
        // A second of slack: the stored time need not round-trip to the ms.
        Math.abs(data.scheduledAt - dueAt) > 1000
      ) {
        logger.info({
          message: 'Delete actor job superseded by a newer schedule',
          actorId,
          jobScheduledAt: data.scheduledAt,
          currentScheduledAt: dueAt
        })
        span.setStatus({ code: SpanStatusCode.OK, message: 'Superseded' })
        return
      }
      if (dueAt !== null && dueAt > Date.now()) {
        const queue = getQueue()
        logger.info({
          message: 'Delete actor job arrived before the scheduled time',
          actorId,
          scheduledAt: dueAt
        })
        // A real queue can run it again at the right time. The in-process queue
        // cannot, but then only the sweep publishes jobs, and only once due.
        if (!queue.runsInline) {
          await queue.publish({
            id: `${message.id}:early:${dueAt}`,
            name: DELETE_ACTOR_JOB_NAME,
            data: { actorId, scheduledAt: dueAt },
            delaySeconds: Math.max(1, Math.ceil((dueAt - Date.now()) / 1000))
          })
        }
        span.setStatus({ code: SpanStatusCode.OK, message: 'Not yet due' })
        return
      }

      // Store email for notification before deletion
      const accountEmail = actor.account?.email
      logger.debug({
        message: 'Actor email for notification',
        actorId,
        hasEmail: !!accountEmail
      })

      // Mark actor as deleting
      try {
        await database.startActorDeletion({ actorId })
        logger.info({
          message: 'Marked actor as deleting',
          actorId
        })
      } catch (err) {
        logger.error({
          message: 'Failed to mark actor as deleting',
          actorId,
          err: toLoggableError(err)
        })
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'Failed to start deletion'
        })
        span.recordException(
          err instanceof Error ? err : new Error(String(err))
        )
        throw err
      }

      await federateActorDeletion(database, actor)

      // Delete all actor data
      try {
        await database.deleteActorData({ actorId })
        logger.info({
          message: 'Deleted actor data',
          actorId
        })
      } catch (err) {
        logger.error({
          message: 'Failed to delete actor data',
          actorId,
          err: toLoggableError(err)
        })
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'Failed to delete actor data'
        })
        span.recordException(
          err instanceof Error ? err : new Error(String(err))
        )
        throw err
      }

      // Send email notification
      if (accountEmail) {
        const config = getConfig()
        if (config.email) {
          try {
            // The admin can leave the instance contact address blank, in which
            // case the notice falls back to naming no address rather than
            // pointing the user at the no-reply sender.
            const { instance } = await getResolvedServerSettings(database)
            const email = buildActorDeletedEmail({
              recipient: actor,
              recipientEmail: accountEmail,
              contactEmail: instance.contactEmail || undefined
            })
            await sendMail({
              from: config.email.serviceFromAddress,
              to: [accountEmail],
              subject: email.subject,
              content: { text: email.text, html: email.html }
            })
            // The address itself is never logged: it is personal data, and
            // the actor id already identifies the notification.
            logger.info({
              message: 'Sent actor deletion email notification',
              actorId
            })
          } catch (err) {
            logger.error({
              message: 'Failed to send actor deletion email notification',
              actorId,
              err: toLoggableError(err)
            })
            // Don't fail the job if email fails
          }
        }
      }

      logger.info({
        message: 'Delete actor job completed successfully',
        actorId
      })
      span.setStatus({ code: SpanStatusCode.OK })
    })
  }
)

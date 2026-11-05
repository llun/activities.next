import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import {
  DELIVER_ACTIVITY_JOB_NAME,
  SEND_FEATURED_STATUS_JOB_NAME
} from '@/lib/jobs/names'
import {
  MAX_CONCURRENT_DELIVERY_PUBLICATIONS,
  getDeliveryJobId,
  runWithConcurrencyLimit
} from '@/lib/jobs/sendNoteJob'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { getQueue } from '@/lib/services/queue'
import { JobHandle } from '@/lib/services/queue/type'
import { isStatusPubliclyReadable } from '@/lib/services/statusAccess'
import { AddAction, RemoveAction } from '@/lib/types/activitypub/activities'
import { getLocalActorFeaturedCollectionId } from '@/lib/utils/activitypubId'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { withSpan } from '@/lib/utils/trace'

export const PinFederationAction = z.enum([AddAction, RemoveAction])
export type PinFederationAction = z.infer<typeof PinFederationAction>

export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string(),
  action: PinFederationAction,
  // Random per-transition id, stored so retries re-send the same activity.
  eventId: z.string().min(1)
})

export const getFeaturedStatusActivityId = ({
  statusId,
  action,
  eventId
}: {
  statusId: string
  action: PinFederationAction
  eventId: string
}): string => `${statusId}#${action === AddAction ? 'pin' : 'unpin'}/${eventId}`

// Fans an Add or Remove activity for the actor's featured collection out to the
// pinned post's own audience (followers, plus accepted relays for a listed
// public post) after a local status pin or unpin changes state.
export const sendFeaturedStatusJob: JobHandle = createJobHandle(
  SEND_FEATURED_STATUS_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'sendFeaturedStatus', {}, async (span) => {
      const { actorId, statusId, action, eventId } = JobData.parse(message.data)
      span.setAttribute('actorId', actorId)
      span.setAttribute('statusId', statusId)
      span.setAttribute('action', action)

      const actor = await database.getActorFromId({ id: actorId })
      // Only a local actor has a key to sign with, and only a local actor's
      // featured collection is ours to announce.
      if (!actor?.privateKey) {
        span.recordException(new Error('Local actor not found'))
        return
      }

      // The featured collection lists only publicly readable posts, so an Add
      // or Remove is only federated for one, addressed by the post's own
      // audience: a followers-only pin must not reach relays, and a post that
      // is gone was already federated as a Delete.
      const status = await database.getStatus({ statusId, withReplies: false })
      if (
        !status ||
        status.actorId !== actor.id ||
        !isStatusPubliclyReadable(status)
      ) {
        return
      }

      const pinnedStatusIds = await database.getPinnedStatusIds({ actorId })
      // A later transition has its own job; drop this event if its state no
      // longer matches rather than undoing the actor's current pin state.
      if (pinnedStatusIds.includes(statusId) !== (action === AddAction)) {
        return
      }

      const activity = {
        '@context': ACTIVITY_STREAM_URL,
        id: getFeaturedStatusActivityId({ statusId, action, eventId }),
        type: action,
        actor: actor.id,
        object: statusId,
        target: getLocalActorFeaturedCollectionId(actor.id)
      }

      const inboxes = await getFederatedStatusDeliveryInboxes({
        database,
        currentActor: actor,
        status
      })

      const queue = getQueue()
      const results = await runWithConcurrencyLimit(
        inboxes,
        MAX_CONCURRENT_DELIVERY_PUBLICATIONS,
        (inbox) =>
          queue.publish({
            id: getDeliveryJobId(message.id, inbox),
            name: DELIVER_ACTIVITY_JOB_NAME,
            data: { inbox, actorId: actor.id, activity }
          })
      )
      span.setAttribute('fanout.inbox_count', inboxes.length)

      const failures = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      )
      if (failures.length === 0) return
      const errors = failures.map((failure) =>
        failure.reason instanceof Error
          ? failure.reason
          : new Error(String(failure.reason))
      )
      // The in-process queue ran each delivery inline, so a rejection is one
      // inbox failing; record it and let the rest stand. A real queue failed
      // to accept the job, so retry the fan-out: each delivery keeps its id
      // and the queue drops the ones it already holds.
      if (queue.runsInline) {
        errors.forEach((error) => span.recordException(error))
        return
      }
      throw new AggregateError(
        errors,
        `Failed to publish ${errors.length} featured status deliveries`
      )
    })
  }
)

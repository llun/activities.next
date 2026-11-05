import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_UPDATE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { enqueueDeliveries } from '@/lib/services/federation/enqueueDeliveries'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { JobHandle } from '@/lib/services/queue/type'
import { UpdateAction } from '@/lib/types/activitypub/activities'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'
import { withSpan } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  // Epoch ms of the profile change. It names the activity, so a retried job
  // re-sends the same Update rather than minting a new one.
  updatedAt: z.number()
})

// Fans an Update(Person) out after a local profile edit, so remote servers
// refresh the display name, bio, images and locked state they cached instead
// of waiting for their own periodic re-fetch. Reaches the same audience
// Mastodon does: follower inboxes plus accepted relays.
export const sendUpdateActorJob: JobHandle = createJobHandle(
  SEND_UPDATE_ACTOR_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'sendUpdateActor', {}, async (span) => {
      const { actorId, updatedAt } = JobData.parse(message.data)
      span.setAttribute('actorId', actorId)

      const actor = await database.getActorFromId({ id: actorId })
      // Only a local actor has a key to sign with, and only a local actor's
      // profile is ours to announce.
      if (!actor?.privateKey) {
        span.recordException(new Error('Local actor not found'))
        return
      }

      const { '@context': context, ...person } = getPersonFromActor(actor)
      const activity = {
        '@context': context,
        id: `${actor.id}#updates/${updatedAt}`,
        type: UpdateAction,
        actor: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        object: person
      }

      const inboxes = await getFederatedStatusDeliveryInboxes({
        database,
        currentActor: actor,
        status: { to: [ACTIVITY_STREAM_PUBLIC], cc: [actor.followersUrl] }
      })

      await enqueueDeliveries({
        database,
        parentMessageId: message.id,
        actorId: actor.id,
        activity,
        inboxes,
        span
      })
    })
  }
)

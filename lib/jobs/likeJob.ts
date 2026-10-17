import { z } from 'zod'

import { likeRequest } from '@/lib/actions/like'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { LIKE_JOB_NAME } from '@/lib/jobs/names'
import { actorMatchesVerifiedSender } from '@/lib/jobs/verifiedSender'
import { JobHandle } from '@/lib/services/queue/type'
import { Like } from '@/lib/types/activitypub'

const LikeUndo = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal('Undo'),
  object: Like
})

/**
 * Shared-inbox path for plain favourites. GoToSocial, Pixelfed, Lemmy and
 * Pleroma/Akkoma may deliver a `Like` (or its `Undo`) to the shared inbox
 * instead of the recipient's personal one, where it is handled by
 * `likeRequest` / `deleteLike`. This job applies the very same operations, so a
 * favourite behaves identically whichever inbox it arrives at. Reaction-bearing
 * Likes never reach it (they route to the emoji reaction job).
 *
 * Only likes of LOCAL statuses are kept: the shared inbox is not addressed to
 * anyone, so a Like of a remote object is not ours to count. Redelivery (also
 * to both inboxes) is idempotent: `createLike` returns false for an existing
 * row, which also suppresses a second notification.
 */
export const likeJob: JobHandle = createJobHandle(
  LIKE_JOB_NAME,
  async (database, message) => {
    const undo = LikeUndo.safeParse(message.data)
    const like = undo.success ? undo : Like.safeParse(message.data)
    if (!like.success) return

    // For an Undo the wrapper carries the actor whose identity the sender guard
    // verified; the undone Like is evaluated as that actor.
    const activity = undo.success
      ? { ...undo.data.object, actor: undo.data.actor }
      : (like.data as z.infer<typeof Like>)
    if (!actorMatchesVerifiedSender(activity.actor, message)) return

    const statusId =
      typeof activity.object === 'string' ? activity.object : activity.object.id
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status || !status.isLocalActor) return

    if (undo.success) {
      await database.deleteLike({ actorId: activity.actor, statusId })
      return
    }
    await likeRequest({ activity, database })
  }
)

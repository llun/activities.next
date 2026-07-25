import { z } from 'zod'

import {
  emojiReactionRequest,
  getReactionContent,
  undoEmojiReactionRequest
} from '@/lib/actions/emojiReaction'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { EMOJI_REACTION_JOB_NAME } from '@/lib/jobs/names'
import { actorMatchesVerifiedSender } from '@/lib/jobs/verifiedSender'
import { JobHandle } from '@/lib/services/queue/type'
import { EmojiReact, Like } from '@/lib/types/activitypub'

const ReactionActivity = z.union([EmojiReact, Like])

const ReactionUndo = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal('Undo'),
  object: ReactionActivity
})

/**
 * Shared-inbox path for emoji reactions. Pleroma-family delivery may target the
 * shared inbox rather than the recipient's personal one, so both spellings
 * (`EmojiReact` and a Misskey-style `Like` carrying the emoji) plus their
 * `Undo`s are routed here and handled by the same actions the per-user inbox
 * uses. A plain `Like` is not routed here at all — favourite semantics at the
 * shared inbox are unchanged.
 */
export const emojiReactionJob: JobHandle = createJobHandle(
  EMOJI_REACTION_JOB_NAME,
  async (database, message) => {
    const undo = ReactionUndo.safeParse(message.data)
    if (undo.success) {
      if (!actorMatchesVerifiedSender(undo.data.actor, message)) return
      // The undone object carries the reaction; the wrapper carries the actor
      // whose identity the sender guard verified.
      await undoEmojiReactionRequest({
        activity: { ...undo.data.object, actor: undo.data.actor },
        database
      })
      return
    }

    const reaction = ReactionActivity.safeParse(message.data)
    if (!reaction.success) return
    if (!actorMatchesVerifiedSender(reaction.data.actor, message)) return
    // A plain Like reaching this job is not a reaction; drop it rather than
    // silently turning it into one.
    if (!getReactionContent(reaction.data)) return

    await emojiReactionRequest({ activity: reaction.data, database })
  }
)

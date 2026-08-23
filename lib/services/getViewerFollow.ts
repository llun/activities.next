import { cache } from 'react'

import { Database } from '@/lib/database/types'
import { Follow } from '@/lib/types/domain/follow'

/**
 * The viewer's own accepted-or-requested follow of a target actor, memoized for
 * the length of one request.
 *
 * Rendering `/@user@domain` asks this exact question twice from two places that
 * cannot see each other: `resolveActorStatusesAudience` needs it to decide
 * whether the viewer may be shown followers-only posts, and `getRelationship`
 * needs the same row for the follow button's state, its reblog/notify
 * preferences and its language filter. Both are reads on one render, so the
 * second was a wasted round trip for every signed-in visitor to someone else's
 * profile.
 *
 * **Read paths only.** `database.getAcceptedOrRequestedFollow` stays the entry
 * point everywhere else. The follow, unfollow and block routes read *this* row,
 * mutate it, and then report the result through `getRelationship` — so they
 * reach this helper only after their own write, which is a cold read. Keep it
 * that way: routing one of their pre-mutation reads through here would make the
 * response describe the state they just replaced. (The follow-request
 * authorize/reject routes mutate the opposite direction, which is a different
 * key and so cannot collide either way — but they are the same shape of hazard
 * if the direction ever changes.)
 *
 * The parameters are positional and primitive on purpose. React `cache` keys on
 * argument identity, so the options-object spelling the database method itself
 * uses would allocate a fresh key on every call and memoize nothing.
 *
 * Outside a request scope — jobs, scripts, Vitest — React `cache` is a
 * passthrough, so this is the database call with no memoization at all.
 */
export const getViewerFollow = cache(
  (
    database: Database,
    viewerId: string,
    targetActorId: string
  ): Promise<Follow | null> =>
    database.getAcceptedOrRequestedFollow({
      actorId: viewerId,
      targetActorId
    })
)

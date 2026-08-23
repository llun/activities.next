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
 * point everywhere else, and in particular on the follow, unfollow, block and
 * follow-request authorize/reject routes: those read the row, mutate it, and
 * then report the result, so a value cached from before their own write would
 * be wrong. Those routes reach `getRelationship` (and therefore this helper)
 * only *after* the mutation, which is a cold read; keep it that way — routing
 * one of their own pre-mutation reads through here would make their response
 * describe the state they just replaced.
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

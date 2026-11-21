import { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'
import {
  isUsableAccountActor,
  selectAccountActor
} from '@/lib/utils/selectAccountActor'

// The subset of Better Auth's session record this resolution needs. `userId` is
// mapped to the `accounts` table (see the `session.fields` mapping in auth.ts),
// and `actorId` is the additional field the session hook and `/api/v1/actors/
// switch` persist.
export interface ConsentSession {
  userId?: string | null
  actorId?: string | null
}

interface ResolveConsentReferenceIdParams {
  database: Database | null
  session: ConsentSession | null | undefined
}

/**
 * Resolves the actor an OAuth grant is bound to.
 *
 * Better Auth stores the returned value on the issued token as `referenceId`,
 * and `OAuthGuard` reads it back as the acting actor — so a grant that resolves
 * to nothing produces a token that 401s on every bearer-authenticated route,
 * `/oauth/userinfo` included (which fails an OIDC login outright).
 *
 * The session's own `actorId` wins when it is still usable. A session minted
 * before a moderation action can name a suspended actor, and binding the grant
 * to it would hand out a token every guarded route refuses while another actor
 * on the account could still act — so an unusable session actor falls through
 * to the same rule the web session uses (`getActorFromSession`): the default
 * actor if one is set and usable, else the first actor that is not pending
 * deletion. Only relying on `defaultActorId` left every account that never
 * picked a default with an actor-less grant — invisible while the consent
 * screen was shown, because approving it persists the session actor first, but
 * permanent once consent is stored and the consent screen is skipped.
 */
export const resolveConsentReferenceId = async ({
  database,
  session
}: ResolveConsentReferenceIdParams): Promise<string | undefined> => {
  if (!session) return undefined
  // Without a database (or an account to look actors up for) the session's own
  // actor is all there is to go on.
  if (!database || !session.userId) return session.actorId ?? undefined

  const accountId = session.userId
  try {
    const [account, actors] = await Promise.all([
      database.getAccountFromId({ id: accountId }),
      database.getActorsForAccount({ accountId })
    ])
    if (session.actorId) {
      const selected = actors.find(
        (actor) => actor.id === session.actorId && isUsableAccountActor(actor)
      )
      if (selected) return selected.id
    }
    return selectAccountActor(actors, account?.defaultActorId)?.id
  } catch (e) {
    logger.error({
      message: 'Failed to resolve the OAuth consent actor reference',
      error: e
    })
    // The lookup failed, not the session: keep the actor the session already
    // names. Returning undefined here would mint the grant for no actor, and
    // `OAuthGuard` would then fall back to the account's default actor — a
    // different identity than the one the user consented for.
    return session.actorId ?? undefined
  }
}

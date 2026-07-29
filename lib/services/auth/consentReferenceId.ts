import { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'
import { selectAccountActor } from '@/lib/utils/selectAccountActor'

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
 * The session's own `actorId` wins when present. Otherwise fall back to the
 * account's actors with the same rule the web session uses
 * (`getActorFromSession`): the default actor if one is set and usable, else the
 * first actor that is not pending deletion. Only relying on `defaultActorId`
 * left every account that never picked a default with an actor-less grant —
 * invisible while the consent screen was shown, because approving it persists
 * the session actor first, but permanent once consent is stored and the consent
 * screen is skipped.
 */
export const resolveConsentReferenceId = async ({
  database,
  session
}: ResolveConsentReferenceIdParams): Promise<string | undefined> => {
  if (session?.actorId) return session.actorId
  if (!database || !session?.userId) return undefined

  const accountId = session.userId
  try {
    const [account, actors] = await Promise.all([
      database.getAccountFromId({ id: accountId }),
      database.getActorsForAccount({ accountId })
    ])
    return selectAccountActor(actors, account?.defaultActorId)?.id
  } catch (e) {
    logger.error({
      message: 'Failed to resolve the OAuth consent actor reference',
      error: e
    })
    return undefined
  }
}

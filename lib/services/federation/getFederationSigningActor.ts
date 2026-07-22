import { Database } from '@/lib/database/types'
import { isFederationSigningActor } from '@/lib/services/federation/instanceActor'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

/**
 * Returns the dedicated headless federation signer.
 *
 * The optional actor is only a short-circuit for callers that already resolved
 * the headless signer earlier in the same flow. User actors are intentionally
 * ignored so federation fetches never fall back to signing as a person.
 */
export const getFederationSigningActor = async (
  database: Database,
  candidateActor?: Actor
): Promise<Actor | undefined> => {
  if (isFederationSigningActor(candidateActor)) return candidateActor

  return (await database.getFederationSigningActor()) ?? undefined
}

/**
 * Best-effort variant of getFederationSigningActor for fetch paths that must
 * degrade to an unsigned request instead of failing: a resolution error is
 * logged (with the caller-provided context appended) and yields undefined.
 */
export const getFederationSigningActorSafe = async (
  database: Database,
  context: string
): Promise<Actor | undefined> =>
  getFederationSigningActor(database).catch((error) => {
    logger.warn({
      message: `Failed to resolve federation signing actor ${context}; falling back to an unsigned request`,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  })

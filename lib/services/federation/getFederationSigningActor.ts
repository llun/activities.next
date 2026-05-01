import { Database } from '@/lib/database/types'
import { isFederationSigningActor } from '@/lib/services/federation/instanceActor'
import { Actor } from '@/lib/types/domain/actor'

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

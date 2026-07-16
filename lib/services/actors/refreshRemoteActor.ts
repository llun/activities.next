import { recordActorIfNeeded } from '@/lib/actions/utils'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

// Refresh a known remote actor's stored profile and collection counts before
// an account-serving endpoint serializes it, so profile headers built from
// lookup/search responses carry current remote data instead of whatever last
// federated here. recordActorIfNeeded no-ops for recently-synced actors (a
// single marker lookup), so the steady-state cost is negligible; a failed
// refresh falls back to the stored actor. Internal actors (account-backed
// users and the headless signer, which always carries a private key) are
// never refreshed from the network.
export const refreshKnownRemoteActor = async ({
  database,
  actor,
  signingActor
}: {
  database: Database
  actor: Actor
  signingActor?: Actor
}): Promise<Actor> => {
  if (actor.account || actor.privateKey) return actor

  try {
    return (
      (await recordActorIfNeeded({
        actorId: actor.id,
        database,
        signingActor
      })) ?? actor
    )
  } catch (error) {
    logger.warn({
      message: 'Failed to refresh remote actor',
      actorId: actor.id,
      error: error instanceof Error ? error.message : String(error)
    })
    return actor
  }
}

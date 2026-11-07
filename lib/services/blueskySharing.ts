import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { Actor } from '@/lib/types/domain/actor'
import { BLUESKY_BRIDGE_DOMAIN } from '@/lib/utils/accountHandle'
import {
  BLUESKY_BRIDGE_ACTOR_ID,
  BlueskySharingState,
  getBlueskyHandle,
  getBlueskyRequirements,
  getBlueskySharingStatus
} from '@/lib/utils/blueskySharing'

// Stored rows only: opening Settings never contacts the bridge.
export const getStoredBlueskyBridge = async (database: Database) =>
  (await database.getActorFromUsername({
    username: BLUESKY_BRIDGE_DOMAIN,
    domain: BLUESKY_BRIDGE_DOMAIN
  })) ?? (await database.getActorFromId({ id: BLUESKY_BRIDGE_ACTOR_ID }))

export const getBlueskySharingState = async (
  database: Database,
  actor: Actor
): Promise<BlueskySharingState> => {
  const bot = await getStoredBlueskyBridge(database)
  const targetActorId = bot?.id ?? BLUESKY_BRIDGE_ACTOR_ID
  const [follow, block, federationAllowed] = await Promise.all([
    database.getAcceptedOrRequestedFollow({ actorId: actor.id, targetActorId }),
    database.getBlock({ actorId: actor.id, targetActorId }),
    canFederateWithDomain(database, BLUESKY_BRIDGE_DOMAIN)
  ])
  return {
    status: getBlueskySharingStatus(Boolean(block), follow?.status),
    handle: getBlueskyHandle(actor),
    requirements: getBlueskyRequirements(actor),
    federationAllowed
  }
}

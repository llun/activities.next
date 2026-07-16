import { getActorCollectionCounts } from '@/lib/activities/getActorCollectionCounts'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Actor as ActivityPubActor } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import {
  getActorImageUrl,
  getActorProfileFields
} from '@/lib/utils/activitypubActor'
import { logger } from '@/lib/utils/logger'

interface RecordActorIfNeededParams {
  actorId: string
  database: Database
  signingActor?: Actor
}

const REMOTE_ACTOR_REFRESH_INTERVAL_MS = 3 * 86_400_000

export class BlockedFederationDomainError extends Error {
  constructor(actorId: string) {
    super(`Federation with actor domain is blocked: ${actorId}`)
    this.name = 'BlockedFederationDomainError'
  }
}

export const assertActorCanFederate = async ({
  actorId,
  database
}: RecordActorIfNeededParams): Promise<void> => {
  if (!(await canFederateWithDomain(database, actorId))) {
    throw new BlockedFederationDomainError(actorId)
  }
}

// Sync the collection sizes the remote server advertises (followers/following/
// outbox totalItems) into the actor's local counter rows — the values the
// Mastodon account serializer reads. Without this, remote actors show zero
// followers/following and a local-only status count in Mastodon clients.
// Best-effort: a failed sync leaves the existing counters untouched.
const syncActorCollectionCounts = async (
  database: Database,
  person: ActivityPubActor,
  signingActor?: Actor
): Promise<void> => {
  try {
    const counts = await getActorCollectionCounts({ person, signingActor })
    await database.setActorCounters({
      actorId: person.id,
      followersCount: counts.followersCount,
      followingCount: counts.followingCount,
      statusCount: counts.statusesCount
    })
  } catch (error) {
    logger.warn({
      message: 'Failed to sync remote actor collection counts',
      actorId: person.id,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

// The remote profile data persisted whenever a remote actor is recorded or
// refreshed (recordActorIfNeeded here, plus the web profile page), so
// Mastodon clients see the actor's real display name, bio, images, metadata
// fields and follow-approval (locked) state instead of local defaults.
export const getPersistableProfile = (person: ActivityPubActor) => {
  const iconUrl = getActorImageUrl(person.icon)
  const headerImageUrl = getActorImageUrl(person.image)
  return {
    type: person.type,
    ...(person.name ? { name: person.name } : {}),
    ...(person.summary ? { summary: person.summary } : {}),
    ...(iconUrl ? { iconUrl } : {}),
    ...(headerImageUrl ? { headerImageUrl } : {}),
    // ActivityStreams treats an absent flag as "does not require approval".
    manuallyApprovesFollowers: person.manuallyApprovesFollowers ?? false,
    fields: getActorProfileFields(person),
    followersUrl: person.followers ?? '',
    inboxUrl: person.inbox,
    sharedInboxUrl: person.endpoints?.sharedInbox ?? person.inbox,
    publicKey: person.publicKey.publicKeyPem || ''
  }
}

export const recordActorIfNeeded = async ({
  actorId,
  database,
  signingActor
}: RecordActorIfNeededParams): Promise<Actor | undefined> => {
  await assertActorCanFederate({ actorId, database })

  const existingActor = await database.getActorFromId({
    id: actorId
  })
  // Don't update local actor
  if (existingActor?.privateKey) {
    return existingActor
  }

  const getResolvedSigningActor = async () => {
    const resolvedSigningActor = await getFederationSigningActor(
      database,
      signingActor
    )
    if (!resolvedSigningActor) {
      logger.warn({
        message: 'Fetching remote actor without a federation signing actor',
        actorId
      })
    }
    return resolvedSigningActor
  }

  if (!existingActor) {
    const resolvedSigningActor = await getResolvedSigningActor()
    const person = await getActorPerson({
      actorId,
      signingActor: resolvedSigningActor
    })
    if (!person) return
    const actor = await database.createActor({
      actorId,
      username: person.preferredUsername,
      // host (not hostname) so instances on non-standard ports keep the port
      // in the stored domain, matching getActorDomain and handle lookups.
      domain: new URL(person.id).host,
      ...getPersistableProfile(person),
      createdAt: new Date(person.published ?? Date.now()).getTime()
    })
    await syncActorCollectionCounts(database, person, resolvedSigningActor)
    return actor ?? undefined
  }

  const currentTime = Date.now()
  // Update actor if it's older than 3 day. Also refresh a fresh actor whose
  // collection counters were never synced — remote actors recorded before
  // counter syncing existed would otherwise keep showing zero
  // followers/following until the next stale refresh.
  const isStale =
    currentTime - existingActor.updatedAt > REMOTE_ACTOR_REFRESH_INTERVAL_MS
  if (!isStale && (await database.hasActorCounters({ actorId }))) {
    return existingActor
  }

  const resolvedSigningActor = await getResolvedSigningActor()
  const person = await getActorPerson({
    actorId,
    signingActor: resolvedSigningActor
  })
  if (!person) {
    if (isStale) return undefined
    // A counter-only sync must not degrade the previous behavior of returning
    // the stored actor when the remote fetch fails. Mark the counters synced
    // (rows created, values preserved) so an unreachable actor doesn't
    // re-trigger a blocking remote fetch on every subsequent call — the
    // 3-day stale refresh remains the retry path.
    await database.setActorCounters({ actorId })
    return existingActor
  }
  const actor = await database.updateActor({
    actorId,
    ...getPersistableProfile(person)
  })
  await syncActorCollectionCounts(database, person, resolvedSigningActor)
  return actor ?? undefined
}

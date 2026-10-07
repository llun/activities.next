import { confirmActorHandle } from '@/lib/activities/confirmActorHandle'
import { getActorCollectionCounts } from '@/lib/activities/getActorCollectionCounts'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { Actor as ActivityPubActor } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import { isSameActivityPubOrigin } from '@/lib/utils/activitypub'
import {
  getActorImageUrl,
  getActorProfileFields
} from '@/lib/utils/activitypubActor'
import { logger } from '@/lib/utils/logger'

interface RecordActorIfNeededParams {
  actorId: string
  database: Database
  signingActor?: Actor
  // Re-fetch a stored remote actor even when it is not stale, because its
  // origin just announced a change (an inbound Update(Person)).
  forceRefresh?: boolean
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
// The counters are keyed on the stored row's id — the key `hasActorCounters`
// reads — not on `person.id`, which differs for a row recorded under an alias.
const syncActorCollectionCounts = async (
  database: Database,
  rowActorId: string,
  person: ActivityPubActor,
  signingActor?: Actor
): Promise<void> => {
  try {
    const counts = await getActorCollectionCounts({ person, signingActor })
    await database.setActorCounters({
      actorId: rowActorId,
      followersCount: counts.followersCount,
      followingCount: counts.followingCount,
      statusCount: counts.statusesCount
    })
  } catch (error) {
    logger.warn({
      message: 'Failed to sync remote actor collection counts',
      actorId: rowActorId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export const getActorEmojiTags = (
  person: ActivityPubActor
): { type: 'emoji'; name: string; value: string }[] => {
  if (!person.tag) return []
  const rawTags = Array.isArray(person.tag) ? person.tag : [person.tag]
  return rawTags.flatMap((tag) => {
    if (
      typeof tag === 'object' &&
      tag !== null &&
      'type' in tag &&
      tag.type === 'Emoji' &&
      'name' in tag &&
      typeof tag.name === 'string' &&
      'icon' in tag &&
      typeof tag.icon === 'object' &&
      tag.icon !== null &&
      'url' in tag.icon &&
      typeof tag.icon.url === 'string'
    ) {
      return [
        {
          type: 'emoji' as const,
          name: tag.name,
          value: tag.icon.url
        }
      ]
    }
    return []
  })
}

// The remote profile data persisted whenever a remote actor is recorded or
// refreshed (recordActorIfNeeded here, plus the web profile page), so
// Mastodon clients see the actor's real display name, bio, images, metadata
// fields and follow-approval (locked) state instead of local defaults.
export const getPersistableProfile = (person: ActivityPubActor) => {
  const iconUrl = getActorImageUrl(person.icon)
  const headerImageUrl = getActorImageUrl(person.image)
  const tags = getActorEmojiTags(person)
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
    publicKey: person.publicKey?.publicKeyPem || '',
    ...(tags.length > 0 ? { tags } : {})
  }
}

// `getActorPerson` guarantees the document belongs to `person.id`'s origin,
// not that `person.id` is the actor that was asked for: requesting
// https://evil.example/x whose document claims https://victim.example/users/alice
// returns alice's real document. Recording that gave the handle
// @alice@victim.example to a row evil.example answers for on every refresh
// (its own inbox and key included), so the two ids must share an origin. A
// same-origin canonical form (Mastodon's /@bob serving /users/bob) still
// records — under the fetched id, see recordActorIfNeeded. Sharing an origin
// proves only that one host vouches for the id, username and domain, not that
// the handle is genuine: any document that host serves can claim any username
// on it, which is why a new row is created only once WebFinger confirms the
// handle (`confirmActorHandle`).
const getRequestedActorPerson = async ({
  actorId,
  signingActor
}: {
  actorId: string
  signingActor?: Actor
}) => {
  const person = await getActorPerson({ actorId, signingActor })
  if (!person) return null
  if (!isSameActivityPubOrigin(person.id, actorId)) {
    logger.warn({
      message: 'Refused remote actor whose document id is on another origin',
      actorId,
      fetchedActorId: person.id
    })
    return null
  }
  return person
}

// The one rule for persisting an actor fetched from a URL other than its own
// id. When `person.id` is not `requestedActorId` the fetched document is only a
// pointer: any URL on the origin (a user upload, say) can serve JSON claiming
// the real id with its own key and inbox, and that key would then verify every
// activity signed as the real id. Returns the document to write under
// `person.id` — the fetched one when the ids agree, otherwise what `person.id`
// itself serves, and only when that document names exactly `person.id`
// (Mastodon re-fetches the same way). `null` means persist nothing. Callers
// that already hold a row under `person.id` leave it untouched instead of
// calling this: the refresh path re-fetches a row's own id.
export const getPersistableActorPerson = async ({
  requestedActorId,
  person,
  signingActor
}: {
  requestedActorId: string
  person: ActivityPubActor
  signingActor?: Actor
}): Promise<ActivityPubActor | null> => {
  if (person.id === requestedActorId) return person
  const canonicalPerson = await getActorPerson({
    actorId: person.id,
    signingActor
  })
  if (!canonicalPerson || canonicalPerson.id !== person.id) {
    logger.warn({
      message:
        'Refused remote actor alias whose canonical id does not serve itself',
      actorId: requestedActorId,
      fetchedActorId: person.id,
      canonicalDocumentId: canonicalPerson?.id
    })
    return null
  }
  return canonicalPerson
}

export const recordActorIfNeeded = async ({
  actorId,
  database,
  signingActor,
  forceRefresh = false
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
    const fetchedPerson = await getRequestedActorPerson({
      actorId,
      signingActor: resolvedSigningActor
    })
    if (!fetchedPerson) return
    // The row is keyed on the fetched id, never on the alias that was asked
    // for (`/@bob`, `/users/bob/`, `/users/bob?x`). Keying it on the alias let
    // any URL the origin answers for occupy the actor's UNIQUE (username,
    // domain), after which the real id could never be recorded and every
    // activity from it failed on the constraint.
    if (fetchedPerson.id !== actorId) {
      const canonicalActor = await database.getActorFromId({
        id: fetchedPerson.id
      })
      if (canonicalActor) return canonicalActor
    }
    const person = await getPersistableActorPerson({
      requestedActorId: actorId,
      person: fetchedPerson,
      signingActor: resolvedSigningActor
    })
    if (!person) return
    // The row fixes `username@domain` for good (the refresh path below never
    // rewrites it), so WebFinger must vouch for the handle before it exists.
    // The handle is normally `preferredUsername@<actor host>` — host, not
    // hostname, so instances on non-standard ports keep the port in the stored
    // domain, matching getActorDomain and handle lookups — and is the handle
    // domain's own answer when only that domain confirms it.
    const handle = await confirmActorHandle({
      database,
      actorId: person.id,
      username: person.preferredUsername,
      webfinger: person.webfinger
    })
    if (!handle) return
    // A row recorded under an alias before the rule above still holds the
    // handle. It is not re-keyed here (statuses, follows and counters point at
    // its id); refuse instead of failing on the unique constraint, and leave
    // the row for an operator to remove.
    const handleOwner = await database.getActorFromUsername(handle)
    if (
      handleOwner &&
      handleOwner.username === handle.username &&
      handleOwner.id !== person.id
    ) {
      logger.warn({
        message: 'Remote actor handle is already held by a row with another id',
        actorId,
        fetchedActorId: person.id,
        storedActorId: handleOwner.id
      })
      return
    }
    const actor = await database.createActor({
      actorId: person.id,
      username: handle.username,
      domain: handle.domain,
      ...getPersistableProfile(person),
      createdAt: new Date(person.published ?? Date.now()).getTime()
    })
    await syncActorCollectionCounts(
      database,
      person.id,
      person,
      resolvedSigningActor
    )
    return actor ?? undefined
  }

  const currentTime = Date.now()
  // Update actor if it's older than 3 day. Also refresh a fresh actor whose
  // collection counters were never synced — remote actors recorded before
  // counter syncing existed would otherwise keep showing zero
  // followers/following until the next stale refresh.
  const isStale =
    currentTime - existingActor.updatedAt > REMOTE_ACTOR_REFRESH_INTERVAL_MS
  if (
    !forceRefresh &&
    !isStale &&
    (await database.hasActorCounters({ actorId }))
  ) {
    return existingActor
  }

  const resolvedSigningActor = await getResolvedSigningActor()
  const person = await getRequestedActorPerson({
    actorId,
    signingActor: resolvedSigningActor
  })
  if (!person) {
    if (isStale) return undefined
    // A failed forced refresh leaves the fresh row as it was; the counter
    // marker below belongs to the counter-only sync.
    if (forceRefresh) return existingActor
    // A counter-only sync must not degrade the previous behavior of returning
    // the stored actor when the remote fetch fails (so the marker write is
    // best-effort too). Stamp the sync marker so an unreachable actor doesn't
    // re-trigger a blocking remote fetch on every subsequent call — the
    // 3-day stale refresh remains the retry path.
    try {
      await database.setActorCounters({ actorId })
    } catch (error) {
      logger.warn({
        message: 'Failed to mark remote actor counter sync as attempted',
        actorId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return existingActor
  }
  const actor = await database.updateActor({
    actorId,
    ...getPersistableProfile(person)
  })
  await syncActorCollectionCounts(
    database,
    actorId,
    person,
    resolvedSigningActor
  )
  return actor ?? undefined
}

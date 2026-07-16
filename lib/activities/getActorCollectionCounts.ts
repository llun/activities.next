import { fetchCollectionRoot } from '@/lib/activities/getActorCollections'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

type CollectionField = 'followers' | 'following' | 'outbox'

export interface ActorCollectionCounts {
  followersCount: number | null
  followingCount: number | null
  statusesCount: number | null
}

interface Params {
  person: Actor
  signingActor?: DomainActor
}

// Fetch a single collection root and read its advertised totalItems. Unlike
// getActorCollections this never follows the first page — callers here only
// need the collection size. Best-effort: any failure yields null so callers
// can keep the locally-known value instead of overwriting it with a zero.
const getCollectionTotalItems = async (
  person: Actor,
  field: CollectionField,
  signingActor?: DomainActor
): Promise<number | null> => {
  const url = person[field]
  if (!url) return null

  try {
    const { collection } = await fetchCollectionRoot({ url, signingActor })
    const totalItems = collection?.totalItems
    if (
      typeof totalItems !== 'number' ||
      !Number.isFinite(totalItems) ||
      totalItems < 0
    ) {
      return null
    }
    return Math.floor(totalItems)
  } catch (error) {
    logger.warn({
      message: 'Failed to fetch actor collection total items',
      actorId: person.id,
      field,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

// The follower/following/status counts a remote actor advertises on its
// followers/following/outbox collections. These are the numbers Mastodon
// clients expect on an Account entity; the local database only knows about
// relationships and statuses that involve this instance.
export const getActorCollectionCounts = async ({
  person,
  signingActor
}: Params): Promise<ActorCollectionCounts> => {
  const [followersCount, followingCount, statusesCount] = await Promise.all([
    getCollectionTotalItems(person, 'followers', signingActor),
    getCollectionTotalItems(person, 'following', signingActor),
    getCollectionTotalItems(person, 'outbox', signingActor)
  ])
  return { followersCount, followingCount, statusesCount }
}

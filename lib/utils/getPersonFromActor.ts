import { Actor as ActivityPubActor } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import {
  getLocalActorFeaturedCollectionId,
  getLocalActorFeaturedCollectionsId,
  getLocalActorFeaturedTagsCollectionId,
  getLocalActorOutboxId
} from '@/lib/utils/activitypubId'
import { FEP_7AA9_CONTEXT_URL } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const getPersonFromActor = (
  actor: Actor
): ActivityPubActor & { '@context': string[] } => {
  const actorType = actor.type ?? 'Person'
  const profileUrl =
    actorType === 'Service'
      ? actor.id
      : `https://${actor.domain}/@${actor.username}`
  const icon = actor.iconUrl
    ? {
        icon: {
          type: 'Image',
          mediaType: 'image/jpeg',
          url: actor.iconUrl
        }
      }
    : null
  const headerImage = actor.headerImageUrl
    ? {
        image: {
          type: 'Image',
          mediaType: 'image/png',
          url: actor.headerImageUrl
        }
      }
    : null

  const person = ActivityPubActor.parse({
    id: actor.id,
    type: actorType,
    following: `${actor.id}/following`,
    followers: actor.followersUrl,
    inbox: actor.inboxUrl,
    outbox: getLocalActorOutboxId(actor.id),
    featured: getLocalActorFeaturedCollectionId(actor.id),
    featuredTags: getLocalActorFeaturedTagsCollectionId(actor.id),
    featuredCollections: getLocalActorFeaturedCollectionsId(actor.id),
    preferredUsername: actor.username,
    name: actor.name || '',
    summary: actor.summary || '',
    url: profileUrl,
    published: getISOTimeUTC(actor.createdAt),
    publicKey: {
      id: `${actor.id}#main-key`,
      owner: actor.id,
      publicKeyPem: actor.publicKey
    },
    endpoints: {
      sharedInbox: actor.sharedInboxUrl
    },
    ...icon,
    ...headerImage
  })

  return {
    // FEP-7aa9 context is added so the `featuredCollections` term resolves for
    // peers that JSON-LD-compact the actor document.
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
      FEP_7AA9_CONTEXT_URL
    ],
    ...person
  }
}

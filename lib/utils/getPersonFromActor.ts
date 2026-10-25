import { Actor as ActivityPubActor } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import {
  getLocalActorFeaturedCollectionId,
  getLocalActorFeaturedTagsCollectionId,
  getLocalActorOutboxId
} from '@/lib/utils/activitypubId'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { formatProfileFieldValue } from '@/lib/utils/text/formatProfileFieldValue'
import { toEmojiShortcodeToken } from '@/lib/utils/text/getEmojiTags'

// The public profile page URL that `url` carries (a service actor's is its id).
export const getActorProfileUrl = (
  actor: Pick<Actor, 'id' | 'type' | 'domain' | 'username'>
) =>
  (actor.type ?? 'Person') === 'Service'
    ? actor.id
    : `https://${actor.domain}/@${actor.username}`

const HOSTNAME_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

const isValidAttributionDomain = (value: string) => {
  const domain = value.trim().toLowerCase()
  return (
    domain.length > 0 &&
    domain.length <= 253 &&
    domain.split('.').every((label) => HOSTNAME_LABEL.test(label))
  )
}

export const getPersonFromActor = (
  actor: Actor
): ActivityPubActor & { '@context': (string | Record<string, unknown>)[] } => {
  const actorType = actor.type ?? 'Person'
  const profileUrl = getActorProfileUrl(actor)
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

  const emojiTags = (actor.tags ?? [])
    .filter((tag) => tag.type === 'emoji')
    .map((tag) => {
      const token = toEmojiShortcodeToken(tag.name)
      return {
        type: 'Emoji' as const,
        id: tag.value,
        name: token ?? tag.name,
        updated: getISOTimeUTC(actor.updatedAt),
        icon: {
          type: 'Image' as const,
          url: tag.value
        }
      }
    })

  // Mastodon profile metadata: one PropertyValue per field with an HTML value.
  const profileFields = (actor.fields ?? [])
    .filter((field) => field.name.trim() || field.value.trim())
    .map((field) => ({
      type: 'PropertyValue' as const,
      name: field.name,
      value: formatProfileFieldValue(field.value)
    }))

  // Mastodon 4.4+ author attribution: only valid hostnames are federated.
  const attributionDomains = (actor.attributionDomains ?? []).filter(
    isValidAttributionDomain
  )

  const person = ActivityPubActor.parse({
    id: actor.id,
    type: actorType,
    following: `${actor.id}/following`,
    followers: actor.followersUrl,
    inbox: actor.inboxUrl,
    outbox: getLocalActorOutboxId(actor.id),
    featured: getLocalActorFeaturedCollectionId(actor.id),
    featuredTags: getLocalActorFeaturedTagsCollectionId(actor.id),
    preferredUsername: actor.username,
    webfinger: `${actor.username}@${actor.domain}`,
    name: actor.name || '',
    summary: actor.summary || '',
    url: profileUrl,
    published: getISOTimeUTC(actor.createdAt),
    // Mastodon, Misskey and GoToSocial read this to show a locked account and
    // to expect a follow request rather than an immediate Accept.
    manuallyApprovesFollowers: actor.manuallyApprovesFollowers ?? false,
    // Both are opt-in on the wire, as in Mastodon's ActorSerializer
    // (`discoverable || false`): an unset flag federates as false, so users
    // who never opted in are not advertised to remote servers.
    discoverable: actor.discoverable === true,
    indexable: actor.indexable === true,
    ...(attributionDomains.length > 0 ? { attributionDomains } : null),
    ...(actor.alsoKnownAs && actor.alsoKnownAs.length > 0
      ? { alsoKnownAs: actor.alsoKnownAs }
      : null),
    ...(actor.movedTo ? { movedTo: actor.movedTo } : null),
    publicKey: {
      id: `${actor.id}#main-key`,
      owner: actor.id,
      publicKeyPem: actor.publicKey
    },
    endpoints: {
      sharedInbox: actor.sharedInboxUrl
    },
    ...icon,
    ...headerImage,
    ...(emojiTags.length > 0 ? { tag: emojiTags } : null),
    ...(profileFields.length > 0 ? { attachment: profileFields } : null)
  })

  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
      'https://purl.archive.org/socialweb/webfinger',
      {
        // Not in the ActivityStreams context document; Mastodon declares it
        // the same way so compacting peers keep the term.
        manuallyApprovesFollowers: 'as:manuallyApprovesFollowers',
        toot: 'http://joinmastodon.org/ns#',
        discoverable: 'toot:discoverable',
        indexable: 'toot:indexable',
        ...(attributionDomains.length > 0
          ? {
              attributionDomains: {
                '@id': 'toot:attributionDomains',
                '@type': '@id',
                '@container': '@set'
              }
            }
          : null),
        ...(actor.alsoKnownAs && actor.alsoKnownAs.length > 0
          ? {
              alsoKnownAs: {
                '@id': 'as:alsoKnownAs',
                '@type': '@id'
              }
            }
          : null),
        ...(actor.movedTo
          ? {
              movedTo: {
                '@id': 'as:movedTo',
                '@type': '@id'
              }
            }
          : null),
        ...(emojiTags.length > 0 ? { Emoji: 'toot:Emoji' } : null),
        // Mastodon declares the schema prefix with the non-standard
        // `http://schema.org#` base; the inbound canonical context uses the
        // same IRI, so keep it.
        ...(profileFields.length > 0
          ? {
              schema: 'http://schema.org#',
              PropertyValue: 'schema:PropertyValue',
              value: 'schema:value'
            }
          : null)
      }
    ],
    ...person
  }
}

import { Actor as ActivityPubActor } from '@llun/activities.schema'

import { Actor } from '@/lib/models/actor'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const getPersonFromActor = (
  actor: Actor
): ActivityPubActor & { '@context': string[] } => {
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
    type: 'Person',
    following: `https://${actor.domain}/users/${actor.username}/following`,
    followers: `https://${actor.domain}/users/${actor.username}/followers`,
    inbox: `https://${actor.domain}/users/${actor.username}/inbox`,
    outbox: `https://${actor.domain}/users/${actor.username}/outbox`,
    preferredUsername: actor.username,
    name: actor.name || '',
    summary: actor.summary || '',
    url: `https://${actor.domain}/@${actor.username}`,
    published: getISOTimeUTC(actor.createdAt),
    publicKey: {
      id: `${actor.id}#main-key`,
      owner: actor.id,
      publicKeyPem: actor.publicKey
    },
    endpoints: {
      sharedInbox: `https://${actor.domain}/inbox`
    },
    ...icon,
    ...headerImage
  })

  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    ...person
  }
}

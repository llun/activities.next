import type { NextApiRequest, NextApiResponse } from 'next'

import { PersonContext } from '../../../lib/activities/context'
import { Image } from '../../../lib/activities/entities/image'
import { Person } from '../../../lib/activities/entities/person'
import { getConfig } from '../../../lib/config'
import { ERROR_404, ERROR_500 } from '../../../lib/errors'
import { ACTIVITY_STREAM_URL } from '../../../lib/jsonld/activitystream'
import { W3ID_URL } from '../../../lib/jsonld/w3id'
import { getStorage } from '../../../lib/storage'
import { getISOTimeUTC } from '../../../lib/time'

type Data =
  | {
      error?: string
    }
  | Person

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const config = getConfig()
  const { actorId } = req.query

  const storage = await getStorage()
  if (!storage) {
    return res.status(500).json(ERROR_500)
  }

  const actor = await storage.getActorFromUsername({
    username: actorId as string
  })
  if (!actor) {
    return res.status(404).json(ERROR_404)
  }

  const icon = actor.iconUrl
    ? {
        icon: {
          type: 'Image',
          mediaType: 'image/jpeg',
          url: actor.iconUrl
        } as Image
      }
    : null
  const headerImage = actor.headerImageUrl
    ? {
        image: {
          type: 'Image',
          mediaType: 'image/png',
          url: actor.headerImageUrl
        } as Image
      }
    : null

  const user: Person = {
    '@context': [ACTIVITY_STREAM_URL, W3ID_URL],
    id: `https://${config.host}/users/${actorId}`,
    type: 'Person',
    following: `https://${config.host}/users/${actorId}/following`,
    followers: `https://${config.host}/users/${actorId}/followers`,
    inbox: `https://${config.host}/users/${actorId}/inbox`,
    outbox: `https://${config.host}/users/${actorId}/outbox`,
    preferredUsername: `${actorId}`,
    name: actor.name || '',
    summary: actor.summary || '',
    url: `https://${config.host}/@${actorId}`,
    published: getISOTimeUTC(actor.createdAt),
    publicKey: {
      id: `https://${config.host}/users/${actorId}#main-key`,
      owner: `https://${config.host}/users/${actorId}`,
      publicKeyPem: actor.publicKey
    },
    endpoints: {
      sharedInbox: `https://${config.host}/inbox`
    },
    ...icon,
    ...headerImage
  }
  res.status(200).json(user)
}

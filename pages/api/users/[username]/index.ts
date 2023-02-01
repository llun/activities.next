import type { NextApiRequest, NextApiResponse } from 'next'

import { Image } from '../../../../lib/activities/entities/image'
import { Person } from '../../../../lib/activities/entities/person'
import { RequestHost } from '../../../../lib/guard'
import { ACTIVITY_STREAM_URL } from '../../../../lib/jsonld/activitystream'
import { W3ID_URL } from '../../../../lib/jsonld/w3id'
import { ERROR_404, ERROR_500 } from '../../../../lib/responses'
import { getStorage } from '../../../../lib/storage'
import { getISOTimeUTC } from '../../../../lib/time'

type Data =
  | {
      error?: string
    }
  | Person

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const { username } = req.query

  const storage = await getStorage()
  if (!storage) {
    return res.status(500).json(ERROR_500)
  }

  const host = RequestHost(req)
  const actor = await storage.getActorFromUsername({
    username: username as string,
    domain: host as string
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
  }
  res.status(200).json(user)
}

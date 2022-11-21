import type { NextApiRequest, NextApiResponse } from 'next'
import { PersonContext } from '../../../lib/activities/context'
import { Person } from '../../../lib/activities/entities/person'
import { Image } from '../../../lib/activities/entities/image'
import { getConfig } from '../../../lib/config'
import { ERROR_404, ERROR_500 } from '../../../lib/errors'
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
  const { account } = req.query

  const storage = await getStorage()
  if (!storage) {
    return res.status(500).json(ERROR_500)
  }

  const actor = await storage.getActorFromUsername({
    username: account as string
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
    '@context': PersonContext,
    id: `https://${config.host}/users/${account}`,
    type: 'Person',
    following: `https://${config.host}/users/${account}/following`,
    followers: `https://${config.host}/users/${account}/followers`,
    inbox: `https://${config.host}/users/${account}/inbox`,
    outbox: `https://${config.host}/users/${account}/outbox`,
    featured: `https://${config.host}/users/${account}/collections/featured`,
    featuredTags: `https://${config.host}/users/${account}/collections/tags`,
    preferredUsername: `${account}`,
    name: actor.name || '',
    summary: actor.summary || '',
    url: `https://${config.host}/@${account}`,
    manuallyApprovesFollowers: false,
    discoverable: false,
    published: getISOTimeUTC(actor.createdAt),
    devices: `https://${config.host}/users/${account}/collections/devices`,
    publicKey: {
      id: `https://${config.host}/users/${account}#main-key`,
      owner: `https://${config.host}/users/${account}`,
      publicKeyPem: actor.publicKey
    },
    tag: [],
    attachment: [],
    endpoints: {
      sharedInbox: `https://${config.host}/inbox`
    },
    ...icon,
    ...headerImage
  }
  res.status(200).json(user)
}

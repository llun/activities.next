import type { NextApiRequest, NextApiResponse } from 'next'
import { Person, PersonContext } from '../../../lib/activities/types'
import { getConfig } from '../../../lib/config'
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
    return res.status(500).json({ error: 'Internal Server Error' })
  }

  const actor = await storage.getActorFromHandle(account as string)
  if (!actor) {
    return res.status(404).json({ error: 'Not Found' })
  }

  const user: Person = {
    ...PersonContext,
    id: `https://${config.host}/users/${account}`,
    type: 'Person',
    following: `https://${config.host}/users/${account}/following`,
    followers: `https://${config.host}/users/${account}/followers`,
    inbox: `https://${config.host}/users/${account}/inbox`,
    outbox: `https://${config.host}/users/${account}/outbox`,
    featured: `https://${config.host}/users/${account}/collections/featured`,
    featuredTags: `https://${config.host}/users/${account}/collections/tags`,
    preferredUsername: `${account}`,
    name: '',
    summary: '',
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
    }
  }
  res.status(200).json(user)
}

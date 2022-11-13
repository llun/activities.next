// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'
import formatInTimeZone from 'date-fns-tz/formatInTimeZone'
import { getConfig } from '../../../lib/config'
import { getStorage } from '../../../lib/storage'

const CONTEXT = {
  '@context': [
    'https://www.w3.org/ns/activitystreams',
    'https://w3id.org/security/v1',
    {
      manuallyApprovesFollowers: 'as:manuallyApprovesFollowers',
      toot: 'http://joinmastodon.org/ns#',
      featured: {
        '@id': 'toot:featured',
        '@type': '@id'
      },
      featuredTags: {
        '@id': 'toot:featuredTags',
        '@type': '@id'
      },
      alsoKnownAs: {
        '@id': 'as:alsoKnownAs',
        '@type': '@id'
      },
      movedTo: {
        '@id': 'as:movedTo',
        '@type': '@id'
      },
      schema: 'http://schema.org#',
      PropertyValue: 'schema:PropertyValue',
      value: 'schema:value',
      discoverable: 'toot:discoverable',
      Device: 'toot:Device',
      Ed25519Signature: 'toot:Ed25519Signature',
      Ed25519Key: 'toot:Ed25519Key',
      Curve25519Key: 'toot:Curve25519Key',
      EncryptedMessage: 'toot:EncryptedMessage',
      publicKeyBase64: 'toot:publicKeyBase64',
      deviceId: 'toot:deviceId',
      claim: {
        '@type': '@id',
        '@id': 'toot:claim'
      },
      fingerprintKey: {
        '@type': '@id',
        '@id': 'toot:fingerprintKey'
      },
      identityKey: {
        '@type': '@id',
        '@id': 'toot:identityKey'
      },
      devices: {
        '@type': '@id',
        '@id': 'toot:devices'
      },
      messageFranking: 'toot:messageFranking',
      messageType: 'toot:messageType',
      cipherText: 'toot:cipherText',
      suspended: 'toot:suspended'
    }
  ]
}

type Data =
  | {
      error?: string
    }
  | (typeof CONTEXT & {
      id: string
      type: string
      following: string
      followers: string
      inbox: string
      outbox: string
      featured: string
      featuredTags: string
      preferredUsername: string
      name: string
      summary: string
      url: string
      manuallyApprovesFollowers: boolean
      discoverable: boolean
      published: string
      devices: string
      publicKey: {
        id: string
        owner: string
        publicKeyPem: string
      }
      tag: string[]
      attachment: string[]
      endpoints: {
        sharedInbox: string
      }
    })

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

  const person = await storage.getAccountFromHandle(account as string)
  if (!person) {
    return res.status(404).json({ error: 'Not Found' })
  }

  const user = {
    ...CONTEXT,
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
    published: formatInTimeZone(
      person.createdAt,
      'GMT+0',
      "yyyy-MM-dd'T'HH:mm:ss'Z'"
    ),
    devices: `https://${config.host}/users/${account}/collections/devices`,
    publicKey: {
      id: `https://${config.host}/users/${account}#main-key`,
      owner: `https://${config.host}/users/${account}`,
      publicKeyPem: person.publicKey
    },
    tag: [],
    attachment: [],
    endpoints: {
      sharedInbox: `https://${config.host}/inbox`
    }
  }
  res.status(200).json(user)
}

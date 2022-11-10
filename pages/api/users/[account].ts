// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'
import { getConfig } from '../../../lib/config'

type Data = {
  name: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  const config = await getConfig()
  const { account } = req.query
  const user = {
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
    ],
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
    published: '2022-11-08T00:00:00Z',
    devices: `https://${config.host}/users/${account}/collections/devices`,
    publicKey: {
      id: `https://${config.host}/users/${account}#main-key`,
      owner: `https://${config.host}/users/${account}`,
      publicKeyPem: ''
    },
    tag: [],
    attachment: [],
    endpoints: {
      sharedInbox: `https://${config.host}/inbox`
    }
  }
  res.status(200).json(user)
}

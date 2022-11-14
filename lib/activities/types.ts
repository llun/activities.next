export const PersonContext = {
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

export type PropertyValue = {
  type: 'PropertyValue'
  name: string
  value: string
}

export type Image = {
  type: 'Image'
  mediaType: string
  url: string
}

export type Person = typeof PersonContext & {
  id: string
  type: 'Person'
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
  attachment: PropertyValue[]
  endpoints: {
    sharedInbox: string
  }
  icon?: Image
}

export type OrderedCollection = {
  '@context': 'https://www.w3.org/ns/activitystreams'
  id: string
  type: 'OrderedCollection'
  totalItems: number
  first: string
  last?: string
}

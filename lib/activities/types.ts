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

export type Mention = {
  type: 'Mention'
  href: string
  name: string
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
  tag: Mention[]
  attachment: PropertyValue[]
  endpoints: {
    sharedInbox: string
  }
  icon?: Image
  image?: Image
}

export type OrderedCollection = {
  '@context': 'https://www.w3.org/ns/activitystreams'
  id: string
  type: 'OrderedCollection'
  totalItems: number
  first: string
  last?: string
}

export type CollectionPage = {
  type: 'CollectionPage'
  next: string
  partOf: string
  items: []
}

export type Collection = {
  id: string
  type: 'Collection'
  first: CollectionPage
}

export type Note = {
  id: string
  type: 'Note'
  summary: null
  inReplyTo: string
  published: string
  url: string
  attributedTo: string
  to: string[]
  cc: string[]
  sensitive: boolean
  atomUri: string
  inReplyToAtomUri: string
  conversation: string
  content: string
  contentMap: {
    [locale: string]: string
  }
  attachment: PropertyValue[]
  tag: Mention[]
  replies: Collection
}

export type CreateActivity = {
  id: string
  type: 'Create'
  actor: string
  published: string
  to: string[]
  cc: string[]
  object: Note
}

export const OutboxContext = {
  '@context': [
    'https://www.w3.org/ns/activitystreams',
    {
      ostatus: 'http://ostatus.org#',
      atomUri: 'ostatus:atomUri',
      inReplyToAtomUri: 'ostatus:inReplyToAtomUri',
      conversation: 'ostatus:conversation',
      sensitive: 'as:sensitive',
      toot: 'http://joinmastodon.org/ns#',
      votersCount: 'toot:votersCount'
    }
  ]
}

export type OrderedCollectionPage = typeof OutboxContext & {
  id: string
  type: 'OrderedCollectionPage'
  next: string
  prev: string
  partOf: string
  orderedItems: CreateActivity[]
}

export type BaseFollow = {
  '@context': 'https://www.w3.org/ns/activitystreams'
  id: string
  actor: string
}

export type FollowRequest = BaseFollow & {
  type: 'Follow'
  object: string
}

export type FollowObject = {
  id: string
  type: 'Follow'
  actor: string
  object: string
}

export type AcceptFollow = BaseFollow & {
  type: 'Accept'
  object: FollowObject
}

export type RejectFollow = BaseFollow & {
  type: 'Reject'
  object: FollowObject
}

export type UndoFollow = BaseFollow & {
  type: 'Undo'
  object: FollowObject
}

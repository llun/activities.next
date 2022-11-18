export type Context =
  | string
  | { [key in string]: string | { '@id': string; '@type': string } }

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

export type Person = {
  '@context': Context | Context[]
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
  '@context': Context | Context[]
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

export type QuestionNote = {
  type: 'Note'
  name: string
  replies: { type: 'Collection'; totalItems: number }
}

export type Question = Note & {
  type: 'Question'
  endTime: string
  votersCount: number
  oneOf: QuestionNote[]
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

export type OrderedCollectionPage = {
  '@context': Context | Context[]
  id: string
  type: 'OrderedCollectionPage'
  next: string
  prev: string
  partOf: string
  orderedItems: CreateActivity[]
}

export type BaseFollow = {
  '@context': Context | Context[]
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

export type HashTag = {
  type: string
  href: string
  name: string
}

export type HashTagCollection = {
  '@context': Context | Context[]
  id: string
  type: 'Collection'
  totalItems: number
  items: HashTag[]
}

export type FeaturedOrderedItems = {
  '@context': Context | Context[]
  id: string
  type: 'OrderedCollection'
  totalItems: number
  orderedItems: Note[]
}

export type Signature = {
  type: string
  creator: string
  created: string
  signatureValue: string
}

export type BaseInboxActivity = {
  '@context': Context | Context[]
  id: string
  actor: string
  to: string[]
}

export type InboxCreate = BaseInboxActivity & {
  type: 'Create'
  published: string
  cc: string[]
  object: Note | Question
  signature: Signature
}

export type InboxAnnounce = BaseInboxActivity & {
  type: 'Announce'
  published: string
  cc: string[]
  object: string
}

export type InboxUndo = BaseInboxActivity & {
  type: 'Undo'
  object: InboxAnnounce
  signature: Signature
}

export type InboxUpdate = BaseInboxActivity & {
  type: 'Update'
  object: Note | Question
  signature: Signature
}

export type InboxActivities = InboxCreate | InboxAnnounce | InboxUndo

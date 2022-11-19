import { ContextEntity } from './base'
import { Image } from './image'
import { Mention } from './mention'
import { PropertyValue } from './propertyValue'

export interface Person extends ContextEntity {
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

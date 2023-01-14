import { ContextEntity } from './base'
import { Image } from './image'

export interface Person extends ContextEntity {
  id: string
  type: 'Person'
  following: string
  followers: string
  inbox: string
  outbox: string
  preferredUsername: string
  name: string
  summary: string
  url: string
  published: string
  publicKey: {
    id: string
    owner: string
    publicKeyPem: string
  }
  endpoints?: {
    sharedInbox?: string
  }
  icon?: Image
  image?: Image
}

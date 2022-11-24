import { Account } from './account'

export interface Actor {
  id: string
  preferredUsername: string
  name?: string
  summary?: string

  account?: Account
  following?: Actor

  manuallyApprovesFollowers: boolean
  discoverable: boolean

  iconUrl?: string
  headerImageUrl?: string

  publicKey: string
  privateKey: string

  createdAt: number
  updatedAt: number
}

export const getUsernameFromId = (actorId: string) => actorId.split('/').pop()
export const getHostnameFromId = (actorId: string) => new URL(actorId).hostname
export const getAtUsernameFromId = (actorId: string) =>
  `@${getUsernameFromId(actorId)}`
export const getAtWithHostFromId = (actorId: string) =>
  `${getAtUsernameFromId(actorId)}@${getHostnameFromId(actorId)}`

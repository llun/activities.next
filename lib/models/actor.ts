import { Account } from './account'

export interface Profile {
  id: string
  name?: string
  summary?: string
  iconUrl?: string
  headerImageUrl?: string
  appleSharedAlbumToken?: string
  createdAt: number
}

export interface Actor extends Profile {
  id: string
  preferredUsername: string

  account?: Account

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

export const getProfileFromActor = (actor: Actor) => ({
  id: actor.id,
  name: actor.name,
  summary: actor.summary,
  iconUrl: actor.iconUrl,
  headerImageUrl: actor.headerImageUrl,
  appleSharedAlbumToken: actor.appleSharedAlbumToken,
  createdAt: actor.createdAt
})

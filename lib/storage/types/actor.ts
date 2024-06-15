import { Mastodon } from '@llun/activities.schema'

import { Actor } from '../../models/actor'

export type CreateActorParams = {
  actorId: string

  username: string
  domain: string
  name?: string
  summary?: string
  iconUrl?: string
  headerImageUrl?: string

  inboxUrl: string
  sharedInboxUrl: string
  followersUrl: string

  publicKey: string
  privateKey?: string

  createdAt: number
}
export type GetActorFromEmailParams = { email: string }
export type GetActorFromUsernameParams = { username: string; domain: string }
export type GetActorFromIdParams = { id: string }
export type IsCurrentActorFollowingParams = {
  currentActorId: string
  followingActorId: string
}
export type UpdateActorParams = {
  actorId: string

  name?: string
  summary?: string
  iconUrl?: string
  headerImageUrl?: string
  appleSharedAlbumToken?: string

  publicKey?: string

  followersUrl?: string
  inboxUrl?: string
  sharedInboxUrl?: string
}
export type DeleteActorParams = {
  actorId: string
}

export type GetActorFollowingCountParams = { actorId: string }
export type GetActorFollowersCountParams = { actorId: string }

export type IsInternalActorParams = { actorId: string }

export interface ActorStorage {
  createActor(params: CreateActorParams): Promise<Actor | undefined>
  createMastodonActor(
    params: CreateActorParams
  ): Promise<Mastodon.Account | null>

  getActorFromEmail(params: GetActorFromEmailParams): Promise<Actor | undefined>
  getMastodonActorFromEmail(
    params: GetActorFromEmailParams
  ): Promise<Mastodon.Account | null>
  getActorFromUsername(
    params: GetActorFromUsernameParams
  ): Promise<Actor | undefined>
  getMastodonActorFromUsername(
    params: GetActorFromUsernameParams
  ): Promise<Mastodon.Account | null>
  getActorFromId(params: GetActorFromIdParams): Promise<Actor | undefined>
  getMastodonActorFromId(
    params: GetActorFromIdParams
  ): Promise<Mastodon.Account | null>
  updateActor(params: UpdateActorParams): Promise<Actor | undefined>
  deleteActor(params: DeleteActorParams): Promise<void>

  isCurrentActorFollowing(
    params: IsCurrentActorFollowingParams
  ): Promise<boolean>
  getActorFollowingCount(params: GetActorFollowingCountParams): Promise<number>
  getActorFollowersCount(params: GetActorFollowersCountParams): Promise<number>

  isInternalActor(params: IsInternalActorParams): Promise<boolean>
}

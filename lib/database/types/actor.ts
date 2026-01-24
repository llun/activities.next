import { Mastodon } from '@llun/activities.schema'

import { ActorSettings } from '@/lib/database/types/sql'
import { Actor } from '@/lib/models/actor'

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
  manuallyApprovesFollowers?: boolean
  emailNotifications?: {
    follow_request?: boolean
    follow?: boolean
    like?: boolean
    mention?: boolean
    reply?: boolean
    reblog?: boolean
  }

  publicKey?: string

  followersUrl?: string
  inboxUrl?: string
  sharedInboxUrl?: string
}
export type DeleteActorParams = {
  actorId: string
}

export type ScheduleActorDeletionParams = {
  actorId: string
  scheduledAt: Date | null // null means immediate deletion
}

export type CancelActorDeletionParams = {
  actorId: string
}

export type GetActorsScheduledForDeletionParams = {
  beforeDate: Date
}

export type StartActorDeletionParams = {
  actorId: string
}

export type DeleteActorDataParams = {
  actorId: string
}

export type GetActorFollowingCountParams = { actorId: string }
export type GetActorFollowersCountParams = { actorId: string }
export type GetActorSettingsParams = { actorId: string }

export type IsInternalActorParams = { actorId: string }

export interface ActorDatabase {
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

  // Deletion scheduling methods
  scheduleActorDeletion(params: ScheduleActorDeletionParams): Promise<void>
  cancelActorDeletion(params: CancelActorDeletionParams): Promise<void>
  startActorDeletion(params: StartActorDeletionParams): Promise<void>
  getActorsScheduledForDeletion(
    params: GetActorsScheduledForDeletionParams
  ): Promise<Actor[]>
  getActorDeletionStatus(
    params: GetActorFromIdParams
  ): Promise<{ status: string | null; scheduledAt: number | null } | undefined>
  deleteActorData(params: DeleteActorDataParams): Promise<void>

  isCurrentActorFollowing(
    params: IsCurrentActorFollowingParams
  ): Promise<boolean>
  getActorFollowingCount(params: GetActorFollowingCountParams): Promise<number>
  getActorFollowersCount(params: GetActorFollowersCountParams): Promise<number>

  isInternalActor(params: IsInternalActorParams): Promise<boolean>
  getActorSettings(
    params: GetActorSettingsParams
  ): Promise<ActorSettings | undefined>
}

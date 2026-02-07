import { Firestore } from '@google-cloud/firestore'

import { getCompatibleTime } from '@/lib/database/firestore/utils'
import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue
} from '@/lib/database/firestore/utils/counter'
import {
  ActorDatabase,
  CancelActorDeletionParams,
  CreateActorParams,
  DeleteActorDataParams,
  DeleteActorParams,
  GetActorFollowersCountParams,
  GetActorFollowingCountParams,
  GetActorFromEmailParams,
  GetActorFromIdParams,
  GetActorFromUsernameParams,
  GetActorSettingsParams,
  GetActorsScheduledForDeletionParams,
  IsCurrentActorFollowingParams,
  IsInternalActorParams,
  ScheduleActorDeletionParams,
  StartActorDeletionParams,
  UpdateActorParams
} from '@/lib/types/database/operations'
import { ActorSettings } from '@/lib/types/database/rows'
import { Actor } from '@/lib/types/domain/actor'
import * as Mastodon from '@/lib/types/mastodon'

interface ActorData {
  id: string
  accountId?: string
  username: string
  domain: string
  name?: string
  summary?: string
  settings: string
  publicKey: string
  privateKey?: string
  lastStatusAt?: number
  deletionStatus?: string
  deletionScheduledAt?: number
  createdAt: number
  updatedAt: number
}

interface AccountData {
  id: string
  email: string
  createdAt: number
  updatedAt: number
  verifiedAt?: number
}

export const ActorFirestoreDatabaseMixin = (
  database: Firestore
): ActorDatabase => ({
  async createActor(params: CreateActorParams): Promise<Actor | null> {
    const actorId = params.actorId
    const currentTime = new Date()
    const actorSettings: ActorSettings = {
      followersUrl: params.followersUrl,
      inboxUrl: params.inboxUrl,
      sharedInboxUrl: params.sharedInboxUrl
    }

    const data = {
      id: actorId,
      username: params.username,
      domain: params.domain,
      name: params.name ?? null,
      summary: params.summary ?? null,
      followersUrl: params.followersUrl,
      inboxUrl: params.inboxUrl,
      sharedInboxUrl: params.sharedInboxUrl,
      settings: JSON.stringify(actorSettings),
      publicKey: params.publicKey,
      privateKey: params.privateKey ?? null,
      createdAt: new Date(params.createdAt),
      updatedAt: currentTime
    }

    await database
      .collection('actors')
      .doc(encodeURIComponent(actorId))
      .set(data)
    return this.getActorFromId({ id: actorId })
  },

  async createMastodonActor(
    params: CreateActorParams
  ): Promise<Mastodon.Account | null> {
    const actor = await this.createActor(params)
    if (!actor) return null
    return actor.toMastodonAccount()
  },

  async getActorFromId({ id }: GetActorFromIdParams): Promise<Actor | null> {
    const doc = await database
      .collection('actors')
      .doc(encodeURIComponent(id))
      .get()
    if (!doc.exists) return null
    const data = doc.data() as ActorData

    // We need account here, but ActorDatabase doesn't have AccountDatabase.
    // In SQL version, it's joined or fetched separately.
    // For now, I'll fetch account if accountId exists.
    let account = null
    if (data.accountId) {
      const accountDoc = await database
        .collection('accounts')
        .doc(data.accountId)
        .get()
      if (accountDoc.exists) {
        const accountData = accountDoc.data() as AccountData
        account = {
          ...accountData,
          createdAt: getCompatibleTime(accountData.createdAt),
          updatedAt: getCompatibleTime(accountData.updatedAt),
          verifiedAt: getCompatibleTime(accountData.verifiedAt)
        }
      }
    }

    const settings = JSON.parse(data.settings) as ActorSettings

    const [followingCount, followersCount, statusCount] = await Promise.all([
      getCounterValue(database, CounterKey.totalFollowing(data.id)),
      getCounterValue(database, CounterKey.totalFollowers(data.id)),
      getCounterValue(database, CounterKey.totalStatus(data.id))
    ])

    return Actor.parse({
      id: data.id,
      username: data.username,
      domain: data.domain,
      name: data.name ?? null,
      summary: data.summary ?? null,
      iconUrl: settings.iconUrl ?? null,
      headerImageUrl: settings.headerImageUrl ?? null,
      manuallyApprovesFollowers: settings.manuallyApprovesFollowers ?? true,
      followersUrl: settings.followersUrl,
      inboxUrl: settings.inboxUrl,
      sharedInboxUrl: settings.sharedInboxUrl,
      publicKey: data.publicKey,
      privateKey: data.privateKey ?? null,
      account,
      followingCount,
      followersCount,
      statusCount,
      lastStatusAt: getCompatibleTime(data.lastStatusAt),
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt),
      deletionStatus: data.deletionStatus ?? null,
      deletionScheduledAt: getCompatibleTime(data.deletionScheduledAt)
    })
  },

  async getActorFromEmail({
    email
  }: GetActorFromEmailParams): Promise<Actor | null> {
    const accountResult = await database
      .collection('accounts')
      .where('email', '==', email)
      .limit(1)
      .get()
    if (accountResult.empty) return null
    const accountId = accountResult.docs[0].id

    const actorResult = await database
      .collection('actors')
      .where('accountId', '==', accountId)
      .limit(1)
      .get()
    if (actorResult.empty) return null
    return this.getActorFromId({ id: actorResult.docs[0].data().id })
  },

  async getActorFromUsername({
    username,
    domain
  }: GetActorFromUsernameParams): Promise<Actor | null> {
    const result = await database
      .collection('actors')
      .where('username', '==', username)
      .where('domain', '==', domain)
      .limit(1)
      .get()
    if (result.empty) return null
    return this.getActorFromId({ id: result.docs[0].data().id })
  },

  async getMastodonActorFromEmail(
    params: GetActorFromEmailParams
  ): Promise<Mastodon.Account | null> {
    const actor = await this.getActorFromEmail(params)
    return actor?.toMastodonAccount() ?? null
  },

  async getMastodonActorFromUsername(
    params: GetActorFromUsernameParams
  ): Promise<Mastodon.Account | null> {
    const actor = await this.getActorFromUsername(params)
    return actor?.toMastodonAccount() ?? null
  },

  async getMastodonActorFromId(
    params: GetActorFromIdParams
  ): Promise<Mastodon.Account | null> {
    const actor = await this.getActorFromId(params)
    return actor?.toMastodonAccount() ?? null
  },

  async updateActor(params: UpdateActorParams): Promise<Actor | null> {
    const { actorId, ...updateParams } = params
    const docRef = database
      .collection('actors')
      .doc(encodeURIComponent(actorId))
    const doc = await docRef.get()
    if (!doc.exists) return null

    const data = doc.data() as ActorData
    const settings = JSON.parse(data.settings) as ActorSettings

    if (updateParams.iconUrl) settings.iconUrl = updateParams.iconUrl
    if (updateParams.headerImageUrl)
      settings.headerImageUrl = updateParams.headerImageUrl
    if (updateParams.manuallyApprovesFollowers !== undefined)
      settings.manuallyApprovesFollowers =
        updateParams.manuallyApprovesFollowers
    if (updateParams.emailNotifications)
      settings.emailNotifications = updateParams.emailNotifications
    if (updateParams.fitness) settings.fitness = updateParams.fitness

    const updateData: any = {
      settings: JSON.stringify(settings),
      updatedAt: new Date()
    }
    if (updateParams.name) updateData.name = updateParams.name
    if (updateParams.summary) updateData.summary = updateParams.summary
    if (updateParams.publicKey) updateData.publicKey = updateParams.publicKey

    await docRef.update(updateData)
    return this.getActorFromId({ id: actorId })
  },

  async deleteActor({ actorId }: DeleteActorParams): Promise<void> {
    await database.collection('actors').doc(encodeURIComponent(actorId)).delete()
  },

  async updateActorFollowersCount(actorId: string): Promise<void> {
    await increaseCounterValue(database, CounterKey.totalFollowers(actorId))
  },

  async updateActorFollowingCount(actorId: string): Promise<void> {
    await increaseCounterValue(database, CounterKey.totalFollowing(actorId))
  },

  async increaseActorStatusCount(
    actorId: string,
    amount?: number
  ): Promise<void> {
    await increaseCounterValue(database, CounterKey.totalStatus(actorId), amount)
  },

  async decreaseActorStatusCount(
    actorId: string,
    amount?: number
  ): Promise<void> {
    await decreaseCounterValue(database, CounterKey.totalStatus(actorId), amount)
  },

  async updateActorLastStatusAt(actorId: string, time: number): Promise<void> {
    await database.collection('actors').doc(encodeURIComponent(actorId)).update({
      lastStatusAt: new Date(time),
      updatedAt: new Date()
    })
  },

  async isCurrentActorFollowing({
    currentActorId,
    followingActorId
  }: IsCurrentActorFollowingParams): Promise<boolean> {
    const result = await database
      .collection('follows')
      .where('actorId', '==', currentActorId)
      .where('targetActorId', '==', followingActorId)
      .where('status', '==', 'Accepted')
      .limit(1)
      .get()
    return !result.empty
  },

  async scheduleActorDeletion({
    actorId,
    scheduledAt
  }: ScheduleActorDeletionParams): Promise<void> {
    await database.collection('actors').doc(encodeURIComponent(actorId)).update({
      deletionStatus: 'scheduled',
      deletionScheduledAt: scheduledAt,
      updatedAt: new Date()
    })
  },

  async cancelActorDeletion({
    actorId
  }: CancelActorDeletionParams): Promise<void> {
    await database.collection('actors').doc(encodeURIComponent(actorId)).update({
      deletionStatus: null,
      deletionScheduledAt: null,
      updatedAt: new Date()
    })
  },

  async startActorDeletion({
    actorId
  }: StartActorDeletionParams): Promise<void> {
    await database.collection('actors').doc(encodeURIComponent(actorId)).update({
      deletionStatus: 'deleting',
      updatedAt: new Date()
    })
  },

  async getActorsScheduledForDeletion({
    beforeDate
  }: GetActorsScheduledForDeletionParams): Promise<Actor[]> {
    const result = await database
      .collection('actors')
      .where('deletionStatus', '==', 'scheduled')
      .where('deletionScheduledAt', '<=', beforeDate)
      .get()
    const actors = await Promise.all(
      result.docs.map((doc) => this.getActorFromId({ id: doc.data().id }))
    )
    return actors.filter((actor): actor is Actor => actor !== null)
  },

  async deleteActorData({ actorId }: DeleteActorDataParams): Promise<void> {
    // This should delete everything related to the actor.
    // In SQL it might be handled by cascade or manual deletes.
    // For now, let's just mark as deleted.
    await database.collection('actors').doc(encodeURIComponent(actorId)).update({
      deletionStatus: 'deleted',
      updatedAt: new Date()
    })
  },

  async getActorDeletionStatus({
    id
  }: GetActorFromIdParams): Promise<
    { status: string | null; scheduledAt: number | null } | undefined
  > {
    const doc = await database
      .collection('actors')
      .doc(encodeURIComponent(id))
      .get()
    if (!doc.exists) return undefined
    const data = doc.data() as ActorData
    return {
      status: data.deletionStatus ?? null,
      scheduledAt: getCompatibleTime(data.deletionScheduledAt)
    }
  },

  async getActorFollowingCount(
    params: GetActorFollowingCountParams
  ): Promise<number> {
    return getCounterValue(database, CounterKey.totalFollowing(params.actorId))
  },

  async getActorFollowersCount(
    params: GetActorFollowersCountParams
  ): Promise<number> {
    return getCounterValue(database, CounterKey.totalFollowers(params.actorId))
  },

  async isInternalActor({ actorId }: IsInternalActorParams): Promise<boolean> {
    const doc = await database
      .collection('actors')
      .doc(encodeURIComponent(actorId))
      .get()
    if (!doc.exists) return false
    return !!doc.data()?.accountId
  },

  async getActorSettings({
    actorId
  }: GetActorSettingsParams): Promise<ActorSettings | undefined> {
    const doc = await database
      .collection('actors')
      .doc(encodeURIComponent(actorId))
      .get()
    if (!doc.exists) return undefined
    return JSON.parse(doc.data()?.settings)
  }
})

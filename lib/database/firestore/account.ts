import { Firestore } from '@google-cloud/firestore'

import { getCompatibleTime } from '@/lib/database/firestore/utils'
import {
  AccountDatabase,
  ChangePasswordParams,
  CreateAccountParams,
  CreateAccountSessionParams,
  CreateActorForAccountParams,
  DeleteAccountSessionParams,
  GetAccountAllSessionsParams,
  GetAccountFromEmailParams,
  GetAccountFromIdParams,
  GetAccountFromProviderIdParams,
  GetAccountProvidersParams,
  GetAccountSessionParams,
  GetActorsForAccountParams,
  IsAccountExistsParams,
  IsUsernameExistsParams,
  LinkAccountWithProviderParams,
  RequestEmailChangeParams,
  SetDefaultActorParams,
  SetSessionActorParams,
  UnlinkAccountFromProviderParams,
  UpdateAccountSessionParams,
  VerifyAccountParams,
  VerifyEmailChangeParams
} from '@/lib/types/database/operations'
import { ActorSettings } from '@/lib/types/database/rows'
import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'
import { Session } from '@/lib/types/domain/session'

interface AccountData {
  id: string
  email: string
  passwordHash: string
  verificationCode?: string
  verifiedAt?: number
  emailVerifiedAt?: number
  emailChangeCode?: string
  emailChangeCodeExpiresAt?: number
  emailChangePending?: string
  defaultActorId?: string
  createdAt: number
  updatedAt: number
}

interface ActorData {
  id: string
  accountId: string
  username: string
  domain: string
  name?: string
  summary?: string
  iconUrl?: string
  headerImageUrl?: string
  followersUrl: string
  inboxUrl: string
  sharedInboxUrl: string
  publicKey: string
  privateKey?: string
  createdAt: number
  updatedAt: number
  lastStatusAt?: number
  deletionStatus?: string
  deletionScheduledAt?: number
  settings: string
  manuallyApprovesFollowers?: boolean
}

interface SessionData {
  id: string
  accountId: string
  token: string
  actorId?: string | null
  expireAt: number
  createdAt: number
  updatedAt: number
}

interface AccountProviderData {
  id: string
  provider: string
  providerId: string
  accountId: string
  createdAt: number
  updatedAt: number
}

export const AccountFirestoreDatabaseMixin = (
  database: Firestore
): AccountDatabase => ({
  async isAccountExists({ email }: IsAccountExistsParams) {
    const result = await database
      .collection('accounts')
      .where('email', '==', email)
      .limit(1)
      .get()
    return !result.empty
  },

  async isUsernameExists({ username, domain }: IsUsernameExistsParams) {
    const result = await database
      .collection('actors')
      .where('username', '==', username)
      .where('domain', '==', domain)
      .limit(1)
      .get()
    return !result.empty
  },

  async createAccount({
    email,
    username,
    passwordHash,
    verificationCode,
    domain,
    privateKey,
    publicKey
  }: CreateAccountParams) {
    const accountId = crypto.randomUUID()
    const actorId = `https://${domain}/users/${username}`
    const currentTime = new Date()

    const actorSettings: ActorSettings = {
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${domain}/inbox`
    }

    await database.runTransaction(async (trx) => {
      trx.set(database.collection('accounts').doc(accountId), {
        id: accountId,
        email,
        passwordHash,
        ...(verificationCode
          ? { verificationCode }
          : { verifiedAt: currentTime }),
        createdAt: currentTime,
        updatedAt: currentTime
      })
      trx.set(database.collection('actors').doc(encodeURIComponent(actorId)), {
        id: actorId,
        accountId,
        username,
        domain,
        settings: JSON.stringify(actorSettings),
        publicKey,
        privateKey,
        createdAt: currentTime,
        updatedAt: currentTime
      })
    })

    return accountId
  },

  async getAccountFromId({ id }: GetAccountFromIdParams) {
    const doc = await database.collection('accounts').doc(id).get()
    if (!doc.exists) return null
    const account = doc.data() as AccountData
    return {
      ...account,
      verifiedAt: getCompatibleTime(account.verifiedAt),
      emailVerifiedAt: getCompatibleTime(account.emailVerifiedAt),
      emailChangeCodeExpiresAt: getCompatibleTime(
        account.emailChangeCodeExpiresAt
      ),
      createdAt: getCompatibleTime(account.createdAt),
      updatedAt: getCompatibleTime(account.updatedAt)
    }
  },

  async getAccountFromEmail({
    email
  }: GetAccountFromEmailParams): Promise<Account | null> {
    const result = await database
      .collection('accounts')
      .where('email', '==', email)
      .limit(1)
      .get()
    if (result.empty) return null
    const account = result.docs[0].data() as AccountData
    return {
      ...account,
      verifiedAt: getCompatibleTime(account.verifiedAt),
      emailVerifiedAt: getCompatibleTime(account.emailVerifiedAt),
      emailChangeCodeExpiresAt: getCompatibleTime(
        account.emailChangeCodeExpiresAt
      ),
      createdAt: getCompatibleTime(account.createdAt),
      updatedAt: getCompatibleTime(account.updatedAt)
    }
  },

  async getAccountFromProviderId({
    provider,
    accountId
  }: GetAccountFromProviderIdParams): Promise<Account | null> {
    const result = await database
      .collection('account_providers')
      .where('provider', '==', provider)
      .where('providerId', '==', accountId)
      .limit(1)
      .get()
    if (result.empty) return null
    const providerData = result.docs[0].data()
    return this.getAccountFromId({ id: providerData.accountId })
  },

  async linkAccountWithProvider({
    accountId,
    providerAccountId,
    provider
  }: LinkAccountWithProviderParams): Promise<Account | null> {
    const [existingLinkAccount, account] = await Promise.all([
      database
        .collection('account_providers')
        .where('provider', '==', provider)
        .where('providerId', '==', providerAccountId)
        .limit(1)
        .get(),
      this.getAccountFromId({ id: accountId })
    ])

    if (!existingLinkAccount.empty) return null
    if (!account) return null

    const currentTime = new Date()
    const id = crypto.randomUUID()
    await database.collection('account_providers').doc(id).set({
      id,
      provider,
      providerId: providerAccountId,
      accountId,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    return account
  },

  async verifyAccount({ verificationCode }: VerifyAccountParams) {
    const result = await database
      .collection('accounts')
      .where('verificationCode', '==', verificationCode)
      .limit(1)
      .get()
    if (result.empty) return null

    const account = result.docs[0].data()
    const currentTime = new Date()
    await database.collection('accounts').doc(account.id).update({
      verificationCode: '',
      verifiedAt: currentTime,
      updatedAt: currentTime
    })
    return this.getAccountFromId({ id: account.id })
  },

  async createAccountSession({
    accountId,
    expireAt,
    token,
    actorId
  }: CreateAccountSessionParams): Promise<void> {
    const currentTime = new Date()
    const id = crypto.randomUUID()
    await database.collection('sessions').doc(token).set({
      id,
      accountId,
      token,
      actorId: actorId ?? null,
      expireAt: new Date(expireAt),
      createdAt: currentTime,
      updatedAt: currentTime
    })
  },

  async getAccountSession({ token }: GetAccountSessionParams): Promise<{
    account: Account
    session: Session
  } | null> {
    const doc = await database.collection('sessions').doc(token).get()
    if (!doc.exists) return null

    const sessionData = doc.data() as SessionData
    const account = await this.getAccountFromId({ id: sessionData.accountId })
    if (!account) return null

    return {
      account,
      session: Session.parse({
        accountId: sessionData.accountId,
        actorId: sessionData.actorId ?? null,
        expireAt: getCompatibleTime(sessionData.expireAt),
        token: sessionData.token,
        createdAt: getCompatibleTime(sessionData.createdAt),
        updatedAt: getCompatibleTime(sessionData.updatedAt)
      })
    }
  },

  async getAccountAllSessions({
    accountId
  }: GetAccountAllSessionsParams): Promise<Session[]> {
    const result = await database
      .collection('sessions')
      .where('accountId', '==', accountId)
      .get()
    return result.docs.map((doc) => {
      const data = doc.data() as SessionData
      return Session.parse({
        ...data,
        actorId: data.actorId ?? null,
        expireAt: getCompatibleTime(data.expireAt),
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    })
  },

  async updateAccountSession({
    token,
    expireAt
  }: UpdateAccountSessionParams): Promise<void> {
    if (!expireAt) return
    await database
      .collection('sessions')
      .doc(token)
      .update({ expireAt: new Date(expireAt) })
  },

  async deleteAccountSession({
    token
  }: DeleteAccountSessionParams): Promise<void> {
    await database.collection('sessions').doc(token).delete()
  },

  async getAccountProviders({ accountId }: GetAccountProvidersParams): Promise<
    {
      provider: string
      providerId: string
      createdAt: number
      updatedAt: number
    }[]
  > {
    const result = await database
      .collection('account_providers')
      .where('accountId', '==', accountId)
      .get()
    return result.docs.map((doc) => {
      const data = doc.data() as AccountProviderData
      return {
        provider: data.provider,
        providerId: data.providerId,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      }
    })
  },

  async unlinkAccountFromProvider({
    accountId,
    provider
  }: UnlinkAccountFromProviderParams): Promise<void> {
    const result = await database
      .collection('account_providers')
      .where('accountId', '==', accountId)
      .where('provider', '==', provider)
      .get()
    const batch = database.batch()
    result.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
  },

  async createActorForAccount({
    accountId,
    username,
    domain,
    privateKey,
    publicKey
  }: CreateActorForAccountParams): Promise<string> {
    const actorId = `https://${domain}/users/${username}`
    const currentTime = new Date()

    const actorSettings: ActorSettings = {
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${domain}/inbox`
    }

    await database.collection('actors').doc(encodeURIComponent(actorId)).set({
      id: actorId,
      accountId,
      username,
      domain,
      settings: JSON.stringify(actorSettings),
      publicKey,
      privateKey,
      createdAt: currentTime,
      updatedAt: currentTime
    })

    return actorId
  },

  async getActorsForAccount({
    accountId
  }: GetActorsForAccountParams): Promise<Actor[]> {
    const result = await database
      .collection('actors')
      .where('accountId', '==', accountId)
      .get()
    if (result.empty) return []

    const account = await this.getAccountFromId({ id: accountId })
    if (!account) return []

    const results: Actor[] = []
    for (const doc of result.docs) {
      const data = doc.data() as ActorData
      // In Firestore implementation, we might need a separate way to handle counters
      // For now, I'll just put 0 or fetch them if I implement counters collection
      results.push(
        Actor.parse({
          id: data.id,
          username: data.username,
          domain: data.domain,
          name: data.name ?? null,
          summary: data.summary ?? null,
          iconUrl: data.iconUrl ?? null,
          headerImageUrl: data.headerImageUrl ?? null,
          manuallyApprovesFollowers: data.manuallyApprovesFollowers ?? true,
          followersUrl: data.followersUrl,
          inboxUrl: data.inboxUrl,
          sharedInboxUrl: data.sharedInboxUrl,
          publicKey: data.publicKey,
          privateKey: data.privateKey ?? null,
          account,
          followingCount: 0, // TODO: Implement counters
          followersCount: 0, // TODO: Implement counters
          statusCount: 0, // TODO: Implement counters
          lastStatusAt: getCompatibleTime(data.lastStatusAt),
          createdAt: getCompatibleTime(data.createdAt),
          updatedAt: getCompatibleTime(data.updatedAt),
          deletionStatus: data.deletionStatus ?? null,
          deletionScheduledAt: getCompatibleTime(data.deletionScheduledAt)
        })
      )
    }
    return results
  },

  async setDefaultActor({
    accountId,
    actorId
  }: SetDefaultActorParams): Promise<void> {
    const currentTime = new Date()
    await database.collection('accounts').doc(accountId).update({
      defaultActorId: actorId,
      updatedAt: currentTime
    })
  },

  async setSessionActor({
    token,
    actorId
  }: SetSessionActorParams): Promise<void> {
    const currentTime = new Date()
    await database.collection('sessions').doc(token).update({
      actorId,
      updatedAt: currentTime
    })
  },

  async requestEmailChange({
    accountId,
    newEmail,
    emailChangeCode
  }: RequestEmailChangeParams): Promise<void> {
    const currentTime = new Date()
    const expiresAt = new Date(currentTime.getTime() + 24 * 60 * 60 * 1000)
    await database.collection('accounts').doc(accountId).update({
      emailChangePending: newEmail,
      emailChangeCode,
      emailChangeCodeExpiresAt: expiresAt,
      updatedAt: currentTime
    })
  },

  async verifyEmailChange({
    accountId,
    emailChangeCode
  }: VerifyEmailChangeParams): Promise<Account | null> {
    let accountDoc
    if (accountId) {
      accountDoc = await database.collection('accounts').doc(accountId).get()
    } else {
      const result = await database
        .collection('accounts')
        .where('emailChangeCode', '==', emailChangeCode)
        .limit(1)
        .get()
      if (!result.empty) {
        accountDoc = result.docs[0]
      }
    }

    if (!accountDoc || !accountDoc.exists) return null
    const account = accountDoc.data() as AccountData
    if (account.emailChangeCode !== emailChangeCode) return null

    const now = new Date()
    if (
      account.emailChangeCodeExpiresAt &&
      now > getCompatibleTime(account.emailChangeCodeExpiresAt)
    ) {
      return null
    }

    const pendingEmail = account.emailChangePending
    if (!pendingEmail) return null

    await database.collection('accounts').doc(account.id).update({
      email: pendingEmail,
      emailVerifiedAt: now,
      emailChangePending: null,
      emailChangeCode: null,
      emailChangeCodeExpiresAt: null,
      updatedAt: now
    })

    return this.getAccountFromId({ id: account.id })
  },

  async changePassword({
    accountId,
    newPasswordHash
  }: ChangePasswordParams): Promise<void> {
    const currentTime = new Date()
    await database.collection('accounts').doc(accountId).update({
      passwordHash: newPasswordHash,
      updatedAt: currentTime
    })
  }
})

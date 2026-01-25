import { Knex } from 'knex'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
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
} from '@/lib/database/types/account'
import { ActorSettings } from '@/lib/database/types/sql'
import { Account } from '@/lib/models/account'
import { Actor } from '@/lib/models/actor'
import { Session } from '@/lib/models/session'

export const AccountSQLDatabaseMixin = (database: Knex): AccountDatabase => ({
  async isAccountExists({ email }: IsAccountExistsParams) {
    const result = await database('accounts')
      .where('email', email)
      .count<{ count: string }>('id as count')
      .first()
    return parseInt(result?.count ?? '0', 10) > 0
  },

  async isUsernameExists({ username, domain }: IsUsernameExistsParams) {
    const response = await database('actors')
      .where('username', username)
      .andWhere('domain', domain)
      .count<{ count: string }>('id as count')
      .first()
    return parseInt(response?.count ?? '0', 10) > 0
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

    await database.transaction(async (trx) => {
      await trx('accounts').insert({
        id: accountId,
        email,
        passwordHash,
        ...(verificationCode
          ? { verificationCode }
          : { verifiedAt: currentTime }),
        createdAt: currentTime,
        updatedAt: currentTime
      })
      await trx('actors').insert({
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
    const account = await database('accounts').where('id', id).first()
    if (!account) return null
    return {
      ...account,
      ...(account.verifiedAt
        ? { verifiedAt: getCompatibleTime(account.verifiedAt) }
        : null),
      ...(account.emailVerifiedAt
        ? { emailVerifiedAt: getCompatibleTime(account.emailVerifiedAt) }
        : null),
      ...(account.emailChangeCodeExpiresAt
        ? {
            emailChangeCodeExpiresAt: getCompatibleTime(
              account.emailChangeCodeExpiresAt
            )
          }
        : null),
      createdAt: getCompatibleTime(account.createdAt),
      updatedAt: getCompatibleTime(account.updatedAt)
    }
  },

  async getAccountFromEmail({
    email
  }: GetAccountFromEmailParams): Promise<Account | null> {
    const account = await database('accounts').where('email', email).first()
    if (!account) return null
    return {
      ...account,
      ...(account.verifiedAt
        ? { verifiedAt: getCompatibleTime(account.verifiedAt) }
        : null),
      ...(account.emailVerifiedAt
        ? { emailVerifiedAt: getCompatibleTime(account.emailVerifiedAt) }
        : null),
      ...(account.emailChangeCodeExpiresAt
        ? {
            emailChangeCodeExpiresAt: getCompatibleTime(
              account.emailChangeCodeExpiresAt
            )
          }
        : null),
      createdAt: getCompatibleTime(account.createdAt),
      updatedAt: getCompatibleTime(account.updatedAt)
    }
  },

  async getAccountFromProviderId({
    provider,
    accountId
  }: GetAccountFromProviderIdParams): Promise<Account | null> {
    const account = await database('account_providers')
      .where('provider', provider)
      .where('providerId', accountId)
      .join('accounts', 'account_providers.accountId', '=', 'accounts.id')
      .select<Account>('accounts.*')
      .first()
    if (!account) return null
    return {
      ...account,
      ...(account.verifiedAt
        ? { verifiedAt: getCompatibleTime(account.verifiedAt) }
        : null),
      ...(account.emailVerifiedAt
        ? { emailVerifiedAt: getCompatibleTime(account.emailVerifiedAt) }
        : null),
      ...(account.emailChangeCodeExpiresAt
        ? {
            emailChangeCodeExpiresAt: getCompatibleTime(
              account.emailChangeCodeExpiresAt
            )
          }
        : null),
      createdAt: getCompatibleTime(account.createdAt),
      updatedAt: getCompatibleTime(account.updatedAt)
    }
  },

  async linkAccountWithProvider({
    accountId,
    providerAccountId,
    provider
  }: LinkAccountWithProviderParams): Promise<Account | null> {
    const [existingLinkAccount, account] = await Promise.all([
      database('account_providers')
        .where('provider', provider)
        .where('providerId', providerAccountId)
        .first(),
      database('accounts').where('id', accountId).first()
    ])

    if (existingLinkAccount) return null
    if (!account) return null

    const currentTime = new Date()
    await database('account_providers').insert({
      id: crypto.randomUUID(),
      provider,
      providerId: providerAccountId,
      accountId,

      createdAt: currentTime,
      updatedAt: currentTime
    })
    return {
      ...account,
      ...(account.verifiedAt
        ? { verifiedAt: getCompatibleTime(account.verifiedAt) }
        : null),
      createdAt: getCompatibleTime(account.createdAt),
      updatedAt: getCompatibleTime(account.updatedAt)
    }
  },

  async verifyAccount({ verificationCode }: VerifyAccountParams) {
    const account = await database('accounts')
      .where('verificationCode', verificationCode)
      .first<Account>()
    if (!account) return null

    const currentTime = new Date()
    await database('accounts').where('id', account.id).update({
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

    await database('sessions').insert({
      id: crypto.randomUUID(),
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
    const session = await database('sessions').where('token', token).first()
    if (!session) return null

    const {
      accountId,
      token: sessionToken,
      actorId,
      expireAt,
      createdAt,
      updatedAt
    } = session
    const account = await this.getAccountFromId({ id: accountId })
    if (!account) return null

    return {
      account,
      session: Session.parse({
        accountId,
        actorId: actorId ?? null,
        expireAt: getCompatibleTime(expireAt),
        token: sessionToken,
        createdAt: getCompatibleTime(createdAt),
        updatedAt: getCompatibleTime(updatedAt)
      })
    }
  },

  async getAccountAllSessions({
    accountId
  }: GetAccountAllSessionsParams): Promise<Session[]> {
    const session = await database<Session>('sessions').where(
      'accountId',
      accountId
    )
    if (!session) return []
    return session.map((session) =>
      Session.parse({
        ...session,
        actorId: session.actorId ?? null,
        expireAt: getCompatibleTime(session.expireAt),
        createdAt: getCompatibleTime(session.createdAt),
        updatedAt: getCompatibleTime(session.updatedAt)
      })
    )
  },

  async updateAccountSession({
    token,
    expireAt
  }: UpdateAccountSessionParams): Promise<void> {
    if (!expireAt) return

    return database('sessions')
      .where('token', token)
      .update({ expireAt: new Date(expireAt) })
  },

  async deleteAccountSession({
    token
  }: DeleteAccountSessionParams): Promise<void> {
    await database('sessions').where('token', token).delete()
  },

  async getAccountProviders({ accountId }: GetAccountProvidersParams): Promise<
    {
      provider: string
      providerId: string
      createdAt: number
      updatedAt: number
    }[]
  > {
    const providers = await database('account_providers')
      .where('accountId', accountId)
      .select<
        {
          provider: string
          providerId: string
          createdAt: number
          updatedAt: number
        }[]
      >('provider', 'providerId', 'createdAt', 'updatedAt')
    return providers.map((provider) => ({
      ...provider,
      createdAt: getCompatibleTime(provider.createdAt),
      updatedAt: getCompatibleTime(provider.updatedAt)
    }))
  },

  async unlinkAccountFromProvider({
    accountId,
    provider
  }: UnlinkAccountFromProviderParams): Promise<void> {
    await database('account_providers')
      .where('accountId', accountId)
      .where('provider', provider)
      .delete()
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

    await database('actors').insert({
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
    const sqlActors = await database('actors').where('accountId', accountId)
    if (!sqlActors || sqlActors.length === 0) return []

    const account = await database('accounts').where('id', accountId).first()
    if (!account) return []

    const results: Actor[] = []

    for (const sqlActor of sqlActors) {
      const settings = getCompatibleJSON<ActorSettings>(sqlActor.settings)

      const [totalFollowers, totalFollowing, totalStatus, lastStatus] =
        await database.transaction(async (trx) => {
          return Promise.all([
            trx('follows')
              .where('targetActorId', sqlActor.id)
              .andWhere('status', 'Accepted')
              .count<{ count: string }>('* as count')
              .first(),
            trx('follows')
              .where('actorId', sqlActor.id)
              .andWhere('status', 'Accepted')
              .count<{ count: string }>('* as count')
              .first(),
            trx('counters').where('id', `total-status:${sqlActor.id}`).first(),
            trx('statuses')
              .where('actorId', sqlActor.id)
              .orderBy('createdAt', 'desc')
              .first<{ createdAt: number | Date }>('createdAt')
          ])
        })

      const actor = Actor.parse({
        id: sqlActor.id,
        username: sqlActor.username,
        domain: sqlActor.domain,
        ...(sqlActor.name ? { name: sqlActor.name } : null),
        ...(sqlActor.summary ? { summary: sqlActor.summary } : null),
        ...(settings.iconUrl ? { iconUrl: settings.iconUrl } : null),
        ...(settings.headerImageUrl
          ? { headerImageUrl: settings.headerImageUrl }
          : null),
        manuallyApprovesFollowers: settings.manuallyApprovesFollowers ?? true,
        followersUrl: settings.followersUrl,
        inboxUrl: settings.inboxUrl,
        sharedInboxUrl: settings.sharedInboxUrl,
        publicKey: sqlActor.publicKey,
        ...(sqlActor.privateKey ? { privateKey: sqlActor.privateKey } : null),
        account: Account.parse({
          ...account,
          createdAt: getCompatibleTime(account.createdAt),
          updatedAt: getCompatibleTime(account.updatedAt),
          ...(account.verifiedAt
            ? { verifiedAt: getCompatibleTime(account.verifiedAt) }
            : null)
        }),
        followingCount: parseInt(totalFollowing?.count ?? '0', 10),
        followersCount: parseInt(totalFollowers?.count ?? '0', 10),
        statusCount: totalStatus?.value ?? 0,
        lastStatusAt: lastStatus?.createdAt
          ? getCompatibleTime(lastStatus.createdAt)
          : null,
        createdAt: getCompatibleTime(sqlActor.createdAt),
        updatedAt: getCompatibleTime(sqlActor.updatedAt),
        deletionStatus: sqlActor.deletionStatus ?? null,
        deletionScheduledAt: sqlActor.deletionScheduledAt
          ? getCompatibleTime(sqlActor.deletionScheduledAt)
          : null
      })

      results.push(actor)
    }

    return results
  },

  async setDefaultActor({
    accountId,
    actorId
  }: SetDefaultActorParams): Promise<void> {
    const currentTime = new Date()
    await database('accounts').where('id', accountId).update({
      defaultActorId: actorId,
      updatedAt: currentTime
    })
  },

  async setSessionActor({
    token,
    actorId
  }: SetSessionActorParams): Promise<void> {
    const currentTime = new Date()
    await database('sessions').where('token', token).update({
      actorId,
      updatedAt: currentTime
    })
  },

  // Note: Multiple email change requests will overwrite previous pending changes.
  // The most recent request invalidates any previous verification codes.
  async requestEmailChange({
    accountId,
    newEmail,
    emailChangeCode
  }: RequestEmailChangeParams): Promise<void> {
    const currentTime = new Date()
    const expiresAt = new Date(currentTime.getTime() + 24 * 60 * 60 * 1000) // 24 hours

    await database('accounts').where('id', accountId).update({
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
    // If accountId is provided, verify for that specific account
    // Otherwise, find the account by the verification code
    let account
    if (accountId) {
      account = await database('accounts').where('id', accountId).first()
    } else {
      account = await database('accounts')
        .where('emailChangeCode', emailChangeCode)
        .first()
    }

    if (!account) return null
    if (account.emailChangeCode !== emailChangeCode) return null

    const now = new Date()
    if (
      account.emailChangeCodeExpiresAt &&
      now > new Date(account.emailChangeCodeExpiresAt)
    ) {
      return null
    }

    // Validate that emailChangePending is not null before proceeding
    const pendingEmail = account.emailChangePending
    if (pendingEmail == null) {
      return null
    }

    await database('accounts').where('id', account.id).update({
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
    await database('accounts').where('id', accountId).update({
      passwordHash: newPasswordHash,
      updatedAt: currentTime
    })
  }
})

import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  AccountDatabase,
  CreateAccountParams,
  CreateAccountSessionParams,
  DeleteAccountSessionParams,
  GetAccountAllSessionsParams,
  GetAccountFromIdParams,
  GetAccountFromProviderIdParams,
  GetAccountSessionParams,
  IsAccountExistsParams,
  IsUsernameExistsParams,
  LinkAccountWithProviderParams,
  UpdateAccountSessionParams,
  VerifyAccountParams
} from '@/lib/database/types/account'
import { ActorSettings } from '@/lib/database/types/sql'
import { Account } from '@/lib/models/account'
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
    token
  }: CreateAccountSessionParams): Promise<void> {
    const currentTime = new Date()

    await database('sessions').insert({
      id: crypto.randomUUID(),
      accountId,
      token,

      expireAt,

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
      expireAt,
      createdAt,
      updatedAt
    } = session
    const account = await this.getAccountFromId({ id: accountId })
    if (!account) return null

    return {
      account,
      session: {
        accountId,
        expireAt,
        token: sessionToken,
        createdAt: getCompatibleTime(createdAt),
        updatedAt: getCompatibleTime(updatedAt)
      }
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
    return session.map((session) => ({
      ...session,
      expireAt: getCompatibleTime(session.expireAt),
      createdAt: getCompatibleTime(session.createdAt),
      updatedAt: getCompatibleTime(session.updatedAt)
    }))
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
  }
})

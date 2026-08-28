import {
  createLocalAccountIssuer,
  createOAuthAccountIssuer
} from '@better-auth/core/db'
import { Knex } from 'knex'

import { recordWeeklyLoginSafely } from '@/lib/database/sql/instanceActivity'
import { indexActorSearchDocument } from '@/lib/database/sql/search'
import {
  CounterKey,
  getCounterValues,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { incrementBucket } from '@/lib/database/sql/utils/counterBucket'
import { deleteSessionsWithTokenDetach } from '@/lib/database/sql/utils/detachOAuthTokensFromSessions'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { toDomainAccount } from '@/lib/database/sql/utils/toDomainAccount'
import { findActorRowByUsername } from '@/lib/database/sql/utils/usernameMatch'
import {
  AccountDatabase,
  ChangePasswordParams,
  CreateAccountParams,
  CreateAccountSessionParams,
  CreateActorForAccountParams,
  CreateCredentialProviderParams,
  DeleteAccountSessionParams,
  DeleteOtherAccountSessionsParams,
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
  RepointUnconfirmedAccountEmailParams,
  RequestEmailChangeParams,
  RequestPasswordResetParams,
  ResetPasswordWithCodeParams,
  SetDefaultActorParams,
  SetSessionActorParams,
  UnlinkAccountFromProviderParams,
  UpdateAccountImageParams,
  UpdateAccountNameParams,
  UpdateAccountSessionParams,
  ValidatePasswordResetCodeParams,
  VerifyAccountParams,
  VerifyEmailChangeParams
} from '@/lib/types/database/operations'
import { ActorSettings, SQLAccount } from '@/lib/types/database/rows'
import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'
import { Session } from '@/lib/types/domain/session'
import {
  getLocalActorFollowersId,
  getLocalActorId,
  getLocalActorInboxId,
  getLocalActorSharedInboxId
} from '@/lib/utils/activitypubId'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'
import { normalizeUsername } from '@/lib/utils/normalizeUsername'
import { generatePublicId } from '@/lib/utils/publicId'

// better-auth 1.7 resolves a credential row by `issuer` as well as `providerId`
// (`signInEmail` -> `createLocalAccountIssuer('credential')`), so every
// `account_providers` row this module writes directly — bypassing better-auth's
// own adapter — has to carry the same value or the account cannot sign in.
// Derived from better-auth's own helper rather than a literal so the two can
// never drift; `20260821120000_better_auth_17_columns` backfills the rows that
// predate the column.
const CREDENTIAL_PROVIDER = 'credential'
const CREDENTIAL_ISSUER = createLocalAccountIssuer(CREDENTIAL_PROVIDER)

// Emails are normalized (trimmed + lowercased) inside every method that stores
// or looks up by email so storage and lookup can never disagree on casing. This
// is the most robust place for it — it cannot be bypassed by a caller that
// forgets to normalize first. See `lib/utils/normalizeEmail.ts`.
export const AccountSQLDatabaseMixin = (database: Knex): AccountDatabase => ({
  async isAccountExists({ email }: IsAccountExistsParams) {
    const result = await database('accounts')
      .where('email', normalizeEmail(email))
      .count<{ count: string }>('id as count')
      .first()
    return parseInt(result?.count ?? '0', 10) > 0
  },

  async isUsernameExists({ username, domain }: IsUsernameExistsParams) {
    // Case-insensitive, so an existing `Alice` refuses a new `alice`. Without
    // this the two creation paths would mint a second actor whose handle is
    // indistinguishable from the first one's to every case-insensitive client.
    return Boolean(await findActorRowByUsername(database, { username, domain }))
  },

  async createAccount({
    email,
    username: rawUsername,
    name,
    passwordHash,
    verificationCode,
    domain,
    privateKey,
    publicKey
  }: CreateAccountParams) {
    const normalizedEmail = normalizeEmail(email)
    // Normalized here as well as in the request schema for the same reason
    // emails are: a caller reaching this method directly cannot produce a
    // mixed-case handle. It matters more than it does for email — `username` is
    // interpolated into `actorId` below, so the column and the ActivityPub id
    // are derived from one value and cannot drift.
    //
    // NOT the only place a local actor row is written: `createActorForAccount`
    // is the second account-facing mint path, and `getFederationSigningActor`
    // (`actor.ts`) inserts its own row bypassing both. Each has to make this
    // one-variable argument for itself.
    const username = normalizeUsername(rawUsername)
    const accountId = crypto.randomUUID()
    const actorId = getLocalActorId({ domain, username })
    const currentTime = new Date()

    const actorSettings: ActorSettings = {
      followersUrl: getLocalActorFollowersId(actorId),
      inboxUrl: getLocalActorInboxId(actorId),
      sharedInboxUrl: getLocalActorSharedInboxId(domain)
    }
    const actor = {
      id: actorId,
      publicId: generatePublicId(),
      type: 'Person' as const,
      accountId,
      username,
      domain,
      settings: JSON.stringify(actorSettings),
      publicKey,
      privateKey,
      createdAt: currentTime,
      updatedAt: currentTime
    }

    await database.transaction(async (trx) => {
      await trx('accounts').insert({
        id: accountId,
        email: normalizedEmail,
        name: name || null,
        passwordHash,
        // `verifiedAt` is written EXPLICITLY as null for a pending
        // registration. Omitting it does not leave the column unset: it carries
        // `DEFAULT CURRENT_TIMESTAMP` (20230824181927_add_accounts_verification),
        // so the database stamped `now()` on every account that was still
        // awaiting confirmation and `canCreateSessionForAccount`'s `verifiedAt`
        // test could never fire. Credential sign-in was still refused —
        // better-auth's own `requireEmailVerification` reads `emailVerified`,
        // which this branch correctly leaves false — so this repairs a
        // defence-in-depth check rather than an open door.
        ...(verificationCode
          ? { verificationCode, verifiedAt: null }
          : { verifiedAt: currentTime, emailVerified: true }),
        // No approval-required registration mode exists yet (Admin moderation
        // API, Decision 4): every account is approved at creation, so the
        // sign-in hook's approvedAt gate stays a no-op until such a mode lands.
        approvedAt: currentTime,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      await trx('actors').insert(actor)
      await trx('account_providers').insert({
        id: `credential_${accountId}`,
        accountId,
        provider: CREDENTIAL_PROVIDER,
        issuer: CREDENTIAL_ISSUER,
        providerId: accountId,
        password: passwordHash,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      await increaseCounterValue(
        trx,
        CounterKey.nodeinfoTotalUsers(),
        1,
        currentTime
      )
      await increaseCounterValue(
        trx,
        CounterKey.serviceTotalAccounts(),
        1,
        currentTime
      )
      await increaseCounterValue(
        trx,
        CounterKey.serviceTotalActors(),
        1,
        currentTime
      )
      await incrementBucket(trx, 'accounts', 1, currentTime)
      await incrementBucket(trx, 'actors', 1, currentTime)
      await indexActorSearchDocument(trx, { id: actorId, actor })
    })

    return accountId
  },

  async createCredentialProvider({
    accountId,
    passwordHash
  }: CreateCredentialProviderParams): Promise<void> {
    const currentTime = new Date()
    await database('account_providers')
      .insert({
        id: `credential_${accountId}`,
        accountId,
        provider: CREDENTIAL_PROVIDER,
        issuer: CREDENTIAL_ISSUER,
        providerId: accountId,
        password: passwordHash,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict('id')
      // The row id encodes that this IS the credential row, so stamping the
      // issuer is correct by construction and repairs one left NULL by pre-1.7
      // code. Everything else is still left alone — this must not touch an
      // existing password.
      .merge({ issuer: CREDENTIAL_ISSUER })
  },

  async getAccountFromId({ id }: GetAccountFromIdParams) {
    const account = await database<SQLAccount>('accounts')
      .where('id', id)
      .first()
    if (!account) return null
    return toDomainAccount(account)
  },

  async getAccountFromEmail({
    email
  }: GetAccountFromEmailParams): Promise<Account | null> {
    const account = await database<SQLAccount>('accounts')
      .where('email', normalizeEmail(email))
      .first()
    if (!account) return null
    return toDomainAccount(account)
  },

  async getAccountFromProviderId({
    provider,
    accountId
  }: GetAccountFromProviderIdParams): Promise<Account | null> {
    const account = await database('account_providers')
      .where('provider', provider)
      .where('providerId', accountId)
      .join('accounts', 'account_providers.accountId', '=', 'accounts.id')
      .select<SQLAccount>('accounts.*')
      .first()
    if (!account) return null
    return toDomainAccount(account)
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
      // An external identity, so it takes better-auth's OAuth namespace rather
      // than the local one the credential rows use.
      issuer: createOAuthAccountIssuer(provider),
      providerId: providerAccountId,
      accountId,

      createdAt: currentTime,
      updatedAt: currentTime
    })
    return toDomainAccount(account)
  },

  async verifyAccount({ verificationCode }: VerifyAccountParams) {
    const account = await database<SQLAccount>('accounts')
      .where('verificationCode', verificationCode)
      .first()
    if (!account) return null

    const currentTime = new Date()
    await database('accounts').where('id', account.id).update({
      verificationCode: '',
      verifiedAt: currentTime,
      emailVerified: true,
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
    await recordWeeklyLoginSafely(database, accountId, currentTime)
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
    await database.transaction((trx) =>
      deleteSessionsWithTokenDetach(trx, (query) => query.where('token', token))
    )
  },

  async deleteOtherAccountSessions({
    accountId,
    exceptToken
  }: DeleteOtherAccountSessionsParams): Promise<number> {
    return database.transaction((trx) =>
      deleteSessionsWithTokenDetach(trx, (query) =>
        query.where('accountId', accountId).andWhereNot('token', exceptToken)
      )
    )
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
    username: rawUsername,
    domain,
    privateKey,
    publicKey
  }: CreateActorForAccountParams): Promise<string> {
    // See createAccount: the local mint paths normalize so the stored username
    // and the actor id it is interpolated into always agree.
    const username = normalizeUsername(rawUsername)
    const actorId = getLocalActorId({ domain, username })
    const currentTime = new Date()

    const actorSettings: ActorSettings = {
      followersUrl: getLocalActorFollowersId(actorId),
      inboxUrl: getLocalActorInboxId(actorId),
      sharedInboxUrl: getLocalActorSharedInboxId(domain)
    }
    const actor = {
      id: actorId,
      publicId: generatePublicId(),
      type: 'Person' as const,
      accountId,
      username,
      domain,
      settings: JSON.stringify(actorSettings),
      publicKey,
      privateKey,
      createdAt: currentTime,
      updatedAt: currentTime
    }

    await database.transaction(async (trx) => {
      await trx('actors').insert(actor)
      await increaseCounterValue(
        trx,
        CounterKey.serviceTotalActors(),
        1,
        currentTime
      )
      await incrementBucket(trx, 'actors', 1, currentTime)
      await indexActorSearchDocument(trx, { id: actorId, actor })
    })

    return actorId
  },

  async getActorsForAccount({
    accountId
  }: GetActorsForAccountParams): Promise<Actor[]> {
    const sqlActors = await database('actors').where('accountId', accountId)
    if (!sqlActors || sqlActors.length === 0) return []

    const account = await database<SQLAccount>('accounts')
      .where('id', accountId)
      .first()
    if (!account) return []

    const results: Actor[] = []

    for (const sqlActor of sqlActors) {
      const settings = getCompatibleJSON<ActorSettings>(sqlActor.settings)

      const [counters, lastStatus] = await database.transaction(async (trx) => {
        return Promise.all([
          getCounterValues(trx, [
            CounterKey.totalFollowers(sqlActor.id),
            CounterKey.totalFollowing(sqlActor.id),
            CounterKey.totalStatus(sqlActor.id)
          ]),
          trx('statuses')
            .where('actorId', sqlActor.id)
            .orderBy('createdAt', 'desc')
            .first<{ createdAt: number | Date }>('createdAt')
        ])
      })

      const actor = Actor.parse({
        id: sqlActor.id,
        publicId: sqlActor.publicId ?? null,
        type: sqlActor.type ?? 'Person',
        username: sqlActor.username,
        domain: sqlActor.domain,
        ...(sqlActor.name ? { name: sqlActor.name } : null),
        ...(sqlActor.summary ? { summary: sqlActor.summary } : null),
        ...(settings.iconUrl ? { iconUrl: settings.iconUrl } : null),
        ...(settings.headerImageUrl
          ? { headerImageUrl: settings.headerImageUrl }
          : null),
        manuallyApprovesFollowers: settings.manuallyApprovesFollowers ?? true,
        ...(settings.readingExpandMedia !== undefined
          ? { readingExpandMedia: settings.readingExpandMedia }
          : null),
        ...(settings.readingExpandSpoilers !== undefined
          ? { readingExpandSpoilers: settings.readingExpandSpoilers }
          : null),
        ...(settings.readingAutoplayGifs !== undefined
          ? { readingAutoplayGifs: settings.readingAutoplayGifs }
          : null),
        followersUrl: settings.followersUrl,
        inboxUrl: settings.inboxUrl,
        sharedInboxUrl: settings.sharedInboxUrl,
        publicKey: sqlActor.publicKey,
        ...(sqlActor.privateKey ? { privateKey: sqlActor.privateKey } : null),
        account: toDomainAccount(account),
        followingCount: counters[CounterKey.totalFollowing(sqlActor.id)] ?? 0,
        followersCount: counters[CounterKey.totalFollowers(sqlActor.id)] ?? 0,
        statusCount: counters[CounterKey.totalStatus(sqlActor.id)] ?? 0,
        lastStatusAt: lastStatus?.createdAt
          ? getCompatibleTime(lastStatus.createdAt)
          : null,
        createdAt: getCompatibleTime(sqlActor.createdAt),
        updatedAt: getCompatibleTime(sqlActor.updatedAt),
        deletionStatus: sqlActor.deletionStatus ?? null,
        deletionScheduledAt: sqlActor.deletionScheduledAt
          ? getCompatibleTime(sqlActor.deletionScheduledAt)
          : null,
        // Moderation state must reach the cookie/session actor path too, so the
        // OAuthGuard suspend check and the sensitized-forces-sensitive rule fire
        // for browser sessions, not only bearer tokens (which use getActor).
        suspendedAt: sqlActor.suspendedAt
          ? getCompatibleTime(sqlActor.suspendedAt)
          : null,
        silencedAt: sqlActor.silencedAt
          ? getCompatibleTime(sqlActor.silencedAt)
          : null,
        sensitizedAt: sqlActor.sensitizedAt
          ? getCompatibleTime(sqlActor.sensitizedAt)
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

    await database('accounts')
      .where('id', accountId)
      .update({
        emailChangePending: normalizeEmail(newEmail),
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

    // `emailChangePending` is stored already-normalized; normalize again when
    // promoting it so the canonical `email` column can never drift.
    const normalizedEmail = normalizeEmail(pendingEmail)

    // The pending address may have been claimed by another account between the
    // change request and this verification. Reject gracefully — callers map a
    // null result to an "invalid or expired" response — instead of letting the
    // unique-email constraint surface as a 500.
    const conflicting = await database('accounts')
      .where('email', normalizedEmail)
      .whereNot('id', account.id)
      .first('id')
    if (conflicting) return null

    try {
      await database('accounts').where('id', account.id).update({
        email: normalizedEmail,
        emailVerifiedAt: now,
        emailChangePending: null,
        emailChangeCode: null,
        emailChangeCodeExpiresAt: null,
        updatedAt: now
      })
    } catch (error) {
      // Pre-check covers the common case; a concurrent claim can still race onto
      // the unique constraint between the check and the update. Map that to the
      // same graceful null rather than a 500.
      if (isUniqueConstraintError(error)) return null
      throw error
    }

    return this.getAccountFromId({ id: account.id })
  },

  // Multiple reset requests are allowed; the most recent code replaces prior ones.
  async requestPasswordReset({
    email,
    passwordResetCode,
    expiresAt
  }: RequestPasswordResetParams): Promise<boolean> {
    const account = await database<SQLAccount>('accounts')
      .where('email', normalizeEmail(email))
      .first()
    if (!account) return false

    const currentTime = new Date()
    const expiresAtDate =
      passwordResetCode === null
        ? null
        : expiresAt
          ? new Date(expiresAt)
          : new Date(currentTime.getTime() + 24 * 60 * 60 * 1000) // 24 hours

    await database('accounts').where('id', account.id).update({
      passwordResetCode,
      passwordResetCodeExpiresAt: expiresAtDate,
      updatedAt: currentTime
    })

    return true
  },

  async validatePasswordResetCode({
    passwordResetCode
  }: ValidatePasswordResetCodeParams): Promise<string | null> {
    const now = new Date()
    const account = await database<SQLAccount>('accounts')
      .where('passwordResetCode', passwordResetCode)
      .andWhere('passwordResetCodeExpiresAt', '>=', now)
      .first('id')

    return account?.id ?? null
  },

  async resetPasswordWithCode({
    accountId,
    passwordResetCode,
    newPasswordHash
  }: ResetPasswordWithCodeParams): Promise<Account | null> {
    const now = new Date()
    const targetAccountId = accountId
      ? accountId
      : (
          await database<SQLAccount>('accounts')
            .where('passwordResetCode', passwordResetCode)
            .first('id')
        )?.id
    if (!targetAccountId) return null

    const updatedAccountId = await database.transaction(async (trx) => {
      const updatedCount = await trx('accounts')
        .where('id', targetAccountId)
        .andWhere('passwordResetCode', passwordResetCode)
        .andWhere('passwordResetCodeExpiresAt', '>=', now)
        .update({
          passwordHash: newPasswordHash,
          passwordResetCode: null,
          passwordResetCodeExpiresAt: null,
          updatedAt: now
        })

      if (updatedCount === 0) return null

      await trx('account_providers')
        .insert({
          id: `credential_${targetAccountId}`,
          accountId: targetAccountId,
          provider: CREDENTIAL_PROVIDER,
          issuer: CREDENTIAL_ISSUER,
          providerId: targetAccountId,
          password: newPasswordHash,
          createdAt: now,
          updatedAt: now
        })
        .onConflict('id')
        // `issuer` is merged, not just inserted: a row written by pre-1.7 code
        // during the rollout window (migration applied, old code still serving)
        // carries a NULL issuer and cannot sign in, and this is the path a
        // locked-out account would reach for. Merging only the password would
        // make password reset a dead end for exactly those rows.
        .merge({
          password: newPasswordHash,
          issuer: CREDENTIAL_ISSUER,
          updatedAt: now
        })

      await deleteSessionsWithTokenDetach(trx, (query) =>
        query.where('accountId', targetAccountId)
      )
      return targetAccountId
    })

    if (!updatedAccountId) return null
    return this.getAccountFromId({ id: updatedAccountId })
  },

  async changePassword({
    accountId,
    newPasswordHash
  }: ChangePasswordParams): Promise<void> {
    const currentTime = new Date()
    await database.transaction(async (trx) => {
      await trx('accounts').where('id', accountId).update({
        passwordHash: newPasswordHash,
        passwordResetCode: null,
        passwordResetCodeExpiresAt: null,
        updatedAt: currentTime
      })
      await trx('account_providers')
        .insert({
          id: `credential_${accountId}`,
          accountId,
          provider: CREDENTIAL_PROVIDER,
          issuer: CREDENTIAL_ISSUER,
          providerId: accountId,
          password: newPasswordHash,
          createdAt: currentTime,
          updatedAt: currentTime
        })
        .onConflict('id')
        // Repairs a NULL issuer too — see `resetPasswordWithCode`.
        .merge({
          password: newPasswordHash,
          issuer: CREDENTIAL_ISSUER,
          updatedAt: currentTime
        })
      await deleteSessionsWithTokenDetach(trx, (query) =>
        query.where('accountId', accountId)
      )
    })
  },

  async repointUnconfirmedAccountEmail({
    accountId,
    email,
    verificationCode
  }: RepointUnconfirmedAccountEmailParams): Promise<void> {
    const currentTime = new Date()
    await database('accounts')
      .where('id', accountId)
      .update({
        email: normalizeEmail(email),
        // Written in the SAME statement as the address it belongs to. A
        // confirmation code proves control of the address it was mailed to and
        // nothing else — `verifyAccount` matches on the code alone — so a code
        // that outlives a change of address confirms the new one on the
        // strength of the old one having been received. Unconditional: the
        // parameter is required precisely so this cannot be skipped.
        verificationCode,
        // Every other proof about the OLD address goes with it, for the same
        // reason. `emailVerified` is the one that matters most: a
        // backfilled-cohort row is NOT pending
        // (`isAccountConfirmationPending` reads it), so leaving it set let such
        // an account re-point to an arbitrary address and stay verified, and
        // the id_token then asserted `email_verified: true` for an address
        // nobody had proven. `verifiedAt` and `emailVerifiedAt` are cleared
        // alongside it so no surface can answer that question differently.
        //
        // `verifyAccount` restores `verifiedAt` and `emailVerified` when the
        // new address is confirmed. It does NOT restore `emailVerifiedAt` —
        // only `verifyEmailChange` ever writes that column — so an account
        // that had previously used the change-address flow loses the
        // "Verified" badge on `/account` (its one reader) until it next
        // completes a change-address flow — which it can do with the address it
        // already holds, since the conflict probe excludes the account itself.
        // Clearing it anyway is the lesser of two wrongs: left
        // standing, that badge would assert the NEW, unproven address is
        // verified. Making `verifyAccount` stamp it would fix both, and is a
        // deliberate separate change — the badge is currently absent for every
        // normally-registered account, so turning it on is user-visible well
        // beyond this fix.
        emailVerified: false,
        verifiedAt: null,
        emailVerifiedAt: null,
        updatedAt: currentTime
      })
  },

  async updateAccountName({
    accountId,
    name
  }: UpdateAccountNameParams): Promise<void> {
    const currentTime = new Date()
    await database('accounts')
      .where('id', accountId)
      .update({
        name: name || null,
        updatedAt: currentTime
      })
  },

  async updateAccountImage({
    accountId,
    iconUrl
  }: UpdateAccountImageParams): Promise<void> {
    const currentTime = new Date()
    await database('accounts')
      .where('id', accountId)
      .update({
        iconUrl: iconUrl || null,
        image: iconUrl || null,
        updatedAt: currentTime
      })
  }
})

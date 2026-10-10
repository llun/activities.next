// Accounts and the actors minted for them: sign-up, lookups, confirmation,
// provider links and profile fields. E-mail change and password reset live in
// ./credentials.ts and sessions in ./sessions.ts; ./queries.ts binds all three.
import type {
  CreateAccountParams,
  CreateActorForAccountParams,
  GetAccountFromEmailParams,
  GetAccountFromIdParams,
  GetActorsForAccountParams,
  IsAccountExistsParams,
  IsUsernameExistsParams,
  SetDefaultActorParams,
  UnlinkAccountFromProviderParams,
  UpdateAccountImageParams,
  UpdateAccountNameParams,
  VerifyAccountParams
} from '@/lib/database/domains/account/types'
import { indexActorSearchDocument } from '@/lib/database/domains/search/accounts'
import { type Db, inTransaction } from '@/lib/database/kysely'
import {
  getCounterValues,
  increaseCounterValue
} from '@/lib/database/kysely/counter'
import { incrementBucket } from '@/lib/database/kysely/counterBucket'
import { findActorRowByUsername } from '@/lib/database/kysely/usernameMatch'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { toDomainAccount } from '@/lib/database/sql/utils/toDomainAccount'
import type { ActorSettings, SQLAccount } from '@/lib/types/database/rows'
import type { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'
import {
  getLocalActorFollowersId,
  getLocalActorId,
  getLocalActorInboxId,
  getLocalActorSharedInboxId
} from '@/lib/utils/activitypubId'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'
import { normalizeUsername } from '@/lib/utils/normalizeUsername'
import { generatePublicId } from '@/lib/utils/publicId'

// The provider name of an account's password row in `account_providers`.
export const CREDENTIAL_PROVIDER = 'credential'

// Emails are normalized (trimmed + lowercased) inside every query that stores
// or looks up by email so storage and lookup can never disagree on casing. This
// is the most robust place for it — it cannot be bypassed by a caller that
// forgets to normalize first. See `lib/utils/normalizeEmail.ts`.

export const selectAccount = (db: Db) => db.selectFrom('accounts').selectAll()

const toAccount = (row: object): Account => toDomainAccount(row as SQLAccount)

// The actor row a local mint path writes. `username` must already be
// normalized: it is interpolated into the actor id, so the column and the
// ActivityPub id are derived from one value and cannot drift.
const getLocalActorRow = ({
  accountId,
  username,
  domain,
  privateKey,
  publicKey,
  currentTime
}: {
  accountId: string
  username: string
  domain: string
  privateKey: string
  publicKey: string
  currentTime: Date
}) => {
  const actorId = getLocalActorId({ domain, username })
  const actorSettings: ActorSettings = {
    followersUrl: getLocalActorFollowersId(actorId),
    inboxUrl: getLocalActorInboxId(actorId),
    sharedInboxUrl: getLocalActorSharedInboxId(domain)
  }
  return {
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
}

export const isAccountExists = async (
  db: Db,
  { email }: IsAccountExistsParams
): Promise<boolean> => {
  const result = await db
    .selectFrom('accounts')
    .select((eb) => eb.fn.count('id').as('count'))
    .where('email', '=', normalizeEmail(email))
    .executeTakeFirst()
  return Number(result?.count ?? 0) > 0
}

export const isUsernameExists = async (
  db: Db,
  { username, domain }: IsUsernameExistsParams
): Promise<boolean> =>
  // Case-insensitive, so an existing `Alice` refuses a new `alice`. Without
  // this the two creation paths would mint a second actor whose handle is
  // indistinguishable from the first one's to every case-insensitive client.
  Boolean(await findActorRowByUsername(db, { username, domain }))

export const createAccount = async (
  db: Db,
  {
    email,
    username: rawUsername,
    name,
    passwordHash,
    verificationCode,
    domain,
    privateKey,
    publicKey
  }: CreateAccountParams
): Promise<string> => {
  const normalizedEmail = normalizeEmail(email)
  // Normalized here as well as in the request schema for the same reason
  // emails are: a caller reaching this query directly cannot produce a
  // mixed-case handle. It matters more than it does for email — `username` is
  // interpolated into the actor id, so the column and the ActivityPub id are
  // derived from one value and cannot drift.
  //
  // NOT the only place a local actor row is written: `createActorForAccount`
  // is the second account-facing mint path, and `getFederationSigningActor`
  // (`actor.ts`) inserts its own row bypassing both. Each has to make this
  // one-variable argument for itself.
  const username = normalizeUsername(rawUsername)
  const accountId = crypto.randomUUID()
  const currentTime = new Date()
  const actor = getLocalActorRow({
    accountId,
    username,
    domain,
    privateKey,
    publicKey,
    currentTime
  })

  // The account, its actor, the credential provider, the service counters and
  // the actor's search document commit together or not at all.
  await inTransaction(db, async (trx) => {
    await trx
      .insertInto('accounts')
      .values({
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
      .execute()
    await trx.insertInto('actors').values(actor).execute()
    await trx
      .insertInto('account_providers')
      .values({
        id: `credential_${accountId}`,
        accountId,
        provider: CREDENTIAL_PROVIDER,
        providerId: accountId,
        password: passwordHash,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .execute()
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
    await indexActorSearchDocument(trx, { id: actor.id, actor })
  })

  return accountId
}

export const getAccountFromId = async (
  db: Db,
  { id }: GetAccountFromIdParams
): Promise<Account | null> => {
  const account = await selectAccount(db)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  return account ? toAccount(account) : null
}

export const getAccountFromEmail = async (
  db: Db,
  { email }: GetAccountFromEmailParams
): Promise<Account | null> => {
  const account = await selectAccount(db)
    .where('email', '=', normalizeEmail(email))
    .limit(1)
    .executeTakeFirst()
  return account ? toAccount(account) : null
}

export const verifyAccount = async (
  db: Db,
  { verificationCode }: VerifyAccountParams
): Promise<Account | null> => {
  if (!verificationCode) return null

  const account = await db
    .selectFrom('accounts')
    .select('id')
    .where('verificationCode', '=', verificationCode)
    .limit(1)
    .executeTakeFirst()
  if (!account) return null

  const currentTime = new Date()
  await db
    .updateTable('accounts')
    .set({
      verificationCode: '',
      verifiedAt: currentTime,
      emailVerified: true,
      emailVerifiedAt: currentTime,
      updatedAt: currentTime
    })
    .where('id', '=', account.id)
    .execute()
  return getAccountFromId(db, { id: account.id })
}

export const unlinkAccountFromProvider = async (
  db: Db,
  { accountId, provider }: UnlinkAccountFromProviderParams
): Promise<void> => {
  await db
    .deleteFrom('account_providers')
    .where('accountId', '=', accountId)
    .where('provider', '=', provider)
    .execute()
}

export const createActorForAccount = async (
  db: Db,
  {
    accountId,
    username: rawUsername,
    domain,
    privateKey,
    publicKey
  }: CreateActorForAccountParams
): Promise<string> => {
  // See createAccount: the local mint paths normalize so the stored username
  // and the actor id it is interpolated into always agree.
  const username = normalizeUsername(rawUsername)
  const currentTime = new Date()
  const actor = getLocalActorRow({
    accountId,
    username,
    domain,
    privateKey,
    publicKey,
    currentTime
  })

  await inTransaction(db, async (trx) => {
    await trx.insertInto('actors').values(actor).execute()
    await increaseCounterValue(
      trx,
      CounterKey.serviceTotalActors(),
      1,
      currentTime
    )
    await incrementBucket(trx, 'actors', 1, currentTime)
    await indexActorSearchDocument(trx, { id: actor.id, actor })
  })

  return actor.id
}

export const getActorsForAccount = async (
  db: Db,
  { accountId }: GetActorsForAccountParams
): Promise<Actor[]> => {
  const sqlActors = await db
    .selectFrom('actors')
    .selectAll()
    .$narrowType<{ id: string }>()
    .where('accountId', '=', accountId)
    .execute()
  if (sqlActors.length === 0) return []

  const account = await selectAccount(db)
    .where('id', '=', accountId)
    .limit(1)
    .executeTakeFirst()
  if (!account) return []

  const results: Actor[] = []

  for (const sqlActor of sqlActors) {
    const settings = (sqlActor.settings ?? {}) as ActorSettings

    // The counters and the latest status are read in one transaction.
    const [counters, lastStatus] = await inTransaction(db, (trx) =>
      Promise.all([
        getCounterValues(trx, [
          CounterKey.totalFollowers(sqlActor.id),
          CounterKey.totalFollowing(sqlActor.id),
          CounterKey.totalStatus(sqlActor.id)
        ]),
        trx
          .selectFrom('statuses')
          .select('createdAt')
          .where('actorId', '=', sqlActor.id)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .executeTakeFirst()
      ])
    )

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
      account: toAccount(account),
      followingCount: counters[CounterKey.totalFollowing(sqlActor.id)] ?? 0,
      followersCount: counters[CounterKey.totalFollowers(sqlActor.id)] ?? 0,
      statusCount: counters[CounterKey.totalStatus(sqlActor.id)] ?? 0,
      lastStatusAt: lastStatus?.createdAt ?? null,
      createdAt: sqlActor.createdAt,
      updatedAt: sqlActor.updatedAt,
      deletionStatus: sqlActor.deletionStatus ?? null,
      deletionScheduledAt: sqlActor.deletionScheduledAt ?? null,
      // Moderation state must reach the cookie/session actor path too, so the
      // OAuthGuard suspend check and the sensitized-forces-sensitive rule fire
      // for browser sessions, not only bearer tokens (which use getActor).
      suspendedAt: sqlActor.suspendedAt ?? null,
      silencedAt: sqlActor.silencedAt ?? null,
      sensitizedAt: sqlActor.sensitizedAt ?? null
    })

    results.push(actor)
  }

  return results
}

export const setDefaultActor = async (
  db: Db,
  { accountId, actorId }: SetDefaultActorParams
): Promise<void> => {
  await db
    .updateTable('accounts')
    .set({ defaultActorId: actorId, updatedAt: new Date() })
    .where('id', '=', accountId)
    .execute()
}

export const updateAccountName = async (
  db: Db,
  { accountId, name }: UpdateAccountNameParams
): Promise<void> => {
  await db
    .updateTable('accounts')
    .set({ name: name || null, updatedAt: new Date() })
    .where('id', '=', accountId)
    .execute()
}

export const updateAccountImage = async (
  db: Db,
  { accountId, iconUrl }: UpdateAccountImageParams
): Promise<void> => {
  await db
    .updateTable('accounts')
    .set({
      iconUrl: iconUrl || null,
      image: iconUrl || null,
      updatedAt: new Date()
    })
    .where('id', '=', accountId)
    .execute()
}

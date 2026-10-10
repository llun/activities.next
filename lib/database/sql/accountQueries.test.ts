import crypto from 'crypto'
import { type Updateable, sql } from 'kysely'

import type { Accounts } from '@/lib/database/kysely/db'
import { findActorRowByUsername } from '@/lib/database/kysely/usernameMatch'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { getLocalActorId } from '@/lib/utils/activitypubId'

// Every `where` in the account queries, each pinned with a neighbouring row the
// query must not touch, plus the transactions of createAccount,
// createActorForAccount, resetPasswordWithCode and changePassword rolling back
// as a whole when their last write fails. Runs on PostgreSQL in CI.

const DOMAIN = 'acctq.test'

const testDb = createTestDatabase()
const { database } = testDb
const db = () => testDb.db

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
})

afterAll(async () => {
  await database.destroy()
})

const newAccount = async (
  label: string,
  { verificationCode }: { verificationCode?: string } = {}
) => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const username = `${label}-${suffix}`
  const email = `${username}@${DOMAIN}`
  const accountId = await database.createAccount({
    email,
    username,
    passwordHash: `hash-${username}`,
    domain: DOMAIN,
    privateKey: `private-${username}`,
    publicKey: `public-${username}`,
    verificationCode
  })
  return {
    accountId,
    username,
    email,
    actorId: getLocalActorId({ domain: DOMAIN, username })
  }
}

const accountRow = (id: string) =>
  db()
    .selectFrom('accounts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()

const patchAccount = (id: string, values: Updateable<Accounts>) =>
  db().updateTable('accounts').set(values).where('id', '=', id).execute()

const sessionTokens = async (accountId: string) =>
  (
    await db()
      .selectFrom('sessions')
      .select('token')
      .where('accountId', '=', accountId)
      .orderBy('token')
      .execute()
  ).map((row) => row.token)

const addSession = (accountId: string, token: string) =>
  database.createAccountSession({
    accountId,
    token,
    expireAt: Date.now() + 60_000
  })

const sessionIdOf = async (token: string) =>
  (
    await db()
      .selectFrom('sessions')
      .select('id')
      .where('token', '=', token)
      .executeTakeFirstOrThrow()
  ).id

// An OAuth access + refresh token pair minted from the session `token`.
const addOAuthTokens = async (accountId: string, token: string) => {
  const suffix = crypto.randomUUID()
  const clientId = `client-${suffix}`
  const sessionId = await sessionIdOf(token)
  await db()
    .insertInto('oauthClient')
    .values({ id: suffix, clientId, redirectUris: '[]' })
    .execute()
  const refreshId = `refresh-${suffix}`
  await db()
    .insertInto('oauthRefreshToken')
    .values({
      id: refreshId,
      token: `refresh-token-${suffix}`,
      clientId,
      userId: accountId,
      sessionId,
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: 'read'
    })
    .execute()
  const accessId = `access-${suffix}`
  await db()
    .insertInto('oauthAccessToken')
    .values({
      id: accessId,
      token: `access-token-${suffix}`,
      clientId,
      userId: accountId,
      sessionId,
      refreshId,
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: 'read'
    })
    .execute()
  return { accessId, refreshId }
}

const tokenSessionIds = async ({
  accessId,
  refreshId
}: {
  accessId: string
  refreshId: string
}) => ({
  access: (
    await db()
      .selectFrom('oauthAccessToken')
      .select('sessionId')
      .where('id', '=', accessId)
      .executeTakeFirstOrThrow()
  ).sessionId,
  refresh: (
    await db()
      .selectFrom('oauthRefreshToken')
      .select('sessionId')
      .where('id', '=', refreshId)
      .executeTakeFirstOrThrow()
  ).sessionId
})

describe('isAccountExists and isUsernameExists', () => {
  it('matches the e-mail exactly, case-folded', async () => {
    const { email } = await newAccount('exists')
    expect(await database.isAccountExists({ email })).toBe(true)
    expect(await database.isAccountExists({ email: email.toUpperCase() })).toBe(
      true
    )
    expect(await database.isAccountExists({ email: `missing-${email}` })).toBe(
      false
    )
  })

  it('matches the username on its own domain only, exactly or folded', async () => {
    const { username } = await newAccount('taken')
    // A row with the same name on another domain and a case variant there.
    await database.createActor({
      actorId: `https://other.test/users/Elsewhere-${username}`,
      username: `Elsewhere-${username}`,
      domain: 'other.test',
      followersUrl: 'https://other.test/followers',
      inboxUrl: 'https://other.test/inbox',
      sharedInboxUrl: 'https://other.test/inbox',
      publicKey: 'public',
      createdAt: Date.now()
    })

    expect(await database.isUsernameExists({ username, domain: DOMAIN })).toBe(
      true
    )
    expect(
      await database.isUsernameExists({
        username: username.toUpperCase(),
        domain: DOMAIN
      })
    ).toBe(true)
    expect(
      await database.isUsernameExists({ username, domain: 'other.test' })
    ).toBe(false)
    expect(
      await database.isUsernameExists({
        username: `elsewhere-${username}`,
        domain: DOMAIN
      })
    ).toBe(false)
    expect(
      await database.isUsernameExists({
        username: `elsewhere-${username}`,
        domain: 'other.test'
      })
    ).toBe(true)
    expect(
      await database.isUsernameExists({
        username: `free-${username}`,
        domain: DOMAIN
      })
    ).toBe(false)
  })
})

describe('findActorRowByUsername', () => {
  it('prefers the exact spelling, then the oldest folded match, on its own domain only', async () => {
    const domain = `fold-${crypto.randomUUID().slice(0, 8)}.test`
    const addActor = (username: string, actorDomain: string, at: number) =>
      db()
        .insertInto('actors')
        .values({
          id: `https://${actorDomain}/users/${username}`,
          username,
          domain: actorDomain,
          publicKey: 'public',
          settings: '{}',
          createdAt: new Date(at),
          updatedAt: new Date(at)
        })
        .execute()
    await addActor('alice', domain, 3_000)
    await addActor('Alice', domain, 2_000)
    await addActor('ALICE', domain, 1_000)
    await addActor('Фёдор', domain, 1_000)
    await addActor('bob', `other-${domain}`, 1_000)
    const find = async (username: string) =>
      (await findActorRowByUsername(db(), { username, domain }))?.username

    expect(await find('Alice')).toBe('Alice')
    expect(await find('aLiCe')).toBe('ALICE')
    // SQLite's lower() folds ASCII only, so only the exact arm finds this.
    expect(await find('Фёдор')).toBe('Фёдор')
    expect(await find('bob')).toBeUndefined()
  })
})

describe('getAccountFromId and getAccountFromEmail', () => {
  it('returns the requested account, not a neighbour', async () => {
    const neighbour = await newAccount('neighbour')
    const target = await newAccount('target')

    expect(
      (await database.getAccountFromId({ id: target.accountId }))?.id
    ).toBe(target.accountId)
    expect(
      (await database.getAccountFromEmail({ email: target.email }))?.id
    ).toBe(target.accountId)
    expect(
      (await database.getAccountFromEmail({ email: neighbour.email }))?.id
    ).toBe(neighbour.accountId)
    expect(await database.getAccountFromId({ id: 'missing' })).toBeNull()
    expect(
      await database.getAccountFromEmail({ email: `missing@${DOMAIN}` })
    ).toBeNull()
  })
})

describe('verifyAccount', () => {
  it('confirms only the account holding the code, once', async () => {
    const neighbour = await newAccount('verify-n', {
      verificationCode: `code-n-${crypto.randomUUID()}`
    })
    const code = `code-t-${crypto.randomUUID()}`
    const target = await newAccount('verify-t', { verificationCode: code })

    const verified = await database.verifyAccount({ verificationCode: code })
    expect(verified?.id).toBe(target.accountId)
    expect(verified?.emailVerified).toBe(true)
    expect(verified?.verifiedAt).toEqual(expect.any(Number))

    const neighbourRow = await accountRow(neighbour.accountId)
    expect(neighbourRow.verificationCode).toMatch(/^code-n-/)
    expect(neighbourRow.emailVerified).toBe(false)
    expect(neighbourRow.verifiedAt).toBeNull()

    // The code is cleared, so it cannot confirm anything a second time.
    expect(await database.verifyAccount({ verificationCode: code })).toBeNull()
    expect(await database.verifyAccount({ verificationCode: '' })).toBeNull()
  })
})

describe('sessions', () => {
  it('lists only the account own sessions', async () => {
    const neighbour = await newAccount('list-n')
    const target = await newAccount('list-t')
    await addSession(neighbour.accountId, `list-n-${neighbour.accountId}`)
    await addSession(target.accountId, `list-t-${target.accountId}`)

    const sessions = await database.getAccountAllSessions({
      accountId: target.accountId
    })
    expect(sessions.map((session) => session.token)).toEqual([
      `list-t-${target.accountId}`
    ])
    expect(sessions[0]).toMatchObject({
      accountId: target.accountId,
      actorId: null,
      expireAt: expect.any(Number),
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number)
    })
  })

  it('deletes one session by id and leaves the account other sessions and their tokens', async () => {
    const neighbour = await newAccount('del-n')
    const target = await newAccount('del-t')
    await addSession(target.accountId, 'del-t-a')
    await addSession(target.accountId, 'del-t-b')
    await addSession(neighbour.accountId, 'del-n-a')
    const keptTokens = await addOAuthTokens(target.accountId, 'del-t-b')
    const goneTokens = await addOAuthTokens(target.accountId, 'del-t-a')
    const neighbourTokens = await addOAuthTokens(neighbour.accountId, 'del-n-a')
    const keptSessionId = await sessionIdOf('del-t-b')
    const neighbourSessionId = await sessionIdOf('del-n-a')

    // Another account's session id matches nothing.
    expect(
      await database.deleteAccountSessionById({
        accountId: target.accountId,
        id: neighbourSessionId
      })
    ).toBe(0)
    expect(
      await database.deleteAccountSessionById({
        accountId: target.accountId,
        id: await sessionIdOf('del-t-a')
      })
    ).toBe(1)

    expect(await sessionTokens(target.accountId)).toEqual(['del-t-b'])
    expect(await sessionTokens(neighbour.accountId)).toEqual(['del-n-a'])
    expect(await tokenSessionIds(goneTokens)).toEqual({
      access: null,
      refresh: null
    })
    expect(await tokenSessionIds(keptTokens)).toEqual({
      access: keptSessionId,
      refresh: keptSessionId
    })
    expect(await tokenSessionIds(neighbourTokens)).toEqual({
      access: neighbourSessionId,
      refresh: neighbourSessionId
    })
  })

  it('revokes every other session of the account and only those tokens', async () => {
    const neighbour = await newAccount('other-n')
    const target = await newAccount('other-t')
    await addSession(target.accountId, 'other-t-keep')
    await addSession(target.accountId, 'other-t-a')
    await addSession(target.accountId, 'other-t-b')
    await addSession(neighbour.accountId, 'other-n-a')
    const keptTokens = await addOAuthTokens(target.accountId, 'other-t-keep')
    const goneTokens = await addOAuthTokens(target.accountId, 'other-t-a')
    const neighbourTokens = await addOAuthTokens(
      neighbour.accountId,
      'other-n-a'
    )

    expect(
      await database.deleteOtherAccountSessions({
        accountId: target.accountId,
        exceptToken: 'other-t-keep'
      })
    ).toBe(2)

    expect(await sessionTokens(target.accountId)).toEqual(['other-t-keep'])
    expect(await sessionTokens(neighbour.accountId)).toEqual(['other-n-a'])
    expect(await tokenSessionIds(goneTokens)).toEqual({
      access: null,
      refresh: null
    })
    const keptSessionId = await sessionIdOf('other-t-keep')
    expect(await tokenSessionIds(keptTokens)).toEqual({
      access: keptSessionId,
      refresh: keptSessionId
    })
    const neighbourSessionId = await sessionIdOf('other-n-a')
    expect(await tokenSessionIds(neighbourTokens)).toEqual({
      access: neighbourSessionId,
      refresh: neighbourSessionId
    })
  })
})

describe('unlinkAccountFromProvider', () => {
  it('removes only that provider of that account', async () => {
    const neighbour = await newAccount('unlink-n')
    const target = await newAccount('unlink-t')
    const now = new Date()
    for (const [accountId, provider] of [
      [target.accountId, 'github'],
      [target.accountId, 'gitlab'],
      [neighbour.accountId, 'github']
    ]) {
      await db()
        .insertInto('account_providers')
        .values({
          id: crypto.randomUUID(),
          accountId,
          provider,
          providerId: `${provider}-${accountId}`,
          createdAt: now,
          updatedAt: now
        })
        .execute()
    }
    const providersOf = async (accountId: string) =>
      (
        await db()
          .selectFrom('account_providers')
          .select('provider')
          .where('accountId', '=', accountId)
          .orderBy('provider')
          .execute()
      ).map((row) => row.provider)

    await database.unlinkAccountFromProvider({
      accountId: target.accountId,
      provider: 'github'
    })

    expect(await providersOf(target.accountId)).toEqual([
      'credential',
      'gitlab'
    ])
    expect(await providersOf(neighbour.accountId)).toEqual([
      'credential',
      'github'
    ])
  })
})

describe('getActorsForAccount', () => {
  it('returns the account own actors with their own counters and latest status', async () => {
    const neighbour = await newAccount('actors-n')
    const target = await newAccount('actors-t')
    const secondActorId = await database.createActorForAccount({
      accountId: target.accountId,
      username: `second-${target.username}`,
      domain: DOMAIN,
      privateKey: 'private',
      publicKey: 'public'
    })
    const createNote = (actorId: string, createdAt: number) =>
      database.createNote({
        id: `${actorId}/statuses/${createdAt}`,
        url: `${actorId}/statuses/${createdAt}`,
        actorId,
        to: [],
        cc: [],
        text: 'note',
        createdAt
      })
    await createNote(target.actorId, 1_000_000)
    await createNote(target.actorId, 2_000_000)
    // The neighbour posted later; it must not leak into the target's actors.
    await createNote(neighbour.actorId, 3_000_000)
    await db()
      .insertInto('counters')
      .values([
        {
          id: `total-followers:${target.actorId}`,
          value: 7,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: `total-followers:${neighbour.actorId}`,
          value: 99,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ])
      .execute()

    const actors = await database.getActorsForAccount({
      accountId: target.accountId
    })
    const byId = new Map(actors.map((actor) => [actor.id, actor]))

    expect([...byId.keys()].sort()).toEqual(
      [target.actorId, secondActorId].sort()
    )
    expect(byId.get(target.actorId)).toMatchObject({
      followersCount: 7,
      followingCount: 0,
      statusCount: 2,
      lastStatusAt: 2_000_000,
      // A new actor's settings carry no flag: it reads as locked.
      manuallyApprovesFollowers: true,
      account: { id: target.accountId, email: target.email }
    })
    expect(byId.get(secondActorId)).toMatchObject({
      followersCount: 0,
      statusCount: 0,
      lastStatusAt: null,
      account: { id: target.accountId }
    })
    expect(
      await database.getActorsForAccount({ accountId: 'missing' })
    ).toEqual([])
  })
})

describe('setDefaultActor, updateAccountName and updateAccountImage', () => {
  it('write only the target account', async () => {
    const neighbour = await newAccount('profile-n')
    const target = await newAccount('profile-t')
    const before = await accountRow(neighbour.accountId)

    await database.setDefaultActor({
      accountId: target.accountId,
      actorId: target.actorId
    })
    await database.updateAccountName({
      accountId: target.accountId,
      name: 'Target Name'
    })
    await database.updateAccountImage({
      accountId: target.accountId,
      iconUrl: 'https://acctq.test/icon.png'
    })

    expect(await accountRow(target.accountId)).toMatchObject({
      defaultActorId: target.actorId,
      name: 'Target Name',
      iconUrl: 'https://acctq.test/icon.png',
      image: 'https://acctq.test/icon.png'
    })
    expect(await accountRow(neighbour.accountId)).toEqual(before)

    await database.updateAccountName({ accountId: target.accountId, name: '' })
    await database.updateAccountImage({
      accountId: target.accountId,
      iconUrl: null
    })
    expect(await accountRow(target.accountId)).toMatchObject({
      name: null,
      iconUrl: null,
      image: null
    })
  })
})

describe('email change', () => {
  it('requests and verifies a change for the target account only', async () => {
    const neighbour = await newAccount('email-n')
    const target = await newAccount('email-t')
    await database.requestEmailChange({
      accountId: neighbour.accountId,
      newEmail: `next-n-${neighbour.email}`,
      emailChangeCode: `email-n-${neighbour.accountId}`
    })
    const code = `email-t-${target.accountId}`
    await database.requestEmailChange({
      accountId: target.accountId,
      newEmail: `Next-T-${target.email}`.toUpperCase(),
      emailChangeCode: code
    })
    const neighbourBefore = await accountRow(neighbour.accountId)
    expect(neighbourBefore.emailChangeCode).toBe(
      `email-n-${neighbour.accountId}`
    )

    // Looked up by code alone, the neighbour's pending change is not taken.
    const verified = await database.verifyEmailChange({ emailChangeCode: code })
    expect(verified?.id).toBe(target.accountId)
    expect(verified?.email).toBe(`next-t-${target.email}`)
    expect(verified?.emailChangeCode).toBeNull()
    expect(await accountRow(neighbour.accountId)).toEqual(neighbourBefore)

    // Single use.
    expect(await database.verifyEmailChange({ emailChangeCode: code })).toBe(
      null
    )
    expect(
      await database.verifyEmailChange({
        accountId: target.accountId,
        emailChangeCode: code
      })
    ).toBeNull()
  })

  it('refuses a code that belongs to another account or has expired', async () => {
    const neighbour = await newAccount('email-x-n')
    const target = await newAccount('email-x-t')
    const neighbourCode = `email-x-n-${neighbour.accountId}`
    await database.requestEmailChange({
      accountId: neighbour.accountId,
      newEmail: `next-${neighbour.email}`,
      emailChangeCode: neighbourCode
    })
    await database.requestEmailChange({
      accountId: target.accountId,
      newEmail: `next-${target.email}`,
      emailChangeCode: `email-x-t-${target.accountId}`
    })

    // The account id pins the lookup: the neighbour's code is not the target's.
    expect(
      await database.verifyEmailChange({
        accountId: target.accountId,
        emailChangeCode: neighbourCode
      })
    ).toBeNull()

    await patchAccount(target.accountId, {
      emailChangeCodeExpiresAt: new Date(Date.now() - 1_000)
    })
    expect(
      await database.verifyEmailChange({
        accountId: target.accountId,
        emailChangeCode: `email-x-t-${target.accountId}`
      })
    ).toBeNull()
    expect((await accountRow(target.accountId)).email).toBe(target.email)
    expect((await accountRow(neighbour.accountId)).email).toBe(neighbour.email)
  })

  it('issues a code that expires a day after the request', async () => {
    const target = await newAccount('email-ttl')
    const before = Date.now()
    await database.requestEmailChange({
      accountId: target.accountId,
      newEmail: `next-${target.email}`,
      emailChangeCode: `email-ttl-${target.accountId}`
    })
    const after = Date.now()
    const day = 24 * 60 * 60 * 1000
    const { emailChangeCodeExpiresAt } = await accountRow(target.accountId)
    expect(emailChangeCodeExpiresAt).toBeGreaterThanOrEqual(before + day)
    expect(emailChangeCodeExpiresAt).toBeLessThanOrEqual(after + day)
  })

  it('lets an account confirm a change to its own current address', async () => {
    const target = await newAccount('email-own')
    const code = `email-own-${target.accountId}`
    await database.requestEmailChange({
      accountId: target.accountId,
      newEmail: target.email,
      emailChangeCode: code
    })
    expect(
      (
        await database.verifyEmailChange({
          accountId: target.accountId,
          emailChangeCode: code
        })
      )?.email
    ).toBe(target.email)
  })
})

describe('password reset', () => {
  const issue = (email: string, code: string | null, cooldownMs?: number) =>
    database.requestPasswordReset({
      email,
      passwordResetCode: code,
      cooldownMs
    })

  it('issues, validates and consumes a code for the target account only', async () => {
    const neighbour = await newAccount('reset-n')
    const target = await newAccount('reset-t')
    const neighbourCode = `reset-n-${neighbour.accountId}`
    const code = `reset-t-${target.accountId}`
    expect(await issue(neighbour.email, neighbourCode)).toBe(true)
    expect(await issue(target.email, code)).toBe(true)
    expect(await issue(`missing@${DOMAIN}`, 'nope')).toBe(false)
    expect((await accountRow(neighbour.accountId)).passwordResetCode).toBe(
      neighbourCode
    )

    expect(
      await database.validatePasswordResetCode({ passwordResetCode: code })
    ).toBe(target.accountId)

    await addSession(target.accountId, `reset-t-session-${target.accountId}`)
    await addSession(
      neighbour.accountId,
      `reset-n-session-${neighbour.accountId}`
    )
    const neighbourBefore = await accountRow(neighbour.accountId)

    const reset = await database.resetPasswordWithCode({
      passwordResetCode: code,
      newPasswordHash: 'new-hash'
    })
    expect(reset?.id).toBe(target.accountId)
    expect(reset?.passwordHash).toBe('new-hash')
    expect(reset?.passwordResetCode).toBeNull()
    expect(await sessionTokens(target.accountId)).toEqual([])
    expect(await sessionTokens(neighbour.accountId)).toEqual([
      `reset-n-session-${neighbour.accountId}`
    ])
    expect(await accountRow(neighbour.accountId)).toEqual(neighbourBefore)
    const credential = (accountId: string) =>
      db()
        .selectFrom('account_providers')
        .select('password')
        .where('id', '=', `credential_${accountId}`)
        .executeTakeFirstOrThrow()
    expect((await credential(target.accountId)).password).toBe('new-hash')
    expect((await credential(neighbour.accountId)).password).toBe(
      `hash-${neighbour.username}`
    )

    // Single use.
    expect(
      await database.validatePasswordResetCode({ passwordResetCode: code })
    ).toBeNull()
    expect(
      await database.resetPasswordWithCode({
        passwordResetCode: code,
        newPasswordHash: 'again'
      })
    ).toBeNull()
  })

  it('issues a code that expires a day after the request', async () => {
    const target = await newAccount('reset-ttl')
    const before = Date.now()
    expect(await issue(target.email, `reset-ttl-${target.accountId}`)).toBe(
      true
    )
    const after = Date.now()
    const day = 24 * 60 * 60 * 1000
    const { passwordResetCodeExpiresAt } = await accountRow(target.accountId)
    expect(passwordResetCodeExpiresAt).toBeGreaterThanOrEqual(before + day)
    expect(passwordResetCodeExpiresAt).toBeLessThanOrEqual(after + day)
  })

  it('refuses an expired code, and a code of another account', async () => {
    const neighbour = await newAccount('reset-x-n')
    const target = await newAccount('reset-x-t')
    const neighbourCode = `reset-x-n-${neighbour.accountId}`
    const code = `reset-x-t-${target.accountId}`
    await issue(neighbour.email, neighbourCode)
    await issue(target.email, code)

    expect(
      await database.resetPasswordWithCode({
        accountId: target.accountId,
        passwordResetCode: neighbourCode,
        newPasswordHash: 'stolen'
      })
    ).toBeNull()

    await patchAccount(target.accountId, {
      passwordResetCodeExpiresAt: new Date(Date.now() - 1_000)
    })
    expect(
      await database.validatePasswordResetCode({ passwordResetCode: code })
    ).toBeNull()
    expect(
      await database.resetPasswordWithCode({
        accountId: target.accountId,
        passwordResetCode: code,
        newPasswordHash: 'late'
      })
    ).toBeNull()
    expect((await accountRow(target.accountId)).passwordHash).toBe(
      `hash-${target.username}`
    )
    expect((await accountRow(neighbour.accountId)).passwordHash).toBe(
      `hash-${neighbour.username}`
    )
    expect((await accountRow(neighbour.accountId)).passwordResetCode).toBe(
      neighbourCode
    )
  })

  it('applies the cooldown to a live code only', async () => {
    const cooldownMs = 60_000
    const target = await newAccount('cooldown')

    // No code at all: always issued.
    expect(await issue(target.email, 'first', cooldownMs)).toBe(true)
    // A code issued just now is inside the cooldown.
    expect(await issue(target.email, 'second', cooldownMs)).toBe(false)
    expect((await accountRow(target.accountId)).passwordResetCode).toBe('first')

    // A code with no expiry qualifies.
    await patchAccount(target.accountId, { passwordResetCodeExpiresAt: null })
    expect(await issue(target.email, 'third', cooldownMs)).toBe(true)

    // A cleared code with a leftover expiry qualifies.
    await patchAccount(target.accountId, {
      passwordResetCode: null,
      passwordResetCodeExpiresAt: new Date(Date.now() + 24 * 3_600_000)
    })
    expect(await issue(target.email, 'fourth', cooldownMs)).toBe(true)

    // A code issued longer ago than the cooldown qualifies.
    await patchAccount(target.accountId, {
      passwordResetCodeExpiresAt: new Date(
        Date.now() + 24 * 3_600_000 - cooldownMs - 1_000
      )
    })
    expect(await issue(target.email, 'fifth', cooldownMs)).toBe(true)
    expect((await accountRow(target.accountId)).passwordResetCode).toBe('fifth')
  })

  it('changes the password of the target account only', async () => {
    const neighbour = await newAccount('change-n')
    const target = await newAccount('change-t')
    await issue(target.email, `change-t-${target.accountId}`)
    await addSession(target.accountId, `change-t-session-${target.accountId}`)
    await addSession(
      neighbour.accountId,
      `change-n-session-${neighbour.accountId}`
    )
    const neighbourBefore = await accountRow(neighbour.accountId)

    await database.changePassword({
      accountId: target.accountId,
      newPasswordHash: 'changed'
    })

    expect(await accountRow(target.accountId)).toMatchObject({
      passwordHash: 'changed',
      passwordResetCode: null,
      passwordResetCodeExpiresAt: null
    })
    expect(await sessionTokens(target.accountId)).toEqual([])
    expect(await sessionTokens(neighbour.accountId)).toEqual([
      `change-n-session-${neighbour.accountId}`
    ])
    expect(await accountRow(neighbour.accountId)).toEqual(neighbourBefore)
  })
})

describe('repointUnconfirmedAccountEmail', () => {
  const repoint = (accountId: string, label: string) =>
    database.repointUnconfirmedAccountEmail({
      accountId,
      email: `${label}-${accountId}@${DOMAIN}`,
      verificationCode: `new-${accountId}`
    })

  it.each([
    { state: 'false', emailVerified: false },
    { state: 'unset', emailVerified: null }
  ])(
    'moves a pending account whose emailVerified is $state',
    async ({ emailVerified }) => {
      const neighbour = await newAccount('repoint-n', {
        verificationCode: 'pending-n'
      })
      const target = await newAccount('repoint-t', {
        verificationCode: 'pending-t'
      })
      await patchAccount(target.accountId, { emailVerified })
      const neighbourBefore = await accountRow(neighbour.accountId)

      const moved = await repoint(target.accountId, 'moved')
      expect(moved?.email).toBe(`moved-${target.accountId}@${DOMAIN}`)
      expect(moved?.verificationCode).toBe(`new-${target.accountId}`)
      expect(await accountRow(neighbour.accountId)).toEqual(neighbourBefore)
    }
  )

  it.each([
    { state: 'no code', values: { verificationCode: null } },
    { state: 'an empty code', values: { verificationCode: '' } },
    {
      state: 'a confirmed address',
      values: { verificationCode: 'still-set', emailVerified: true }
    }
  ])('leaves an account with $state', async ({ values }) => {
    const target = await newAccount('repoint-x', {
      verificationCode: 'pending-x'
    })
    await patchAccount(target.accountId, values)
    const before = await accountRow(target.accountId)

    const account = await repoint(target.accountId, 'moved')
    expect(account?.email).toBe(target.email)
    expect(await accountRow(target.accountId)).toEqual(before)
  })
})

// Forces the next matching write on `table` to fail with a database error.
// Returns the function that removes the trigger again.
const failWrite = async (
  table: string,
  event: 'insert' | 'delete',
  column: string,
  value: string
) => {
  const name = `account_queries_fail_${event}_${table}`.toLowerCase()
  const record = event === 'insert' ? 'new' : 'old'
  const literal = `'${value.replaceAll("'", "''")}'`
  if (testDb.backend === 'pg') {
    await sql
      .raw(
        `create or replace function account_queries_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
      )
      .execute(db())
    await sql
      .raw(
        `create trigger ${name} before ${event} on "${table}" for each row when (${record}."${column}" = ${literal}) execute function account_queries_fail()`
      )
      .execute(db())
    return () => sql.raw(`drop trigger ${name} on "${table}"`).execute(db())
  }
  await sql
    .raw(
      `create trigger ${name} before ${event} on "${table}" when ${record}."${column}" = ${literal} begin select raise(abort, 'forced failure'); end`
    )
    .execute(db())
  return () => sql.raw(`drop trigger ${name}`).execute(db())
}

const TABLES = [
  'accounts',
  'actors',
  'account_providers',
  'counters',
  'search_documents',
  'sessions',
  'oauthAccessToken',
  'oauthRefreshToken'
] as const

const dumpTables = async () => {
  const dump: Record<string, unknown[]> = {}
  for (const table of TABLES) {
    dump[table] = await db()
      .selectFrom(table)
      .selectAll()
      .orderBy('id')
      .execute()
  }
  return dump
}

describe('service counters', () => {
  const counterTotals = async () => {
    const rows = await db()
      .selectFrom('counters')
      .select(['id', 'value'])
      .execute()
    const sum = (match: (id: string) => boolean) =>
      rows
        .filter((row) => match(row.id))
        .reduce((total, row) => total + Number(row.value), 0)
    const bucket = (type: string) => (id: string) =>
      id.startsWith(CounterKey.bucketKey(type, ''))
    return {
      users: sum((id) => id === CounterKey.nodeinfoTotalUsers()),
      accounts: sum((id) => id === CounterKey.serviceTotalAccounts()),
      actors: sum((id) => id === CounterKey.serviceTotalActors()),
      accountBuckets: sum(bucket('accounts')),
      actorBuckets: sum(bucket('actors'))
    }
  }

  it('createAccount and createActorForAccount count what they create', async () => {
    const before = await counterTotals()
    const owner = await newAccount('counted')
    await database.createActorForAccount({
      accountId: owner.accountId,
      username: `counted-${crypto.randomUUID().slice(0, 8)}`,
      domain: DOMAIN,
      privateKey: 'private',
      publicKey: 'public'
    })
    expect(await counterTotals()).toEqual({
      users: before.users + 1,
      accounts: before.accounts + 1,
      actors: before.actors + 2,
      accountBuckets: before.accountBuckets + 1,
      actorBuckets: before.actorBuckets + 2
    })
  })
})

describe('transactions', () => {
  it('createAccount keeps nothing when its search document write fails', async () => {
    const username = `txfail-${crypto.randomUUID().slice(0, 8)}`
    const drop = await failWrite(
      'search_documents',
      'insert',
      'entityId',
      getLocalActorId({ domain: DOMAIN, username })
    )
    const before = await dumpTables()
    try {
      await expect(
        database.createAccount({
          email: `${username}@${DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: DOMAIN,
          privateKey: 'private',
          publicKey: 'public'
        })
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('createActorForAccount keeps nothing when its search document write fails', async () => {
    const owner = await newAccount('txfail-owner')
    const username = `txfail-${crypto.randomUUID().slice(0, 8)}`
    const drop = await failWrite(
      'search_documents',
      'insert',
      'entityId',
      getLocalActorId({ domain: DOMAIN, username })
    )
    const before = await dumpTables()
    try {
      await expect(
        database.createActorForAccount({
          accountId: owner.accountId,
          username,
          domain: DOMAIN,
          privateKey: 'private',
          publicKey: 'public'
        })
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  })

  it('resetPasswordWithCode keeps the code, the password and the sessions when the session delete fails', async () => {
    const target = await newAccount('txfail-reset')
    const code = `txfail-reset-${target.accountId}`
    await database.requestPasswordReset({
      email: target.email,
      passwordResetCode: code
    })
    await addSession(target.accountId, `txfail-reset-${target.accountId}`)
    await addOAuthTokens(target.accountId, `txfail-reset-${target.accountId}`)
    const drop = await failWrite(
      'sessions',
      'delete',
      'accountId',
      target.accountId
    )
    const before = await dumpTables()
    try {
      await expect(
        database.resetPasswordWithCode({
          passwordResetCode: code,
          newPasswordHash: 'never'
        })
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
    expect(
      await database.validatePasswordResetCode({ passwordResetCode: code })
    ).toBe(target.accountId)
  })

  it('changePassword keeps the password and the sessions when the session delete fails', async () => {
    const target = await newAccount('txfail-change')
    await addSession(target.accountId, `txfail-change-${target.accountId}`)
    await addOAuthTokens(target.accountId, `txfail-change-${target.accountId}`)
    const drop = await failWrite(
      'sessions',
      'delete',
      'accountId',
      target.accountId
    )
    const before = await dumpTables()
    try {
      await expect(
        database.changePassword({
          accountId: target.accountId,
          newPasswordHash: 'never'
        })
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dumpTables()).toEqual(before)
  })
})

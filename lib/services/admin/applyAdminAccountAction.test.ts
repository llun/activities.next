import crypto from 'crypto'
import { sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { applyAdminAccountAction } from '@/lib/services/admin/applyAdminAccountAction'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { getLocalActorId } from '@/lib/utils/activitypubId'

// The admin action runs on both backends. PostgreSQL is where the
// `oauthAccessToken.sessionId` / `oauthRefreshToken.sessionId` foreign keys are
// enforced, so a bare session delete throws there; the token-detach assertions
// below also fail on SQLite, where the old code left the tokens pointing at a
// deleted session.
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

const MODERATOR_ACTOR_ID = `https://${TEST_DOMAIN}/users/moderator`

const newAccount = async (label: string) => {
  const username = `${label}-${crypto.randomUUID().slice(0, 8)}`
  const email = `${username}@${TEST_DOMAIN}`
  const accountId = await database.createAccount({
    email,
    username,
    passwordHash: TEST_PASSWORD_HASH,
    domain: TEST_DOMAIN,
    privateKey: 'private',
    publicKey: 'public'
  })
  return {
    accountId,
    username,
    email,
    actorId: getLocalActorId({ domain: TEST_DOMAIN, username })
  }
}

// A session that minted an OAuth access + refresh token pair, the shape
// better-auth writes when a user authorises a client app.
const addSessionWithOAuthTokens = async (
  kysely: Db,
  accountId: string,
  token: string
) => {
  await database.createAccountSession({
    accountId,
    token,
    expireAt: Date.now() + 60_000
  })
  const session = await kysely
    .selectFrom('sessions')
    .select('id')
    .where('token', '=', token)
    .executeTakeFirstOrThrow()

  const clientId = `client-${crypto.randomUUID()}`
  await kysely
    .insertInto('oauthClient')
    .values({
      id: crypto.randomUUID(),
      clientId,
      redirectUris: '[]'
    })
    .execute()

  const refreshId = crypto.randomUUID()
  await kysely
    .insertInto('oauthRefreshToken')
    .values({
      id: refreshId,
      token: `refresh-${crypto.randomUUID()}`,
      clientId,
      userId: accountId,
      sessionId: session.id,
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: 'read'
    })
    .execute()

  const accessId = crypto.randomUUID()
  await kysely
    .insertInto('oauthAccessToken')
    .values({
      id: accessId,
      token: `access-${crypto.randomUUID()}`,
      clientId,
      userId: accountId,
      sessionId: session.id,
      refreshId,
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: 'read'
    })
    .execute()

  return { sessionId: session.id, accessId, refreshId }
}

const tokenSessionIds = async (accessId: string, refreshId: string) => {
  const access = await db()
    .selectFrom('oauthAccessToken')
    .select('sessionId')
    .where('id', '=', accessId)
    .executeTakeFirstOrThrow()
  const refresh = await db()
    .selectFrom('oauthRefreshToken')
    .select('sessionId')
    .where('id', '=', refreshId)
    .executeTakeFirstOrThrow()
  return { access: access.sessionId, refresh: refresh.sessionId }
}

const sessionExists = async (sessionId: string) =>
  Boolean(
    await db()
      .selectFrom('sessions')
      .select('id')
      .where('id', '=', sessionId)
      .executeTakeFirst()
  )

const moderationActionsFor = (actorId: string) =>
  db()
    .selectFrom('moderation_actions')
    .selectAll()
    .where('targetActorId', '=', actorId)
    .execute()

const reportRow = (reportId: string) =>
  db()
    .selectFrom('reports')
    .selectAll()
    .where('id', '=', reportId)
    .executeTakeFirstOrThrow()

const recordFor = async (actorId: string) => {
  const record = await database.getAdminAccount({ actorId })
  if (!record) throw new Error(`no admin account record for ${actorId}`)
  return record
}

describe('applyAdminAccountAction', () => {
  it('suspends an account with an OAuth-token session in one transaction', async () => {
    const target = await newAccount('suspend')
    const { sessionId, accessId, refreshId } = await addSessionWithOAuthTokens(
      db(),
      target.accountId,
      `suspend-${target.accountId}`
    )
    const report = await database.createReport({
      actorId: `https://${TEST_DOMAIN}/users/reporter`,
      targetActorId: target.actorId
    })

    const result = await applyAdminAccountAction({
      database,
      record: await recordFor(target.actorId),
      action: 'suspend',
      moderator: { accountId: null, actorId: MODERATOR_ACTOR_ID },
      reportId: report.id
    })
    expect(result).toEqual({ ok: true })

    const actor = await db()
      .selectFrom('actors')
      .select('suspendedAt')
      .where('id', '=', target.actorId)
      .executeTakeFirstOrThrow()
    expect(actor.suspendedAt).toEqual(expect.any(Number))

    expect(await sessionExists(sessionId)).toBe(false)
    expect(await tokenSessionIds(accessId, refreshId)).toEqual({
      access: null,
      refresh: null
    })

    const actions = await moderationActionsFor(target.actorId)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      action: 'suspend',
      reportId: report.id,
      moderatorActorId: MODERATOR_ACTOR_ID
    })

    expect(await reportRow(report.id)).toMatchObject({
      actionTaken: true,
      actionTakenByActorId: MODERATOR_ACTOR_ID
    })
  })

  it('disables an account with an OAuth-token session in one transaction', async () => {
    const target = await newAccount('disable')
    const { sessionId, accessId, refreshId } = await addSessionWithOAuthTokens(
      db(),
      target.accountId,
      `disable-${target.accountId}`
    )

    const result = await applyAdminAccountAction({
      database,
      record: await recordFor(target.actorId),
      action: 'disable',
      moderator: { accountId: null, actorId: MODERATOR_ACTOR_ID }
    })
    expect(result).toEqual({ ok: true })

    const account = await db()
      .selectFrom('accounts')
      .select('disabledAt')
      .where('id', '=', target.accountId)
      .executeTakeFirstOrThrow()
    expect(account.disabledAt).toEqual(expect.any(Number))

    expect(await sessionExists(sessionId)).toBe(false)
    expect(await tokenSessionIds(accessId, refreshId)).toEqual({
      access: null,
      refresh: null
    })
    expect(await moderationActionsFor(target.actorId)).toHaveLength(1)
  })

  it('rolls the whole action back when a later step fails', async () => {
    const target = await newAccount('rollback')
    const { sessionId, accessId, refreshId } = await addSessionWithOAuthTokens(
      db(),
      target.accountId,
      `rollback-${target.accountId}`
    )
    const report = await database.createReport({
      actorId: `https://${TEST_DOMAIN}/users/reporter`,
      targetActorId: target.actorId
    })

    // Fail the audit-row insert, the last write in the transaction, so the
    // flag change and the session wipe before it have to roll back too.
    if (testDb.backend === 'pg') {
      await sql
        .raw(
          `create or replace function apply_admin_action_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
        )
        .execute(db())
      await sql
        .raw(
          `create trigger apply_admin_action_fail before insert on moderation_actions for each row execute function apply_admin_action_fail()`
        )
        .execute(db())
    } else {
      await sql
        .raw(
          `create trigger apply_admin_action_fail before insert on moderation_actions begin select raise(abort, 'forced failure'); end`
        )
        .execute(db())
    }

    try {
      await expect(
        applyAdminAccountAction({
          database,
          record: await recordFor(target.actorId),
          action: 'suspend',
          moderator: { accountId: null, actorId: MODERATOR_ACTOR_ID },
          reportId: report.id
        })
      ).rejects.toThrow()
    } finally {
      await sql
        .raw(
          testDb.backend === 'pg'
            ? 'drop trigger apply_admin_action_fail on moderation_actions'
            : 'drop trigger apply_admin_action_fail'
        )
        .execute(db())
    }

    const actor = await db()
      .selectFrom('actors')
      .select('suspendedAt')
      .where('id', '=', target.actorId)
      .executeTakeFirstOrThrow()
    expect(actor.suspendedAt).toBeNull()
    expect(await sessionExists(sessionId)).toBe(true)
    expect(await tokenSessionIds(accessId, refreshId)).toEqual({
      access: sessionId,
      refresh: sessionId
    })
    expect(await moderationActionsFor(target.actorId)).toHaveLength(0)
    expect(await reportRow(report.id)).toMatchObject({
      actionTaken: false,
      actionTakenAt: null
    })
  })

  it('rejects an unsuspend of a not-suspended account without writing', async () => {
    const target = await newAccount('unsuspend')

    const result = await applyAdminAccountAction({
      database,
      record: await recordFor(target.actorId),
      action: 'unsuspend',
      moderator: { accountId: null, actorId: MODERATOR_ACTOR_ID }
    })
    expect(result).toEqual({
      ok: false,
      status: 422,
      error: 'Account is not currently suspended'
    })
    expect(await moderationActionsFor(target.actorId)).toHaveLength(0)
  })
})

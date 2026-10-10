import crypto from 'crypto'
import { sql } from 'kysely'

import {
  SESSION_ID_CHUNK_SIZE,
  deleteSessionsWithTokenDetach as deleteWithKysely
} from '@/lib/database/domains/account/sessions'
import { deleteSessionsWithTokenDetach as deleteWithKnex } from '@/lib/database/sql/utils/detachOAuthTokensFromSessions'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

// The FK-safe session delete has two implementations: the Knex one the
// better-auth adapter still calls with its own transaction, and the Kysely one
// the account queries use. Both must leave the same rows behind, so each runs
// against the same seeded rows and the resulting tables are compared. The
// seed spans more than one chunk of session ids and carries OAuth tokens on
// the sessions to delete, on the session to keep and on another account's
// session.

const testDb = createTestDatabase()
const { database } = testDb
const db = () => testDb.db

const SEEDED_AT = new Date('2026-01-02T03:04:05.000Z')
const EXPIRES_AT = new Date('2027-01-02T03:04:05.000Z')
const REVOKED_COUNT = SESSION_ID_CHUNK_SIZE + 7
// Sessions to delete that carry tokens: first, either side of the chunk
// boundary, and last.
const TOKEN_INDEXES = [
  0,
  SESSION_ID_CHUNK_SIZE - 1,
  SESSION_ID_CHUNK_SIZE,
  REVOKED_COUNT - 1
]

let targetAccountId: string
let neighbourAccountId: string
const clientId = `detach-client-${crypto.randomUUID()}`

beforeAll(async () => {
  await testDb.prepare()
  await database.migrate()
  const create = (label: string) =>
    database.createAccount({
      email: `${label}@detach.test`,
      username: label,
      passwordHash: 'hash',
      domain: 'detach.test',
      privateKey: 'private',
      publicKey: 'public'
    })
  targetAccountId = await create('detach-target')
  neighbourAccountId = await create('detach-neighbour')
  await db()
    .insertInto('oauthClient')
    .values({ id: clientId, clientId, redirectUris: '[]' })
    .execute()
})

afterAll(async () => {
  await database.destroy()
})

const clear = async () => {
  await db().deleteFrom('oauthAccessToken').execute()
  await db().deleteFrom('oauthRefreshToken').execute()
  await db().deleteFrom('sessions').execute()
}

const addSession = async (id: string, accountId: string, token: string) => {
  await db()
    .insertInto('sessions')
    .values({
      id,
      accountId,
      token,
      expireAt: EXPIRES_AT,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT
    })
    .execute()
}

const addTokens = async (sessionId: string, userId: string) => {
  await db()
    .insertInto('oauthRefreshToken')
    .values({
      id: `refresh-${sessionId}`,
      token: `refresh-token-${sessionId}`,
      clientId,
      userId,
      sessionId,
      expiresAt: EXPIRES_AT,
      scopes: 'read',
      createdAt: SEEDED_AT
    })
    .execute()
  await db()
    .insertInto('oauthAccessToken')
    .values({
      id: `access-${sessionId}`,
      token: `access-token-${sessionId}`,
      clientId,
      userId,
      sessionId,
      refreshId: `refresh-${sessionId}`,
      expiresAt: EXPIRES_AT,
      scopes: 'read',
      createdAt: SEEDED_AT
    })
    .execute()
}

const seed = async () => {
  await clear()
  await addSession('keep', targetAccountId, 'keep-token')
  await addTokens('keep', targetAccountId)
  await addSession('neighbour', neighbourAccountId, 'neighbour-token')
  await addTokens('neighbour', neighbourAccountId)
  for (let index = 0; index < REVOKED_COUNT; index += 1) {
    const id = `revoke-${String(index).padStart(4, '0')}`
    await addSession(id, targetAccountId, `revoke-token-${index}`)
    if (TOKEN_INDEXES.includes(index)) await addTokens(id, targetAccountId)
  }
}

const dump = async () => ({
  sessions: await db()
    .selectFrom('sessions')
    .selectAll()
    .orderBy('id')
    .execute(),
  accessTokens: await db()
    .selectFrom('oauthAccessToken')
    .selectAll()
    .orderBy('id')
    .execute(),
  refreshTokens: await db()
    .selectFrom('oauthRefreshToken')
    .selectAll()
    .orderBy('id')
    .execute()
})

// Makes deleting the session with this id fail with a database error, and
// returns the function that removes the trigger again.
const failSessionDelete = async (sessionId: string) => {
  const literal = `'${sessionId}'`
  if (testDb.backend === 'pg') {
    await sql
      .raw(
        `create or replace function session_detach_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`
      )
      .execute(db())
    await sql
      .raw(
        `create trigger session_detach_fail before delete on "sessions" for each row when (old."id" = ${literal}) execute function session_detach_fail()`
      )
      .execute(db())
    return () =>
      sql.raw(`drop trigger session_detach_fail on "sessions"`).execute(db())
  }
  await sql
    .raw(
      `create trigger session_detach_fail before delete on "sessions" when old."id" = ${literal} begin select raise(abort, 'forced failure'); end`
    )
    .execute(db())
  return () => sql.raw(`drop trigger session_detach_fail`).execute(db())
}

describe('deleteSessionsWithTokenDetach', () => {
  it('leaves the same rows behind with Knex and with Kysely', async () => {
    await seed()
    const knexCount = await testDb.knex.transaction((trx) =>
      deleteWithKnex(trx, (query) =>
        query
          .where('accountId', targetAccountId)
          .andWhereNot('token', 'keep-token')
      )
    )
    const afterKnex = await dump()

    await seed()
    const kyselyCount = await deleteWithKysely(db(), (eb) =>
      eb.and([
        eb('accountId', '=', targetAccountId),
        eb.not(eb('token', '=', 'keep-token'))
      ])
    )
    const afterKysely = await dump()

    expect(kyselyCount).toBe(knexCount)
    expect(afterKysely).toEqual(afterKnex)

    // And what both left is what the delete promises.
    expect(kyselyCount).toBe(REVOKED_COUNT)
    expect(afterKysely.sessions.map((row) => row.id)).toEqual([
      'keep',
      'neighbour'
    ])
    const sessionIdById = (rows: { id: string; sessionId: string | null }[]) =>
      Object.fromEntries(rows.map((row) => [row.id, row.sessionId]))
    const expected = Object.fromEntries(
      TOKEN_INDEXES.map((index) => [
        `revoke-${String(index).padStart(4, '0')}`,
        null
      ])
    )
    expect(
      sessionIdById(
        afterKysely.accessTokens.map((row) => ({
          id: row.id.replace(/^access-/, ''),
          sessionId: row.sessionId
        }))
      )
    ).toEqual({ ...expected, keep: 'keep', neighbour: 'neighbour' })
    expect(
      sessionIdById(
        afterKysely.refreshTokens.map((row) => ({
          id: row.id.replace(/^refresh-/, ''),
          sessionId: row.sessionId
        }))
      )
    ).toEqual({ ...expected, keep: 'keep', neighbour: 'neighbour' })
  })

  it('runs inside the caller transaction and rolls back with it', async () => {
    await seed()
    const before = await dump()
    await expect(
      db()
        .transaction()
        .execute(async (trx) => {
          expect(
            await deleteWithKysely(trx, (eb) =>
              eb('accountId', '=', targetAccountId)
            )
          ).toBe(REVOKED_COUNT + 1)
          throw new Error('roll back')
        })
    ).rejects.toThrow('roll back')
    expect(await dump()).toEqual(before)
  })

  it('keeps every token attached when a later chunk delete fails', async () => {
    await seed()
    const before = await dump()
    // The last doomed session sits in the second chunk, so the first chunk's
    // detach and delete have already run when this one fails.
    const lastId = `revoke-${String(REVOKED_COUNT - 1).padStart(4, '0')}`
    const drop = await failSessionDelete(lastId)
    try {
      await expect(
        deleteWithKysely(db(), (eb) => eb('accountId', '=', targetAccountId))
      ).rejects.toThrow()
    } finally {
      await drop()
    }
    expect(await dump()).toEqual(before)
  })

  it('deletes nothing when the scope matches nothing', async () => {
    await seed()
    const before = await dump()
    expect(
      await deleteWithKysely(db(), (eb) => eb('accountId', '=', 'missing'))
    ).toBe(0)
    expect(await dump()).toEqual(before)
  })
})

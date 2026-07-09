import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Exercises the persisted `actors.lastStatusAt` column: it is maintained inside
// the status create/delete transactions and read by the directory `order=active`
// sort and the Mastodon serializer's `last_status_at`. Uses a self-owned
// in-memory SQLite database (running the real migration chain, including the new
// `lastStatusAt` migration) so tests can control `actors.createdAt` and read the
// raw column directly.
const withDatabase = async (
  test: (database: Database, instance: Knex) => Promise<void>
) => {
  const instance = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const database = getSQLDatabase(instance)
  try {
    await database.migrate()
    await test(database, instance)
  } finally {
    await instance.destroy()
  }
}

const at = (iso: string) => Date.parse(iso)

const createLocalActor = async (database: Database, username: string) => {
  await database.createAccount({
    email: `${username}@${TEST_DOMAIN}`,
    username,
    passwordHash: 'hash',
    domain: TEST_DOMAIN,
    privateKey: `privateKey-${username}`,
    publicKey: `publicKey-${username}`
  })
  const actor = await database.getActorFromUsername({
    username,
    domain: TEST_DOMAIN
  })
  if (!actor) throw new Error(`actor ${username} was not created`)
  return actor.id
}

const createNoteAt = (
  database: Database,
  actorId: string,
  suffix: string,
  createdAt: number
) =>
  database.createNote({
    id: `${actorId}/statuses/${suffix}`,
    url: `${actorId}/statuses/${suffix}`,
    actorId,
    text: `note ${suffix}`,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    createdAt
  })

// The serialized `last_status_at` (UTC date string, or null) — the value read
// back through the same path the directory and Mastodon API expose.
const lastStatusDate = async (database: Database, actorId: string) => {
  const account = await database.getMastodonActor(actorId)
  return account?.last_status_at ?? null
}

const directoryUsernames = async (
  database: Database,
  order: 'active' | 'new'
) => {
  const actors = await database.getLocalMastodonActors({
    localDomain: TEST_DOMAIN,
    order
  })
  return actors.map((actor) => actor.username)
}

describe('actors.lastStatusAt maintenance', () => {
  it('sets it from the created status and advances only for a newer status', async () => {
    await withDatabase(async (database) => {
      const actorId = await createLocalActor(database, 'alice')
      expect(await lastStatusDate(database, actorId)).toBeNull()

      await createNoteAt(database, actorId, '1', at('2026-03-01T10:00:00Z'))
      expect(await lastStatusDate(database, actorId)).toBe('2026-03-01')

      // A newer status advances it.
      await createNoteAt(database, actorId, '2', at('2026-03-05T10:00:00Z'))
      expect(await lastStatusDate(database, actorId)).toBe('2026-03-05')

      // A backdated status (e.g. a federated/imported post) must not lower it.
      await createNoteAt(database, actorId, '0', at('2026-01-01T10:00:00Z'))
      expect(await lastStatusDate(database, actorId)).toBe('2026-03-05')
    })
  })

  it('advances it for an Announce and a Poll (parity with the old aggregation)', async () => {
    await withDatabase(async (database) => {
      const actorId = await createLocalActor(database, 'alice')
      // A real status for the Announce to reblog.
      const original = await createNoteAt(
        database,
        actorId,
        'original',
        at('2026-03-01T10:00:00Z')
      )

      await database.createPoll({
        id: `${actorId}/statuses/poll`,
        url: `${actorId}/statuses/poll`,
        actorId,
        text: 'poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Yes', 'No'],
        endAt: at('2026-04-01T00:00:00Z'),
        createdAt: at('2026-03-06T10:00:00Z')
      })
      expect(await lastStatusDate(database, actorId)).toBe('2026-03-06')

      await database.createAnnounce({
        id: `${actorId}/statuses/reblog`,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: original.id,
        createdAt: at('2026-03-10T10:00:00Z')
      })
      expect(await lastStatusDate(database, actorId)).toBe('2026-03-10')
    })
  })

  it('recomputes it to the previous status when the newest status is deleted', async () => {
    await withDatabase(async (database) => {
      const actorId = await createLocalActor(database, 'alice')
      await createNoteAt(database, actorId, '1', at('2026-03-01T10:00:00Z'))
      await createNoteAt(database, actorId, '2', at('2026-03-05T10:00:00Z'))
      await createNoteAt(database, actorId, '3', at('2026-03-10T10:00:00Z'))
      expect(await lastStatusDate(database, actorId)).toBe('2026-03-10')

      await database.deleteStatus({
        statusId: `${actorId}/statuses/3`,
        actorId
      })
      expect(await lastStatusDate(database, actorId)).toBe('2026-03-05')
    })
  })

  it('clears it to null when the last remaining status is deleted', async () => {
    await withDatabase(async (database, instance) => {
      const actorId = await createLocalActor(database, 'alice')
      await createNoteAt(database, actorId, '1', at('2026-03-01T10:00:00Z'))
      expect(await lastStatusDate(database, actorId)).toBe('2026-03-01')

      await database.deleteStatus({
        statusId: `${actorId}/statuses/1`,
        actorId
      })
      expect(await lastStatusDate(database, actorId)).toBeNull()
      // The column itself is NULL, not a stale/zero value.
      const row = await instance('actors')
        .where('id', actorId)
        .first('lastStatusAt')
      expect(row?.lastStatusAt).toBeNull()
    })
  })

  it('updateActorLastStatusAt is a guarded set-if-newer', async () => {
    await withDatabase(async (database) => {
      const actorId = await createLocalActor(database, 'alice')

      await database.updateActorLastStatusAt(
        actorId,
        at('2026-03-05T10:00:00Z')
      )
      expect(await lastStatusDate(database, actorId)).toBe('2026-03-05')

      // An older time does not lower the persisted value.
      await database.updateActorLastStatusAt(
        actorId,
        at('2026-01-01T10:00:00Z')
      )
      expect(await lastStatusDate(database, actorId)).toBe('2026-03-05')
    })
  })
})

describe('getLocalMastodonActors ordering', () => {
  it('orders by last status time for order=active, placing never-posted actors last', async () => {
    await withDatabase(async (database) => {
      const aliceId = await createLocalActor(database, 'alice')
      const bobId = await createLocalActor(database, 'bob')
      await createLocalActor(database, 'carol') // never posts

      await createNoteAt(database, aliceId, '1', at('2026-03-01T00:00:00Z'))
      await createNoteAt(database, bobId, '1', at('2026-03-09T00:00:00Z'))

      expect(await directoryUsernames(database, 'active')).toEqual([
        'bob',
        'alice',
        'carol'
      ])
    })
  })

  it('orders by account creation for order=new, independent of activity', async () => {
    await withDatabase(async (database, instance) => {
      const aliceId = await createLocalActor(database, 'alice')
      const bobId = await createLocalActor(database, 'bob')

      // Deterministic account age: alice older, bob newer.
      await instance('actors')
        .where('id', aliceId)
        .update({ createdAt: new Date(at('2026-01-01T00:00:00Z')) })
      await instance('actors')
        .where('id', bobId)
        .update({ createdAt: new Date(at('2026-01-02T00:00:00Z')) })

      // Make the OLDER account (alice) the more recently active one.
      await createNoteAt(database, aliceId, '1', at('2026-05-01T00:00:00Z'))
      await createNoteAt(database, bobId, '1', at('2026-04-01T00:00:00Z'))

      // `new` follows account age (bob first) and ignores activity.
      expect(await directoryUsernames(database, 'new')).toEqual([
        'bob',
        'alice'
      ])
      // `active` follows last status time (alice first).
      expect(await directoryUsernames(database, 'active')).toEqual([
        'alice',
        'bob'
      ])
    })
  })
})

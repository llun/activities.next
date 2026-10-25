import type { Db } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'

// The remote-rename write (Mastodon's rename_account!): what it updates, what
// it refuses, and how a stale remote row still holding the handle gets out of
// the way of the unique index.
describe('updateRemoteActorHandle', () => {
  const withFreshDatabase = async (
    test: (database: Database, db: Db) => Promise<void>
  ) => {
    const testDb = createTestDatabase()
    await testDb.prepare()
    const { database } = testDb
    await database.migrate()
    try {
      await test(database, testDb.db)
    } finally {
      await database.destroy()
    }
  }

  const createRemoteActor = (
    database: Database,
    {
      actorId,
      username,
      domain
    }: { actorId: string; username: string; domain: string }
  ) =>
    database
      .createActor({
        actorId,
        username,
        domain,
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `https://${domain}/inbox`,
        publicKey: 'public-key',
        createdAt: Date.now()
      })
      .then(() => actorId)

  const createLocalActor = async (
    database: Database,
    username: string,
    domain = TEST_DOMAIN
  ) => {
    const accountId = await database.createAccount({
      email: `${username}-${crypto.randomUUID()}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain,
      privateKey: `private-key-${username}`,
      publicKey: `public-key-${username}`
    })
    const actors = await database.getActorsForAccount({ accountId })
    return actors[0].id
  }

  it('renames a remote actor in place, keeping the id and re-indexing search', () =>
    withFreshDatabase(async (database, db) => {
      const actorId = await createRemoteActor(database, {
        actorId: 'https://old.remote.test/users/alice',
        username: 'alice',
        domain: 'old.remote.test'
      })

      const renamed = await database.updateRemoteActorHandle({
        actorId,
        username: 'bob',
        domain: 'new.remote.test'
      })

      expect(renamed).toMatchObject({
        id: actorId,
        username: 'bob',
        domain: 'new.remote.test'
      })
      await expect(
        database.getActorFromId({ id: actorId })
      ).resolves.toMatchObject({ username: 'bob', domain: 'new.remote.test' })
      await expect(
        database.getActorFromUsername({
          username: 'alice',
          domain: 'old.remote.test'
        })
      ).resolves.toBeNull()
      const document = await db
        .selectFrom('search_documents')
        .selectAll()
        .where('entityType', '=', 'account')
        .where('entityId', '=', actorId)
        .executeTakeFirst()
      expect(document?.documentText).toContain('bob')
      expect(document?.documentText).not.toContain('alice')
    }))

  it('is a no-op when the confirmed handle is already stored in any casing', () =>
    withFreshDatabase(async (database) => {
      const actorId = await createRemoteActor(database, {
        actorId: 'https://remote.test/users/alice',
        username: 'Alice',
        domain: 'remote.test'
      })

      await expect(
        database.updateRemoteActorHandle({
          actorId,
          username: 'ALICE',
          domain: 'REMOTE.test'
        })
      ).resolves.toMatchObject({ username: 'Alice', domain: 'remote.test' })
    }))

  it('displaces a stale remote row that holds the confirmed handle', () =>
    withFreshDatabase(async (database, db) => {
      const actorId = await createRemoteActor(database, {
        actorId: 'https://old.remote.test/users/alice',
        username: 'alice',
        domain: 'old.remote.test'
      })
      const squatterId = await createRemoteActor(database, {
        actorId: 'https://squat.remote.test/users/ghost',
        username: 'bob',
        domain: 'new.remote.test'
      })

      await expect(
        database.updateRemoteActorHandle({
          actorId,
          username: 'bob',
          domain: 'new.remote.test'
        })
      ).resolves.toMatchObject({
        id: actorId,
        username: 'bob',
        domain: 'new.remote.test'
      })

      // The squatter keeps its row (statuses and follows point at its id) but
      // its handle is gone, so the unique index never trips and the handle is
      // not resolvable under the squatter any more.
      const squatter = await database.getActorFromId({ id: squatterId })
      expect(squatter).not.toBeNull()
      expect(squatter?.username).not.toBe('bob')
      await expect(
        database.getActorFromUsername({
          username: 'bob',
          domain: 'new.remote.test'
        })
      ).resolves.toMatchObject({ id: actorId })
      const squatterDocument = await db
        .selectFrom('search_documents')
        .selectAll()
        .where('entityType', '=', 'account')
        .where('entityId', '=', squatterId)
        .executeTakeFirst()
      expect(squatterDocument?.documentText).not.toContain('bob')
    }))

  it('refuses to displace a LOCAL row that holds the confirmed handle', () =>
    withFreshDatabase(async (database) => {
      const actorId = await createRemoteActor(database, {
        actorId: 'https://remote.test/users/alice',
        username: 'alice',
        domain: 'remote.test'
      })
      const localId = await createLocalActor(database, 'bob')

      await expect(
        database.updateRemoteActorHandle({
          actorId,
          username: 'bob',
          domain: TEST_DOMAIN
        })
      ).resolves.toBeNull()
      await expect(
        database.getActorFromId({ id: actorId })
      ).resolves.toMatchObject({ username: 'alice', domain: 'remote.test' })
      await expect(
        database.getActorFromId({ id: localId })
      ).resolves.toMatchObject({ username: 'bob' })
    }))

  it('never moves a local actor, whatever the network claims', () =>
    withFreshDatabase(async (database) => {
      const localId = await createLocalActor(database, 'alice')

      await expect(
        database.updateRemoteActorHandle({
          actorId: localId,
          username: 'bob',
          domain: 'remote.test'
        })
      ).resolves.toBeNull()
      await expect(
        database.getActorFromId({ id: localId })
      ).resolves.toMatchObject({
        username: 'alice',
        domain: TEST_DOMAIN
      })
    }))

  it('refuses a handle another actor reserves in the ledger', () =>
    withFreshDatabase(async (database) => {
      const actorId = await createRemoteActor(database, {
        actorId: 'https://remote.test/users/alice',
        username: 'alice',
        domain: 'remote.test'
      })
      // A local actor that renamed away from `previous` keeps it reserved.
      const renamerId = await createLocalActor(database, 'renamer')
      await database.recordActorHandleRename({
        actorId: renamerId,
        username: 'renamer2',
        domain: TEST_DOMAIN,
        now: new Date('2026-01-01T00:00:00.000Z'),
        cooldownMs: 30 * 24 * 60 * 60 * 1000
      })

      await expect(
        database.updateRemoteActorHandle({
          actorId,
          username: 'renamer',
          domain: TEST_DOMAIN
        })
      ).resolves.toBeNull()
      await expect(
        database.getActorFromId({ id: actorId })
      ).resolves.toMatchObject({ username: 'alice', domain: 'remote.test' })
    }))

  it('returns null for an actor this server never stored', () =>
    withFreshDatabase(async (database) => {
      await expect(
        database.updateRemoteActorHandle({
          actorId: 'https://remote.test/users/stranger',
          username: 'bob',
          domain: 'remote.test'
        })
      ).resolves.toBeNull()
    }))
})

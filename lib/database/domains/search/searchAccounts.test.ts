import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { createSearchActor } from '@/lib/database/testing/searchTestHelpers'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getLocalActorId } from '@/lib/utils/activitypubId'

// The statements of one kind among the captured ones. The quoting is the
// backend's, so both forms are matched.
const isActorSelect = (sql: string) =>
  sql.toLowerCase().startsWith('select') &&
  (sql.includes('from `actors`') || sql.includes('from "actors"'))
const isSearchDocumentInsert = (sql: string) =>
  sql.includes('insert into `search_documents`') ||
  sql.includes('insert into "search_documents"')

describe('SearchDatabase accounts', () => {
  it('indexes actors and searches accounts by profile text', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: 'https://remote.test/users/alice',
        username: 'alice',
        name: 'Alice Runner',
        summary: 'Trail running logs'
      })
      await createSearchActor(database, {
        id: 'https://remote.test/users/bob',
        username: 'bob',
        name: 'Bob Builder'
      })

      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 10,
          offset: 0
        })
      ).resolves.toEqual(['https://remote.test/users/alice'])
    } finally {
      await database.destroy()
    }
  })

  it('filters account search to followed actors when requested', async () => {
    const testDb = createTestDatabase()
    const { database, db } = testDb
    const aliceId = 'https://remote.test/users/alice'
    const bobId = 'https://remote.test/users/bob'

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: 'https://remote.test/users/viewer',
        username: 'viewer'
      })
      await createSearchActor(database, {
        id: aliceId,
        username: 'alice',
        summary: 'Runner'
      })
      await createSearchActor(database, {
        id: bobId,
        username: 'bob',
        summary: 'Runner'
      })
      await db
        .updateTable('actors')
        .set({
          settings: JSON.stringify({
            followersUrl: `${bobId}/followers`,
            inboxUrl: `${bobId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            noindex: true
          })
        })
        .where('id', '=', bobId)
        .execute()
      await database.indexActorSearchDocument({ id: bobId })
      await database.createFollow({
        actorId: 'https://remote.test/users/viewer',
        targetActorId: bobId,
        status: FollowStatus.enum.Accepted,
        inbox: 'https://remote.test/users/bob/inbox',
        sharedInbox: 'https://remote.test/inbox'
      })

      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 10
        })
      ).resolves.toEqual([aliceId])
      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 10,
          followingActorId: 'https://remote.test/users/viewer'
        })
      ).resolves.toEqual([bobId])
    } finally {
      await database.destroy()
    }
  })

  it('counts the searcher among the accounts they follow', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb
    const viewerId = 'https://remote.test/users/runner-viewer'
    const followedId = 'https://remote.test/users/followed-runner'
    const strangerId = 'https://remote.test/users/stranger-runner'

    try {
      await testDb.prepare()
      await database.migrate()
      for (const [id, username] of [
        [viewerId, 'runner-viewer'],
        [followedId, 'followed-runner'],
        [strangerId, 'stranger-runner']
      ]) {
        await createSearchActor(database, { id, username, summary: 'Runner' })
      }
      await database.createFollow({
        actorId: viewerId,
        targetActorId: followedId,
        status: FollowStatus.enum.Accepted,
        inbox: `${followedId}/inbox`,
        sharedInbox: 'https://remote.test/inbox'
      })

      // Mastodon's following filter includes the searcher, which is how a
      // client picking list members offers the owner themselves.
      expect(
        (
          await database.searchAccountIds({
            q: 'runner',
            limit: 10,
            followingActorId: viewerId
          })
        ).sort()
      ).toEqual([followedId, viewerId].sort())
      await expect(
        database.searchAccountIds({
          q: '@runner-viewer@remote.test',
          limit: 10,
          followingActorId: viewerId
        })
      ).resolves.toEqual([viewerId])
    } finally {
      await database.destroy()
    }
  })

  it('only returns non-discoverable accounts for exact handle matches', async () => {
    const testDb = createTestDatabase()
    const { database, db } = testDb
    const actorId = 'https://remote.test/users/secret'

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'secret',
        summary: 'Hidden account'
      })
      await db
        .updateTable('actors')
        .set({
          settings: JSON.stringify({
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            noindex: true
          })
        })
        .where('id', '=', actorId)
        .execute()
      await database.indexActorSearchDocument({ id: actorId })

      await expect(
        database.searchAccountIds({
          q: 'hidden',
          limit: 10
        })
      ).resolves.toEqual([])
      await expect(
        database.searchAccountIds({
          q: 'secret',
          limit: 10,
          localDomain: 'remote.test'
        })
      ).resolves.toEqual([actorId])
      await expect(
        database.searchAccountIds({
          q: 'secret',
          limit: 10
        })
      ).resolves.toEqual([])
      await expect(
        database.searchAccountIds({
          q: '@secret@remote.test',
          limit: 10
        })
      ).resolves.toEqual([actorId])
      await db
        .updateTable('actors')
        .set({ username: 'Secret' })
        .where('id', '=', actorId)
        .execute()
      await database.indexActorSearchDocument({ id: actorId })
      await expect(
        database.searchAccountIds({
          q: 'secret',
          limit: 10,
          localDomain: 'remote.test'
        })
      ).resolves.toEqual([actorId])
      await expect(
        database.searchAccountIds({
          q: '@secret@remote.test',
          limit: 10
        })
      ).resolves.toEqual([actorId])
      await database.deleteActorSearchDocument({ id: actorId })
      await expect(
        database.searchAccountIds({
          q: '@secret@remote.test',
          limit: 10
        })
      ).resolves.toEqual([actorId])
    } finally {
      await database.destroy()
    }
  })

  it('escapes account ordering prefix wildcards', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb
    const alphaId = 'https://remote.test/users/alpha'
    const xunnerId = 'https://remote.test/users/xunner'

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: xunnerId,
        username: 'xunner',
        summary: '_unner literal token'
      })
      await createSearchActor(database, {
        id: alphaId,
        username: 'alpha',
        summary: '_unner literal token'
      })

      await expect(
        database.searchAccountIds({
          q: '_unner',
          limit: 10
        })
      ).resolves.toEqual([alphaId, xunnerId])
    } finally {
      await database.destroy()
    }
  })

  it('indexes local account creation without reloading the inserted actor', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb

    try {
      await testDb.prepare()
      await database.migrate()
      const actorSelectQueries = (
        await testDb.captureQueries(() =>
          database.createAccount({
            email: 'local-runner@remote.test',
            username: 'local-runner',
            passwordHash: 'password-hash',
            domain: 'remote.test',
            privateKey: 'private-key',
            publicKey: 'public-key'
          })
        )
      )
        .map(({ sql }) => sql)
        .filter(isActorSelect)

      expect(actorSelectQueries).toHaveLength(0)
      await expect(
        database.searchAccountIds({ q: 'local-runner', limit: 10 })
      ).resolves.toEqual([
        getLocalActorId({ domain: 'remote.test', username: 'local-runner' })
      ])
    } finally {
      await database.destroy()
    }
  })

  it('indexes account actors without reloading the inserted actor', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb

    try {
      await testDb.prepare()
      await database.migrate()
      const accountId = await database.createAccount({
        email: 'local-runner@remote.test',
        username: 'local-runner',
        passwordHash: 'password-hash',
        domain: 'remote.test',
        privateKey: 'private-key',
        publicKey: 'public-key'
      })

      let actorId: string | undefined
      const actorSelectQueries = (
        await testDb.captureQueries(async () => {
          actorId = await database.createActorForAccount({
            accountId,
            username: 'secondary-runner',
            domain: 'remote.test',
            privateKey: 'secondary-private-key',
            publicKey: 'secondary-public-key'
          })
        })
      )
        .map(({ sql }) => sql)
        .filter(isActorSelect)

      expect(actorSelectQueries).toHaveLength(0)
      await expect(
        database.searchAccountIds({ q: 'secondary-runner', limit: 10 })
      ).resolves.toEqual([actorId])
    } finally {
      await database.destroy()
    }
  })

  it('paginates exact account matches with indexed results without skipping', async () => {
    const testDb = createTestDatabase()
    const { database, db } = testDb
    const exactActorId = 'https://remote.test/users/runner'

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: exactActorId,
        username: 'runner',
        summary: 'Hidden runner'
      })
      await db
        .updateTable('actors')
        .set({
          settings: JSON.stringify({
            followersUrl: `${exactActorId}/followers`,
            inboxUrl: `${exactActorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            noindex: true
          })
        })
        .where('id', '=', exactActorId)
        .execute()
      await database.indexActorSearchDocument({ id: exactActorId })
      await createSearchActor(database, {
        id: 'https://remote.test/users/alice',
        username: 'alice',
        summary: 'Runner'
      })
      await createSearchActor(database, {
        id: 'https://remote.test/users/bob',
        username: 'bob',
        summary: 'Runner'
      })

      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 2,
          offset: 0,
          exactActorIds: [exactActorId]
        })
      ).resolves.toEqual([exactActorId, 'https://remote.test/users/alice'])
      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 2,
          offset: 2,
          exactActorIds: [exactActorId]
        })
      ).resolves.toEqual(['https://remote.test/users/bob'])
    } finally {
      await database.destroy()
    }
  })

  it('returns exact account matches without existing search documents', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb
    const exactActorId = 'https://remote.test/users/legacy-runner'

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: exactActorId,
        username: 'legacy-runner',
        summary: 'Legacy runner'
      })
      await database.deleteActorSearchDocument({ id: exactActorId })
      await createSearchActor(database, {
        id: 'https://remote.test/users/alice',
        username: 'alice',
        summary: 'Runner'
      })
      await createSearchActor(database, {
        id: 'https://remote.test/users/bob',
        username: 'bob',
        summary: 'Runner'
      })

      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 2,
          offset: 0,
          exactActorIds: [exactActorId]
        })
      ).resolves.toEqual([exactActorId, 'https://remote.test/users/alice'])
      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 2,
          offset: 2,
          exactActorIds: [exactActorId]
        })
      ).resolves.toEqual(['https://remote.test/users/bob'])
    } finally {
      await database.destroy()
    }
  })

  it('updates account search discoverability during deletion transitions', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb
    const actorId = 'https://remote.test/users/deleting-runner'
    const viewerId = 'https://remote.test/users/deletion-viewer'

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: viewerId,
        username: 'deletion-viewer'
      })
      await createSearchActor(database, {
        id: actorId,
        username: 'deleting-runner',
        summary: 'Runner'
      })
      await database.createFollow({
        actorId: viewerId,
        targetActorId: actorId,
        status: FollowStatus.enum.Accepted,
        inbox: `${actorId}/inbox`,
        sharedInbox: 'https://remote.test/inbox'
      })

      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([actorId])
      await expect(
        database.searchAccountIds({
          q: '@deleting-runner@remote.test',
          limit: 10,
          followingActorId: viewerId
        })
      ).resolves.toEqual([actorId])
      await database.scheduleActorDeletion({
        actorId,
        scheduledAt: new Date()
      })
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([])
      await expect(
        database.searchAccountIds({
          q: '@deleting-runner@remote.test',
          limit: 10
        })
      ).resolves.toEqual([])
      await expect(
        database.searchAccountIds({
          q: '@deleting-runner@remote.test',
          limit: 10,
          followingActorId: viewerId
        })
      ).resolves.toEqual([])
      await database.cancelActorDeletion({ actorId })
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([actorId])
      await database.startActorDeletion({ actorId })
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([])
      await database.cancelActorDeletion({ actorId })
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([actorId])
    } finally {
      await database.destroy()
    }
  })

  it('reindexes account search documents with a batched upsert', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: 'https://remote.test/users/alice',
        username: 'alice',
        summary: 'Runner'
      })
      await createSearchActor(database, {
        id: 'https://remote.test/users/bob',
        username: 'bob',
        summary: 'Runner'
      })

      const statements = (
        await testDb.captureQueries(() =>
          database.reindexSearchAccounts({ limit: 10 })
        )
      ).map(({ sql }) => sql)
      const insertQueries = statements.filter(isSearchDocumentInsert)
      const actorSelectQueries = statements.filter(isActorSelect)

      expect(insertQueries).toHaveLength(1)
      expect(actorSelectQueries).toHaveLength(1)
      expect(actorSelectQueries[0]).not.toContain('select *')
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([
        'https://remote.test/users/alice',
        'https://remote.test/users/bob'
      ])
    } finally {
      await database.destroy()
    }
  })

  it('sizes SQLite account reindex batches from the search document column count', async () => {
    const testDb = createTestDatabase()
    const { database, db } = testDb

    try {
      await testDb.prepare()
      await database.migrate()
      for (let index = 0; index < 83; index += 1) {
        const actorId = `https://remote.test/users/batch-runner-${index}`
        await db
          .insertInto('actors')
          .values({
            id: actorId,
            type: 'Person',
            username: `batch-runner-${index}`,
            domain: 'remote.test',
            name: null,
            summary: 'Runner',
            accountId: null,
            settings: JSON.stringify({
              followersUrl: `${actorId}/followers`,
              inboxUrl: `${actorId}/inbox`,
              sharedInboxUrl: 'https://remote.test/inbox'
            }),
            publicKey: 'public-key',
            privateKey: null,
            deletionStatus: null,
            deletionScheduledAt: null,
            createdAt: new Date(1),
            updatedAt: new Date(1)
          })
          .execute()
      }

      const insertQueries = (
        await testDb.captureQueries(() =>
          database.reindexSearchAccounts({ limit: 83 })
        )
      )
        .map(({ sql }) => sql)
        .filter(isSearchDocumentInsert)

      expect(insertQueries).toHaveLength(1)
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 100 })
      ).resolves.toHaveLength(83)
    } finally {
      await database.destroy()
    }
  })

  it('excludes internal federation signing actors from account search', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb
    const actorId = 'https://remote.test/users/__instance__'

    try {
      await testDb.prepare()
      await database.migrate()
      await database.createActor({
        actorId,
        type: 'Service',
        username: '__instance__',
        domain: 'remote.test',
        name: 'Instance actor',
        summary: 'Service actor used for ActivityPub federation signing.',
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: 'https://remote.test/inbox',
        followersUrl: `${actorId}/followers`,
        publicKey: 'public-key',
        privateKey: 'private-key',
        createdAt: 1
      })

      await expect(
        database.searchAccountIds({ q: 'instance', limit: 10 })
      ).resolves.toEqual([])
      await expect(
        database.searchAccountIds({
          q: '@__instance__@remote.test',
          limit: 10,
          exactActorIds: [actorId]
        })
      ).resolves.toEqual([])
    } finally {
      await database.destroy()
    }
  })
})

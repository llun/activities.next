import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { createSearchActor } from '@/lib/database/sql/searchTestHelpers'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getLocalActorId } from '@/lib/utils/activitypubId'

describe('SearchDatabase accounts', () => {
  it('indexes actors and searches accounts by profile text', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)

    try {
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
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const aliceId = 'https://remote.test/users/alice'
    const bobId = 'https://remote.test/users/bob'

    try {
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
      await knexDatabase('actors')
        .where('id', bobId)
        .update({
          settings: JSON.stringify({
            followersUrl: `${bobId}/followers`,
            inboxUrl: `${bobId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            noindex: true
          })
        })
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
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const viewerId = 'https://remote.test/users/runner-viewer'
    const followedId = 'https://remote.test/users/followed-runner'
    const strangerId = 'https://remote.test/users/stranger-runner'

    try {
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
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/secret'

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'secret',
        summary: 'Hidden account'
      })
      await knexDatabase('actors')
        .where('id', actorId)
        .update({
          settings: JSON.stringify({
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            noindex: true
          })
        })
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
      await knexDatabase('actors')
        .where('id', actorId)
        .update({ username: 'Secret' })
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
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const alphaId = 'https://remote.test/users/alpha'
    const xunnerId = 'https://remote.test/users/xunner'

    try {
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
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorSelectQueries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      if (
        sql.toLowerCase().startsWith('select') &&
        (sql.includes('from `actors`') || sql.includes('from "actors"'))
      ) {
        actorSelectQueries.push(sql)
      }
    }

    try {
      await database.migrate()
      knexDatabase.on('query', handleQuery)
      await database.createAccount({
        email: 'local-runner@remote.test',
        username: 'local-runner',
        passwordHash: 'password-hash',
        domain: 'remote.test',
        privateKey: 'private-key',
        publicKey: 'public-key'
      })
      knexDatabase.off('query', handleQuery)

      expect(actorSelectQueries).toHaveLength(0)
      await expect(
        database.searchAccountIds({ q: 'local-runner', limit: 10 })
      ).resolves.toEqual([
        getLocalActorId({ domain: 'remote.test', username: 'local-runner' })
      ])
    } finally {
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })

  it('indexes account actors without reloading the inserted actor', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorSelectQueries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      if (
        sql.toLowerCase().startsWith('select') &&
        (sql.includes('from `actors`') || sql.includes('from "actors"'))
      ) {
        actorSelectQueries.push(sql)
      }
    }

    try {
      await database.migrate()
      const accountId = await database.createAccount({
        email: 'local-runner@remote.test',
        username: 'local-runner',
        passwordHash: 'password-hash',
        domain: 'remote.test',
        privateKey: 'private-key',
        publicKey: 'public-key'
      })

      knexDatabase.on('query', handleQuery)
      const actorId = await database.createActorForAccount({
        accountId,
        username: 'secondary-runner',
        domain: 'remote.test',
        privateKey: 'secondary-private-key',
        publicKey: 'secondary-public-key'
      })
      knexDatabase.off('query', handleQuery)

      expect(actorSelectQueries).toHaveLength(0)
      await expect(
        database.searchAccountIds({ q: 'secondary-runner', limit: 10 })
      ).resolves.toEqual([actorId])
    } finally {
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })

  it('paginates exact account matches with indexed results without skipping', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const exactActorId = 'https://remote.test/users/runner'

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: exactActorId,
        username: 'runner',
        summary: 'Hidden runner'
      })
      await knexDatabase('actors')
        .where('id', exactActorId)
        .update({
          settings: JSON.stringify({
            followersUrl: `${exactActorId}/followers`,
            inboxUrl: `${exactActorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            noindex: true
          })
        })
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
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const exactActorId = 'https://remote.test/users/legacy-runner'

    try {
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
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/deleting-runner'
    const viewerId = 'https://remote.test/users/deletion-viewer'

    try {
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
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const insertQueries: string[] = []
    const actorSelectQueries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      if (
        sql.includes('insert into `search_documents`') ||
        sql.includes('insert into "search_documents"')
      ) {
        insertQueries.push(sql)
      }
      if (
        sql.toLowerCase().startsWith('select') &&
        (sql.includes('from `actors`') || sql.includes('from "actors"'))
      ) {
        actorSelectQueries.push(sql)
      }
    }

    try {
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

      knexDatabase.on('query', handleQuery)
      await database.reindexSearchAccounts({ limit: 10 })
      knexDatabase.off('query', handleQuery)

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
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })

  it('sizes SQLite account reindex batches from the search document column count', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const insertQueries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      if (
        sql.includes('insert into `search_documents`') ||
        sql.includes('insert into "search_documents"')
      ) {
        insertQueries.push(sql)
      }
    }

    try {
      await database.migrate()
      for (let index = 0; index < 83; index += 1) {
        const actorId = `https://remote.test/users/batch-runner-${index}`
        await knexDatabase('actors').insert({
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
      }

      knexDatabase.on('query', handleQuery)
      await database.reindexSearchAccounts({ limit: 83 })
      knexDatabase.off('query', handleQuery)

      expect(insertQueries).toHaveLength(1)
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 100 })
      ).resolves.toHaveLength(83)
    } finally {
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })

  it('excludes internal federation signing actors from account search', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/__instance__'

    try {
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

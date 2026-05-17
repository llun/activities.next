import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('SearchDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
      await database.rebuildSearchIndex({ batchSize: 25 })
    })

    it('finds accounts by partial username', async () => {
      const accounts = await database.searchAccounts({
        query: 'test',
        limit: 10,
        offset: 0
      })

      expect(accounts.map((account) => account.acct)).toContain(
        'test1@llun.test'
      )
      expect(accounts.map((account) => account.acct)).toContain(
        'test2@llun.test'
      )
    })

    it('limits account search to accepted following relationships', async () => {
      const accounts = await database.searchAccounts({
        query: 'test',
        limit: 10,
        offset: 0,
        currentActorId: ACTOR1_ID,
        following: true
      })

      expect(accounts.map((account) => account.url)).toEqual([EXTERNAL_ACTOR1])
    })

    it('finds only public statuses by indexed text', async () => {
      await database.createNote({
        id: `${ACTOR1_ID}/statuses/search-public-note`,
        url: `${ACTOR1_ID}/statuses/search-public-note`,
        actorId: ACTOR1_ID,
        text: 'Pineapple searchable public status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: `${ACTOR1_ID}/statuses/search-private-note`,
        url: `${ACTOR1_ID}/statuses/search-private-note`,
        actorId: ACTOR1_ID,
        text: 'Pineapple hidden private status',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const statuses = await database.searchStatuses({
        query: 'pineapple',
        limit: 10,
        offset: 0
      })

      expect(statuses.map((status) => status.id)).toContain(
        `${ACTOR1_ID}/statuses/search-public-note`
      )
      expect(statuses.map((status) => status.id)).not.toContain(
        `${ACTOR1_ID}/statuses/search-private-note`
      )
    })

    it('finds hashtags with Mastodon tag shape', async () => {
      const status = (await database.createNote({
        id: `${ACTOR1_ID}/statuses/search-hashtag-note`,
        url: `${ACTOR1_ID}/statuses/search-hashtag-note`,
        actorId: ACTOR1_ID,
        text: 'Tag search test',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })) as StatusNote
      await database.createTag({
        statusId: status.id,
        type: 'hashtag',
        name: '#TrailRun',
        value: 'https://llun.test/tags/TrailRun'
      })

      const hashtags = await database.searchHashtags({
        query: 'trail',
        limit: 10,
        offset: 0
      })

      expect(hashtags).toContainEqual({
        id: 'trailrun',
        name: 'TrailRun',
        url: 'https://llun.test/tags/TrailRun',
        history: []
      })
    })

    it('reindexes hashtags when a poll is updated', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const statusId = `${ACTOR1_ID}/statuses/poll-hashtag-reindex-${suffix}`
      const hashtag = `#PollReindex${suffix}`

      await database.createPoll({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Original poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Alpha', 'Beta'],
        endAt: Date.now() + 1000
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: hashtag,
        value: `https://llun.test/tags/${hashtag.slice(1)}`
      })

      await database.deleteSearchDocument({
        entityType: 'hashtag',
        entityId: hashtag.slice(1).toLowerCase()
      })
      await database.updatePoll({
        statusId,
        text: 'Updated poll',
        choices: [
          { title: 'Alpha', totalVotes: 1 },
          { title: 'Beta', totalVotes: 0 }
        ]
      })

      const hashtags = await database.searchHashtags({
        query: hashtag,
        limit: 10,
        offset: 0
      })
      expect(hashtags.map((tag) => tag.id)).toContain(
        hashtag.slice(1).toLowerCase()
      )
    })

    it('reindexes hashtags when status visibility changes', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const statusId = `${ACTOR1_ID}/statuses/visibility-hashtag-${suffix}`
      const hashtag = `#VisibilityReindex${suffix}`

      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Private hashtag status',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: hashtag,
        value: `https://llun.test/tags/${hashtag.slice(1)}`
      })

      expect(
        await database.searchHashtags({ query: hashtag, limit: 10, offset: 0 })
      ).toEqual([])

      await database.updateNoteVisibility({
        statusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const hashtags = await database.searchHashtags({
        query: hashtag,
        limit: 10,
        offset: 0
      })
      expect(hashtags.map((tag) => tag.id)).toContain(
        hashtag.slice(1).toLowerCase()
      )
    })

    it('removes actor-owned status search documents when deleting an actor', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const username = `search-delete-${suffix}`
      const actorId = `https://llun.test/users/${username}`
      const statusId = `${actorId}/statuses/delete-search-${suffix}`
      const searchText = `DeleteSearchStatus${suffix}`

      await database.createAccount({
        email: `${username}@llun.test`,
        username,
        passwordHash: `hash-${suffix}`,
        domain: 'llun.test',
        privateKey: `private-${suffix}`,
        publicKey: `public-${suffix}`
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        text: searchText,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      expect(
        (
          await database.searchStatuses({
            query: searchText,
            limit: 10,
            offset: 0
          })
        ).map((status) => status.id)
      ).toContain(statusId)

      await database.deleteActor({ actorId })

      expect(
        (
          await database.searchStatuses({
            query: searchText,
            limit: 10,
            offset: 0
          })
        ).map((status) => status.id)
      ).not.toContain(statusId)
    })

    it('reindexes affected hashtags when deleting actor data', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const username = `search-delete-data-${suffix}`
      const actorId = `https://llun.test/users/${username}`
      const statusId = `${actorId}/statuses/delete-data-hashtag-${suffix}`
      const hashtag = `#DeleteDataReindex${suffix}`

      await database.createAccount({
        email: `${username}@llun.test`,
        username,
        passwordHash: `hash-${suffix}`,
        domain: 'llun.test',
        privateKey: `private-${suffix}`,
        publicKey: `public-${suffix}`
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        text: 'Actor data hashtag',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: hashtag,
        value: `https://llun.test/tags/${hashtag.slice(1)}`
      })
      expect(
        (
          await database.searchHashtags({
            query: hashtag,
            limit: 10,
            offset: 0
          })
        ).map((tag) => tag.id)
      ).toContain(hashtag.slice(1).toLowerCase())

      await database.deleteActorData({ actorId })

      expect(
        await database.searchHashtags({ query: hashtag, limit: 10, offset: 0 })
      ).toEqual([])
    })
  })

  describe('rebuildSearchIndex', () => {
    let database: Database
    let rawDatabase: Knex

    beforeEach(async () => {
      rawDatabase = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: ':memory:'
        }
      })
      database = getSQLDatabase(rawDatabase)
      await database.migrate()
    })

    afterEach(async () => {
      await database.destroy()
    })

    it('counts only statuses that are actually indexed', async () => {
      const actorId = 'https://rebuild.test/users/rebuild'
      await database.createMastodonActor({
        actorId,
        username: 'rebuild',
        domain: 'rebuild.test',
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `${actorId}/inbox`,
        publicKey: 'public-key',
        createdAt: Date.now()
      })
      await database.createNote({
        id: `${actorId}/statuses/public`,
        url: `${actorId}/statuses/public`,
        actorId,
        text: 'Indexed rebuild status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: `${actorId}/statuses/private`,
        url: `${actorId}/statuses/private`,
        actorId,
        text: 'Skipped rebuild status',
        to: [`${actorId}/followers`],
        cc: []
      })

      const result = await database.rebuildSearchIndex({
        clear: true,
        batchSize: 1
      })

      expect(result.statuses).toBe(1)
      expect(
        (
          await database.searchStatuses({
            query: 'Indexed rebuild',
            limit: 10,
            offset: 0
          })
        ).map((status) => status.id)
      ).toEqual([`${actorId}/statuses/public`])
      expect(
        await database.searchStatuses({
          query: 'Skipped rebuild',
          limit: 10,
          offset: 0
        })
      ).toEqual([])
    })

    it('indexes long entity ids with fixed-length search document ids', async () => {
      const actorId = `https://long.test/users/${'actor'.repeat(80)}`
      await database.createMastodonActor({
        actorId,
        username: 'longactor',
        domain: 'long.test',
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `${actorId}/inbox`,
        publicKey: 'public-key',
        createdAt: Date.now()
      })

      const accounts = await database.searchAccounts({
        query: 'longactor',
        limit: 10,
        offset: 0
      })

      expect(accounts.map((account) => account.url)).toEqual([actorId])
      await expect(
        rawDatabase('search_documents')
          .where({ entityType: 'account', entityId: actorId })
          .first<{ id: string }>('id')
      ).resolves.toMatchObject({
        id: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    })
  })
})

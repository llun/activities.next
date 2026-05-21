import { createHash } from 'crypto'
import knex, { Knex } from 'knex'

import { getConfig } from '@/lib/config'
import { getSQLDatabase } from '@/lib/database/sql'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const resetConfigCache = () => {
  const configWithCache = getConfig as typeof getConfig & {
    cache?: { clear?: () => void }
  }
  configWithCache.cache?.clear?.()
}

describe('SearchDatabase', () => {
  const table = getTestDatabaseTable()
  const originalActivitiesHost = process.env.ACTIVITIES_HOST

  beforeAll(async () => {
    process.env.ACTIVITIES_HOST = 'llun.test'
    resetConfigCache()
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
    if (originalActivitiesHost === undefined) {
      delete process.env.ACTIVITIES_HOST
    } else {
      process.env.ACTIVITIES_HOST = originalActivitiesHost
    }
    resetConfigCache()
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

    it('filters account search when either actor blocks the other', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const query = `BlockFilter${suffix}`
      const blockedByCurrentActorId = `https://remote.test/users/block-filter-current-${suffix}`
      const blockingCurrentActorId = `https://remote.test/users/block-filter-target-${suffix}`
      const visibleActorId = `https://remote.test/users/block-filter-visible-${suffix}`

      await database.createMastodonActor({
        actorId: blockedByCurrentActorId,
        username: `block-filter-current-${suffix}`,
        domain: 'remote.test',
        name: query,
        followersUrl: `${blockedByCurrentActorId}/followers`,
        inboxUrl: `${blockedByCurrentActorId}/inbox`,
        sharedInboxUrl: `${blockedByCurrentActorId}/inbox`,
        publicKey: `public-blocked-current-${suffix}`,
        createdAt: Date.now()
      })
      await database.createMastodonActor({
        actorId: blockingCurrentActorId,
        username: `block-filter-target-${suffix}`,
        domain: 'remote.test',
        name: query,
        followersUrl: `${blockingCurrentActorId}/followers`,
        inboxUrl: `${blockingCurrentActorId}/inbox`,
        sharedInboxUrl: `${blockingCurrentActorId}/inbox`,
        publicKey: `public-blocking-current-${suffix}`,
        createdAt: Date.now()
      })
      await database.createMastodonActor({
        actorId: visibleActorId,
        username: `block-filter-visible-${suffix}`,
        domain: 'remote.test',
        name: query,
        followersUrl: `${visibleActorId}/followers`,
        inboxUrl: `${visibleActorId}/inbox`,
        sharedInboxUrl: `${visibleActorId}/inbox`,
        publicKey: `public-visible-${suffix}`,
        createdAt: Date.now()
      })
      await database.createBlock({
        actorId: ACTOR1_ID,
        targetActorId: blockedByCurrentActorId,
        uri: `${ACTOR1_ID}#blocks/account-search-${suffix}-outgoing`
      })
      await database.createBlock({
        actorId: blockingCurrentActorId,
        targetActorId: ACTOR1_ID,
        uri: `${blockingCurrentActorId}#blocks/account-search-${suffix}-incoming`
      })

      const accounts = await database.searchAccounts({
        query,
        limit: 10,
        offset: 0,
        currentActorId: ACTOR1_ID
      })

      expect(accounts.map((account) => account.url)).toEqual([visibleActorId])
    })

    it('prioritizes exact bare username matches over indexed partial matches', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const username = `exactbare${suffix}`
      const exactActorId = `https://llun.test/users/${username}`
      const matchingActorId = `https://remote.test/users/exactbare-peer-${suffix}`

      await database.createAccount({
        email: `${username}@llun.test`,
        username,
        passwordHash: `hash-${suffix}`,
        domain: 'llun.test',
        privateKey: `private-${suffix}`,
        publicKey: `public-${suffix}`
      })
      await database.createMastodonActor({
        actorId: matchingActorId,
        username: `exactbare-peer-${suffix}`,
        domain: 'remote.test',
        name: username,
        followersUrl: `${matchingActorId}/followers`,
        inboxUrl: `${matchingActorId}/inbox`,
        sharedInboxUrl: `${matchingActorId}/inbox`,
        publicKey: `public-match-${suffix}`,
        createdAt: Date.now()
      })

      await expect(
        database.searchAccounts({
          query: username,
          limit: 10,
          offset: 0
        })
      ).resolves.toMatchObject([
        { url: exactActorId },
        { url: matchingActorId }
      ])
    })

    it('does not overfetch indexed account results when an exact match fills the page', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const username = `exactlimit${suffix}`
      const domain = 'example.test'
      const exactActorId = `https://${domain}/users/${username}`
      const matchingActorId = `https://${domain}/users/exactlimit-peer-${suffix}`
      const exactAcct = `${username}@${domain}`

      await database.createMastodonActor({
        actorId: exactActorId,
        username,
        domain,
        followersUrl: `${exactActorId}/followers`,
        inboxUrl: `${exactActorId}/inbox`,
        sharedInboxUrl: `${exactActorId}/inbox`,
        publicKey: `public-exact-${suffix}`,
        createdAt: Date.now()
      })
      await database.createMastodonActor({
        actorId: matchingActorId,
        username: `exactlimit-peer-${suffix}`,
        domain,
        name: exactAcct,
        followersUrl: `${matchingActorId}/followers`,
        inboxUrl: `${matchingActorId}/inbox`,
        sharedInboxUrl: `${matchingActorId}/inbox`,
        publicKey: `public-match-${suffix}`,
        createdAt: Date.now()
      })

      await expect(
        database.searchAccounts({
          query: exactAcct,
          limit: 1,
          offset: 0
        })
      ).resolves.toMatchObject([{ url: exactActorId }])
      await expect(
        database.searchAccounts({
          query: exactAcct,
          limit: 1,
          offset: 1
        })
      ).resolves.toMatchObject([{ url: matchingActorId }])
    })

    it('applies fallback account offsets after indexed matches', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const query = `hybrid${suffix}`
      const indexedUsernames = [`${query}indexeda`, `${query}indexedb`]
      const fallbackUsernames = [`${query}fallbacka`, `${query}fallbackb`]
      const fallbackActorIds = fallbackUsernames.map(
        (username) => `https://llun.test/users/${username}`
      )

      for (const username of [...indexedUsernames, ...fallbackUsernames]) {
        await database.createAccount({
          email: `${username}@llun.test`,
          username,
          passwordHash: `hash-${suffix}`,
          domain: 'llun.test',
          privateKey: `private-${username}`,
          publicKey: `public-${username}`,
          name: query
        })
      }
      for (const actorId of fallbackActorIds) {
        await database.deleteSearchDocument({
          entityType: 'account',
          entityId: actorId,
          syncMeilisearch: false
        })
      }

      const secondPage = await database.searchAccounts({
        query,
        limit: 2,
        offset: 2
      })

      expect(new Set(secondPage.map((account) => account.url))).toEqual(
        new Set(fallbackActorIds)
      )
    })

    it('resolves account URL queries through exact account lookup', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const username = `exact-url-${suffix}`
      const domain = 'remote.test'
      const actorId = `https://${domain}/users/${username}`

      await database.createMastodonActor({
        actorId,
        username,
        domain,
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `${actorId}/inbox`,
        publicKey: `public-exact-url-${suffix}`,
        createdAt: Date.now()
      })

      await expect(
        database.searchAccounts({
          query: `https://${domain}/@${username}`,
          limit: 10,
          offset: 0
        })
      ).resolves.toMatchObject([{ url: actorId }])
      await expect(
        database.searchAccounts({
          query: actorId,
          limit: 10,
          offset: 0
        })
      ).resolves.toMatchObject([{ url: actorId }])
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

    it('filters status search results by block relationships', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const username = `blocked-status-${suffix}`
      const actorId = `https://llun.test/users/${username}`
      const statusId = `${actorId}/statuses/block-filter-${suffix}`
      const searchText = `BlockedStatusSearch${suffix}`

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
            offset: 0,
            currentActorId: ACTOR1_ID
          })
        ).map((status) => status.id)
      ).toContain(statusId)

      await database.createBlock({
        actorId: ACTOR1_ID,
        targetActorId: actorId,
        uri: `${ACTOR1_ID}#blocks/status-search-${suffix}`
      })

      await expect(
        database.searchStatuses({
          query: searchText,
          limit: 10,
          offset: 0,
          currentActorId: ACTOR1_ID
        })
      ).resolves.toEqual([])
    })

    it('paginates status search with the relevance cursor ordering', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const searchText = `ScoreCursor${suffix}`
      const highScoreStatusId = `${ACTOR1_ID}/statuses/search-cursor-high-${suffix}`
      const lowScoreStatusId = `${ACTOR1_ID}/statuses/search-cursor-low-${suffix}`
      const baseTime = Date.now()

      await database.createNote({
        id: highScoreStatusId,
        url: highScoreStatusId,
        actorId: ACTOR1_ID,
        text: `${searchText} in primary text`,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt: baseTime - 1000
      })
      await database.createNote({
        id: lowScoreStatusId,
        url: lowScoreStatusId,
        actorId: ACTOR1_ID,
        text: 'Lower score status',
        summary: `${searchText} in summary only`,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt: baseTime
      })

      await expect(
        database.searchStatuses({
          query: searchText,
          limit: 10,
          offset: 0
        })
      ).resolves.toMatchObject([
        { id: highScoreStatusId },
        { id: lowScoreStatusId }
      ])
      await expect(
        database.searchStatuses({
          query: searchText,
          limit: 10,
          offset: 0,
          maxStatusId: highScoreStatusId
        })
      ).resolves.toMatchObject([{ id: lowScoreStatusId }])
      await expect(
        database.searchStatuses({
          query: searchText,
          limit: 10,
          offset: 0,
          minStatusId: lowScoreStatusId
        })
      ).resolves.toMatchObject([{ id: highScoreStatusId }])
    })

    it('paginates min status cursors from the closest newer indexed match', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const searchText = `AscendingCursor${suffix}`
      const baseTime = Date.now()
      const oldestStatusId = `${ACTOR1_ID}/statuses/min-cursor-oldest-${suffix}`
      const middleStatusId = `${ACTOR1_ID}/statuses/min-cursor-middle-${suffix}`
      const newestStatusId = `${ACTOR1_ID}/statuses/min-cursor-newest-${suffix}`

      await database.createNote({
        id: oldestStatusId,
        url: oldestStatusId,
        actorId: ACTOR1_ID,
        text: searchText,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt: baseTime - 3000
      })
      await database.createNote({
        id: middleStatusId,
        url: middleStatusId,
        actorId: ACTOR1_ID,
        text: searchText,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt: baseTime - 2000
      })
      await database.createNote({
        id: newestStatusId,
        url: newestStatusId,
        actorId: ACTOR1_ID,
        text: searchText,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt: baseTime - 1000
      })

      await expect(
        database.searchStatuses({
          query: searchText,
          limit: 1,
          offset: 0,
          minStatusId: oldestStatusId
        })
      ).resolves.toMatchObject([{ id: middleStatusId }])
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

    it('preserves full normalized hashtag slugs with separators', async () => {
      const status = (await database.createNote({
        id: `${ACTOR1_ID}/statuses/search-hashtag-slug-note`,
        url: `${ACTOR1_ID}/statuses/search-hashtag-slug-note`,
        actorId: ACTOR1_ID,
        text: 'Separated tag search test',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })) as StatusNote
      await database.createTag({
        statusId: status.id,
        type: 'hashtag',
        name: '#Trail-Run',
        value: 'https://llun.test/tags/Trail-Run'
      })

      const hashtags = await database.searchHashtags({
        query: 'trail run',
        limit: 10,
        offset: 0
      })

      expect(hashtags).toContainEqual({
        id: 'trail-run',
        name: 'Trail-Run',
        url: 'https://llun.test/tags/Trail-Run',
        history: []
      })
    })

    it('preserves accented hashtag ids while matching accent-insensitively', async () => {
      const status = (await database.createNote({
        id: `${ACTOR1_ID}/statuses/search-hashtag-accent-note`,
        url: `${ACTOR1_ID}/statuses/search-hashtag-accent-note`,
        actorId: ACTOR1_ID,
        text: 'Accented tag search test',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })) as StatusNote
      await database.createTag({
        statusId: status.id,
        type: 'hashtag',
        name: '#Café',
        value: 'https://llun.test/tags/Caf%C3%A9'
      })

      for (const query of ['cafe', 'café']) {
        await expect(
          database.searchHashtags({
            query,
            limit: 10,
            offset: 0
          })
        ).resolves.toContainEqual({
          id: 'café',
          name: 'Café',
          url: 'https://llun.test/tags/Caf%C3%A9',
          history: []
        })
      }
      await expect(
        database.getSearchHashtagsByIds({ hashtagIds: ['café'] })
      ).resolves.toContainEqual({
        id: 'café',
        name: 'Café',
        url: 'https://llun.test/tags/Caf%C3%A9',
        history: []
      })
    })

    it('does not hydrate private-only or missing hashtag ids', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const privateHashtag = `#PrivateOnly${suffix}`
      const privateHashtagId = privateHashtag.slice(1).toLowerCase()
      const status = (await database.createNote({
        id: `${ACTOR1_ID}/statuses/private-hashtag-hydration-${suffix}`,
        url: `${ACTOR1_ID}/statuses/private-hashtag-hydration-${suffix}`,
        actorId: ACTOR1_ID,
        text: 'Private-only hashtag hydration',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })) as StatusNote
      await database.createTag({
        statusId: status.id,
        type: 'hashtag',
        name: privateHashtag,
        value: `https://llun.test/tags/${privateHashtag.slice(1)}`
      })

      await expect(
        database.getSearchHashtagsByIds({
          hashtagIds: [privateHashtagId, `missing-${suffix}`]
        })
      ).resolves.toEqual([])
    })

    it('hydrates hashtag ids in request order', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const firstHashtag = `#OrderedFirst${suffix}`
      const secondHashtag = `#OrderedSecond${suffix}`
      const status = (await database.createNote({
        id: `${ACTOR1_ID}/statuses/ordered-hashtag-hydration-${suffix}`,
        url: `${ACTOR1_ID}/statuses/ordered-hashtag-hydration-${suffix}`,
        actorId: ACTOR1_ID,
        text: 'Ordered hashtag hydration',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })) as StatusNote
      await database.createTag({
        statusId: status.id,
        type: 'hashtag',
        name: firstHashtag,
        value: `https://llun.test/tags/${firstHashtag.slice(1)}`
      })
      await database.createTag({
        statusId: status.id,
        type: 'hashtag',
        name: secondHashtag,
        value: `https://llun.test/tags/${secondHashtag.slice(1)}`
      })

      await expect(
        database.getSearchHashtagsByIds({
          hashtagIds: [
            secondHashtag.slice(1).toLowerCase(),
            firstHashtag.slice(1).toLowerCase()
          ]
        })
      ).resolves.toMatchObject([
        { id: secondHashtag.slice(1).toLowerCase() },
        { id: firstHashtag.slice(1).toLowerCase() }
      ])
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

    it('deindexes and reindexes actor-owned search documents as deletion state changes', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const username = `search-deletion-state-${suffix}`
      const actorId = `https://llun.test/users/${username}`
      const statusId = `${actorId}/statuses/deletion-state-${suffix}`
      const searchText = `DeletionStateSearch${suffix}`
      const hashtag = `#DeletionStateTag${suffix}`

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
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: hashtag,
        value: `https://llun.test/tags/${hashtag.slice(1)}`
      })

      await database.scheduleActorDeletion({
        actorId,
        scheduledAt: null
      })

      await expect(
        database.searchAccounts({ query: username, limit: 10, offset: 0 })
      ).resolves.toEqual([])
      await expect(
        database.searchStatuses({ query: searchText, limit: 10, offset: 0 })
      ).resolves.toEqual([])
      await expect(
        database.searchHashtags({ query: hashtag, limit: 10, offset: 0 })
      ).resolves.toEqual([])

      await database.cancelActorDeletion({ actorId })

      await expect(
        (
          await database.searchAccounts({
            query: username,
            limit: 10,
            offset: 0
          })
        ).map((account) => account.url)
      ).toContain(actorId)
      await expect(
        (
          await database.searchStatuses({
            query: searchText,
            limit: 10,
            offset: 0
          })
        ).map((status) => status.id)
      ).toContain(statusId)
      await expect(
        (
          await database.searchHashtags({
            query: hashtag,
            limit: 10,
            offset: 0
          })
        ).map((tag) => tag.id)
      ).toContain(hashtag.slice(1).toLowerCase())

      await database.startActorDeletion({ actorId })

      await expect(
        database.searchAccounts({ query: username, limit: 10, offset: 0 })
      ).resolves.toEqual([])
      await expect(
        database.searchStatuses({ query: searchText, limit: 10, offset: 0 })
      ).resolves.toEqual([])
    })

    it('reindexes affected hashtags when deleting an actor', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const firstUsername = `search-delete-hashtag-${suffix}`
      const secondUsername = `search-delete-hashtag-peer-${suffix}`
      const firstActorId = `https://llun.test/users/${firstUsername}`
      const secondActorId = `https://llun.test/users/${secondUsername}`
      const firstStatusId = `${firstActorId}/statuses/delete-hashtag-${suffix}`
      const secondStatusId = `${secondActorId}/statuses/delete-hashtag-${suffix}`
      const uniqueHashtag = `#DeleteActorUnique${suffix}`
      const sharedHashtag = `#DeleteActorShared${suffix}`

      await database.createAccount({
        email: `${firstUsername}@llun.test`,
        username: firstUsername,
        passwordHash: `hash-${suffix}`,
        domain: 'llun.test',
        privateKey: `private-first-${suffix}`,
        publicKey: `public-first-${suffix}`
      })
      await database.createAccount({
        email: `${secondUsername}@llun.test`,
        username: secondUsername,
        passwordHash: `hash-${suffix}`,
        domain: 'llun.test',
        privateKey: `private-second-${suffix}`,
        publicKey: `public-second-${suffix}`
      })
      await database.createNote({
        id: firstStatusId,
        url: firstStatusId,
        actorId: firstActorId,
        text: 'Actor delete unique and shared hashtag',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: secondStatusId,
        url: secondStatusId,
        actorId: secondActorId,
        text: 'Actor delete shared hashtag peer',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createTag({
        statusId: firstStatusId,
        type: 'hashtag',
        name: uniqueHashtag,
        value: `https://llun.test/tags/${uniqueHashtag.slice(1)}`
      })
      await database.createTag({
        statusId: firstStatusId,
        type: 'hashtag',
        name: sharedHashtag,
        value: `https://llun.test/tags/${sharedHashtag.slice(1)}`
      })
      await database.createTag({
        statusId: secondStatusId,
        type: 'hashtag',
        name: sharedHashtag,
        value: `https://llun.test/tags/${sharedHashtag.slice(1)}`
      })

      await database.deleteActor({ actorId: firstActorId })

      await expect(
        database.searchHashtags({
          query: uniqueHashtag,
          limit: 10,
          offset: 0
        })
      ).resolves.toEqual([])
      await expect(
        (
          await database.searchHashtags({
            query: sharedHashtag,
            limit: 10,
            offset: 0
          })
        ).map((tag) => tag.id)
      ).toContain(sharedHashtag.slice(1).toLowerCase())
    })

    it('does not deindex a status when scoped deletion is rejected', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const statusId = `${ACTOR1_ID}/statuses/rejected-delete-search-${suffix}`
      const searchText = `RejectedDeleteSearch${suffix}`

      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: searchText,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.deleteStatus({
        statusId,
        actorId: ACTOR2_ID
      })

      await expect(database.getStatus({ statusId })).resolves.toMatchObject({
        id: statusId
      })
      await expect(
        (
          await database.searchStatuses({
            query: searchText,
            limit: 10,
            offset: 0
          })
        ).map((status) => status.id)
      ).toContain(statusId)
    })

    it('deindexes recursively deleted replies and their hashtags', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const parentStatusId = `${ACTOR1_ID}/statuses/delete-parent-search-${suffix}`
      const replyStatusId = `${ACTOR1_ID}/statuses/delete-reply-search-${suffix}`
      const replySearchText = `DeletedReplySearch${suffix}`
      const replyHashtag = `#DeletedReplyTag${suffix}`

      await database.createNote({
        id: parentStatusId,
        url: parentStatusId,
        actorId: ACTOR1_ID,
        text: 'Parent status for recursive delete',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: replyStatusId,
        url: replyStatusId,
        actorId: ACTOR1_ID,
        text: replySearchText,
        reply: parentStatusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createTag({
        statusId: replyStatusId,
        type: 'hashtag',
        name: replyHashtag,
        value: `https://llun.test/tags/${replyHashtag.slice(1)}`
      })

      await database.deleteStatus({ statusId: parentStatusId })

      await expect(
        database.searchStatuses({
          query: replySearchText,
          limit: 10,
          offset: 0
        })
      ).resolves.toEqual([])
      await expect(
        database.searchHashtags({
          query: replyHashtag,
          limit: 10,
          offset: 0
        })
      ).resolves.toEqual([])
    })

    it('deindexes deep recursively deleted replies and their hashtags', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const rootStatusId = `${ACTOR1_ID}/statuses/deep-delete-root-${suffix}`
      const deepestSearchText = `DeepDeletedReplySearch${suffix}`
      const deepestHashtag = `#DeepDeletedReplyTag${suffix}`
      let previousStatusId = rootStatusId

      await database.createNote({
        id: rootStatusId,
        url: rootStatusId,
        actorId: ACTOR1_ID,
        text: 'Root status for deep recursive delete',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      for (let depth = 1; depth <= 35; depth += 1) {
        const statusId = `${ACTOR1_ID}/statuses/deep-delete-${depth}-${suffix}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: ACTOR1_ID,
          text:
            depth === 35
              ? deepestSearchText
              : `Intermediate deep reply ${depth}`,
          reply: previousStatusId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        previousStatusId = statusId
      }

      await database.createTag({
        statusId: previousStatusId,
        type: 'hashtag',
        name: deepestHashtag,
        value: `https://llun.test/tags/${deepestHashtag.slice(1)}`
      })

      await database.deleteStatus({ statusId: rootStatusId })

      await expect(
        database.searchStatuses({
          query: deepestSearchText,
          limit: 10,
          offset: 0
        })
      ).resolves.toEqual([])
      await expect(
        database.searchHashtags({
          query: deepestHashtag,
          limit: 10,
          offset: 0
        })
      ).resolves.toEqual([])
    })

    it('continues deleting statuses when search cleanup reaches the reply depth limit', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const rootStatusId = `${ACTOR1_ID}/statuses/depth-limit-root-${suffix}`
      const deepestSearchText = `DepthLimitDeletedReplySearch${suffix}`
      let previousStatusId = rootStatusId

      await database.createNote({
        id: rootStatusId,
        url: rootStatusId,
        actorId: ACTOR1_ID,
        text: 'Root status for depth-limit recursive delete',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      for (let depth = 1; depth <= 258; depth += 1) {
        const statusId = `${ACTOR1_ID}/statuses/depth-limit-${depth}-${suffix}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: ACTOR1_ID,
          text:
            depth === 258
              ? deepestSearchText
              : `Intermediate depth-limit reply ${depth}`,
          reply: previousStatusId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        previousStatusId = statusId
      }

      await database.deleteStatus({ statusId: rootStatusId })

      await expect(
        database.getStatus({ statusId: previousStatusId })
      ).resolves.toBeNull()
      await expect(
        database.searchStatuses({
          query: deepestSearchText,
          limit: 10,
          offset: 0
        })
      ).resolves.toEqual([])
    })

    it('does not reindex statuses for deleted actors during rebuild', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const username = `search-deleted-rebuild-${suffix}`
      const actorId = `https://llun.test/users/${username}`
      const statusId = `${actorId}/statuses/rebuild-orphan-${suffix}`
      const searchText = `DeletedActorRebuildSearch${suffix}`

      await database.createAccount({
        email: `${username}@llun.test`,
        username,
        passwordHash: `hash-${suffix}`,
        domain: 'llun.test',
        privateKey: `private-rebuild-${suffix}`,
        publicKey: `public-rebuild-${suffix}`
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        text: searchText,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.deleteActor({ actorId })
      await database.rebuildSearchIndex({ batchSize: 1 })

      await expect(
        database.searchStatuses({
          query: searchText,
          limit: 10,
          offset: 0
        })
      ).resolves.toEqual([])
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

    it('reports dry-run counts without writing search documents', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const actorId = `https://dryrun.test/users/rebuild-${suffix}`
      const publicStatusId = `${actorId}/statuses/public`
      const privateStatusId = `${actorId}/statuses/private`
      await database.createMastodonActor({
        actorId,
        username: `rebuild-${suffix}`,
        domain: 'dryrun.test',
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `${actorId}/inbox`,
        publicKey: 'public-key',
        createdAt: Date.now()
      })
      await database.createNote({
        id: publicStatusId,
        url: publicStatusId,
        actorId,
        text: 'Dry run public status',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createTag({
        statusId: publicStatusId,
        type: 'hashtag',
        name: `#DryRun${suffix}`,
        value: `https://llun.test/tags/DryRun${suffix}`
      })
      await database.createNote({
        id: privateStatusId,
        url: privateStatusId,
        actorId,
        text: 'Dry run private status',
        to: [`${actorId}/followers`],
        cc: []
      })
      await database.clearSearchIndex()

      await expect(
        database.rebuildSearchIndex({ dryRun: true, clear: true, batchSize: 1 })
      ).resolves.toEqual({
        accounts: 1,
        statuses: 1,
        hashtags: 1
      })
      await expect(
        rawDatabase('search_documents').count<{ count: string | number }>(
          '* as count'
        )
      ).resolves.toEqual([{ count: 0 }])
    })

    it('does not index hashtags when public recipients are not to or cc', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const actorId = `https://recipient-type.test/users/rebuild-${suffix}`
      const statusId = `${actorId}/statuses/malformed-public`
      const hashtag = `#MalformedPublic${suffix}`
      await database.createMastodonActor({
        actorId,
        username: `recipient-${suffix}`,
        domain: 'recipient-type.test',
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `${actorId}/inbox`,
        publicKey: 'public-key',
        createdAt: Date.now()
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        text: 'Malformed public recipient hashtag',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: hashtag,
        value: `https://llun.test/tags/${hashtag.slice(1)}`
      })
      await rawDatabase('recipients')
        .where({ statusId, actorId: ACTIVITY_STREAM_PUBLIC })
        .update({ type: 'bto' })
      await database.clearSearchIndex()

      await expect(
        database.rebuildSearchIndex({ clear: true, batchSize: 1 })
      ).resolves.toMatchObject({
        statuses: 0,
        hashtags: 0
      })
      await expect(
        database.searchHashtags({ query: hashtag, limit: 10, offset: 0 })
      ).resolves.toEqual([])
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
          .where({
            entityType: 'account',
            entityId: actorId,
            actorId
          })
          .first<{
            id: string
            actorId: string
            entityId: string
            entityIdHash: string
          }>('id', 'actorId', 'entityId', 'entityIdHash')
      ).resolves.toMatchObject({
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        actorId,
        entityId: actorId,
        entityIdHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    })

    it('falls back to actor search when the account index is empty', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const username = `fallback-account-${suffix}`
      const actorId = `https://fallback.test/users/${username}`
      await database.createMastodonActor({
        actorId,
        username,
        domain: 'fallback.test',
        name: `Fallback Account ${suffix}`,
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `${actorId}/inbox`,
        publicKey: 'public-key',
        createdAt: Date.now()
      })
      await database.clearSearchIndex()

      await expect(
        database.searchAccounts({
          query: 'Fallback Account',
          limit: 10,
          offset: 0
        })
      ).resolves.toMatchObject([{ url: actorId }])
    })

    it('preserves hashtag display casing after a rebuild', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const actorId = `https://hashtag-rebuild.test/users/rebuild-${suffix}`
      const statusId = `${actorId}/statuses/hashtag-rebuild`
      const hashtag = `#TrailRunCase${suffix}`
      await database.createMastodonActor({
        actorId,
        username: `hashtag-rebuild-${suffix}`,
        domain: 'hashtag-rebuild.test',
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `${actorId}/inbox`,
        publicKey: 'public-key',
        createdAt: Date.now()
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        text: 'Hashtag rebuild casing',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: hashtag,
        value: `https://llun.test/tags/${hashtag.slice(1)}`
      })
      await database.rebuildSearchIndex({ clear: true, batchSize: 1 })

      await expect(
        database.searchHashtags({
          query: hashtag,
          limit: 10,
          offset: 0
        })
      ).resolves.toContainEqual({
        id: hashtag.slice(1).toLowerCase(),
        name: hashtag.slice(1),
        url: `https://llun.test/tags/${hashtag.slice(1)}`,
        history: []
      })
    })

    it('applies status cursors with deterministic null timestamp ordering', async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const searchText = `NullCursor${suffix}`
      const actorId = `https://cursor.test/users/cursor-${suffix}`
      const nonNullStatusId = `${actorId}/statuses/non-null-cursor`
      const firstNullStatusId = `${actorId}/statuses/null-cursor-a`
      const secondNullStatusId = `${actorId}/statuses/null-cursor-b`
      await database.createMastodonActor({
        actorId,
        username: `cursor-${suffix}`,
        domain: 'cursor.test',
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `${actorId}/inbox`,
        publicKey: 'public-key',
        createdAt: Date.now()
      })
      await database.createNote({
        id: nonNullStatusId,
        url: nonNullStatusId,
        actorId,
        text: searchText,
        createdAt: Date.now(),
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: firstNullStatusId,
        url: firstNullStatusId,
        actorId,
        text: searchText,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: secondNullStatusId,
        url: secondNullStatusId,
        actorId,
        text: searchText,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await rawDatabase('search_documents')
        .where('entityType', 'status')
        .whereIn('entityId', [firstNullStatusId, secondNullStatusId])
        .update({ entityCreatedAt: null })
      const orderedNullStatusIds = [firstNullStatusId, secondNullStatusId].sort(
        (a, b) =>
          createHash('sha256')
            .update(b, 'utf8')
            .digest('hex')
            .localeCompare(createHash('sha256').update(a, 'utf8').digest('hex'))
      )

      await expect(
        database.searchStatuses({
          query: searchText,
          limit: 10,
          offset: 0,
          maxStatusId: nonNullStatusId
        })
      ).resolves.toMatchObject([
        { id: orderedNullStatusIds[0] },
        { id: orderedNullStatusIds[1] }
      ])
      await expect(
        database.searchStatuses({
          query: searchText,
          limit: 10,
          offset: 0,
          maxStatusId: orderedNullStatusIds[0]
        })
      ).resolves.toMatchObject([{ id: orderedNullStatusIds[1] }])
      await expect(
        database.searchStatuses({
          query: searchText,
          limit: 10,
          offset: 0,
          minStatusId: orderedNullStatusIds[1]
        })
      ).resolves.toMatchObject([
        { id: nonNullStatusId },
        { id: orderedNullStatusIds[0] }
      ])
    })
  })
})

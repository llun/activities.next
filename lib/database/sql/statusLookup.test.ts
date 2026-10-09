import {
  emptyActorId,
  extraActorId,
  primaryActorId,
  replyAuthorId
} from '@/lib/database/sql/statusTestHelpers'
import { SQLITE_MAX_BINDINGS } from '@/lib/database/sql/utils/knex'
import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabaseWithInstance
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { FollowStatus } from '@/lib/types/domain/follow'
import {
  StatusAnnounce,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import {
  generatePublicId,
  getPublicIdTimestamp,
  isPublicId
} from '@/lib/utils/publicId'

describe('StatusDatabase lookups', () => {
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
    })

    describe('publicId', () => {
      // A dedicated actor, isolated from the shared seed fixtures, so these
      // notes never bump a status count another describe block asserts on.
      const publicIdActorId = 'https://public-id-status.test/users/author'

      beforeAll(async () => {
        await database.createActor({
          actorId: publicIdActorId,
          username: 'author',
          domain: 'public-id-status.test',
          followersUrl: `${publicIdActorId}/followers`,
          inboxUrl: `${publicIdActorId}/inbox`,
          sharedInboxUrl: 'https://public-id-status.test/inbox',
          publicKey: 'public-id-status-public-key',
          createdAt: Date.now()
        })
      })

      it('mints a v7 publicId at createNote whose timestamp matches a backdated createdAt', async () => {
        const backdatedAt = Date.UTC(2024, 0, 2, 3, 4, 5, 0)
        const statusId = `${publicIdActorId}/statuses/public-id-backdated`
        const status = (await database.createNote({
          id: statusId,
          url: statusId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Backdated post',
          createdAt: backdatedAt
        })) as StatusNote

        expect(status.publicId).toBeTruthy()
        expect(isPublicId(status.publicId as string)).toBe(true)
        expect(getPublicIdTimestamp(status.publicId as string)).toBe(
          backdatedAt
        )
      })

      it('stores an explicitly passed publicId verbatim', async () => {
        const statusId = `${publicIdActorId}/statuses/public-id-explicit`
        const explicitPublicId = generatePublicId()
        const status = (await database.createNote({
          id: statusId,
          url: statusId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Explicit publicId post',
          publicId: explicitPublicId
        })) as StatusNote

        expect(status.publicId).toBe(explicitPublicId)
      })

      it('round-trips getStatusIdByPublicId and returns null for an id that was never stored', async () => {
        const statusId = `${publicIdActorId}/statuses/public-id-roundtrip`
        const status = (await database.createNote({
          id: statusId,
          url: statusId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Round trip post'
        })) as StatusNote

        expect(
          await database.getStatusIdByPublicId({
            publicId: status.publicId as string
          })
        ).toBe(statusId)
        expect(
          await database.getStatusIdByPublicId({
            publicId: generatePublicId()
          })
        ).toBeNull()
      })

      it('getStatusIdsByPublicIds maps every known publicId back and omits unknown ones', async () => {
        const firstId = `${publicIdActorId}/statuses/public-ids-batch-1`
        const secondId = `${publicIdActorId}/statuses/public-ids-batch-2`
        const first = (await database.createNote({
          id: firstId,
          url: firstId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Batch post one'
        })) as StatusNote
        const second = (await database.createNote({
          id: secondId,
          url: secondId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Batch post two'
        })) as StatusNote
        const unknownPublicId = generatePublicId()

        const map = await database.getStatusIdsByPublicIds({
          publicIds: [
            first.publicId as string,
            second.publicId as string,
            unknownPublicId
          ]
        })

        expect(map.size).toBe(2)
        expect(map.get(first.publicId as string)).toBe(firstId)
        expect(map.get(second.publicId as string)).toBe(secondId)
        expect(map.has(unknownPublicId)).toBe(false)
      })

      it('getStatusIdsByPublicIds returns an empty map for an empty request', async () => {
        const map = await database.getStatusIdsByPublicIds({ publicIds: [] })
        expect(map.size).toBe(0)
      })

      it('resolves an uppercased publicId and keys the batch map by the requested form', async () => {
        // publicIds are stored lowercase and SQLite/PostgreSQL compare them case
        // sensitively, so the case fold has to happen on the lookup PARAMETER —
        // in the database layer, where every resolution site shares it. The
        // batch map is keyed by what the caller asked with, not by what the row
        // holds, so a caller can zip it back against its own input.
        const statusId = `${publicIdActorId}/statuses/public-id-uppercase`
        const status = (await database.createNote({
          id: statusId,
          url: statusId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Uppercase lookup post'
        })) as StatusNote
        const uppercasePublicId = (status.publicId as string).toUpperCase()

        expect(
          await database.getStatusIdByPublicId({ publicId: uppercasePublicId })
        ).toBe(statusId)

        const map = await database.getStatusIdsByPublicIds({
          publicIds: [uppercasePublicId]
        })
        expect(map.get(uppercasePublicId)).toBe(statusId)
      })

      it('getStatusFromPublicId hydrates the same status as getStatus', async () => {
        const statusId = `${publicIdActorId}/statuses/public-id-hydrate`
        const created = (await database.createNote({
          id: statusId,
          url: statusId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Hydrate post'
        })) as StatusNote

        const [byPublicId, byId] = await Promise.all([
          database.getStatusFromPublicId({
            publicId: created.publicId as string
          }),
          database.getStatus({ statusId })
        ])

        expect(byPublicId).toEqual(byId)
      })

      it('getStatusPublicIds returns a map covering only requested ids that have publicIds', async () => {
        const { database: freshDatabase, instance } =
          getTestSQLDatabaseWithInstance()
        await freshDatabase.migrate()
        try {
          await freshDatabase.createAccount({
            email: `public-id-map@${TEST_DOMAIN}`,
            username: 'public-id-map-actor',
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: 'private-public-id-map',
            publicKey: 'public-public-id-map'
          })
          const actor = await freshDatabase.getActorFromEmail({
            email: `public-id-map@${TEST_DOMAIN}`
          })
          if (!actor) throw new Error('failed to seed actor')
          const localActorId = actor.id

          const withId = `${localActorId}/statuses/with-public-id`
          const withoutId = `${localActorId}/statuses/legacy-without-public-id`

          const created = (await freshDatabase.createNote({
            id: withId,
            url: withId,
            actorId: localActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Has a publicId'
          })) as StatusNote

          await freshDatabase.createNote({
            id: withoutId,
            url: withoutId,
            actorId: localActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Simulated pre-backfill legacy status'
          })
          // Simulate a legacy row that predates the backfill migration.
          await instance('statuses')
            .where('id', withoutId)
            .update({ publicId: null })

          const map = await freshDatabase.getStatusPublicIds({
            statusIds: [withId, withoutId, `${localActorId}/statuses/missing`]
          })

          expect(map.size).toBe(1)
          expect(map.get(withId)).toBe(created.publicId)
          expect(map.has(withoutId)).toBe(false)
        } finally {
          await freshDatabase.destroy()
        }
      })

      it('getStatusPublicIds chunks a request wider than the SQLite bind limit', async () => {
        // A full timeline page can carry more ids than SQLITE_MAX_BINDINGS
        // allows in one statement, so the lookup has to chunk like its
        // getStatusIdsByPublicIds counterpart does.
        const { database: freshDatabase, instance } =
          getTestSQLDatabaseWithInstance()
        await freshDatabase.migrate()
        const queries: { bindings: unknown[]; sql: string }[] = []
        const handleQuery = ({
          bindings,
          sql
        }: {
          bindings?: unknown[]
          sql: string
        }) => {
          queries.push({ bindings: bindings ?? [], sql: sql.toLowerCase() })
        }
        try {
          const actorId = 'https://public-id-chunk.test/users/author'
          await freshDatabase.createActor({
            actorId,
            username: 'author',
            domain: 'public-id-chunk.test',
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://public-id-chunk.test/inbox',
            publicKey: 'public-id-chunk-public-key',
            createdAt: Date.now()
          })
          const statusId = `${actorId}/statuses/public-ids-chunked`
          const status = (await freshDatabase.createNote({
            id: statusId,
            url: statusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Chunked lookup post'
          })) as StatusNote
          const statusIds = [
            ...Array.from(
              { length: SQLITE_MAX_BINDINGS + 10 },
              (_unused, index) =>
                `${actorId}/statuses/public-ids-chunk-missing-${index}`
            ),
            statusId
          ]

          instance.on('query', handleQuery)
          const map = await freshDatabase.getStatusPublicIds({ statusIds })
          instance.off('query', handleQuery)

          const bindingCounts = queries
            .filter(
              ({ sql }) =>
                sql.includes('from `statuses`') && sql.includes('`id` in')
            )
            .map(({ bindings }) => bindings.length)
          expect(bindingCounts.length).toBeGreaterThan(1)
          expect(Math.max(...bindingCounts)).toBeLessThanOrEqual(
            SQLITE_MAX_BINDINGS
          )
          expect(map.size).toBe(1)
          expect(map.get(statusId)).toBe(status.publicId)
        } finally {
          instance.off('query', handleQuery)
          await freshDatabase.destroy()
        }
      })
    })

    describe('getStatusesByIds', () => {
      const createVisibilityActor = async ({
        name,
        suffix,
        local = false
      }: {
        name: string
        suffix: string
        local?: boolean
      }) => {
        const actorId = `https://status-visibility.test/users/${name}-${suffix}`
        await database.createActor({
          actorId,
          username: `${name}-${suffix}`,
          domain: 'status-visibility.test',
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: 'https://status-visibility.test/inbox',
          publicKey: `public-key-${name}-${suffix}`,
          privateKey: local ? `private-key-${name}-${suffix}` : undefined,
          createdAt: Date.now()
        })
        return actorId
      }

      it('hydrates actor flags for the current actor', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const bookmarkedStatusId = `${emptyActorId}/statuses/bookmarked-${suffix}`
        const unbookmarkedStatusId = `${emptyActorId}/statuses/unbookmarked-${suffix}`

        await database.createNote({
          id: bookmarkedStatusId,
          url: bookmarkedStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Bookmarked status'
        })
        await database.createNote({
          id: unbookmarkedStatusId,
          url: unbookmarkedStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Unbookmarked status'
        })
        await database.createBookmark({
          actorId: primaryActorId,
          statusId: bookmarkedStatusId
        })
        await database.createLike({
          actorId: primaryActorId,
          statusId: unbookmarkedStatusId
        })

        const results = await database.getStatusesByIds({
          statusIds: [unbookmarkedStatusId, bookmarkedStatusId],
          currentActorId: primaryActorId
        })

        expect(results.map((status) => status.id)).toEqual([
          unbookmarkedStatusId,
          bookmarkedStatusId
        ])
        expect((results[0] as StatusNote).isActorBookmarked).toBe(false)
        expect((results[0] as StatusNote).isActorLiked).toBe(true)
        expect((results[1] as StatusNote).isActorBookmarked).toBe(true)
        expect((results[1] as StatusNote).isActorLiked).toBe(false)
      })

      it('batch-hydrates detected language regardless of whether a viewer is signed in', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const detectedStatusId = `${emptyActorId}/statuses/detected-${suffix}`
        const undetectedStatusId = `${emptyActorId}/statuses/undetected-${suffix}`

        await database.createNote({
          id: detectedStatusId,
          url: detectedStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Status with a detected language'
        })
        await database.createNote({
          id: undetectedStatusId,
          url: undetectedStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Status without a detected language'
        })
        await database.setDetectedLanguage({
          statusId: detectedStatusId,
          language: 'th'
        })

        const signedInResults = await database.getStatusesByIds({
          statusIds: [detectedStatusId, undetectedStatusId],
          currentActorId: primaryActorId
        })
        expect((signedInResults[0] as StatusNote).detectedLanguage).toBe('th')
        expect((signedInResults[1] as StatusNote).detectedLanguage).toBeNull()

        const anonymousResults = await database.getStatusesByIds({
          statusIds: [detectedStatusId, undetectedStatusId]
        })
        expect((anonymousResults[0] as StatusNote).detectedLanguage).toBe('th')
        expect((anonymousResults[1] as StatusNote).detectedLanguage).toBeNull()
      })

      it('hydrates actor flags for nested announce originals', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const originalActorId = `${emptyActorId}/announce-original-${suffix}`
        const firstAnnounceActorId = `${replyAuthorId}/announce-first-${suffix}`
        const secondAnnounceActorId = `${extraActorId}/announce-second-${suffix}`
        const originalStatusId = `${originalActorId}/statuses/original`
        const firstAnnounceId = `${firstAnnounceActorId}/statuses/first`
        const secondAnnounceId = `${secondAnnounceActorId}/statuses/second`

        await database.createNote({
          id: originalStatusId,
          url: originalStatusId,
          actorId: originalActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Nested announce original'
        })
        await database.createAnnounce({
          id: firstAnnounceId,
          actorId: firstAnnounceActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId
        })
        await database.createAnnounce({
          id: secondAnnounceId,
          actorId: secondAnnounceActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: firstAnnounceId
        })
        await database.createBookmark({
          actorId: primaryActorId,
          statusId: secondAnnounceId
        })
        await database.createLike({
          actorId: primaryActorId,
          statusId: originalStatusId
        })

        const results = await database.getStatusesByIds({
          statusIds: [secondAnnounceId],
          currentActorId: primaryActorId
        })

        expect(results).toHaveLength(1)
        const secondAnnounce = results[0] as StatusAnnounce
        expect(secondAnnounce.type).toBe(StatusType.enum.Announce)
        const firstAnnounce = secondAnnounce.originalStatus as StatusAnnounce
        expect(firstAnnounce.type).toBe(StatusType.enum.Announce)
        const originalStatus = firstAnnounce.originalStatus as StatusNote
        expect(originalStatus.id).toBe(originalStatusId)
        expect(originalStatus.isActorBookmarked).toBe(true)
        expect(originalStatus.isActorLiked).toBe(true)
      })

      it('filters statuses by visible actor while preserving requested order', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const hiddenStatusId = `${emptyActorId}/statuses/hidden-${suffix}`
        const directStatusId = `${emptyActorId}/statuses/direct-${suffix}`
        const publicStatusId = `${emptyActorId}/statuses/public-${suffix}`

        await database.createNote({
          id: hiddenStatusId,
          url: hiddenStatusId,
          actorId: emptyActorId,
          to: [extraActorId],
          cc: [],
          text: 'Hidden status'
        })
        await database.createNote({
          id: directStatusId,
          url: directStatusId,
          actorId: emptyActorId,
          to: [primaryActorId],
          cc: [],
          text: 'Direct status'
        })
        await database.createNote({
          id: publicStatusId,
          url: publicStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Public status'
        })

        const results = await database.getStatusesByIds({
          statusIds: [hiddenStatusId, directStatusId, publicStatusId],
          visibleToActorId: primaryActorId
        })

        expect(results.map((status) => status.id)).toEqual([
          directStatusId,
          publicStatusId
        ])
      })

      it('includes recipientless replies to statuses authored by the visible actor', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const visibleActorId = await createVisibilityActor({
          name: 'visible-parent',
          suffix
        })
        const replyActorId = await createVisibilityActor({
          name: 'visible-reply',
          suffix
        })
        const parentStatusId = `${visibleActorId}/statuses/recipientless-visible-parent`
        const replyStatusId = `${replyActorId}/statuses/recipientless-visible-reply`

        const parent = await database.createNote({
          id: parentStatusId,
          url: `${parentStatusId}/canonical`,
          actorId: visibleActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${visibleActorId}/followers`],
          text: 'Recipientless reply parent'
        })
        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: replyActorId,
          to: [],
          cc: [],
          reply: (parent as StatusNote).url,
          text: 'Recipientless reply to visible actor'
        })

        const results = await database.getStatusesByIds({
          statusIds: [replyStatusId],
          visibleToActorId: visibleActorId
        })

        expect(results.map((status) => status.id)).toEqual([replyStatusId])
      })

      it('includes recipientless replies for inherited direct conversation participants', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const rootActorId = await createVisibilityActor({
          name: 'dm-root',
          suffix,
          local: true
        })
        const replyActorId = await createVisibilityActor({
          name: 'dm-reply',
          suffix,
          local: true
        })
        const participantActorId = await createVisibilityActor({
          name: 'dm-participant',
          suffix,
          local: true
        })
        const rootStatusId = `${rootActorId}/statuses/recipientless-dm-root`
        const replyStatusId = `${replyActorId}/statuses/recipientless-dm-reply`

        const root = await database.createNote({
          id: rootStatusId,
          url: `${rootStatusId}/canonical`,
          actorId: rootActorId,
          to: [replyActorId, participantActorId],
          cc: [],
          text: 'Direct conversation root'
        })
        await database.syncDirectConversationForStatus({ status: root })
        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: replyActorId,
          to: [],
          cc: [],
          reply: (root as StatusNote).url,
          text: 'Recipientless reply in synced direct conversation'
        })

        const results = await database.getStatusesByIds({
          statusIds: [replyStatusId],
          visibleToActorId: participantActorId
        })

        expect(results.map((status) => status.id)).toEqual([replyStatusId])
      })

      it('excludes recipientless replies for unrelated visible actors', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const parentActorId = await createVisibilityActor({
          name: 'hidden-parent',
          suffix
        })
        const replyActorId = await createVisibilityActor({
          name: 'hidden-reply',
          suffix
        })
        const visibleActorId = await createVisibilityActor({
          name: 'unrelated-visible',
          suffix
        })
        const parentStatusId = `${parentActorId}/statuses/recipientless-hidden-parent`
        const replyStatusId = `${replyActorId}/statuses/recipientless-hidden-reply`

        const parent = await database.createNote({
          id: parentStatusId,
          url: parentStatusId,
          actorId: parentActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Unrelated recipientless parent'
        })
        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: replyActorId,
          to: [],
          cc: [],
          reply: parent.id,
          text: 'Recipientless reply hidden from unrelated actors'
        })

        const results = await database.getStatusesByIds({
          statusIds: [replyStatusId],
          visibleToActorId: visibleActorId
        })

        expect(results).toEqual([])
      })

      it('includes followers-only statuses from followed actors when filtering by visible actor', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const followerActorId = `${emptyActorId}/followers-only-follower-${suffix}`
        const followedActorId = `${emptyActorId}/followers-only-followed-${suffix}`
        const followersUrl = `${followedActorId}/followers`
        const statusId = `${followedActorId}/statuses/followers-only-${suffix}`

        await database.createActor({
          actorId: followerActorId,
          username: `followers-only-follower-${suffix}`,
          domain: 'remote.test',
          followersUrl: `${followerActorId}/followers`,
          inboxUrl: `${followerActorId}/inbox`,
          sharedInboxUrl: 'https://remote.test/inbox',
          publicKey: `follower-public-key-${suffix}`,
          createdAt: Date.now()
        })
        await database.createActor({
          actorId: followedActorId,
          username: `followers-only-followed-${suffix}`,
          domain: 'remote.test',
          followersUrl,
          inboxUrl: `${followedActorId}/inbox`,
          sharedInboxUrl: 'https://remote.test/inbox',
          publicKey: `followed-public-key-${suffix}`,
          createdAt: Date.now()
        })
        await database.createFollow({
          actorId: followerActorId,
          targetActorId: followedActorId,
          inbox: `${followerActorId}/inbox`,
          sharedInbox: `${followerActorId}/inbox`,
          status: FollowStatus.enum.Accepted
        })
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: followedActorId,
          to: [followersUrl],
          cc: [],
          text: 'Followers-only status from followed actor'
        })

        const results = await database.getStatusesByIds({
          statusIds: [statusId],
          visibleToActorId: followerActorId
        })

        expect(results.map((status) => status.id)).toEqual([statusId])
      })
    })
  })
})

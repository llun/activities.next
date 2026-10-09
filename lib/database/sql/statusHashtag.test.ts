import {
  actors,
  createIsolatedActorFactory
} from '@/lib/database/sql/statusTestHelpers'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { waitFor } from '@/lib/utils/waitFor'

describe('StatusDatabase hashtags', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    const createIsolatedActor = createIsolatedActorFactory(database)

    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    describe('getStatusesByHashtag', () => {
      let hashtagActorId: string

      beforeAll(async () => {
        hashtagActorId = await createIsolatedActor(
          `hashtag-statuses-${Date.now()}`
        )
      })

      it('returns statuses with a given hashtag', async () => {
        const statusId = `${hashtagActorId}/statuses/hashtag-test-${Date.now()}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: hashtagActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Hello #testing'
        })
        await database.createTag({
          statusId,
          name: '#testing',
          value: `https://${actors.primary.domain}/tags/testing`,
          type: 'hashtag'
        })

        const results = await database.getStatusesByHashtag({
          hashtag: 'testing'
        })
        const ids = results.map((s) => s.id)
        expect(ids).toContain(statusId)
      })

      it.each([{ cursor: 'maxStatusId' }, { cursor: 'minStatusId' }])(
        'returns [] when the $cursor cursor status does not exist',
        async ({ cursor }) => {
          const statusId = `${hashtagActorId}/statuses/hashtag-cursor-${cursor}-${Date.now()}`
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId: hashtagActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Hello #cursortag'
          })
          await database.createTag({
            statusId,
            name: '#cursortag',
            value: `https://${actors.primary.domain}/tags/cursortag`,
            type: 'hashtag'
          })

          // An unresolvable cursor yields no page (repo keyset convention),
          // rather than silently falling back to the first page.
          const results = await database.getStatusesByHashtag({
            hashtag: 'cursortag',
            [cursor]: `${hashtagActorId}/statuses/does-not-exist`
          })
          expect(results).toEqual([])
        }
      )

      it('returns compact public statuses with a given hashtag', async () => {
        const statusId = `${hashtagActorId}/statuses/compact-hashtag-test-${Date.now()}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: hashtagActorId,
          to: [ACTIVITY_STREAM_PUBLIC_COMPACT],
          cc: [],
          text: 'Hello #compacttesting'
        })
        await database.createTag({
          statusId,
          name: '#compacttesting',
          value: `https://${actors.primary.domain}/tags/compacttesting`,
          type: 'hashtag'
        })

        const results = await database.getStatusesByHashtag({
          hashtag: 'compacttesting'
        })
        const ids = results.map((s) => s.id)
        expect(ids).toContain(statusId)
      })

      it('returns empty array for unknown hashtag', async () => {
        const results = await database.getStatusesByHashtag({
          hashtag: 'nonexistent_tag_xyz'
        })
        expect(results).toHaveLength(0)
      })

      const createTaggedNote = async ({
        statusId,
        tags,
        actorId = hashtagActorId
      }: {
        statusId: string
        tags: string[]
        actorId?: string
      }) => {
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: tags.map((name) => `#${name}`).join(' ')
        })
        for (const name of tags) {
          await database.createTag({
            statusId,
            name: `#${name}`,
            value: `https://${actors.primary.domain}/tags/${name}`,
            type: 'hashtag'
          })
        }
      }

      it('filters to statuses with attachments when onlyMedia is set', async () => {
        const suffix = Date.now()
        const tag = `mediaonly${suffix}`
        const mediaStatusId = `${hashtagActorId}/statuses/hashtag-media-${suffix}`
        const textStatusId = `${hashtagActorId}/statuses/hashtag-text-${suffix}`
        await createTaggedNote({ statusId: mediaStatusId, tags: [tag] })
        await createTaggedNote({ statusId: textStatusId, tags: [tag] })
        await database.createAttachment({
          actorId: hashtagActorId,
          statusId: mediaStatusId,
          mediaType: 'image/png',
          url: `${mediaStatusId}/image.png`
        })

        const results = await database.getStatusesByHashtag({
          hashtag: tag,
          onlyMedia: true
        })
        expect(results.map((status) => status.id)).toEqual([mediaStatusId])
      })

      it('widens the match to statuses carrying any additional tag', async () => {
        const suffix = Date.now()
        const primaryTag = `anybase${suffix}`
        const extraTag = `anyextra${suffix}`
        const baseStatusId = `${hashtagActorId}/statuses/hashtag-any-base-${suffix}`
        const extraStatusId = `${hashtagActorId}/statuses/hashtag-any-extra-${suffix}`
        await createTaggedNote({ statusId: baseStatusId, tags: [primaryTag] })
        await createTaggedNote({ statusId: extraStatusId, tags: [extraTag] })

        const results = await database.getStatusesByHashtag({
          hashtag: primaryTag,
          anyTags: [extraTag]
        })
        expect(results.map((status) => status.id).sort()).toEqual(
          [baseStatusId, extraStatusId].sort()
        )
      })

      it('applies all[] and none[] tag constraints', async () => {
        const suffix = Date.now()
        const baseTag = `constraint${suffix}`
        const extraTag = `extra${suffix}`
        const bothStatusId = `${hashtagActorId}/statuses/hashtag-both-${suffix}`
        const baseOnlyStatusId = `${hashtagActorId}/statuses/hashtag-base-${suffix}`
        await createTaggedNote({
          statusId: bothStatusId,
          tags: [baseTag, extraTag]
        })
        await createTaggedNote({ statusId: baseOnlyStatusId, tags: [baseTag] })

        const withAll = await database.getStatusesByHashtag({
          hashtag: baseTag,
          allTags: [extraTag]
        })
        expect(withAll.map((status) => status.id)).toEqual([bothStatusId])

        const withNone = await database.getStatusesByHashtag({
          hashtag: baseTag,
          noneTags: [extraTag]
        })
        expect(withNone.map((status) => status.id)).toEqual([baseOnlyStatusId])
      })

      it('requires every all[] tag to be present (AND across multiple tags)', async () => {
        const suffix = Date.now()
        const baseTag = `allbase${suffix}`
        const tagA = `alla${suffix}`
        const tagB = `allb${suffix}`
        const bothStatusId = `${hashtagActorId}/statuses/hashtag-all-both-${suffix}`
        const partialStatusId = `${hashtagActorId}/statuses/hashtag-all-partial-${suffix}`
        await createTaggedNote({
          statusId: bothStatusId,
          tags: [baseTag, tagA, tagB]
        })
        // Has the base tag and tagA but NOT tagB, so it must be excluded — a
        // regression collapsing the per-tag AND loop into an OR (whereIn) would
        // wrongly include it.
        await createTaggedNote({
          statusId: partialStatusId,
          tags: [baseTag, tagA]
        })

        const results = await database.getStatusesByHashtag({
          hashtag: baseTag,
          allTags: [tagA, tagB]
        })
        expect(results.map((status) => status.id)).toEqual([bothStatusId])
      })

      it('scopes results to local or remote authors', async () => {
        const suffix = Date.now()
        const tag = `scope${suffix}`
        const localStatusId = `${hashtagActorId}/statuses/hashtag-local-${suffix}`
        const remoteActorId = DatabaseSeed.externalActors.primary.id
        const remoteStatusId = `${remoteActorId}/statuses/hashtag-remote-${suffix}`
        await createTaggedNote({ statusId: localStatusId, tags: [tag] })
        await createTaggedNote({
          statusId: remoteStatusId,
          tags: [tag],
          actorId: remoteActorId
        })

        const localOnly = await database.getStatusesByHashtag({
          hashtag: tag,
          local: true
        })
        expect(localOnly.map((status) => status.id)).toEqual([localStatusId])

        const remoteOnly = await database.getStatusesByHashtag({
          hashtag: tag,
          remote: true
        })
        expect(remoteOnly.map((status) => status.id)).toEqual([remoteStatusId])
      })

      it('returns only statuses newer than minStatusId', async () => {
        const suffix = Date.now()
        const tag = `mincursor${suffix}`
        const ids: string[] = []
        for (let n = 1; n <= 3; n++) {
          const statusId = `${hashtagActorId}/statuses/hashtag-min-${suffix}-${n}`
          await createTaggedNote({ statusId, tags: [tag] })
          ids.push(statusId)
          await waitFor(5)
        }

        const results = await database.getStatusesByHashtag({
          hashtag: tag,
          minStatusId: ids[0]
        })
        expect(results.map((status) => status.id)).toEqual([ids[2], ids[1]])
      })
    })

    describe('hashtag counters', () => {
      it('increments and decrements hashtag counter', async () => {
        const tag = `counter_test_${Date.now()}`
        await database.increaseHashtagCounter({ hashtag: tag })
        await database.increaseHashtagCounter({ hashtag: tag })
        expect(await database.getHashtagCounter({ hashtag: tag })).toBe(2)

        await database.decreaseHashtagCounter({ hashtag: tag })
        expect(await database.getHashtagCounter({ hashtag: tag })).toBe(1)
      })

      it('normalizes repeated hashtag prefixes for counters', async () => {
        const tag = `RepeatedPrefix_${Date.now()}`

        await database.increaseHashtagCounter({ hashtag: `##${tag}` })

        await expect(
          database.getHashtagCounter({ hashtag: tag.toLowerCase() })
        ).resolves.toBe(1)

        await database.decreaseHashtagCounter({ hashtag: `#${tag}` })

        await expect(
          database.getHashtagCounter({ hashtag: `##${tag.toUpperCase()}` })
        ).resolves.toBe(0)
      })

      it('decreases hashtag counter when status with hashtag is deleted', async () => {
        const actorId = await createIsolatedActor(
          `hashtag-delete-${Date.now()}`
        )
        const tag = `delete_counter_test_${Date.now()}`
        const statusId = `${actorId}/statuses/hashtag-delete-${Date.now()}`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: `Hello #${tag}`
        })
        await database.createTag({
          statusId,
          name: `#${tag}`,
          value: `https://${actors.primary.domain}/tags/${tag}`,
          type: 'hashtag'
        })
        await database.increaseHashtagCounter({ hashtag: tag })

        const beforeCount = await database.getHashtagCounter({ hashtag: tag })
        expect(beforeCount).toBe(1)

        await database.deleteStatus({ statusId })

        const afterCount = await database.getHashtagCounter({ hashtag: tag })
        expect(afterCount).toBe(0)
      })
    })

    describe('getHashtagStatusesPage', () => {
      const tag = `pagetag_${Date.now()}`
      let hashtagActorId: string

      beforeAll(async () => {
        hashtagActorId = await createIsolatedActor(`hashtag-page-${Date.now()}`)
        // Create 3 public posts with the tag and 1 non-public post
        for (let i = 1; i <= 3; i++) {
          const id = `${hashtagActorId}/statuses/page-hashtag-${tag}-${i}`
          await database.createNote({
            id,
            url: id,
            actorId: hashtagActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: `Post #${tag} number ${i}`
          })
          await database.createTag({
            statusId: id,
            name: `#${tag}`,
            value: `https://${actors.primary.domain}/tags/${tag}`,
            type: 'hashtag'
          })
        }
        // Non-public post (followers-only) — should not appear
        const privateId = `${hashtagActorId}/statuses/page-hashtag-${tag}-private`
        await database.createNote({
          id: privateId,
          url: privateId,
          actorId: hashtagActorId,
          to: [`${hashtagActorId}/followers`],
          cc: [],
          text: `Private post #${tag}`
        })
        await database.createTag({
          statusId: privateId,
          name: `#${tag}`,
          value: `https://${actors.primary.domain}/tags/${tag}`,
          type: 'hashtag'
        })
      })

      it('returns paginated public statuses for a hashtag', async () => {
        const { statuses: page1, total } =
          await database.getHashtagStatusesPage({
            hashtag: tag,
            limit: 2,
            offset: 0
          })
        expect(total).toBe(3)
        expect(page1).toHaveLength(2)
      })

      it('respects limit and offset', async () => {
        const { statuses: page2 } = await database.getHashtagStatusesPage({
          hashtag: tag,
          limit: 2,
          offset: 2
        })
        expect(page2).toHaveLength(1)
      })

      it('orders results newest first', async () => {
        const { statuses } = await database.getHashtagStatusesPage({
          hashtag: tag,
          limit: 10,
          offset: 0
        })
        const times = statuses.map((s) => s.createdAt as number)
        expect(times).toEqual([...times].sort((a, b) => b - a))
      })

      it('excludes non-public posts from results and total', async () => {
        const { statuses, total } = await database.getHashtagStatusesPage({
          hashtag: tag,
          limit: 10,
          offset: 0
        })
        expect(total).toBe(3)
        const texts = statuses.map((s) => (s as { text?: string }).text ?? '')
        expect(texts.some((t) => t.includes('Private'))).toBe(false)
      })

      it('handles a # prefix in the hashtag argument', async () => {
        const { statuses } = await database.getHashtagStatusesPage({
          hashtag: `#${tag}`,
          limit: 10,
          offset: 0
        })
        expect(statuses.length).toBe(3)
      })

      it('includes compact public posts in results and total', async () => {
        const compactTag = `compact_pagetag_${Date.now()}`
        const compactId = `${hashtagActorId}/statuses/page-hashtag-${compactTag}`
        await database.createNote({
          id: compactId,
          url: compactId,
          actorId: hashtagActorId,
          to: [ACTIVITY_STREAM_PUBLIC_COMPACT],
          cc: [],
          text: `Compact public post #${compactTag}`
        })
        await database.createTag({
          statusId: compactId,
          name: `#${compactTag}`,
          value: `https://${actors.primary.domain}/tags/${compactTag}`,
          type: 'hashtag'
        })

        const { statuses, total } = await database.getHashtagStatusesPage({
          hashtag: compactTag,
          limit: 10,
          offset: 0
        })
        expect(total).toBe(1)
        expect(statuses.map((status) => status.id)).toContain(compactId)
      })

      it('returns empty results and zero total for unknown hashtag', async () => {
        const { statuses, total } = await database.getHashtagStatusesPage({
          hashtag: 'totally_unknown_tag_xyz',
          limit: 10,
          offset: 0
        })
        expect(statuses).toHaveLength(0)
        expect(total).toBe(0)
      })
    })
  })
})

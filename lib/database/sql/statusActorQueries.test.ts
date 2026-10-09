import {
  createIsolatedActorFactory,
  emptyActorId,
  extraActorId,
  pollAuthorId,
  primaryActorId,
  replyAuthorId,
  statuses
} from '@/lib/database/sql/statusTestHelpers'
import { encodeFavouritedByCursor } from '@/lib/database/sql/utils/favouritedByCursor'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('StatusDatabase actor queries', () => {
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

    describe('getActorStatuses', () => {
      const createStatusFilterActor = async (suffix: string) => {
        const actorId = `https://status-filter.test/users/${suffix}`
        await database.createActor({
          actorId,
          username: suffix,
          domain: 'status-filter.test',
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: 'https://status-filter.test/inbox',
          publicKey: `public-key-${suffix}`,
          createdAt: Date.now()
        })
        return actorId
      }

      it('returns statuses for specific actor', async () => {
        const statuses = await database.getActorStatuses({
          actorId: primaryActorId
        })
        expect(statuses).toHaveLength(3)
        expect(statuses.map((item) => (item as StatusNote).text)).toEqual([
          'This is Actor1 post 3',
          'This is Actor1 post 2',
          'This is Actor1 post'
        ])
      })

      it('batch-hydrates detected language for actor statuses', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const statusId = `${emptyActorId}/statuses/detected-${suffix}`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Status with a detected language'
        })
        await database.setDetectedLanguage({ statusId, language: 'th' })

        const statuses = await database.getActorStatuses({
          actorId: emptyActorId
        })
        const match = statuses.find((item) => item.id === statusId) as
          StatusNote | undefined
        expect(match?.detectedLanguage).toBe('th')
      })

      it('paginates statuses that share createdAt using id as a tiebreaker', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const createdAt = Date.UTC(2035, 0, 1)
        const firstStatusId = `${emptyActorId}/statuses/tie-z-${suffix}`
        const secondStatusId = `${emptyActorId}/statuses/tie-y-${suffix}`
        const thirdStatusId = `${emptyActorId}/statuses/tie-x-${suffix}`

        await database.createNote({
          id: firstStatusId,
          url: firstStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Tie ordered status z',
          createdAt
        })
        await database.createNote({
          id: secondStatusId,
          url: secondStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Tie ordered status y',
          createdAt
        })
        await database.createNote({
          id: thirdStatusId,
          url: thirdStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Tie ordered status x',
          createdAt
        })

        const firstPage = await database.getActorStatuses({
          actorId: emptyActorId,
          limit: 2
        })
        const secondPage = await database.getActorStatuses({
          actorId: emptyActorId,
          maxStatusId: secondStatusId,
          limit: 2
        })

        expect(firstPage.map((status) => status.id)).toEqual([
          firstStatusId,
          secondStatusId
        ])
        expect(secondPage.map((status) => status.id)).toContain(thirdStatusId)
      })

      it('filters media statuses before applying the result limit', async () => {
        const suffix = `only-media-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const createdAt = Date.UTC(2035, 1, 1)
        const mediaStatusId = `${actorId}/statuses/media`
        const textStatusId = `${actorId}/statuses/text`

        await database.createNote({
          id: mediaStatusId,
          url: mediaStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Media status',
          createdAt
        })
        await database.createAttachment({
          actorId,
          statusId: mediaStatusId,
          mediaType: 'image/png',
          url: `${mediaStatusId}/image.png`
        })
        await database.createNote({
          id: textStatusId,
          url: textStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Text status',
          createdAt: createdAt + 1
        })

        const statuses = await database.getActorStatuses({
          actorId,
          limit: 1,
          onlyMedia: true
        })

        expect(statuses.map((status) => status.id)).toEqual([mediaStatusId])
      })

      it('excludes replies to other actors and missing parents while keeping self-replies', async () => {
        const suffix = `exclude-replies-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const otherActorId = await createStatusFilterActor(`${suffix}-other`)
        const createdAt = Date.UTC(2035, 2, 1)
        const parentStatusId = `${actorId}/statuses/parent`
        const selfReplyStatusId = `${actorId}/statuses/self-reply`
        const urlParentStatusId = `${actorId}/statuses/url-parent`
        const urlParentStatusUrl = `${actorId}/@status/url-parent`
        const selfReplyByUrlStatusId = `${actorId}/statuses/self-reply-by-url`
        const otherParentStatusId = `${otherActorId}/statuses/parent`
        const otherReplyStatusId = `${actorId}/statuses/other-reply`
        const missingReplyStatusId = `${actorId}/statuses/missing-reply`

        await database.createNote({
          id: parentStatusId,
          url: parentStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Reply parent',
          createdAt
        })
        await database.createNote({
          id: selfReplyStatusId,
          url: selfReplyStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Self reply',
          reply: parentStatusId,
          createdAt: createdAt + 1
        })
        await database.createNote({
          id: urlParentStatusId,
          url: urlParentStatusUrl,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Reply parent with distinct URL',
          createdAt: createdAt + 2
        })
        await database.createNote({
          id: selfReplyByUrlStatusId,
          url: selfReplyByUrlStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Self reply by URL',
          reply: urlParentStatusUrl,
          createdAt: createdAt + 3
        })
        await database.createNote({
          id: otherParentStatusId,
          url: otherParentStatusId,
          actorId: otherActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Other parent',
          createdAt: createdAt + 4
        })
        await database.createNote({
          id: otherReplyStatusId,
          url: otherReplyStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Other reply',
          reply: otherParentStatusId,
          createdAt: createdAt + 5
        })
        await database.createNote({
          id: missingReplyStatusId,
          url: missingReplyStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Missing reply',
          reply: `${otherActorId}/statuses/missing`,
          createdAt: createdAt + 6
        })

        const statuses = await database.getActorStatuses({
          actorId,
          limit: 10,
          excludeReplies: true
        })
        const statusIds = statuses.map((status) => status.id)

        expect(statusIds).toContain(parentStatusId)
        expect(statusIds).toContain(selfReplyStatusId)
        expect(statusIds).toContain(selfReplyByUrlStatusId)
        expect(statusIds).not.toContain(otherReplyStatusId)
        expect(statusIds).not.toContain(missingReplyStatusId)
      })

      it('excludes reblogs before applying the result limit', async () => {
        const suffix = `exclude-reblogs-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const otherActorId = await createStatusFilterActor(`${suffix}-other`)
        const createdAt = Date.UTC(2035, 3, 1)
        const originalStatusId = `${otherActorId}/statuses/original`
        const noteStatusId = `${actorId}/statuses/note`
        const announceStatusId = `${actorId}/statuses/announce`

        await database.createNote({
          id: originalStatusId,
          url: originalStatusId,
          actorId: otherActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Original status',
          createdAt
        })
        await database.createNote({
          id: noteStatusId,
          url: noteStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Own note status',
          createdAt: createdAt + 1
        })
        await database.createAnnounce({
          id: announceStatusId,
          actorId,
          originalStatusId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          createdAt: createdAt + 2
        })

        const statuses = await database.getActorStatuses({
          actorId,
          limit: 1,
          excludeReblogs: true
        })

        expect(statuses.map((status) => status.id)).toEqual([noteStatusId])
      })

      it('filters statuses by normalized hashtag before applying the result limit', async () => {
        const suffix = `tagged-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const createdAt = Date.UTC(2035, 4, 1)
        const taggedStatusId = `${actorId}/statuses/running`
        const untaggedStatusId = `${actorId}/statuses/cycling`

        await database.createNote({
          id: taggedStatusId,
          url: taggedStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Tagged #Running status',
          createdAt
        })
        await database.createTag({
          statusId: taggedStatusId,
          name: '#Running',
          value: 'https://status-filter.test/tags/running',
          type: 'hashtag'
        })
        await database.createNote({
          id: untaggedStatusId,
          url: untaggedStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Tagged #Cycling status',
          createdAt: createdAt + 1
        })
        await database.createTag({
          statusId: untaggedStatusId,
          name: '#Cycling',
          value: 'https://status-filter.test/tags/cycling',
          type: 'hashtag'
        })

        const statuses = await database.getActorStatuses({
          actorId,
          limit: 1,
          tagged: 'running'
        })

        expect(statuses.map((status) => status.id)).toEqual([taggedStatusId])
      })

      it('filters pinned statuses for the requested actor before applying the result limit', async () => {
        const suffix = `pinned-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const createdAt = Date.UTC(2035, 5, 1)
        const pinnedStatusId = `${actorId}/statuses/pinned`
        const unpinnedStatusId = `${actorId}/statuses/unpinned`

        await database.createNote({
          id: pinnedStatusId,
          url: pinnedStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Pinned status',
          createdAt
        })
        await database.createNote({
          id: unpinnedStatusId,
          url: unpinnedStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Unpinned status',
          createdAt: createdAt + 1
        })
        await database.pinStatus({
          actorId,
          statusId: pinnedStatusId
        })

        const statuses = await database.getActorStatuses({
          actorId,
          limit: 1,
          pinned: true
        })

        expect(statuses.map((status) => status.id)).toEqual([pinnedStatusId])
      })

      it('enforces a max pinned status count inside pinStatus', async () => {
        const suffix = `pin-limit-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const firstStatusId = `${actorId}/statuses/first-pin`
        const secondStatusId = `${actorId}/statuses/second-pin`

        for (const statusId of [firstStatusId, secondStatusId]) {
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Pin limit status'
          })
        }
        await expect(
          database.pinStatus({
            actorId,
            statusId: firstStatusId,
            maxPinnedStatuses: 1
          })
        ).resolves.toBe(true)
        await expect(
          database.pinStatus({
            actorId,
            statusId: secondStatusId,
            maxPinnedStatuses: 1
          })
        ).resolves.toBe(false)
        await expect(
          database.pinStatus({
            actorId,
            statusId: firstStatusId,
            maxPinnedStatuses: 1
          })
        ).resolves.toBe(true)

        await expect(database.getPinnedStatusIds({ actorId })).resolves.toEqual(
          [firstStatusId]
        )
      })

      it('keeps cursor pagination stable when filters match statuses with the same timestamp', async () => {
        const suffix = `cursor-filters-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const createdAt = Date.UTC(2035, 6, 1)
        const firstStatusId = `${actorId}/statuses/z-running`
        const secondStatusId = `${actorId}/statuses/y-running`
        const thirdStatusId = `${actorId}/statuses/x-running`

        for (const statusId of [firstStatusId, secondStatusId, thirdStatusId]) {
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Cursor filtered #running status',
            createdAt
          })
          await database.createTag({
            statusId,
            name: '#running',
            value: 'https://status-filter.test/tags/running',
            type: 'hashtag'
          })
        }

        const firstPage = await database.getActorStatuses({
          actorId,
          tagged: 'running',
          limit: 2
        })
        const secondPage = await database.getActorStatuses({
          actorId,
          tagged: 'running',
          maxStatusId: secondStatusId,
          limit: 2
        })

        expect(firstPage.map((status) => status.id)).toEqual([
          firstStatusId,
          secondStatusId
        ])
        expect(secondPage.map((status) => status.id)).toEqual([thirdStatusId])
      })
    })

    describe('getActorStatusesCount', () => {
      it('returns total number of statuses for the specific actor', async () => {
        const count = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        expect(count).toBe(3)
      })

      it('counts only publicly readable actor statuses when requested', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const publicStatusId = `${emptyActorId}/statuses/public-${suffix}`
        const privateStatusId = `${emptyActorId}/statuses/private-${suffix}`
        const privateAnnounceId = `${emptyActorId}/statuses/announce-private-${suffix}`
        const beforePublicCount = await database.getActorStatusesCount({
          actorId: emptyActorId,
          publicOnly: true
        })

        await database.createNote({
          id: publicStatusId,
          url: publicStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Public count status'
        })
        await database.createNote({
          id: privateStatusId,
          url: privateStatusId,
          actorId: emptyActorId,
          to: [`${emptyActorId}/followers`],
          cc: [],
          text: 'Private count status'
        })
        await database.createAnnounce({
          id: privateAnnounceId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: privateStatusId
        })

        const count = await database.getActorStatusesCount({
          actorId: emptyActorId,
          publicOnly: true
        })
        const statuses = await database.getActorStatuses({
          actorId: emptyActorId,
          publicOnly: true,
          limit: 50
        })
        const publicStatusIds = statuses.map((status) => status.id)

        expect(count).toBe(beforePublicCount + 1)
        expect(publicStatusIds).toContain(publicStatusId)
        expect(publicStatusIds).not.toContain(privateStatusId)
        expect(publicStatusIds).not.toContain(privateAnnounceId)
      })

      it('counts nested announces when the boosted original is publicly readable', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const publicStatusId = `${emptyActorId}/statuses/nested-public-${suffix}`
        const firstAnnounceId = `${emptyActorId}/statuses/nested-boost-${suffix}`
        const nestedAnnounceId = `${emptyActorId}/statuses/nested-reboost-${suffix}`
        const beforePublicCount = await database.getActorStatusesCount({
          actorId: emptyActorId,
          publicOnly: true
        })

        await database.createNote({
          id: publicStatusId,
          url: publicStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Public nested root status'
        })
        await database.createAnnounce({
          id: firstAnnounceId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: publicStatusId
        })
        await database.createAnnounce({
          id: nestedAnnounceId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: firstAnnounceId
        })

        const count = await database.getActorStatusesCount({
          actorId: emptyActorId,
          publicOnly: true
        })
        const statuses = await database.getActorStatuses({
          actorId: emptyActorId,
          publicOnly: true,
          limit: 50
        })
        const publicStatusIds = statuses.map((status) => status.id)

        // The note, the boost of it, and the boost of that boost all resolve to
        // a publicly readable non-Announce, so all three count. The second hop
        // only resolves if the recursion runs past its first iteration.
        expect(count).toBe(beforePublicCount + 3)
        expect(publicStatusIds).toEqual(
          expect.arrayContaining([
            publicStatusId,
            firstAnnounceId,
            nestedAnnounceId
          ])
        )
      })

      it('excludes nested announces when the boosted original is not publicly readable', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const privateStatusId = `${emptyActorId}/statuses/nested-private-${suffix}`
        const firstAnnounceId = `${emptyActorId}/statuses/nested-announce-private-${suffix}`
        const nestedAnnounceId = `${emptyActorId}/statuses/nested-announce-public-${suffix}`
        const beforePublicCount = await database.getActorStatusesCount({
          actorId: emptyActorId,
          publicOnly: true
        })

        await database.createNote({
          id: privateStatusId,
          url: privateStatusId,
          actorId: emptyActorId,
          to: [`${emptyActorId}/followers`],
          cc: [],
          text: 'Private nested root status'
        })
        await database.createAnnounce({
          id: firstAnnounceId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: privateStatusId
        })
        await database.createAnnounce({
          id: nestedAnnounceId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: firstAnnounceId
        })

        const count = await database.getActorStatusesCount({
          actorId: emptyActorId,
          publicOnly: true
        })
        const statuses = await database.getActorStatuses({
          actorId: emptyActorId,
          publicOnly: true,
          limit: 50
        })
        const publicStatusIds = statuses.map((status) => status.id)

        expect(count).toBe(beforePublicCount)
        expect(publicStatusIds).not.toContain(privateStatusId)
        expect(publicStatusIds).not.toContain(firstAnnounceId)
        expect(publicStatusIds).not.toContain(nestedAnnounceId)
      })
    })

    describe('getActorStatuses followers audience fallback', () => {
      it('includes fallback actor followers audience for followers-only reads', async () => {
        const actorId = await createIsolatedActor(
          `fallback-followers-${Date.now()}`
        )
        const statusId = `${actorId}/statuses/fallback-followers-${Date.now()}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId,
          to: [`${actorId}/followers`],
          cc: [],
          text: 'Fallback followers audience'
        })

        const statuses = await database.getActorStatuses({
          actorId,
          includeFollowersOnly: true,
          followersAudience: `${actorId}/followers-updated`,
          limit: 50
        })

        expect(statuses.map((status) => status.id)).toContain(statusId)
      })
    })

    describe('getStatusReplies', () => {
      it('returns replies for specific status', async () => {
        const replies = await database.getStatusReplies({
          statusId: statuses.primary.post
        })
        expect(replies).toHaveLength(2)

        expect((replies[0] as StatusNote).text).toBe(
          'This is Actor2 reply to Actor1'
        )
        expect((replies[1] as StatusNote).text).toBe(
          '<p><span class="h-card"><a href="https://test.llun.dev/@test1@llun.test" target="_blank" class="u-url mention">@<span>test1</span></a></span> This is Actor1 post</p>'
        )
      })

      it('batch-hydrates detected language for replies', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const parentActorId = await createIsolatedActor(
          `detected-reply-parent-${suffix}`
        )
        const parentId = `${parentActorId}/statuses/detected-reply-parent-${suffix}`
        const replyId = `${replyAuthorId}/statuses/detected-reply-${suffix}`

        await database.createNote({
          id: parentId,
          url: parentId,
          actorId: parentActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Detected language reply parent'
        })
        await database.createNote({
          id: replyId,
          url: replyId,
          actorId: replyAuthorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Detected language reply',
          reply: parentId
        })
        await database.setDetectedLanguage({
          statusId: replyId,
          language: 'th'
        })

        const replies = await database.getStatusReplies({
          statusId: parentId
        })
        const match = replies.find((item) => item.id === replyId) as
          StatusNote | undefined
        expect(match?.detectedLanguage).toBe('th')
      })

      it('filters replies to statuses potentially visible to the current actor', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const parentActorId = await createIsolatedActor(
          `context-parent-${suffix}`
        )
        const parentStatusId = `${parentActorId}/statuses/context-parent-${suffix}`
        const publicReplyId = `${replyAuthorId}/statuses/context-public-${suffix}`
        const directReplyId = `${replyAuthorId}/statuses/context-direct-${suffix}`
        const hiddenReplyId = `${replyAuthorId}/statuses/context-hidden-${suffix}`
        const createdAt = Date.now()

        await database.createNote({
          id: parentStatusId,
          url: parentStatusId,
          actorId: parentActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Context parent',
          createdAt
        })
        await database.createNote({
          id: publicReplyId,
          url: publicReplyId,
          actorId: replyAuthorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Public context reply',
          reply: parentStatusId,
          createdAt: createdAt + 1
        })
        await database.createNote({
          id: directReplyId,
          url: directReplyId,
          actorId: replyAuthorId,
          to: [extraActorId],
          cc: [],
          text: 'Direct context reply',
          reply: parentStatusId,
          createdAt: createdAt + 2
        })
        await database.createNote({
          id: hiddenReplyId,
          url: hiddenReplyId,
          actorId: replyAuthorId,
          to: [primaryActorId],
          cc: [],
          text: 'Hidden context reply',
          reply: parentStatusId,
          createdAt: createdAt + 3
        })

        const replies = await database.getStatusReplies({
          statusId: parentStatusId,
          visibleToActorId: extraActorId
        })

        expect(replies.map((status) => status.id)).toEqual([
          directReplyId,
          publicReplyId
        ])
      })

      it("includes followers-only replies using the reply author's stored followersUrl", async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const customActorId = `https://remote.test/users/context-author-${suffix}`
        const customFollowersUrl = `https://remote.test/collections/context-author-${suffix}/followers`
        const parentActorId = await createIsolatedActor(
          `context-custom-parent-${suffix}`
        )
        const parentStatusId = `${parentActorId}/statuses/context-custom-followers-parent-${suffix}`
        const replyStatusId = `${customActorId}/statuses/context-custom-followers-reply`

        await database.createActor({
          actorId: customActorId,
          username: `context-author-${suffix}`,
          domain: 'remote.test',
          followersUrl: customFollowersUrl,
          inboxUrl: `${customActorId}/inbox`,
          sharedInboxUrl: 'https://remote.test/inbox',
          publicKey: `public-key-${suffix}`,
          createdAt: Date.now()
        })
        await database.createFollow({
          actorId: extraActorId,
          targetActorId: customActorId,
          inbox: `${extraActorId}/inbox`,
          sharedInbox: `${extraActorId}/inbox`,
          status: FollowStatus.enum.Accepted
        })
        await database.createNote({
          id: parentStatusId,
          url: parentStatusId,
          actorId: parentActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Context parent for custom followers reply'
        })
        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: customActorId,
          to: [customFollowersUrl],
          cc: [],
          text: 'Custom followers reply',
          reply: parentStatusId
        })

        const replies = await database.getStatusReplies({
          statusId: parentStatusId,
          visibleToActorId: extraActorId
        })

        expect(replies.map((status) => status.id)).toEqual([replyStatusId])
      })
    })

    describe('hasActorAnnouncedStatus', () => {
      it('returns true if actor has announced status', async () => {
        const result = await database.hasActorAnnouncedStatus({
          statusId: statuses.replyAuthor.mentionReplyToPrimary,
          actorId: replyAuthorId
        })
        expect(result).toBeTrue()
      })

      it('returns false if actor has not announced status', async () => {
        const result = await database.hasActorAnnouncedStatus({
          statusId: statuses.primary.post,
          actorId: primaryActorId
        })
        expect(result).toBeFalse()
      })
    })

    describe('getActorAnnounceStatus', () => {
      it('returns announce status for actor', async () => {
        const announce = await database.getActorAnnounceStatus({
          statusId: statuses.primary.postWithAttachments,
          actorId: replyAuthorId
        })
        expect(announce).toMatchObject({
          id: statuses.replyAuthor.announcePrimary,
          actorId: replyAuthorId,
          type: 'Announce'
        })
      })

      it('returns null when actor has not announced status', async () => {
        const announce = await database.getActorAnnounceStatus({
          statusId: statuses.primary.postWithAttachments,
          actorId: primaryActorId
        })
        expect(announce).toBeNull()
      })
    })

    describe('getActorAnnouncedStatusId', () => {
      it('returns the actor announce id for an original status', async () => {
        const announceId = await database.getActorAnnouncedStatusId({
          originalStatusId: statuses.primary.postWithAttachments,
          actorId: replyAuthorId
        })

        expect(announceId).toBe(statuses.replyAuthor.announcePrimary)
      })

      it('returns null when the actor has not announced the status', async () => {
        const announceId = await database.getActorAnnouncedStatusId({
          originalStatusId: statuses.primary.postWithAttachments,
          actorId: primaryActorId
        })

        expect(announceId).toBeNull()
      })
    })

    describe('getStatusReblogsCount', () => {
      it('returns reblog counts for single and multiple statuses', async () => {
        expect(
          await database.getStatusReblogsCount({
            statusId: statuses.primary.postWithAttachments
          })
        ).toBe(1)
        expect(
          await database.getStatusReblogsCount({
            statusId: statuses.primary.post
          })
        ).toBe(0)

        const counts = await database.getStatusReblogsCounts({
          statusIds: [
            statuses.primary.postWithAttachments,
            statuses.primary.post
          ]
        })
        expect(counts).toEqual({
          [statuses.primary.postWithAttachments]: 1,
          [statuses.primary.post]: 0
        })
      })

      it('returns bulk reblog counts in SQLite-safe batches', async () => {
        const statusIds = Array.from(
          { length: 1005 },
          (_, index) => `${emptyActorId}/statuses/bulk-reblog-count-${index}`
        )
        const counts = await database.getStatusReblogsCounts({ statusIds })

        expect(Object.keys(counts)).toHaveLength(statusIds.length)
        expect(Object.values(counts).every((count) => count === 0)).toBe(true)
      })
    })

    describe('getStatusRepliesCount', () => {
      it('returns reply counts for single and multiple statuses', async () => {
        expect(
          await database.getStatusRepliesCount({
            statusId: statuses.primary.post
          })
        ).toBe(2)
        expect(
          await database.getStatusRepliesCount({
            statusId: statuses.primary.secondPost
          })
        ).toBe(0)

        const counts = await database.getStatusRepliesCounts({
          statusIds: [statuses.primary.post, statuses.primary.secondPost]
        })
        expect(counts).toEqual({
          [statuses.primary.post]: 2,
          [statuses.primary.secondPost]: 0
        })
      })

      it('counts replies that reference parent URL', async () => {
        const parentStatusId = `${emptyActorId}/statuses/url-parent`
        const parentStatusUrl = `${emptyActorId}/statuses/url-parent`

        await database.createNote({
          id: parentStatusId,
          url: parentStatusUrl,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Parent status for URL-based reply counting'
        })

        await database.createNote({
          id: `${pollAuthorId}/statuses/url-reply`,
          url: `${pollAuthorId}/statuses/url-reply`,
          actorId: pollAuthorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Reply by parent URL',
          reply: parentStatusUrl
        })

        const count = await database.getStatusRepliesCount({
          statusId: parentStatusId
        })
        expect(count).toBe(1)
      })
    })

    describe('getFavouritedBy', () => {
      it('returns an empty page when no one favourited the status', async () => {
        const favourites = await database.getFavouritedBy({
          statusId: statuses.primary.post,
          limit: 40
        })
        expect(favourites).toHaveLength(0)
      })

      it('returns the actors who favourited the status', async () => {
        const favourites = await database.getFavouritedBy({
          statusId: statuses.poll.status,
          limit: 40
        })
        expect(favourites).toHaveLength(1)
        expect(favourites[0].actorId).toBe(replyAuthorId)
        expect(typeof favourites[0].createdAt).toBe('number')
      })

      it('supports id-cursor pagination via max_id', async () => {
        const actorId = await createIsolatedActor(
          `fav-max-id-${crypto.randomUUID().slice(0, 8)}`
        )
        const statusId = `${actorId}/statuses/1`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId,
          text: 'Favourited post',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        await database.createLike({ actorId: primaryActorId, statusId })
        await database.createLike({ actorId: replyAuthorId, statusId })
        await database.createLike({ actorId: pollAuthorId, statusId })

        const firstPage = await database.getFavouritedBy({
          statusId,
          limit: 2
        })
        expect(firstPage).toHaveLength(2)

        const cursor = encodeFavouritedByCursor({
          createdAt: firstPage[firstPage.length - 1].createdAt,
          actorId: firstPage[firstPage.length - 1].actorId
        })
        const secondPage = await database.getFavouritedBy({
          statusId,
          limit: 2,
          maxId: cursor
        })
        expect(secondPage).toHaveLength(1)

        const actorIds = [...firstPage, ...secondPage].map(
          (item) => item.actorId
        )
        expect(new Set(actorIds).size).toBe(3)
        expect(actorIds).toEqual(
          expect.arrayContaining([primaryActorId, replyAuthorId, pollAuthorId])
        )
      })

      it('returns an empty page for a malformed cursor', async () => {
        const favourites = await database.getFavouritedBy({
          statusId: statuses.poll.status,
          limit: 40,
          maxId: 'not-a-valid-cursor!!'
        })
        expect(favourites).toHaveLength(0)
      })

      it('pages newer favourites with min_id, distinct from max_id direction', async () => {
        const actorId = await createIsolatedActor(
          `fav-min-id-${crypto.randomUUID().slice(0, 8)}`
        )
        const statusId = `${actorId}/statuses/1`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId,
          text: 'Favourited post',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        await database.createLike({ actorId: primaryActorId, statusId })
        await database.createLike({ actorId: replyAuthorId, statusId })
        await database.createLike({ actorId: pollAuthorId, statusId })

        const ordered = await database.getFavouritedBy({ statusId, limit: 40 })
        expect(ordered.length).toBeGreaterThanOrEqual(3)
        const oldest = ordered[ordered.length - 1]

        // min_id returns favourites strictly newer than the cursor (everything
        // except the oldest), and never the cursor row itself.
        const cursor = encodeFavouritedByCursor({
          createdAt: oldest.createdAt,
          actorId: oldest.actorId
        })
        const newer = await database.getFavouritedBy({
          statusId,
          limit: 40,
          minId: cursor
        })
        const newerIds = newer.map((item) => item.actorId)
        expect(newerIds).not.toContain(oldest.actorId)
        expect(newerIds).toHaveLength(ordered.length - 1)
      })
    })
  })
})

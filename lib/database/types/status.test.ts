import { TagType } from '@/lib/models/tag'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { seedStorage } from '@/lib/stub/storage'

import { Storage } from '../types'
import { databaseBeforeAll, getTestDatabaseTable } from '../utils'

describe('StatusDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedStorage(database as Storage)
    })

    describe('getStatus', () => {
      it('returns status without replies by default', async () => {
        const status = await database.getStatus({
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })
        expect(status?.toJson()).toEqual({
          id: 'https://llun.test/users/test1/statuses/post-1',
          actorId: 'https://llun.test/users/test1',
          actor: {
            id: 'https://llun.test/users/test1',
            username: 'test1',
            domain: 'llun.test',
            followersUrl: 'https://llun.test/users/test1/followers',
            inboxUrl: 'https://llun.test/users/test1/inbox',
            sharedInboxUrl: 'https://llun.test/inbox',
            followingCount: 2,
            followersCount: 1,
            statusCount: 3,
            lastStatusAt: expect.toBeNumber(),
            createdAt: expect.toBeNumber()
          },
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          edits: [],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: 'https://llun.test/users/test1/statuses/post-1',
          text: 'This is Actor1 post',
          summary: '',
          reply: '',
          replies: [],
          isActorAnnounced: false,
          isActorLiked: false,
          isLocalActor: true,
          totalLikes: 0,
          attachments: [],
          tags: []
        })
      })

      it('returns status with replies', async () => {
        const status = await database.getStatus({
          statusId: `${ACTOR1_ID}/statuses/post-1`,
          withReplies: true
        })
        expect(status?.toJson().replies).toHaveLength(1)
        expect(status?.toJson()).toMatchObject({
          id: 'https://llun.test/users/test1/statuses/post-1',
          actorId: 'https://llun.test/users/test1',
          actor: {
            id: 'https://llun.test/users/test1',
            username: 'test1',
            domain: 'llun.test',
            followersUrl: 'https://llun.test/users/test1/followers',
            inboxUrl: 'https://llun.test/users/test1/inbox',
            sharedInboxUrl: 'https://llun.test/inbox',
            followingCount: 2,
            followersCount: 1,
            createdAt: expect.toBeNumber()
          },
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          edits: [],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: 'https://llun.test/users/test1/statuses/post-1',
          text: 'This is Actor1 post',
          summary: '',
          reply: '',
          isActorAnnounced: false,
          isActorLiked: false,
          isLocalActor: true,
          totalLikes: 0,
          attachments: [],
          tags: []
        })
      })

      it('returns status with attachments', async () => {
        const status = await database.getStatus({
          statusId: `${ACTOR1_ID}/statuses/post-3`
        })
        expect(status?.data.attachments).toHaveLength(2)
        expect(status?.data.attachments).toMatchObject([
          {
            id: expect.toBeString(),
            actorId: 'https://llun.test/users/test1',
            statusId: 'https://llun.test/users/test1/statuses/post-3',
            type: 'Document',
            mediaType: 'image/png',
            url: 'https://via.placeholder.com/150',
            width: 150,
            height: 150,
            name: '',
            createdAt: expect.toBeNumber(),
            updatedAt: expect.toBeNumber()
          },
          {
            id: expect.toBeString(),
            actorId: 'https://llun.test/users/test1',
            statusId: 'https://llun.test/users/test1/statuses/post-3',
            type: 'Document',
            mediaType: 'image/png',
            url: 'https://via.placeholder.com/150',
            width: 150,
            height: 150,
            name: '',
            createdAt: expect.toBeNumber(),
            updatedAt: expect.toBeNumber()
          }
        ])
      })

      it('returns status with tags', async () => {
        const status = await database.getStatus({
          statusId: `${ACTOR2_ID}/statuses/post-2`
        })
        expect(status?.data.tags).toHaveLength(1)
        expect(status?.data.tags).toMatchObject([
          {
            id: expect.toBeString(),
            statusId: 'https://llun.test/users/test2/statuses/post-2',
            type: 'mention',
            name: '@test1',
            value: 'https://llun.test/@test1',
            createdAt: expect.toBeNumber(),
            updatedAt: expect.toBeNumber()
          }
        ])
      })

      it('returns announce status', async () => {
        const status = await database.getStatus({
          statusId: `${ACTOR2_ID}/statuses/post-3`
        })
        expect(status?.data).toMatchObject({
          id: `${ACTOR2_ID}/statuses/post-3`,
          actorId: ACTOR2_ID,
          actor: {
            username: 'test2',
            domain: 'llun.test'
          },
          type: 'Announce',
          originalStatus: {
            id: `${ACTOR2_ID}/statuses/post-2`,
            actorId: ACTOR2_ID,
            type: 'Note',
            text: expect.toBeString()
          }
        })
      })

      it('returns poll status', async () => {
        const status = await database.getStatus({
          statusId: `${ACTOR3_ID}/statuses/poll-1`
        })
        expect(status?.data).toMatchObject({
          id: `${ACTOR3_ID}/statuses/poll-1`,
          actorId: ACTOR3_ID,
          type: 'Poll',
          url: 'https://llun.test/users/test3/statuses/poll-1',
          text: 'This is a poll',
          tags: [],
          choices: [
            {
              statusId: 'https://llun.test/users/test3/statuses/poll-1',
              title: 'Yes',
              totalVotes: 0
            },
            {
              statusId: 'https://llun.test/users/test3/statuses/poll-1',
              title: 'No',
              totalVotes: 0
            }
          ]
        })
      })
    })

    describe('getActorStatuses', () => {
      it('returns statuses for specific actor', async () => {
        const statuses = await database.getActorStatuses({
          actorId: ACTOR1_ID
        })
        expect(statuses).toHaveLength(3)
        expect(statuses.map((item) => item.data.text)).toEqual([
          'This is Actor1 post 3',
          'This is Actor1 post 2',
          'This is Actor1 post'
        ])
      })
    })

    describe('getActorStatusesCount', () => {
      it('returns total number of statuses for the specific actor', async () => {
        const count = await database.getActorStatusesCount({
          actorId: ACTOR1_ID
        })
        expect(count).toBe(3)
      })
    })

    describe('getStatusReplies', () => {
      it('returns replies for specific status', async () => {
        const replies = await database.getStatusReplies({
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })
        expect(replies).toHaveLength(1)
        expect(replies[0].data.text).toBe(
          '<p><span class="h-card"><a href="https://test.llun.dev/@test1@llun.test" target="_blank" class="u-url mention">@<span>test1</span></a></span> This is Actor1 post</p>'
        )
      })
    })

    describe('hasActorAnnouncedStatus', () => {
      it('returns true if actor has announced status', async () => {
        const result = await database.hasActorAnnouncedStatus({
          statusId: `${ACTOR2_ID}/statuses/post-2`,
          actorId: ACTOR2_ID
        })
        expect(result).toBeTrue()
      })

      it('returns false if actor has not announced status', async () => {
        const result = await database.hasActorAnnouncedStatus({
          statusId: `${ACTOR1_ID}/statuses/post-1`,
          actorId: ACTOR1_ID
        })
        expect(result).toBeFalse()
      })
    })

    describe('getFavouritedBy', () => {
      it('returns actors who favourited the status', async () => {
        const actors = await database.getFavouritedBy({
          statusId: `${ACTOR1_ID}/statuses/post-1`
        })
        expect(actors).toHaveLength(0)
      })

      it('returns actors who favourited the status', async () => {
        const actors = await database.getFavouritedBy({
          statusId: `${ACTOR3_ID}/statuses/poll-1`
        })
        expect(actors).toHaveLength(1)
        expect(actors[0].id).toBe(ACTOR2_ID)
      })
    })

    describe('createNote', () => {
      it('creates a new note', async () => {
        const status = await database.createNote({
          id: `${ACTOR4_ID}/statuses/new-post`,
          url: `${ACTOR4_ID}/statuses/new-post`,
          actorId: ACTOR4_ID,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post'
        })
        expect(status?.data.text).toBe('This is a new post')
      })

      it('creates a new note with attachments', async () => {
        await database.createNote({
          id: `${ACTOR4_ID}/statuses/new-post-2`,
          url: `${ACTOR4_ID}/statuses/new-post-2`,
          actorId: ACTOR4_ID,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post with attachments'
        })
        await database.createAttachment({
          actorId: ACTOR4_ID,
          statusId: `${ACTOR4_ID}/statuses/new-post-2`,
          mediaType: 'image/png',
          url: 'https://via.placeholder.com/150',
          width: 150,
          height: 150
        })
        await database.createAttachment({
          actorId: ACTOR4_ID,
          statusId: `${ACTOR4_ID}/statuses/new-post-2`,
          mediaType: 'image/png',
          url: 'https://via.placeholder.com/150',
          width: 150,
          height: 150
        })
        const status = await database.getStatus({
          statusId: `${ACTOR4_ID}/statuses/new-post-2`
        })
        expect(status?.data.text).toBe('This is a new post with attachments')
        expect(status?.data.attachments).toHaveLength(2)
      })

      it('creates a new note with tags', async () => {
        await database.createNote({
          id: `${ACTOR4_ID}/statuses/new-post-3`,
          url: `${ACTOR4_ID}/statuses/new-post-3`,
          actorId: ACTOR4_ID,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post with tags'
        })
        const tag = await database.createTag({
          statusId: `${ACTOR4_ID}/statuses/new-post-3`,
          type: TagType.enum.mention,
          name: '@test1',
          value: 'https://llun.test/@test1'
        })
        const status = await database.getStatus({
          statusId: `${ACTOR4_ID}/statuses/new-post-3`
        })
        expect(status?.data.text).toBe('This is a new post with tags')
        expect(status?.data.tags).toHaveLength(1)
        expect(status?.data.tags).toMatchObject([
          {
            id: tag.data.id,
            statusId: `${ACTOR4_ID}/statuses/new-post-3`,
            type: TagType.enum.mention,
            name: '@test1',
            value: 'https://llun.test/@test1',
            createdAt: tag.data.createdAt,
            updatedAt: tag.data.updatedAt
          }
        ])
      })
    })
  })
})

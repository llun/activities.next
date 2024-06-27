import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { seedStorage } from '@/lib/stub/storage'

import { FirestoreStorage } from '../firestore'
import { SqlStorage } from '../sql'
import { Storage } from '../types'
import { AccountStorage } from './acount'
import { ActorStorage } from './actor'
import { BaseStorage } from './base'
import { StatusStorage } from './status'

type AccountAndStatusStorage = AccountStorage &
  ActorStorage &
  StatusStorage &
  BaseStorage
type TestStorage = [string, AccountAndStatusStorage]

describe('StatusStorage', () => {
  const testStorages: TestStorage[] = [
    [
      'sqlite',
      new SqlStorage({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: ':memory:'
        }
      })
    ],
    // Enable this when run start:firestore emulator and clear the database manually
    [
      'firestore',
      new FirestoreStorage({
        type: 'firebase',
        projectId: 'test',
        host: 'localhost:8080',
        ssl: false
      })
    ]
  ]

  beforeAll(async () => {
    await Promise.all(testStorages.map((item) => item[1].migrate()))
  })

  afterAll(async () => {
    await Promise.all(testStorages.map((item) => item[1].destroy()))
  })

  describe.each(testStorages)('%s', (name, storage) => {
    beforeAll(async () => {
      await seedStorage(storage as Storage)
    })

    describe('getStatus', () => {
      it('returns status without replies by default', async () => {
        const status = await storage.getStatus({
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
        const status = await storage.getStatus({
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
        const status = await storage.getStatus({
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
        const status = await storage.getStatus({
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
    })

    describe('getActorStatuses', () => {
      it('returns statuses for specific actor', async () => {
        const statuses = await storage.getActorStatuses({
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
  })
})

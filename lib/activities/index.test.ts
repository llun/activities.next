/** eslint-disable @typescript-eslint/no-explicit-any */
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  acceptFollow,
  deleteStatus,
  follow,
  getNote,
  rejectFollow,
  sendAnnounce,
  sendLike,
  sendNote,
  sendUndoLike,
  unfollow
} from '@/lib/activities'
import { CreateStatus } from '@/lib/activities/actions/createStatus'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Actor } from '@/lib/models/actor'
import { StatusType } from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { MockActor } from '@/lib/stub/actor'
import { TEST_SHARED_INBOX, seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { seedActor1 } from '@/lib/stub/seed/actor1'

enableFetchMocks()

describe('activities', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | undefined

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    actor1 = await database.getActorFromEmail({ email: seedActor1.email })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('#getNote', () => {
    it('returns note when fetch succeeds', async () => {
      const statusId = 'https://llun.test/users/test/statuses/123'
      const result = await getNote({ statusId })

      expect(result).not.toBeNull()
      expect(result?.content).toBeDefined()
    })

    it('returns null when fetch returns non-200', async () => {
      fetchMock.mockResponseOnce('', { status: 404 })
      const result = await getNote({ statusId: 'https://notfound.test/note' })

      expect(result).toBeNull()
    })
  })

  describe('#sendNote', () => {
    it('fetch to shared inbox', async () => {
      const actor = MockActor({})
      const note = MockMastodonActivityPubNote({
        content: '<p>Hello</p>',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: ['https://chat.llun.dev/users/me/followers']
      })

      await sendNote({
        currentActor: actor,
        inbox: TEST_SHARED_INBOX,
        note
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [, options] = fetchMock.mock.lastCall as any
      const { body } = options
      const data = JSON.parse(body) as CreateStatus
      const object = data.object
      expect(object.content).toEqual('<p>Hello</p>')
      expect(object.to).toContain(
        'https://www.w3.org/ns/activitystreams#Public'
      )
      expect(object.cc).toContain('https://chat.llun.dev/users/me/followers')
    })
  })

  describe('#sendAnnounce', () => {
    it('returns null for non-Announce status type', async () => {
      const actor = MockActor({})
      const status = {
        id: 'https://llun.test/statuses/123',
        type: StatusType.enum.Note,
        actorId: actor.id,
        to: [],
        cc: [],
        createdAt: Date.now()
      }

      const result = await sendAnnounce({
        currentActor: actor,
        inbox: TEST_SHARED_INBOX,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status: status as any
      })

      expect(result).toBeNull()
    })

    it('sends announce for Announce status type', async () => {
      const actor = MockActor({})
      const originalStatus = {
        id: 'https://llun.test/statuses/original',
        type: StatusType.enum.Note,
        actorId: 'https://llun.test/users/someone',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: []
      }
      const status = {
        id: 'https://llun.test/statuses/123',
        type: StatusType.enum.Announce,
        actorId: actor.id,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [],
        createdAt: Date.now(),
        originalStatus
      }

      await sendAnnounce({
        currentActor: actor,
        inbox: TEST_SHARED_INBOX,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status: status as any
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [url, options] = fetchMock.mock.lastCall as any
      expect(url).toEqual(TEST_SHARED_INBOX)
      expect(options.method).toEqual('POST')

      const body = JSON.parse(options.body)
      expect(body.type).toEqual('Announce')
      expect(body.object).toEqual(originalStatus.id)
    })
  })

  describe('#deleteStatus', () => {
    it('sends delete request to inbox', async () => {
      const actor = MockActor({})
      const statusId = 'https://llun.test/statuses/to-delete'

      await deleteStatus({
        currentActor: actor,
        inbox: TEST_SHARED_INBOX,
        statusId
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [url, options] = fetchMock.mock.lastCall as any
      expect(url).toEqual(TEST_SHARED_INBOX)
      expect(options.method).toEqual('POST')

      const body = JSON.parse(options.body)
      expect(body.type).toEqual('Delete')
      expect(body.object.id).toEqual(statusId)
      expect(body.object.type).toEqual('Tombstone')
    })
  })

  describe('#follow', () => {
    it('sends follow request to user inbox', async () => {
      if (!actor1) fail('Actor1 is required')

      const targetId = 'https://somewhere.test/actors/test1'
      await follow('follow-id', actor1, targetId)
      const firstCall = fetchMock.mock.calls[0]
      expect(firstCall[0]).toEqual(targetId)

      const secondCall = fetchMock.mock.calls[1]
      expect(secondCall[0]).toEqual('https://somewhere.test/actors/test1/inbox')
      expect(secondCall[1]).toMatchObject({
        method: 'POST'
      })

      const followBody = JSON.parse(secondCall[1]?.body as string)
      expect(followBody).toMatchObject({
        id: 'https://llun.test/follow-id',
        type: 'Follow',
        actor: actor1.id,
        object: targetId
      })
    })

    it('returns false when target inbox not found', async () => {
      if (!actor1) fail('Actor1 is required')

      fetchMock.mockResponseOnce('', { status: 404 })
      const result = await follow(
        'follow-id',
        actor1,
        'https://notfound.test/users/nobody'
      )

      expect(result).toBe(false)
    })
  })

  describe('#unfollow', () => {
    it('sends undo follow request', async () => {
      if (!actor1) fail('Actor1 is required')

      const followRecord = {
        id: 'follow-123',
        actorId: actor1.id,
        targetActorId: 'https://somewhere.test/actors/test1',
        inbox: 'https://somewhere.test/actors/test1/inbox',
        status: 'Accepted',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await unfollow(actor1, followRecord as any)

      const calls = fetchMock.mock.calls
      const undoCall = calls.find((call) => {
        if (!call[1]?.body) return false
        const body = JSON.parse(call[1].body as string)
        return body.type === 'Undo'
      })

      expect(undoCall).toBeDefined()
      const body = JSON.parse(undoCall![1]?.body as string)
      expect(body.type).toEqual('Undo')
      expect(body.object.type).toEqual('Follow')
    })
  })

  describe('#acceptFollow', () => {
    it('sends accept response', async () => {
      if (!actor1) fail('Actor1 is required')

      const followRequest = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/follows/123',
        type: 'Follow' as const,
        actor: 'https://somewhere.test/actors/requester',
        object: actor1.id
      }

      await acceptFollow(
        actor1,
        'https://somewhere.test/actors/requester/inbox',
        followRequest
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [url, options] = fetchMock.mock.lastCall as any
      expect(url).toEqual('https://somewhere.test/actors/requester/inbox')

      const body = JSON.parse(options.body)
      expect(body.type).toEqual('Accept')
      expect(body.object.id).toEqual(followRequest.id)
    })
  })

  describe('#rejectFollow', () => {
    it('sends reject response', async () => {
      if (!actor1) fail('Actor1 is required')

      const followRequest = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/follows/456',
        type: 'Follow' as const,
        actor: 'https://somewhere.test/actors/requester',
        object: actor1.id
      }

      await rejectFollow(
        actor1,
        'https://somewhere.test/actors/requester/inbox',
        followRequest
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [url, options] = fetchMock.mock.lastCall as any
      expect(url).toEqual('https://somewhere.test/actors/requester/inbox')

      const body = JSON.parse(options.body)
      expect(body.type).toEqual('Reject')
      expect(body.object.id).toEqual(followRequest.id)
    })
  })

  describe('#sendLike', () => {
    it('sends like to status author inbox', async () => {
      const currentActor = MockActor({})
      const statusActor = {
        id: 'https://somewhere.test/actors/author',
        inboxUrl: 'https://somewhere.test/actors/author/inbox'
      }
      const status = {
        id: 'https://somewhere.test/statuses/liked',
        actor: statusActor
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sendLike({ currentActor, status: status as any })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [url, options] = fetchMock.mock.lastCall as any
      expect(url).toEqual(statusActor.inboxUrl)

      const body = JSON.parse(options.body)
      expect(body.type).toEqual('Like')
      expect(body.object).toEqual(status.id)
    })

    it('does nothing when status has no actor', async () => {
      const currentActor = MockActor({})
      const status = {
        id: 'https://somewhere.test/statuses/orphan',
        actor: null
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sendLike({ currentActor, status: status as any })

      // Should not have made any requests
      expect(fetchMock.mock.calls.length).toBe(0)
    })
  })

  describe('#sendUndoLike', () => {
    it('sends undo like to status author inbox', async () => {
      const currentActor = MockActor({})
      const statusActor = {
        id: 'https://somewhere.test/actors/author',
        inboxUrl: 'https://somewhere.test/actors/author/inbox'
      }
      const status = {
        id: 'https://somewhere.test/statuses/unliked',
        actor: statusActor
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sendUndoLike({ currentActor, status: status as any })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [url, options] = fetchMock.mock.lastCall as any
      expect(url).toEqual(statusActor.inboxUrl)

      const body = JSON.parse(options.body)
      expect(body.type).toEqual('Undo')
      expect(body.object.type).toEqual('Like')
    })

    it('does nothing when status has no actor', async () => {
      const currentActor = MockActor({})
      const status = {
        id: 'https://somewhere.test/statuses/orphan',
        actor: null
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sendUndoLike({ currentActor, status: status as any })

      // Should not have made any requests
      expect(fetchMock.mock.calls.length).toBe(0)
    })
  })
})

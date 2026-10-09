/** eslint-disable @typescript-eslint/no-explicit-any */
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  acceptFollow,
  deleteActor,
  deleteStatus,
  follow,
  followRelay,
  getNote,
  rejectFollow,
  sendAnnounce,
  sendFlag,
  sendLike,
  sendNote,
  sendUndoLike,
  unfollow,
  unfollowRelay
} from '@/lib/activities'
import { CreateStatus } from '@/lib/activities/createStatus'
import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { ACTIVITY_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { MockActor } from '@/lib/stub/actor'
import { TEST_SHARED_INBOX, seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { Follow } from '@/lib/types/domain/follow'
import { Relay } from '@/lib/types/domain/relay'
import { Status, StatusType } from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'

const ACTIVITY_STREAM_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'

const mockRelay = (overrides: Partial<Relay> = {}): Relay => ({
  id: 'relay-1',
  inboxUrl: 'https://relay.example/inbox',
  actorId: null,
  state: 'idle',
  followActivityId: null,
  lastError: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides
})

enableFetchMocks()

describe('activities', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | null = null

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

  describe('getNote', () => {
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

    describe('content type gate', () => {
      // A user upload on the origin's own domain can serve a well-formed note
      // body, but only as a type the uploader picks. The same body labelled
      // ActivityPub is read ('returns note when fetch succeeds' above and the
      // control below).
      const statusId = 'https://victim.test/users/alice/statuses/1'
      const note = MockMastodonActivityPubNote({
        id: statusId,
        from: 'https://victim.test/users/alice',
        content: '<p>uploaded</p>',
        withContext: true
      })

      it('reads a note labelled application/activity+json', async () => {
        fetchMock.mockResponseOnce(JSON.stringify(note), {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS
        })

        const result = await getNote({ statusId })

        expect(result?.id).toEqual(statusId)
      })

      it.each(['application/json', 'application/octet-stream', 'text/plain'])(
        'refuses a note served as %s',
        async (contentType) => {
          fetchMock.mockResponseOnce(JSON.stringify(note), {
            status: 200,
            headers: { 'content-type': contentType }
          })

          expect(await getNote({ statusId })).toBeNull()
          expect(fetchMock).toHaveBeenCalledTimes(1)
        }
      )
    })

    describe('when the requested URL redirects', () => {
      // An open redirect on the claimed origin must not let another host
      // answer for it: callers bind the note's id and attributedTo to the
      // URL they asked for, so a cross-host hop would forge both.
      const redirectingUrl = 'https://victim.test/redirect'
      const forgedNote = MockMastodonActivityPubNote({
        id: 'https://victim.test/users/alice/statuses/forged',
        from: 'https://victim.test/users/alice',
        content: '<p>forged</p>',
        withContext: true
      })
      const redirectTo = (location: string) => {
        fetchMock.mockResponse(async (req) =>
          req.url === redirectingUrl
            ? { status: 302, headers: { location }, body: '' }
            : {
                status: 200,
                body: JSON.stringify(forgedNote),
                headers: ACTIVITY_JSON_HEADERS
              }
        )
      }

      it('refuses a note served after a cross-host redirect', async () => {
        redirectTo('https://attacker.test/forged')

        expect(await getNote({ statusId: redirectingUrl })).toBeNull()
        expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
          redirectingUrl
        ])
      })

      it('follows a same-host redirect', async () => {
        redirectTo('https://victim.test/users/alice/statuses/forged')

        const result = await getNote({ statusId: redirectingUrl })
        expect(result?.id).toEqual(forgedNote.id)
      })
    })
  })

  describe('sendNote', () => {
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
      // The note carries FEP-044f terms (interactionPolicy always, the quote
      // aliases when it quotes), so the activity must declare the context that
      // defines them: a receiver that compacts drops every undefined term, with
      // no error anywhere. Nothing about the delivered content reveals this, so
      // it is asserted here or not at all. The note context supersets the quote
      // one and adds the attachment and tag terms the same Note carries.
      expect(data['@context']).toEqual(NOTE_ACTIVITY_CONTEXT)
      const object = data.object
      expect(object.content).toEqual('<p>Hello</p>')
      expect(object.to).toContain(
        'https://www.w3.org/ns/activitystreams#Public'
      )
      expect(object.cc).toContain('https://chat.llun.dev/users/me/followers')
    })
  })

  describe('sendAnnounce', () => {
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

  describe('deleteStatus', () => {
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

  describe('deleteActor', () => {
    it('sends a Delete of the actor to the inbox', async () => {
      const actor = MockActor({})

      await expect(
        deleteActor({ currentActor: actor, inbox: TEST_SHARED_INBOX })
      ).resolves.toBe(true)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [url, options] = fetchMock.mock.lastCall as any
      expect(url).toEqual(TEST_SHARED_INBOX)
      expect(JSON.parse(options.body)).toMatchObject({
        id: `${actor.id}#delete`,
        type: 'Delete',
        actor: actor.id,
        object: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC]
      })
    })
  })

  describe('follow', () => {
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

  describe('unfollow', () => {
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
      expect(body.id).toEqual(`${actor1.id}#follows/${followRecord.id}/undo`)
      expect(body.object.type).toEqual('Follow')
    })
  })

  describe('followRelay', () => {
    it('sends a Follow of the Public collection to the relay inbox', async () => {
      const signingActor = MockActor({})
      const relay = mockRelay()

      fetchMock.mockResponseOnce('', { status: 202 })
      const result = await followRelay(relay, signingActor)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [url, options] = fetchMock.mock.lastCall as any
      expect(url).toEqual(relay.inboxUrl)
      expect(options.method).toEqual('POST')

      const body = JSON.parse(options.body)
      expect(body.type).toEqual('Follow')
      expect(body.actor).toEqual(signingActor.id)
      expect(body.object).toEqual(ACTIVITY_STREAM_PUBLIC)
      expect(body.id).toEqual(result.followActivityId)
      expect(result.ok).toBe(true)
    })
  })

  describe('unfollowRelay', () => {
    it('sends Undo(Follow) reusing the stored follow id', async () => {
      const signingActor = MockActor({})
      const relay = mockRelay({
        actorId: 'https://relay.example/actor',
        state: 'accepted',
        followActivityId: 'https://llun.test/relay-follow-1'
      })

      fetchMock.mockResponseOnce('', { status: 202 })
      const ok = await unfollowRelay(relay, signingActor)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [url, options] = fetchMock.mock.lastCall as any
      expect(url).toEqual(relay.inboxUrl)

      const body = JSON.parse(options.body)
      expect(body.type).toEqual('Undo')
      expect(body.object.type).toEqual('Follow')
      expect(body.object.id).toEqual('https://llun.test/relay-follow-1')
      expect(body.object.object).toEqual(ACTIVITY_STREAM_PUBLIC)
      expect(ok).toBe(true)
    })
  })

  describe('acceptFollow', () => {
    it('sends accept response', async () => {
      if (!actor1) fail('Actor1 is required')

      const followRequest = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/follows/123',
        type: 'Follow' as const,
        actor: 'https://somewhere.test/actors/requester',
        object: actor1.id
      }

      const accepted = await acceptFollow(
        actor1,
        'https://somewhere.test/actors/requester/inbox',
        followRequest
      )
      expect(accepted).toBe(true)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [url, options] = fetchMock.mock.lastCall as any
      expect(url).toEqual('https://somewhere.test/actors/requester/inbox')

      const body = JSON.parse(options.body)
      expect(body.type).toEqual('Accept')
      expect(body.object.id).toEqual(followRequest.id)
    })

    it('treats both 200 OK and 202 Accepted as success', async () => {
      if (!actor1) fail('Actor1 is required')

      const followRequest = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/follows/123',
        type: 'Follow' as const,
        actor: 'https://somewhere.test/actors/requester',
        object: actor1.id
      }

      fetchMock.mockResponseOnce(JSON.stringify({}), { status: 200 })
      const result200 = await acceptFollow(
        actor1,
        'https://somewhere.test/actors/requester/inbox',
        followRequest
      )
      expect(result200).toBe(true)

      fetchMock.mockResponseOnce(JSON.stringify({}), { status: 202 })
      const result202 = await acceptFollow(
        actor1,
        'https://somewhere.test/actors/requester/inbox',
        followRequest
      )
      expect(result202).toBe(true)

      fetchMock.mockResponseOnce(JSON.stringify({}), { status: 500 })
      const result500 = await acceptFollow(
        actor1,
        'https://somewhere.test/actors/requester/inbox',
        followRequest
      )
      expect(result500).toBe(false)
    })
  })

  describe('rejectFollow', () => {
    it('sends reject response', async () => {
      if (!actor1) fail('Actor1 is required')

      const followRequest = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/follows/456',
        type: 'Follow' as const,
        actor: 'https://somewhere.test/actors/requester',
        object: actor1.id
      }

      const rejected = await rejectFollow(
        actor1,
        'https://somewhere.test/actors/requester/inbox',
        followRequest
      )
      expect(rejected).toBe(true)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [url, options] = fetchMock.mock.lastCall as any
      expect(url).toEqual('https://somewhere.test/actors/requester/inbox')

      const body = JSON.parse(options.body)
      expect(body.type).toEqual('Reject')
      expect(body.object.id).toEqual(followRequest.id)
    })

    it('treats both 200 OK and 202 Accepted as success', async () => {
      if (!actor1) fail('Actor1 is required')

      const followRequest = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/follows/456',
        type: 'Follow' as const,
        actor: 'https://somewhere.test/actors/requester',
        object: actor1.id
      }

      fetchMock.mockResponseOnce(JSON.stringify({}), { status: 200 })
      const result200 = await rejectFollow(
        actor1,
        'https://somewhere.test/actors/requester/inbox',
        followRequest
      )
      expect(result200).toBe(true)

      fetchMock.mockResponseOnce(JSON.stringify({}), { status: 202 })
      const result202 = await rejectFollow(
        actor1,
        'https://somewhere.test/actors/requester/inbox',
        followRequest
      )
      expect(result202).toBe(true)

      fetchMock.mockResponseOnce(JSON.stringify({}), { status: 400 })
      const result400 = await rejectFollow(
        actor1,
        'https://somewhere.test/actors/requester/inbox',
        followRequest
      )
      expect(result400).toBe(false)
    })
  })

  describe('sendLike', () => {
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

  describe('sendFlag', () => {
    it('posts a Flag activity to the inbox resolved from the target person', async () => {
      if (!actor1) fail('Actor1 is required')
      const targetId = 'https://somewhere.test/actors/test1'
      const statusId = 'https://somewhere.test/actors/test1/statuses/1'
      // Resolve a person whose inbox is deliberately NOT `${targetId}/inbox`,
      // so this pins the getActorPerson lookup rather than the guessed
      // fallback (actors on subpath/group deployments have custom inboxes).
      const resolvedInbox = 'https://somewhere.test/custom-delivery/test1'
      fetchMock.mockResponseOnce(
        JSON.stringify({
          ...MockActivityPubPerson({ id: targetId }),
          inbox: resolvedInbox
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/activity+json' }
        }
      )

      const result = await sendFlag({
        uri: `${actor1.id}#reports/report-1`,
        currentActor: actor1,
        targetActorId: targetId,
        objects: [targetId, statusId],
        content: 'spam report',
        signingActor: actor1
      })

      const flagCall = fetchMock.mock.calls.find((call) => {
        if (!call[1]?.body) return false
        return JSON.parse(call[1].body as string).type === 'Flag'
      })
      expect(flagCall?.[0]).toEqual(resolvedInbox)
      const body = JSON.parse(flagCall![1]!.body as string)
      expect(body).toMatchObject({
        id: `${actor1.id}#reports/report-1`,
        type: 'Flag',
        actor: actor1.id,
        object: [targetId, statusId],
        content: 'spam report'
      })
      expect(result.uri).toBe(`${actor1.id}#reports/report-1`)
    })

    it.each([
      {
        description: 'is ok on a 202 Accepted inbox response',
        status: 202,
        expectedOk: true
      },
      {
        description: 'is ok on a 200 OK inbox response',
        status: 200,
        expectedOk: true
      },
      {
        description: 'is not ok on a 400 Bad Request inbox response',
        status: 400,
        expectedOk: false
      }
    ])(
      'falls back to {actor}/inbox and $description',
      async ({ status, expectedOk }) => {
        if (!actor1) fail('Actor1 is required')
        const targetId = 'https://notfound.test/users/nobody'
        // 1st fetch: the getActorPerson lookup fails, so sendFlag posts to the
        // `${targetActorId}/inbox` fallback. 2nd fetch: that inbox POST, whose
        // status decides `ok` (ActivityPub servers answer 200 or 202).
        fetchMock.mockResponseOnce('', { status: 404 })
        fetchMock.mockResponseOnce('', { status })

        const result = await sendFlag({
          uri: `${actor1.id}#reports/report-2`,
          currentActor: actor1,
          targetActorId: targetId,
          objects: targetId,
          content: '',
          signingActor: actor1
        })

        const flagCall = fetchMock.mock.calls.find((call) => {
          if (!call[1]?.body) return false
          return JSON.parse(call[1].body as string).type === 'Flag'
        })
        expect(flagCall?.[0]).toEqual(`${targetId}/inbox`)
        expect(result.ok).toBe(expectedOk)
      }
    )
  })

  describe('sendUndoLike', () => {
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

  describe('inbox delivery failures', () => {
    const likedStatus = {
      id: 'https://somewhere.test/statuses/liked',
      actor: {
        id: 'https://somewhere.test/actors/author',
        inboxUrl: 'https://somewhere.test/actors/author/inbox'
      }
    }
    const unfollowTargetId = 'https://somewhere.test/actors/test1'
    const unfollowRecord = {
      id: 'follow-123',
      actorId: 'https://llun.test/users/test1',
      targetActorId: unfollowTargetId,
      inbox: `${unfollowTargetId}/inbox`,
      status: 'Accepted',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    // Fire-and-forget senders resolve with nothing whatever the inbox says.
    // `inbox` is where the activity must land; `logsTimeout` is whether an
    // ETIMEDOUT is logged (sendNote and deleteStatus silence it).
    const fireAndForget = [
      {
        name: 'sendNote',
        inbox: TEST_SHARED_INBOX,
        logsTimeout: false,
        send: () =>
          sendNote({
            currentActor: MockActor({}),
            inbox: TEST_SHARED_INBOX,
            note: MockMastodonActivityPubNote({
              content: '<p>Hello</p>',
              to: [ACTIVITY_STREAM_PUBLIC]
            })
          })
      },
      {
        name: 'deleteStatus',
        inbox: TEST_SHARED_INBOX,
        logsTimeout: false,
        send: () =>
          deleteStatus({
            currentActor: MockActor({}),
            inbox: TEST_SHARED_INBOX,
            statusId: 'https://llun.test/statuses/to-delete'
          })
      },
      {
        name: 'sendLike',
        inbox: likedStatus.actor.inboxUrl,
        logsTimeout: true,
        send: () =>
          sendLike({
            currentActor: MockActor({}),
            status: likedStatus as unknown as Status
          })
      },
      {
        name: 'sendUndoLike',
        inbox: likedStatus.actor.inboxUrl,
        logsTimeout: true,
        send: () =>
          sendUndoLike({
            currentActor: MockActor({}),
            status: likedStatus as unknown as Status
          })
      }
    ]

    describe.each(fireAndForget)(
      '$name',
      ({ name, inbox, logsTimeout, send }) => {
        afterEach(() => {
          vi.restoreAllMocks()
        })

        it.each([400, 404, 410, 500, 503])(
          'resolves quietly after a %i response, with a single delivery attempt',
          async (status) => {
            const errorSpy = vi.spyOn(logger, 'error')
            fetchMock.resetMocks()
            fetchMock.mockResponse('', { status })

            await expect(send()).resolves.toBeUndefined()

            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(fetchMock.mock.calls[0][0]).toEqual(inbox)
            expect(fetchMock.mock.calls[0][1]?.method).toEqual('POST')
            expect(errorSpy).not.toHaveBeenCalled()
          }
        )

        it('resolves and logs the failure under its own name when the network fails', async () => {
          const errorSpy = vi.spyOn(logger, 'error')
          fetchMock.resetMocks()
          fetchMock.mockReject(new Error('connection reset'))

          await expect(send()).resolves.toBeUndefined()

          expect(errorSpy).toHaveBeenCalledTimes(1)
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining(`[${name}]`)
          )
        })

        it(`${logsTimeout ? 'logs' : 'silences'} an ETIMEDOUT from a slow inbox`, async () => {
          const errorSpy = vi.spyOn(logger, 'error')
          fetchMock.resetMocks()
          fetchMock.mockReject(
            Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
          )

          await expect(send()).resolves.toBeUndefined()

          expect(errorSpy).toHaveBeenCalledTimes(logsTimeout ? 1 : 0)
        })
      }
    )

    describe('deleteActor', () => {
      afterEach(() => {
        vi.restoreAllMocks()
      })

      it.each([200, 202])(
        'reports delivery on a %i response',
        async (status) => {
          fetchMock.resetMocks()
          fetchMock.mockResponse('', { status })

          await expect(
            deleteActor({
              currentActor: MockActor({}),
              inbox: TEST_SHARED_INBOX
            })
          ).resolves.toBe(true)
        }
      )

      it.each([400, 401, 410, 500, 503])(
        'reports non-delivery on a %i response',
        async (status) => {
          const errorSpy = vi.spyOn(logger, 'error')
          fetchMock.resetMocks()
          fetchMock.mockResponse('', { status })

          await expect(
            deleteActor({
              currentActor: MockActor({}),
              inbox: TEST_SHARED_INBOX
            })
          ).resolves.toBe(false)
          expect(fetchMock).toHaveBeenCalledTimes(1)
          expect(errorSpy).not.toHaveBeenCalled()
        }
      )

      it.each([
        ['a network failure', new Error('connection reset')],
        [
          'a timeout',
          Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
        ]
      ])('reports non-delivery without logging on %s', async (_, error) => {
        const errorSpy = vi.spyOn(logger, 'error')
        fetchMock.resetMocks()
        fetchMock.mockReject(error)

        await expect(
          deleteActor({ currentActor: MockActor({}), inbox: TEST_SHARED_INBOX })
        ).resolves.toBe(false)
        // The account is deleted right after this call, so a failed delivery
        // is recorded on the span only.
        expect(errorSpy).not.toHaveBeenCalled()
      })
    })

    describe('unfollow', () => {
      afterEach(() => {
        vi.restoreAllMocks()
      })

      const person = () =>
        JSON.stringify({
          ...MockActivityPubPerson({ id: unfollowTargetId }),
          inbox: 'https://somewhere.test/custom-delivery/test1'
        })

      const queuePerson = () => {
        fetchMock.resetMocks()
        fetchMock.mockResponseOnce(person(), {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS
        })
      }

      it.each([200, 202])(
        'reports delivery on a %i response',
        async (status) => {
          if (!actor1) fail('Actor1 is required')
          queuePerson()
          fetchMock.mockResponseOnce('', { status })

          await expect(
            unfollow(actor1, unfollowRecord as unknown as Follow)
          ).resolves.toBe(true)
          const [url, options] = fetchMock.mock.calls[1]
          expect(url).toEqual('https://somewhere.test/custom-delivery/test1')
          expect(options?.method).toEqual('POST')
        }
      )

      it.each([400, 404, 410, 500])(
        'reports non-delivery on a %i response',
        async (status) => {
          if (!actor1) fail('Actor1 is required')
          queuePerson()
          fetchMock.mockResponseOnce('', { status })

          await expect(
            unfollow(actor1, unfollowRecord as unknown as Follow)
          ).resolves.toBe(false)
        }
      )

      it('falls back to {target}/inbox when the target actor cannot be fetched', async () => {
        if (!actor1) fail('Actor1 is required')
        fetchMock.resetMocks()
        fetchMock.mockResponseOnce('', { status: 404 })
        fetchMock.mockResponseOnce('', { status: 202 })

        await expect(
          unfollow(actor1, unfollowRecord as unknown as Follow)
        ).resolves.toBe(true)
        expect(fetchMock.mock.calls[1][0]).toEqual(`${unfollowTargetId}/inbox`)
      })

      it('reports non-delivery and logs under unfollow when the network fails', async () => {
        if (!actor1) fail('Actor1 is required')
        const errorSpy = vi.spyOn(logger, 'error')
        queuePerson()
        fetchMock.mockRejectOnce(new Error('connection reset'))

        await expect(
          unfollow(actor1, unfollowRecord as unknown as Follow)
        ).resolves.toBe(false)
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('[unfollow]')
        )
      })
    })
  })
})

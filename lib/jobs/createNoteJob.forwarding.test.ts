import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import type { MockInstance } from 'vitest'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import {
  CREATE_NOTE_JOB_NAME,
  FORWARD_ACTIVITY_JOB_NAME
} from '@/lib/jobs/names'
import {
  MAX_FORWARD_INBOXES_PER_JOB,
  resolveForwardingInboxes
} from '@/lib/services/federation/forwardingDelivery'
import { getQueue } from '@/lib/services/queue'
import type { JobMessage, Queue } from '@/lib/services/queue/type'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Note } from '@/lib/types/activitypub'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { FRIEND_ACTOR_ID } from './createNoteJob.testUtils'

enableFetchMocks()

vi.mock('@/lib/services/federation/forwardingDelivery', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/services/federation/forwardingDelivery')
  >('@/lib/services/federation/forwardingDelivery')
  // Passthrough, so a test can stand in a fan-out larger than one job message
  // without seeding hundreds of follows.
  return {
    ...actual,
    resolveForwardingInboxes: vi.fn(actual.resolveForwardingInboxes)
  }
})

describe('createNoteJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | null | undefined

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('ActivityPub Outbound Inbox Forwarding', () => {
    const originalEnv = process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING
    let queueSpy: MockInstance<Queue['publish']>

    beforeEach(() => {
      queueSpy = vi.spyOn(getQueue(), 'publish').mockResolvedValue(undefined)
    })

    afterEach(() => {
      queueSpy.mockRestore()
      if (originalEnv === undefined) {
        delete process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING
      } else {
        process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = originalEnv
      }
    })

    it('enqueues ForwardActivityJob for verified public reply to local user', async () => {
      process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = 'true'

      const localStatusId = `${actor1!.id}/statuses/parent-status-for-forwarding`
      await database.createNote({
        id: localStatusId,
        url: localStatusId,
        actorId: actor1!.id,
        text: 'parent note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      // Add a follower with inbox
      const followerId = 'https://remote-follower.test/users/follower1'
      await database.createFollow({
        actorId: followerId,
        targetActorId: actor1!.id,
        status: 'Accepted',
        inbox: 'https://remote-follower.test/users/follower1/inbox',
        sharedInbox: 'https://remote-follower.test/inbox'
      })

      const remoteAuthor = 'https://remote-author.test/users/author'
      const replyNote = MockMastodonActivityPubNote({
        id: `${remoteAuthor}/statuses/reply-to-forward`,
        from: remoteAuthor,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [actor1!.id],
        inReplyTo: localStatusId,
        content: '<p>Public reply to local user</p>'
      })

      await createNoteJob(database, {
        id: 'reply-to-forward-job',
        name: CREATE_NOTE_JOB_NAME,
        data: replyNote,
        verifiedSenderActorId: remoteAuthor
      })

      const forwardCalls = queueSpy.mock.calls.filter(
        ([message]: [JobMessage]) => message.name === FORWARD_ACTIVITY_JOB_NAME
      )
      expect(forwardCalls).toHaveLength(1)
      const data = forwardCalls[0][0].data as {
        inboxes: string[]
        localActorId: string
      }
      expect(data.inboxes).toContain('https://remote-follower.test/inbox')
      expect(data.localActorId).toBe(actor1!.id)
    })

    it('splits a large forwarding fan-out across bounded job messages', async () => {
      process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = 'true'

      const localStatusId = `${actor1!.id}/statuses/parent-status-for-fanout`
      await database.createNote({
        id: localStatusId,
        url: localStatusId,
        actorId: actor1!.id,
        text: 'parent note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const manyInboxes = Array.from(
        { length: MAX_FORWARD_INBOXES_PER_JOB * 2 + 1 },
        (_, index) => `https://fanout${index}.example/inbox`
      )
      vi.mocked(resolveForwardingInboxes).mockResolvedValueOnce(manyInboxes)

      const remoteAuthor = 'https://remote-author.test/users/author'
      const replyNote = MockMastodonActivityPubNote({
        id: `${remoteAuthor}/statuses/reply-to-fanout`,
        from: remoteAuthor,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [actor1!.id],
        inReplyTo: localStatusId,
        content: '<p>Public reply to local user</p>'
      })

      await createNoteJob(database, {
        id: 'reply-to-fanout-job',
        name: CREATE_NOTE_JOB_NAME,
        data: replyNote,
        verifiedSenderActorId: remoteAuthor
      })

      const forwardCalls = queueSpy.mock.calls.filter(
        ([message]: [JobMessage]) => message.name === FORWARD_ACTIVITY_JOB_NAME
      )
      expect(forwardCalls.length).toBeGreaterThan(1)
      const chunks = forwardCalls.map(
        ([message]) => (message.data as { inboxes: string[] }).inboxes
      )
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(MAX_FORWARD_INBOXES_PER_JOB)
      }
      expect(chunks.flat()).toEqual(manyInboxes)
    })

    it('does not enqueue ForwardActivityJob when feature is disabled', async () => {
      process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = 'false'

      const localStatusId = `${actor1!.id}/statuses/parent-status-disabled-forward`
      await database.createNote({
        id: localStatusId,
        url: localStatusId,
        actorId: actor1!.id,
        text: 'parent note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const remoteAuthor = 'https://remote-author.test/users/author2'
      const replyNote = MockMastodonActivityPubNote({
        id: `${remoteAuthor}/statuses/reply-disabled`,
        from: remoteAuthor,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [actor1!.id],
        inReplyTo: localStatusId,
        content: '<p>Public reply with feature disabled</p>'
      })

      await createNoteJob(database, {
        id: 'reply-disabled-job',
        name: CREATE_NOTE_JOB_NAME,
        data: replyNote,
        verifiedSenderActorId: remoteAuthor
      })

      const forwardCalls = queueSpy.mock.calls.filter(
        ([message]: [JobMessage]) => message.name === FORWARD_ACTIVITY_JOB_NAME
      )
      expect(forwardCalls).toHaveLength(0)
    })

    it('does not enqueue ForwardActivityJob for indirect/unverified delivery', async () => {
      process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING = 'true'

      const localStatusId = `${actor1!.id}/statuses/parent-status-unverified`
      await database.createNote({
        id: localStatusId,
        url: localStatusId,
        actorId: actor1!.id,
        text: 'parent note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const remoteAuthor = 'https://remote-author.test/users/author3'
      const replyNote = MockMastodonActivityPubNote({
        id: `${remoteAuthor}/statuses/reply-unverified`,
        from: remoteAuthor,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [actor1!.id],
        inReplyTo: localStatusId,
        content: '<p>Public reply unverified</p>'
      })

      await createNoteJob(database, {
        id: 'reply-unverified-job',
        name: CREATE_NOTE_JOB_NAME,
        data: replyNote,
        verifiedSenderActorId: 'https://other-signer.test/users/signer'
      })

      const forwardCalls = queueSpy.mock.calls.filter(
        ([message]: [JobMessage]) => message.name === FORWARD_ACTIVITY_JOB_NAME
      )
      expect(forwardCalls).toHaveLength(0)
    })

    it('gracefully returns without throwing when given a Question or non-note payload', async () => {
      const questionPayload = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/questions/1',
        type: 'Question',
        attributedTo: FRIEND_ACTOR_ID,
        content: '<p>Poll?</p>',
        published: '2026-08-30T04:27:44Z',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        oneOf: [
          {
            type: 'Note',
            name: 'Option 1',
            replies: { type: 'Collection', totalItems: 0 }
          }
        ]
      }

      await expect(
        createNoteJob(database, {
          id: 'question-in-note-job',
          name: CREATE_NOTE_JOB_NAME,
          data: questionPayload as unknown as Note
        })
      ).resolves.toBeUndefined()

      await expect(
        createNoteJob(database, {
          id: 'malformed-job',
          name: CREATE_NOTE_JOB_NAME,
          data: { invalid: 'payload' }
        })
      ).resolves.toBeUndefined()
    })
  })
})

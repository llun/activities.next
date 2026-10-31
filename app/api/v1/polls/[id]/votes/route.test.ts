import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

const {
  mockGetMastodonStatus,
  mockGetNote,
  mockSendPollVotes,
  mockSyncRemotePoll
} = vi.hoisted(() => ({
  mockGetMastodonStatus: vi.fn(),
  mockGetNote: vi.fn(),
  mockSendPollVotes: vi.fn().mockResolvedValue(undefined),
  mockSyncRemotePoll: vi.fn()
}))

vi.mock('@/lib/activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/activities')>()
  return { ...actual, getNote: mockGetNote, sendPollVotes: mockSendPollVotes }
})

vi.mock('@/lib/services/polls/syncRemotePoll', () => ({
  syncRemotePoll: mockSyncRemotePoll
}))

// The real serializer, wrapped so a test can inspect what the route hands it.
vi.mock('@/lib/services/mastodon/getMastodonStatus', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/services/mastodon/getMastodonStatus')
    >()
  // The real serializer by default; `clearAllMocks` only clears calls.
  mockGetMastodonStatus.mockImplementation(actual.getMastodonStatus)
  return { ...actual, getMastodonStatus: mockGetMastodonStatus }
})

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const vote = (pollId: string, body: unknown) =>
  POST(
    new NextRequest(`https://llun.test/api/v1/polls/${urlToId(pollId)}/votes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: 'https://llun.test'
      },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ id: urlToId(pollId) }) }
  )

const REMOTE_ACTOR_ID = EXTERNAL_ACTOR1

describe('POST /api/v1/polls/[id]/votes', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    // llun.dev is the one fixture domain that answers on the real internet:
    // it served HTTP 404 for the fixture actor's document. Serve the same 404
    // at the fetch boundary so the refresh path fails the same way without a
    // connection.
    fetchMock.resetMocks()
    fetchMock.doMock()
    fetchMock.mockResponse(async () => ({ status: 404, body: 'Not Found' }))
  })

  afterEach(() => {
    fetchMock.resetMocks()
    fetchMock.dontMock()
  })

  // The signed-in actor (actor1) votes on a poll by actor2.
  const seedPoll = async (
    suffix: string,
    choices = ['a', 'b'],
    pollType: 'oneOf' | 'anyOf' = 'anyOf'
  ) => {
    const pollId = `${ACTOR2_ID}/statuses/poll-vote-${suffix}`
    await database.createPoll({
      id: pollId,
      url: pollId,
      actorId: ACTOR2_ID,
      text: 'vote on me',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      choices,
      pollType,
      endAt: Date.now() + 60_000
    })
    return pollId
  }

  const expectNoVotes = async (pollId: string) => {
    const stored = await database.getStatus({
      statusId: pollId,
      withReplies: false
    })
    expect(stored?.type).toBe(StatusType.enum.Poll)
    if (stored?.type !== StatusType.enum.Poll) {
      throw new Error('Expected poll status')
    }
    expect(stored.choices.every((choice) => choice.totalVotes === 0)).toBe(true)
  }

  it.each([
    {
      description: 'accepts string choices in JSON bodies (documented form)',
      choices: ['1'],
      expected: [1]
    },
    {
      description: 'accepts numeric choices in JSON bodies',
      choices: [0, 1],
      expected: [0, 1]
    }
  ])('$description', async ({ choices, expected }) => {
    const pollId = await seedPoll(`choices-${choices.join('-')}`)

    const response = await vote(pollId, { choices })

    expect(response.status).toBe(200)
    const stored = await database.getStatus({
      statusId: pollId,
      withReplies: false
    })
    expect(stored?.type).toBe(StatusType.enum.Poll)
    if (stored?.type !== StatusType.enum.Poll) {
      throw new Error('Expected poll status')
    }
    expect(stored.choices.map((choice) => choice.totalVotes)).toEqual(
      stored.choices.map((_, index) => (expected.includes(index) ? 1 : 0))
    )
  })

  it('serializes the locally-updated status without a post-vote remote sync', async () => {
    const pollId = await seedPoll('sync-guard')

    const response = await vote(pollId, { choices: ['0'] })

    expect(response.status).toBe(200)
    const [, passedStatus] = mockGetMastodonStatus.mock.calls[0]
    expect(passedStatus).toMatchObject({
      id: pollId,
      type: StatusType.enum.Poll,
      choices: [
        { title: 'a', totalVotes: 1 },
        { title: 'b', totalVotes: 0 }
      ]
    })
    expect(mockSyncRemotePoll).not.toHaveBeenCalled()
  })

  it('still rejects non-numeric choices', async () => {
    const pollId = await seedPoll('non-numeric')

    const response = await vote(pollId, { choices: ['abc'] })

    expect(response.status).toBe(422)
    await expectNoVotes(pollId)
  })

  it.each([
    { description: 'an empty string choice', choice: '' },
    { description: 'a whitespace-only choice', choice: ' ' },
    { description: 'a null choice', choice: null },
    { description: 'a false choice', choice: false },
    { description: 'a true choice', choice: true },
    { description: 'a nested array choice', choice: [] },
    { description: 'an object choice', choice: {} }
  ])(
    'rejects $description instead of voting for option 0',
    async ({ choice }) => {
      const pollId = await seedPoll(`blank-${String(choice)}`)

      const response = await vote(pollId, { choices: [choice] })

      expect(response.status).toBe(422)
      await expectNoVotes(pollId)
    }
  )

  describe('unstored remote Question', () => {
    it('voting on an unstored remote public Question stores it and records the vote', async () => {
      const remoteQuestionId = `${REMOTE_ACTOR_ID}/statuses/remote-question-1`
      mockGetNote.mockResolvedValueOnce({
        id: remoteQuestionId,
        type: 'Question',
        attributedTo: REMOTE_ACTOR_ID,
        content: 'remote question',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        published: '2026-04-26T10:00:00Z',
        endTime: new Date(Date.now() + 86400_000).toISOString(),
        oneOf: [
          {
            type: 'Note',
            name: 'yes',
            replies: { type: 'Collection', totalItems: 0 }
          },
          {
            type: 'Note',
            name: 'no',
            replies: { type: 'Collection', totalItems: 0 }
          }
        ]
      })

      const response = await vote(remoteQuestionId, { choices: ['0'] })

      expect(response.status).toBe(200)
      expect(mockGetNote).toHaveBeenCalledWith(
        expect.objectContaining({ statusId: remoteQuestionId })
      )
      const stored = await database.getStatus({
        statusId: remoteQuestionId,
        withReplies: false
      })
      expect(stored?.type).toBe(StatusType.enum.Poll)
      if (stored?.type !== StatusType.enum.Poll) {
        throw new Error('Expected poll status')
      }
      expect(stored.choices.map((choice) => choice.title)).toEqual([
        'yes',
        'no'
      ])
      expect(stored.choices.map((choice) => choice.totalVotes)).toEqual([1, 0])
      expect(mockSendPollVotes).toHaveBeenCalledTimes(1)
    })

    it('returns 404 for an unstored remote non-Question Note', async () => {
      const remoteNoteId = `${REMOTE_ACTOR_ID}/statuses/remote-note-1`
      mockGetNote.mockResolvedValueOnce({
        id: remoteNoteId,
        type: 'Note',
        attributedTo: REMOTE_ACTOR_ID,
        content: 'just a note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        published: new Date(Date.now() - 60_000).toISOString()
      })

      const response = await vote(remoteNoteId, { choices: ['0'] })

      expect(response.status).toBe(404)
      const stored = await database.getStatus({
        statusId: remoteNoteId,
        withReplies: false
      })
      expect(stored).toBeNull()
      expect(mockSendPollVotes).not.toHaveBeenCalled()
    })

    it('returns 422 for an unstored remote expired Question', async () => {
      const remoteExpiredQuestionId = `${REMOTE_ACTOR_ID}/statuses/remote-expired-question-1`
      mockGetNote.mockResolvedValueOnce({
        id: remoteExpiredQuestionId,
        type: 'Question',
        attributedTo: REMOTE_ACTOR_ID,
        content: 'expired question',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        published: new Date(Date.now() - 86400_000).toISOString(),
        endTime: new Date(Date.now() - 1000).toISOString(),
        oneOf: [
          {
            type: 'Note',
            name: 'yes',
            replies: { type: 'Collection', totalItems: 0 }
          },
          {
            type: 'Note',
            name: 'no',
            replies: { type: 'Collection', totalItems: 0 }
          }
        ]
      })

      const response = await vote(remoteExpiredQuestionId, { choices: ['0'] })

      expect(response.status).toBe(422)
      await expectNoVotes(remoteExpiredQuestionId)
      expect(mockSendPollVotes).not.toHaveBeenCalled()
    })

    it('returns 404 with nothing stored for an unstored remote followers-only Question', async () => {
      const remoteFollowersQuestionId = `${REMOTE_ACTOR_ID}/statuses/remote-followers-question-1`
      mockGetNote.mockResolvedValueOnce({
        id: remoteFollowersQuestionId,
        type: 'Question',
        attributedTo: REMOTE_ACTOR_ID,
        content: 'followers only question',
        to: [`${REMOTE_ACTOR_ID}/followers`],
        cc: [],
        published: new Date(Date.now() - 60_000).toISOString(),
        endTime: new Date(Date.now() + 86400_000).toISOString(),
        oneOf: [
          {
            type: 'Note',
            name: 'yes',
            replies: { type: 'Collection', totalItems: 0 }
          },
          {
            type: 'Note',
            name: 'no',
            replies: { type: 'Collection', totalItems: 0 }
          }
        ]
      })

      const response = await vote(remoteFollowersQuestionId, { choices: ['0'] })

      expect(response.status).toBe(404)
      const stored = await database.getStatus({
        statusId: remoteFollowersQuestionId,
        withReplies: false
      })
      expect(stored).toBeNull()
      expect(mockSendPollVotes).not.toHaveBeenCalled()
    })
  })
})

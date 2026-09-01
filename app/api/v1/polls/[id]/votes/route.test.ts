import { NextRequest } from 'next/server'

import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const POLL_ID = 'https://llun.test/users/llun/statuses/poll-1'

const mockDatabase = {
  getStatus: vi.fn(),
  recordPollVotes: vi.fn()
}
const mockCurrentActor = { id: 'https://llun.test/users/llun' }

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<{ id: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

vi.mock('@/lib/activities', () => ({
  sendPollVotes: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/statusAccess', () => ({
  canActorReadStatus: vi.fn().mockResolvedValue(true)
}))

const mockGetMastodonStatus = vi.fn()
vi.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatus: (...params: unknown[]) => mockGetMastodonStatus(...params)
}))

const mockSyncRemotePoll = vi.fn()
vi.mock('@/lib/services/polls/syncRemotePoll', () => ({
  syncRemotePoll: (...params: unknown[]) => mockSyncRemotePoll(...params)
}))

const createRequest = (body: unknown) =>
  new NextRequest(`https://llun.test/api/v1/polls/${urlToId(POLL_ID)}/votes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

describe('POST /api/v1/polls/[id]/votes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getStatus.mockResolvedValue({
      id: POLL_ID,
      type: 'Poll',
      pollType: 'multiple',
      endAt: Date.now() + 60_000,
      choices: [{ title: 'a' }, { title: 'b' }]
    })
    mockDatabase.recordPollVotes.mockResolvedValue(true)
    mockGetMastodonStatus.mockResolvedValue({ poll: { id: 'poll-1' } })
    mockSyncRemotePoll.mockImplementation(({ status }) => status)
  })

  it.each([
    {
      description: 'accepts string choices in JSON bodies (documented form)',
      body: { choices: ['1'] },
      expected: [1]
    },
    {
      description: 'accepts numeric choices in JSON bodies',
      body: { choices: [0, 1] },
      expected: [0, 1]
    }
  ])('$description', async ({ body, expected }) => {
    const response = await POST(createRequest(body), {
      params: Promise.resolve({ id: urlToId(POLL_ID) })
    })
    expect(response.status).toBe(200)
    expect(mockDatabase.recordPollVotes).toHaveBeenCalledWith({
      statusId: POLL_ID,
      actorId: mockCurrentActor.id,
      choices: expected
    })
  })

  it('serializes the locally-updated status without a post-vote remote sync', async () => {
    const votedStatus = {
      id: POLL_ID,
      type: 'Poll',
      pollType: 'multiple',
      endAt: Date.now() + 60_000,
      choices: [
        { title: 'a', totalVotes: 1 },
        { title: 'b', totalVotes: 0 }
      ]
    }
    mockDatabase.getStatus
      .mockResolvedValueOnce({
        id: POLL_ID,
        type: 'Poll',
        pollType: 'multiple',
        endAt: Date.now() + 60_000,
        choices: [{ title: 'a' }, { title: 'b' }]
      })
      .mockResolvedValueOnce(votedStatus)

    // A revert of the fix would pass this stale, vote-less status to
    // getMastodonStatus instead of the locally-voted one below.
    mockSyncRemotePoll.mockResolvedValue({
      ...votedStatus,
      choices: [
        { title: 'a', totalVotes: 0 },
        { title: 'b', totalVotes: 0 }
      ]
    })

    const response = await POST(createRequest({ choices: ['0'] }), {
      params: Promise.resolve({ id: urlToId(POLL_ID) })
    })

    expect(response.status).toBe(200)
    expect(mockSyncRemotePoll).not.toHaveBeenCalled()
    expect(mockGetMastodonStatus).toHaveBeenCalledWith(
      mockDatabase,
      votedStatus,
      mockCurrentActor.id
    )
  })

  it('still rejects non-numeric choices', async () => {
    const response = await POST(createRequest({ choices: ['abc'] }), {
      params: Promise.resolve({ id: urlToId(POLL_ID) })
    })
    expect(response.status).toBe(422)
    expect(mockDatabase.recordPollVotes).not.toHaveBeenCalled()
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
      // Number() maps '', ' ', null, false and [] all to 0, so blanket coercion
      // would silently record a vote for the first option. These must 422,
      // matching the form-body path.
      const response = await POST(createRequest({ choices: [choice] }), {
        params: Promise.resolve({ id: urlToId(POLL_ID) })
      })
      expect(response.status).toBe(422)
      expect(mockDatabase.recordPollVotes).not.toHaveBeenCalled()
    }
  )
})

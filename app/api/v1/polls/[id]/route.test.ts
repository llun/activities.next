import { NextRequest } from 'next/server'

import { StatusType } from '@/lib/types/domain/status'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'
import { POST } from './votes/route'

const mockGetMastodonStatus = vi.fn()
const mockSendPollVotes = vi.fn()
const mockCanActorReadStatus = vi.fn()
const mockDatabase = {
  getStatus: vi.fn(),
  createPollAnswer: vi.fn(),
  incrementPollChoiceVotes: vi.fn(),
  recordPollVotes: vi.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
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
      }),
  OptionalOAuthGuard:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor | null
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

vi.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatus: (...params: unknown[]) => mockGetMastodonStatus(...params)
}))

vi.mock('@/lib/services/statusAccess', () => ({
  canActorReadStatus: (...params: unknown[]) =>
    mockCanActorReadStatus(...params)
}))

vi.mock('@/lib/activities', () => ({
  sendPollVotes: (...params: unknown[]) => mockSendPollVotes(...params)
}))

const pollStatusId = 'https://remote.test/users/alice/statuses/poll-1'
const encodedPollId = urlToId(pollStatusId)
const pollStatus = {
  id: pollStatusId,
  type: StatusType.enum.Poll,
  endAt: Date.now() + 60_000,
  pollType: 'oneOf',
  choices: [{ title: 'Red' }, { title: 'Blue' }]
}
const mastodonPoll = {
  id: encodedPollId,
  expires_at: '2026-01-01T00:00:00.000Z',
  expired: false,
  multiple: false,
  votes_count: 0,
  voters_count: 0,
  options: [],
  emojis: [],
  voted: false,
  own_votes: []
}

describe('Mastodon poll routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getStatus.mockResolvedValue(pollStatus)
    mockDatabase.recordPollVotes.mockResolvedValue(true)
    mockGetMastodonStatus.mockResolvedValue({ poll: mastodonPoll })
    mockCanActorReadStatus.mockResolvedValue(true)
  })

  it('returns a Mastodon poll entity', async () => {
    const response = await GET(
      new NextRequest(`https://local.test/api/v1/polls/${encodedPollId}`),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.getStatus).toHaveBeenCalledWith({
      statusId: pollStatusId,
      currentActorId: mockCurrentActor.id,
      withReplies: false
    })
    expect(mockCanActorReadStatus).toHaveBeenCalledWith({
      database: mockDatabase,
      status: pollStatus,
      currentActor: mockCurrentActor
    })
    expect(await response.json()).toEqual(mastodonPoll)
  })

  it('accepts form-encoded Mastodon poll votes', async () => {
    mockDatabase.getStatus.mockResolvedValue({
      ...pollStatus,
      pollType: 'anyOf'
    })

    const response = await POST(
      new NextRequest(
        `https://local.test/api/v1/polls/${encodedPollId}/votes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams([
            ['choices', '9'],
            ['choices[]', '0'],
            ['choices[]', '1']
          ])
        }
      ),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.recordPollVotes).toHaveBeenCalledWith({
      statusId: pollStatusId,
      actorId: mockCurrentActor.id,
      choices: [0, 1]
    })
  })

  it('rejects oversized poll vote choice arrays', async () => {
    const response = await POST(
      new NextRequest(
        `https://local.test/api/v1/polls/${encodedPollId}/votes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            choices: Array.from({ length: 21 }, (_, index) => index)
          })
        }
      ),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(422)
    expect(mockDatabase.recordPollVotes).not.toHaveBeenCalled()
  })

  it('returns not found when the poll status does not exist', async () => {
    mockDatabase.getStatus.mockResolvedValue(null)

    const response = await GET(
      new NextRequest(`https://local.test/api/v1/polls/${encodedPollId}`),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(404)
    expect(mockCanActorReadStatus).not.toHaveBeenCalled()
  })

  it('returns not found when the status is not a poll', async () => {
    mockDatabase.getStatus.mockResolvedValue({
      ...pollStatus,
      type: StatusType.enum.Note
    })

    const response = await GET(
      new NextRequest(`https://local.test/api/v1/polls/${encodedPollId}`),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(404)
    expect(mockCanActorReadStatus).not.toHaveBeenCalled()
  })

  it('returns a server error when the Mastodon status has no poll payload', async () => {
    mockGetMastodonStatus.mockResolvedValue({ poll: null })

    const response = await GET(
      new NextRequest(`https://local.test/api/v1/polls/${encodedPollId}`),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(500)
  })

  it('records poll votes and returns the updated Mastodon poll entity', async () => {
    const response = await POST(
      new NextRequest(
        `https://local.test/api/v1/polls/${encodedPollId}/votes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ choices: [0] })
        }
      ),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.recordPollVotes).toHaveBeenCalledWith({
      statusId: pollStatusId,
      actorId: mockCurrentActor.id,
      choices: [0]
    })
    expect(mockSendPollVotes).toHaveBeenCalledWith({
      currentActor: mockCurrentActor,
      status: pollStatus,
      choices: [0]
    })
    expect(await response.json()).toEqual(mastodonPoll)
  })

  it('rejects malformed poll vote JSON without throwing', async () => {
    const response = await POST(
      new NextRequest(
        `https://local.test/api/v1/polls/${encodedPollId}/votes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{'
        }
      ),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(400)
    expect(mockDatabase.recordPollVotes).not.toHaveBeenCalled()
  })

  it('deduplicates and bounds-checks submitted poll choices before recording', async () => {
    const response = await POST(
      new NextRequest(
        `https://local.test/api/v1/polls/${encodedPollId}/votes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ choices: [0, 0] })
        }
      ),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.recordPollVotes).toHaveBeenCalledWith({
      statusId: pollStatusId,
      actorId: mockCurrentActor.id,
      choices: [0]
    })

    const invalidChoiceResponse = await POST(
      new NextRequest(
        `https://local.test/api/v1/polls/${encodedPollId}/votes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ choices: [2] })
        }
      ),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(invalidChoiceResponse.status).toBe(422)
    expect(mockDatabase.recordPollVotes).toHaveBeenCalledTimes(1)
  })

  it('rejects expired poll votes', async () => {
    mockDatabase.getStatus.mockResolvedValue({
      ...pollStatus,
      endAt: Date.now() - 1_000
    })

    const response = await POST(
      new NextRequest(
        `https://local.test/api/v1/polls/${encodedPollId}/votes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ choices: [0] })
        }
      ),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(422)
    expect(mockDatabase.recordPollVotes).not.toHaveBeenCalled()
  })

  it('rejects multiple choices for single-choice polls', async () => {
    const response = await POST(
      new NextRequest(
        `https://local.test/api/v1/polls/${encodedPollId}/votes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ choices: [0, 1] })
        }
      ),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(422)
    expect(mockDatabase.recordPollVotes).not.toHaveBeenCalled()
  })

  it('rejects repeat votes for every poll type', async () => {
    mockDatabase.recordPollVotes.mockResolvedValue(false)
    mockDatabase.getStatus.mockResolvedValue({
      ...pollStatus,
      pollType: 'anyOf'
    })

    const response = await POST(
      new NextRequest(
        `https://local.test/api/v1/polls/${encodedPollId}/votes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ choices: [0, 1] })
        }
      ),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(422)
    expect(mockDatabase.recordPollVotes).toHaveBeenCalledWith({
      statusId: pollStatusId,
      actorId: mockCurrentActor.id,
      choices: [0, 1]
    })
  })

  it('does not expose polls from unreadable statuses', async () => {
    mockCanActorReadStatus.mockResolvedValue(false)

    const response = await GET(
      new NextRequest(`https://local.test/api/v1/polls/${encodedPollId}`),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(404)
    expect(mockGetMastodonStatus).not.toHaveBeenCalled()
  })
})

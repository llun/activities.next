import { NextRequest } from 'next/server'

import { StatusType } from '@/lib/types/domain/status'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'
import { POST } from './votes/route'

const mockGetMastodonStatus = jest.fn()
const mockSendPollVotes = jest.fn()
const mockDatabase = {
  getStatus: jest.fn(),
  hasActorVoted: jest.fn(),
  createPollAnswer: jest.fn(),
  incrementPollChoiceVotes: jest.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
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
      })
}))

jest.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatus: (...params: unknown[]) => mockGetMastodonStatus(...params)
}))

jest.mock('@/lib/activities', () => ({
  sendPollVotes: (...params: unknown[]) => mockSendPollVotes(...params)
}))

const pollStatusId = 'https://remote.test/users/alice/statuses/poll-1'
const encodedPollId = urlToId(pollStatusId)
const pollStatus = {
  id: pollStatusId,
  type: StatusType.enum.Poll,
  endAt: Date.now() + 60_000,
  pollType: 'oneOf'
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
    jest.clearAllMocks()
    mockDatabase.getStatus.mockResolvedValue(pollStatus)
    mockDatabase.hasActorVoted.mockResolvedValue(false)
    mockGetMastodonStatus.mockResolvedValue({ poll: mastodonPoll })
  })

  it('returns a Mastodon poll entity', async () => {
    const response = await GET(
      new NextRequest(`https://local.test/api/v1/polls/${encodedPollId}`),
      { params: Promise.resolve({ id: encodedPollId }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.getStatus).toHaveBeenCalledWith({
      statusId: pollStatusId,
      withReplies: false
    })
    expect(await response.json()).toEqual(mastodonPoll)
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
    expect(mockDatabase.createPollAnswer).toHaveBeenCalledWith({
      statusId: pollStatusId,
      actorId: mockCurrentActor.id,
      choice: 0
    })
    expect(mockDatabase.incrementPollChoiceVotes).toHaveBeenCalledWith({
      statusId: pollStatusId,
      choiceIndex: 0
    })
    expect(mockSendPollVotes).toHaveBeenCalledWith({
      currentActor: mockCurrentActor,
      status: pollStatus,
      choices: [0]
    })
    expect(await response.json()).toEqual(mastodonPoll)
  })
})

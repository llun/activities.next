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

vi.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatus: vi.fn().mockResolvedValue({ poll: { id: 'poll-1' } })
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

  it('still rejects non-numeric choices', async () => {
    const response = await POST(createRequest({ choices: ['abc'] }), {
      params: Promise.resolve({ id: urlToId(POLL_ID) })
    })
    expect(response.status).toBe(422)
    expect(mockDatabase.recordPollVotes).not.toHaveBeenCalled()
  })

  it.each([
    { description: 'an empty string choice', choice: '' },
    { description: 'a whitespace-only choice', choice: ' ' }
  ])(
    'rejects $description instead of voting for option 0',
    async ({ choice }) => {
      // Number('') === 0, so plain coercion would silently record a vote for
      // the first option. Blank input must 422, matching the form-body path.
      const response = await POST(createRequest({ choices: [choice] }), {
        params: Promise.resolve({ id: urlToId(POLL_ID) })
      })
      expect(response.status).toBe(422)
      expect(mockDatabase.recordPollVotes).not.toHaveBeenCalled()
    }
  )
})

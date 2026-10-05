import { NextRequest } from 'next/server'

import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { POST } from './route'

const mockSendPollVotes = vi.fn()
const mockSyncRemotePoll = vi.fn()
const mockDatabase = {
  getStatus: vi.fn(),
  recordPollVotes: vi.fn(),
  getAcceptedOrRequestedFollow: vi.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<object>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<object> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

vi.mock('@/lib/activities', () => ({
  sendPollVotes: (...params: unknown[]) => mockSendPollVotes(...params)
}))

vi.mock('@/lib/services/polls/syncRemotePoll', () => ({
  syncRemotePoll: (...params: unknown[]) => mockSyncRemotePoll(...params)
}))

const pollStatusId = 'https://remote.test/users/alice/statuses/poll-1'
const pollStatus = {
  id: pollStatusId,
  actorId: 'https://remote.test/users/alice',
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: [] as string[],
  type: StatusType.enum.Poll,
  endAt: Date.now() + 60_000,
  pollType: 'oneOf',
  choices: [
    { title: 'Red', totalVotes: 0 },
    { title: 'Blue', totalVotes: 0 }
  ]
}

describe('POST /api/v1/accounts/vote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getStatus.mockResolvedValue(pollStatus)
    mockDatabase.recordPollVotes.mockResolvedValue(true)
    mockDatabase.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    mockSyncRemotePoll.mockImplementation(({ status }) => status)
  })

  it('records votes, sends poll votes, and returns the locally-updated status without a post-vote remote sync', async () => {
    const updatedStatus = {
      ...pollStatus,
      choices: [
        { title: 'Red', totalVotes: 1 },
        { title: 'Blue', totalVotes: 0 }
      ]
    }
    mockDatabase.getStatus
      .mockResolvedValueOnce(pollStatus)
      .mockResolvedValueOnce(updatedStatus)

    // If the route synced from the remote here it would overwrite the local
    // tallies with a stale count that does not yet include the just-cast vote.
    // Stub the sync to return exactly that stale shape so a revert of the fix
    // (which restores the call) makes the response assertion below fail.
    const staleSyncedStatus = {
      ...pollStatus,
      choices: [
        { title: 'Red', totalVotes: 0 },
        { title: 'Blue', totalVotes: 0 }
      ]
    }
    mockSyncRemotePoll.mockResolvedValue(staleSyncedStatus)

    const response = await POST(
      new NextRequest('https://local.test/api/v1/accounts/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          statusId: pollStatusId,
          choices: [0]
        })
      }),
      { params: Promise.resolve({}) }
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
    // Design (a): no immediate post-vote sync — the voter's own vote survives
    // in the response, and reconciliation is deferred to the next poll GET.
    expect(mockSyncRemotePoll).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({ status: updatedStatus })
  })

  it('rejects invalid choice indices', async () => {
    const response = await POST(
      new NextRequest('https://local.test/api/v1/accounts/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          statusId: pollStatusId,
          choices: [5]
        })
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(422)
    expect(mockDatabase.recordPollVotes).not.toHaveBeenCalled()
  })

  it('returns 404 if poll status is not found', async () => {
    mockDatabase.getStatus.mockResolvedValueOnce(null)

    const response = await POST(
      new NextRequest('https://local.test/api/v1/accounts/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          statusId: pollStatusId,
          choices: [0]
        })
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(404)
  })

  it.each([
    [
      'a followers-only poll the voter does not follow',
      { to: ['https://remote.test/users/alice/followers'], cc: [] }
    ],
    [
      'a direct poll not addressed to the voter',
      { to: ['https://remote.test/users/bob'], cc: [] }
    ]
  ])('answers 404 and records nothing for %s', async (_, audience) => {
    mockDatabase.getStatus.mockResolvedValueOnce({
      ...pollStatus,
      ...audience
    })

    const response = await POST(
      new NextRequest('https://local.test/api/v1/accounts/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statusId: pollStatusId, choices: [0] })
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(404)
    expect(mockDatabase.recordPollVotes).not.toHaveBeenCalled()
    expect(mockSendPollVotes).not.toHaveBeenCalled()
  })
})

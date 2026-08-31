import { NextRequest } from 'next/server'

import { StatusType } from '@/lib/types/domain/status'

import { POST } from './route'

const mockSendPollVotes = vi.fn()
const mockSyncRemotePoll = vi.fn()
const mockDatabase = {
  getStatus: vi.fn(),
  recordPollVotes: vi.fn()
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
    mockSyncRemotePoll.mockImplementation(({ status }) => status)
  })

  it('records votes, sends poll votes, syncs remote poll, and returns updated status', async () => {
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

    const syncedStatus = {
      ...pollStatus,
      choices: [
        { title: 'Red', totalVotes: 10 },
        { title: 'Blue', totalVotes: 5 }
      ]
    }
    mockSyncRemotePoll.mockResolvedValueOnce(syncedStatus)

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
    expect(mockSyncRemotePoll).toHaveBeenCalledWith({
      database: mockDatabase,
      status: updatedStatus
    })
    expect(await response.json()).toEqual({ status: syncedStatus })
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
})

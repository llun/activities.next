import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getRemoteStatus } from '@/lib/activities/getRemoteStatus'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { resolveStatusForSearch } from './resolveStatus'

jest.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: jest.fn()
}))

jest.mock('@/lib/activities/getRemoteStatus', () => ({
  getRemoteStatus: jest.fn()
}))

jest.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: jest.fn()
}))

jest.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: jest.fn()
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: jest.fn()
  }
}))

describe('resolveStatusForSearch', () => {
  const mockCanFederateWithDomain =
    canFederateWithDomain as jest.MockedFunction<typeof canFederateWithDomain>
  const mockGetFederationSigningActor =
    getFederationSigningActor as jest.MockedFunction<
      typeof getFederationSigningActor
    >
  const mockGetRemoteStatus = getRemoteStatus as jest.MockedFunction<
    typeof getRemoteStatus
  >
  const mockRecordActorIfNeeded = recordActorIfNeeded as jest.MockedFunction<
    typeof recordActorIfNeeded
  >

  beforeEach(() => {
    jest.clearAllMocks()
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockGetFederationSigningActor.mockResolvedValue(null)
  })

  it('checks federation policy using the status hostname', async () => {
    const database = {
      getStatus: jest.fn().mockResolvedValue(null),
      getStatusFromUrl: jest.fn().mockResolvedValue(null)
    }
    mockCanFederateWithDomain.mockResolvedValue(false)

    await expect(
      resolveStatusForSearch({
        database: database as never,
        query: 'https://remote.test/@alice/statuses/1'
      })
    ).resolves.toBeNull()

    expect(mockCanFederateWithDomain).toHaveBeenCalledWith(
      database,
      'remote.test'
    )
    expect(mockGetRemoteStatus).not.toHaveBeenCalled()
  })

  it('persists searchable remote polls as polls', async () => {
    const endAt = Date.now() + 60_000
    const createdAt = Date.now()
    const remotePoll = {
      id: 'https://remote.test/statuses/poll-1',
      url: 'https://remote.test/@alice/poll/1',
      actorId: 'https://remote.test/users/alice',
      type: StatusType.enum.Poll,
      text: 'Remote poll',
      summary: null,
      reply: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      choices: [
        {
          statusId: 'https://remote.test/statuses/poll-1',
          title: 'One',
          totalVotes: 3,
          createdAt,
          updatedAt: createdAt
        },
        {
          statusId: 'https://remote.test/statuses/poll-1',
          title: 'Two',
          totalVotes: 1,
          createdAt,
          updatedAt: createdAt
        }
      ],
      endAt,
      pollType: 'oneOf',
      createdAt
    }
    const database = {
      getStatus: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(remotePoll),
      getStatusFromUrl: jest.fn().mockResolvedValue(null),
      createPoll: jest.fn().mockResolvedValue(remotePoll),
      upsertStatusSearchDocument: jest.fn()
    }
    mockRecordActorIfNeeded.mockResolvedValue({
      id: remotePoll.actorId
    } as never)
    mockGetRemoteStatus.mockResolvedValue(remotePoll as never)

    await expect(
      resolveStatusForSearch({
        database: database as never,
        query: 'https://remote.test/@alice/poll/1'
      })
    ).resolves.toBe(remotePoll)

    expect(database.createPoll).toHaveBeenCalledWith({
      id: remotePoll.id,
      url: remotePoll.url,
      actorId: remotePoll.actorId,
      text: remotePoll.text,
      summary: '',
      to: remotePoll.to,
      cc: remotePoll.cc,
      reply: remotePoll.reply,
      choices: ['One', 'Two'],
      endAt,
      pollType: 'oneOf',
      createdAt
    })
    expect(mockRecordActorIfNeeded).toHaveBeenCalledWith({
      actorId: remotePoll.actorId,
      database,
      signingActor: undefined
    })
    expect(database.upsertStatusSearchDocument).toHaveBeenCalledWith({
      statusId: remotePoll.id
    })
  })
})

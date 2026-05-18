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

  it('does not persist remote polls as notes', async () => {
    const database = {
      getStatus: jest.fn().mockResolvedValue(null),
      getStatusFromUrl: jest.fn().mockResolvedValue(null),
      createNote: jest.fn(),
      upsertStatusSearchDocument: jest.fn()
    }
    mockGetRemoteStatus.mockResolvedValue({
      id: 'https://remote.test/statuses/poll-1',
      url: 'https://remote.test/@alice/poll/1',
      actorId: 'https://remote.test/users/alice',
      type: StatusType.enum.Poll,
      text: 'Remote poll',
      summary: null,
      reply: '',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      choices: [],
      endAt: Date.now() + 60_000,
      pollType: 'oneOf',
      createdAt: Date.now()
    } as never)

    await expect(
      resolveStatusForSearch({
        database: database as never,
        query: 'https://remote.test/@alice/poll/1'
      })
    ).resolves.toBeNull()

    expect(database.createNote).not.toHaveBeenCalled()
    expect(mockRecordActorIfNeeded).not.toHaveBeenCalled()
    expect(database.upsertStatusSearchDocument).not.toHaveBeenCalled()
  })
})

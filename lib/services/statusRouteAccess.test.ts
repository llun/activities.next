import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'

import { canActorReadStatus, isStatusPubliclyReadable } from './statusAccess'
import { filterReadableStatuses } from './statusRouteAccess'

jest.mock('./statusAccess', () => ({
  canActorReadStatus: jest.fn(),
  isStatusPubliclyReadable: jest.fn()
}))

const createStatus = (id: string) =>
  ({
    id,
    actorId: 'https://example.com/users/alice'
  }) as Status

describe('filterReadableStatuses', () => {
  const getAcceptedFollowTargetActorIds = jest.fn()
  const database = { getAcceptedFollowTargetActorIds } as unknown as Database
  const currentActor = {
    id: 'https://example.com/users/bob'
  } as Actor

  beforeEach(() => {
    jest.clearAllMocks()
    getAcceptedFollowTargetActorIds.mockResolvedValue([
      'https://example.com/users/alice'
    ])
    ;(isStatusPubliclyReadable as jest.Mock).mockReturnValue(false)
    ;(canActorReadStatus as jest.Mock).mockResolvedValue(false)
  })

  it('does not run asynchronous access checks for public statuses', async () => {
    const publicStatus = createStatus('public')
    const privateStatus = createStatus('private')
    ;(isStatusPubliclyReadable as jest.Mock).mockImplementation(
      (status: Status) => status.id === publicStatus.id
    )
    ;(canActorReadStatus as jest.Mock).mockResolvedValue(true)

    const statuses = await filterReadableStatuses({
      database,
      statuses: [publicStatus, privateStatus],
      currentActor
    })

    expect(statuses).toEqual([publicStatus, privateStatus])
    expect(getAcceptedFollowTargetActorIds).toHaveBeenCalledWith({
      actorId: currentActor.id,
      targetActorIds: [privateStatus.actorId]
    })
    expect(canActorReadStatus).toHaveBeenCalledTimes(1)
    expect(canActorReadStatus).toHaveBeenCalledWith({
      database,
      status: privateStatus,
      currentActor,
      followerStateByActorId: new Map([[privateStatus.actorId, true]])
    })
  })

  it('returns only public statuses for anonymous readers', async () => {
    const publicStatus = createStatus('public')
    const privateStatus = createStatus('private')
    ;(isStatusPubliclyReadable as jest.Mock).mockImplementation(
      (status: Status) => status.id === publicStatus.id
    )

    const statuses = await filterReadableStatuses({
      database,
      statuses: [publicStatus, privateStatus],
      currentActor: null
    })

    expect(statuses).toEqual([publicStatus])
    expect(getAcceptedFollowTargetActorIds).not.toHaveBeenCalled()
    expect(canActorReadStatus).not.toHaveBeenCalled()
  })
})

import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { deleteStatus } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

jest.mock('@/lib/activities', () => ({
  deleteStatus: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('@/lib/services/federation/statusDelivery', () => ({
  getFederatedStatusDeliveryInboxes: jest
    .fn()
    .mockResolvedValue(['https://remote.test/inbox'])
}))

describe('deleteStatusFromUserInput', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('preserves direct status cc recipients on federated delete activities', async () => {
    const currentActor = {
      id: 'https://llun.test/users/me'
    } as Actor
    const status = {
      id: 'https://llun.test/users/me/statuses/direct-delete',
      to: ['https://remote.test/users/primary'],
      cc: ['https://remote.test/users/copied']
    } as Status
    const database = {
      getStatus: jest.fn().mockResolvedValue(status),
      deleteStatus: jest.fn().mockResolvedValue(undefined)
    } as unknown as Database

    await deleteStatusFromUserInput({
      currentActor,
      statusId: status.id,
      database
    })

    expect(getFederatedStatusDeliveryInboxes).toHaveBeenCalledWith({
      database,
      currentActor,
      status
    })
    expect(deleteStatus).toHaveBeenCalledWith({
      currentActor,
      inbox: 'https://remote.test/inbox',
      statusId: status.id,
      to: status.to,
      cc: status.cc
    })
  })
})

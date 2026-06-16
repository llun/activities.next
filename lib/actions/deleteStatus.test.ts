import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { deleteStatus } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

vi.mock('@/lib/activities', () => ({
  deleteStatus: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/federation/statusDelivery', () => ({
  getFederatedStatusDeliveryInboxes: vi
    .fn()
    .mockResolvedValue(['https://remote.test/inbox'])
}))

describe('deleteStatusFromUserInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves direct status cc recipients on federated delete activities', async () => {
    const currentActor = {
      id: 'https://llun.test/users/me'
    } as Actor
    const status = {
      id: 'https://llun.test/users/me/statuses/direct-delete',
      actorId: currentActor.id,
      to: ['https://remote.test/users/primary'],
      cc: ['https://remote.test/users/copied']
    } as Status
    const database = {
      getStatus: vi.fn().mockResolvedValue(status),
      deleteStatus: vi.fn().mockResolvedValue(undefined)
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
    expect(database.deleteStatus).toHaveBeenCalledWith({
      statusId: status.id,
      actorId: currentActor.id
    })
  })

  it('does not send or delete statuses owned by a different actor', async () => {
    const currentActor = {
      id: 'https://llun.test/users/me'
    } as Actor
    const status = {
      id: 'https://llun.test/users/other/statuses/delete-attempt',
      actorId: 'https://llun.test/users/other',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: []
    } as Status
    const database = {
      getStatus: vi.fn().mockResolvedValue(status),
      deleteStatus: vi.fn().mockResolvedValue(undefined)
    } as unknown as Database

    await deleteStatusFromUserInput({
      currentActor,
      statusId: status.id,
      database
    })

    expect(getFederatedStatusDeliveryInboxes).not.toHaveBeenCalled()
    expect(deleteStatus).not.toHaveBeenCalled()
    expect(database.deleteStatus).not.toHaveBeenCalled()
  })
})

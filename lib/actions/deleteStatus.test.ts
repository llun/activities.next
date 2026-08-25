import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { Database } from '@/lib/database/types'
import { SEND_DELETE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

const CURRENT_ACTOR = { id: 'https://llun.test/users/me' } as Actor

const createDatabase = (status: Status | null) =>
  ({
    getStatus: vi.fn().mockResolvedValue(status),
    deleteStatus: vi.fn().mockResolvedValue(undefined)
  }) as unknown as Database

describe('deleteStatusFromUserInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // vi.clearAllMocks() drops call history but keeps queued one-shot behaviour,
  // so an unconsumed mockRejectedValueOnce would fire inside a later test's
  // action and be swallowed by its catch.
  afterEach(() => {
    vi.mocked(getQueue().publish).mockReset().mockResolvedValue(undefined)
  })

  it('deletes the status locally before queueing the federation job', async () => {
    const status = {
      id: 'https://llun.test/users/me/statuses/direct-delete',
      actorId: CURRENT_ACTOR.id,
      to: ['https://remote.test/users/primary'],
      cc: ['https://remote.test/users/copied']
    } as Status
    const database = createDatabase(status)
    const publish = vi.mocked(getQueue().publish)

    await deleteStatusFromUserInput({
      currentActor: CURRENT_ACTOR,
      statusId: status.id,
      database
    })

    expect(database.deleteStatus).toHaveBeenCalledWith({
      statusId: status.id,
      actorId: CURRENT_ACTOR.id
    })
    expect(publish).toHaveBeenCalledWith({
      id: getHashFromString(`${status.id}#delete`),
      name: SEND_DELETE_NOTE_JOB_NAME,
      data: {
        actorId: CURRENT_ACTOR.id,
        statusId: status.id,
        to: status.to,
        cc: status.cc
      }
    })

    // The local delete has to win the race: the job resolves its delivery
    // targets from the payload precisely because the row is already gone.
    const deleteOrder = vi.mocked(database.deleteStatus).mock
      .invocationCallOrder[0]
    const publishOrder = publish.mock.invocationCallOrder[0]
    expect(deleteOrder).toBeLessThan(publishOrder)
  })

  it('does not delete or federate statuses owned by a different actor', async () => {
    const status = {
      id: 'https://llun.test/users/other/statuses/delete-attempt',
      actorId: 'https://llun.test/users/other',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: []
    } as Status
    const database = createDatabase(status)

    await deleteStatusFromUserInput({
      currentActor: CURRENT_ACTOR,
      statusId: status.id,
      database
    })

    expect(database.deleteStatus).not.toHaveBeenCalled()
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('does nothing when the status does not exist', async () => {
    const database = createDatabase(null)

    await deleteStatusFromUserInput({
      currentActor: CURRENT_ACTOR,
      statusId: 'https://llun.test/users/me/statuses/missing',
      database
    })

    expect(database.deleteStatus).not.toHaveBeenCalled()
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('keeps the local delete when queueing the federation job fails', async () => {
    const status = {
      id: 'https://llun.test/users/me/statuses/queue-failure',
      actorId: CURRENT_ACTOR.id,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: []
    } as Status
    const database = createDatabase(status)
    vi.mocked(getQueue().publish).mockRejectedValueOnce(
      new Error('Queue unavailable')
    )

    await expect(
      deleteStatusFromUserInput({
        currentActor: CURRENT_ACTOR,
        statusId: status.id,
        database
      })
    ).resolves.toBeUndefined()

    expect(vi.mocked(getQueue().publish)).toHaveBeenCalledTimes(1)
    expect(database.deleteStatus).toHaveBeenCalledWith({
      statusId: status.id,
      actorId: CURRENT_ACTOR.id
    })
  })
})

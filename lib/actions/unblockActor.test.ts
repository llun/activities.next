import type { Database } from '@/lib/database/types'
import { SEND_UNBLOCK_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import type { Actor } from '@/lib/types/domain/actor'

import { unblockActor } from './unblockActor'

vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))

describe('unblockActor', () => {
  const currentActor = { id: 'https://personal.example/users/alice' } as Actor
  const publish = vi.fn()
  const database = {
    getBlock: vi.fn(),
    getActorFromId: vi.fn(),
    deleteBlock: vi.fn()
  }
  const unblock = (targetActorId: string) =>
    unblockActor({
      database: database as unknown as Database,
      currentActor,
      targetActorId
    })

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getQueue).mockReturnValue({ publish } as never)
    publish.mockResolvedValue(undefined)
    database.getBlock.mockImplementation(async ({ targetActorId }) => ({
      id: 'block-1',
      actorId: currentActor.id,
      targetActorId,
      uri: `${currentActor.id}#blocks/1`
    }))
  })

  it('queues the federated Undo for an ActivityPub account', async () => {
    expect(await unblock('https://remote.example/users/bob')).toBe(true)

    expect(database.deleteBlock).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: SEND_UNBLOCK_JOB_NAME })
    )
  })

  it('unblocks a Bluesky account locally without queueing an Undo', async () => {
    const targetActorId =
      'https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx'

    expect(await unblock(targetActorId)).toBe(true)

    expect(database.deleteBlock).toHaveBeenCalledWith({
      actorId: currentActor.id,
      targetActorId
    })
    expect(publish).not.toHaveBeenCalled()
  })
})

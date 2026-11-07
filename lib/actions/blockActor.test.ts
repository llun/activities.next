import { recordActorIfNeeded } from '@/lib/actions/utils'
import type { Database } from '@/lib/database/types'
import {
  SEND_BLOCK_JOB_NAME,
  SEND_UNDO_FOLLOW_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import type { Actor } from '@/lib/types/domain/actor'
import { BLUESKY_BRIDGE_ACTOR_ID } from '@/lib/utils/blueskySharing'

import { blockActor } from './blockActor'

vi.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: vi.fn(),
  BlockedFederationDomainError: class extends Error {}
}))
vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))

describe('blockActor', () => {
  const currentActor = {
    id: 'https://personal.example/users/alice',
    privateKey: 'key'
  } as Actor
  const bot = { id: BLUESKY_BRIDGE_ACTOR_ID } as Actor
  const publish = vi.fn()
  const database = {
    getActorFromId: vi.fn(),
    createBlock: vi.fn(),
    getAcceptedOrRequestedFollow: vi.fn(),
    updateFollowStatus: vi.fn()
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getQueue).mockReturnValue({ publish } as never)
    publish.mockResolvedValue(undefined)
    database.getActorFromId.mockImplementation(async ({ id }) =>
      id === bot.id ? bot : currentActor
    )
    database.createBlock.mockImplementation(async (input) => input)
    database.getAcceptedOrRequestedFollow.mockImplementation(
      async ({ actorId, targetActorId }) => ({
        id: actorId === currentActor.id ? 'outgoing' : 'incoming',
        actorId,
        targetActorId,
        status: 'Accepted'
      })
    )
  })

  it('blocks a stored bot without discovery or policy refresh and undoes follows in both directions', async () => {
    const result = await blockActor({
      database: database as unknown as Database,
      currentActor,
      requestedActorId: bot.id
    })
    expect(result).toEqual({ type: 'ok', targetActorId: bot.id })
    expect(recordActorIfNeeded).not.toHaveBeenCalled()
    expect(database.createBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: currentActor.id,
        targetActorId: bot.id
      })
    )
    expect(database.updateFollowStatus).toHaveBeenCalledWith({
      followId: 'outgoing',
      status: 'Undo'
    })
    expect(database.updateFollowStatus).toHaveBeenCalledWith({
      followId: 'incoming',
      status: 'Undo'
    })
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ name: SEND_BLOCK_JOB_NAME })
    )
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: SEND_UNDO_FOLLOW_JOB_NAME,
        data: expect.objectContaining({ actorId: currentActor.id })
      })
    )
  })

  it('still resolves an unknown target through the existing guarded recording flow', async () => {
    database.getActorFromId.mockResolvedValue(null)
    vi.mocked(recordActorIfNeeded).mockResolvedValue(bot)
    await blockActor({
      database: database as unknown as Database,
      currentActor,
      requestedActorId: bot.id
    })
    expect(recordActorIfNeeded).toHaveBeenCalledWith({
      database,
      actorId: bot.id
    })
  })
})

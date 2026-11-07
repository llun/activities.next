import type { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import type { Actor } from '@/lib/types/domain/actor'
import { BLUESKY_BRIDGE_ACTOR_ID } from '@/lib/utils/blueskySharing'

import { getBlueskySharingState } from './blueskySharing'

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))

describe('stored Bluesky sharing state', () => {
  const database = {
    getActorFromUsername: vi.fn(),
    getActorFromId: vi.fn(),
    getAcceptedOrRequestedFollow: vi.fn(),
    getBlock: vi.fn()
  }
  const actor = {
    id: 'https://other.example/users/alice',
    username: 'alice',
    domain: 'other.example',
    name: 'Alice Example',
    iconUrl: 'avatar'
  } as Actor

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(canFederateWithDomain).mockResolvedValue(true)
  })

  it.each([
    [undefined, undefined, 'Off'],
    ['Requested', undefined, 'Setting up'],
    ['Accepted', undefined, 'On'],
    ['Accepted', {}, 'Off']
  ] as const)(
    'derives %s / block=%s from local rows',
    async (status, block, expected) => {
      database.getAcceptedOrRequestedFollow.mockResolvedValue(
        status ? { status } : null
      )
      database.getBlock.mockResolvedValue(block)
      const state = await getBlueskySharingState(
        database as unknown as Database,
        actor
      )
      expect(state.status).toBe(expected)
      expect(state.handle).toBe('alice.other.example.ap.brid.gy')
      expect(database.getActorFromId).toHaveBeenCalledWith({
        id: BLUESKY_BRIDGE_ACTOR_ID
      })
      expect(database.getBlock).toHaveBeenCalledWith({
        actorId: actor.id,
        targetActorId: BLUESKY_BRIDGE_ACTOR_ID
      })
    }
  )

  it('uses the stored bot and reports instance policy without contacting the network', async () => {
    database.getActorFromUsername.mockResolvedValue({
      id: BLUESKY_BRIDGE_ACTOR_ID
    })
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)
    const state = await getBlueskySharingState(
      database as unknown as Database,
      actor
    )
    expect(state.federationAllowed).toBe(false)
    expect(database.getActorFromId).not.toHaveBeenCalled()
    expect(database.getActorFromUsername).toHaveBeenCalledWith({
      username: 'bsky.brid.gy',
      domain: 'bsky.brid.gy'
    })
  })
})

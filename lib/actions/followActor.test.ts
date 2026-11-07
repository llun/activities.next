import { followActor } from '@/lib/actions/followActor'
import { recordActorIfNeeded } from '@/lib/actions/utils'
import { follow } from '@/lib/activities'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'

vi.mock('@/lib/activities', () => ({ follow: vi.fn() }))
vi.mock('@/lib/actions/utils', () => ({ recordActorIfNeeded: vi.fn() }))
vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn().mockResolvedValue(true)
}))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(null)
}))

describe('followActor', () => {
  const targetActorId = 'https://remote.test/users/bob'
  const currentActor = {
    id: 'https://llun.test/users/alice',
    domain: 'llun.test'
  } as Actor
  const database = {
    getAcceptedOrRequestedFollow: vi.fn(),
    createFollow: vi.fn(),
    updateFollowPreferences: vi.fn()
  }
  const run = () =>
    followActor({
      database: database as unknown as Database,
      currentActor,
      requestedActorId: targetActorId
    })

  beforeEach(() => {
    vi.clearAllMocks()
    database.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    database.createFollow.mockResolvedValue({ id: 'follow-id' })
    vi.mocked(recordActorIfNeeded).mockResolvedValue({
      id: targetActorId
    } as Actor)
  })

  it.each([true, false])(
    'reports whether a new Follow was delivered (%s)',
    async (delivered) => {
      vi.mocked(follow).mockResolvedValue(delivered)
      expect(await run()).toEqual({ type: 'ok', targetActorId, delivered })
    }
  )

  it('sends nothing and reports no delivery for an existing follow', async () => {
    database.getAcceptedOrRequestedFollow.mockResolvedValue({
      status: 'Requested'
    })
    expect(await run()).toEqual({ type: 'ok', targetActorId })
    expect(follow).not.toHaveBeenCalled()
  })
})

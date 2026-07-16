import { recordActorIfNeeded } from '@/lib/actions/utils'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'

import { refreshKnownRemoteActor } from './refreshRemoteActor'

vi.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: vi.fn()
}))

const mockDatabase = {} as Database

const remoteActor = {
  id: 'https://remote.example/users/actor',
  username: 'actor',
  domain: 'remote.example',
  account: null,
  privateKey: ''
} as unknown as Actor

describe('refreshKnownRemoteActor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes a remote actor and returns the refreshed value', async () => {
    const refreshedActor = { ...remoteActor, name: 'Refreshed' }
    ;(recordActorIfNeeded as jest.Mock).mockResolvedValue(refreshedActor)

    await expect(
      refreshKnownRemoteActor({ database: mockDatabase, actor: remoteActor })
    ).resolves.toBe(refreshedActor)
    expect(recordActorIfNeeded).toHaveBeenCalledWith({
      actorId: remoteActor.id,
      database: mockDatabase,
      signingActor: undefined
    })
  })

  it.each([
    {
      description: 'account-backed local actor',
      actor: {
        ...remoteActor,
        account: { id: 'account-id' }
      } as unknown as Actor
    },
    {
      description: 'actor carrying a private key (headless signer)',
      actor: { ...remoteActor, privateKey: 'private-key' } as unknown as Actor
    }
  ])('never refreshes an internal actor ($description)', async ({ actor }) => {
    await expect(
      refreshKnownRemoteActor({ database: mockDatabase, actor })
    ).resolves.toBe(actor)
    expect(recordActorIfNeeded).not.toHaveBeenCalled()
  })

  it('returns the stored actor when the refresh yields nothing', async () => {
    ;(recordActorIfNeeded as jest.Mock).mockResolvedValue(undefined)

    await expect(
      refreshKnownRemoteActor({ database: mockDatabase, actor: remoteActor })
    ).resolves.toBe(remoteActor)
  })

  it('returns the stored actor when the refresh fails', async () => {
    ;(recordActorIfNeeded as jest.Mock).mockRejectedValue(
      new Error('remote down')
    )

    await expect(
      refreshKnownRemoteActor({ database: mockDatabase, actor: remoteActor })
    ).resolves.toBe(remoteActor)
  })
})

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'

import {
  recordRemoteActorBestEffort,
  refreshKnownRemoteActor,
  resetRefreshRemoteActorStateForTesting
} from './refreshRemoteActor'

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

const FAILURE_COOLDOWN_MS = 5 * 60 * 1000
const REFRESH_WAIT_BUDGET_MS = 5_000

describe('refreshKnownRemoteActor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRefreshRemoteActorStateForTesting()
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('backs off after a failed refresh instead of retrying every request', async () => {
    ;(recordActorIfNeeded as jest.Mock).mockRejectedValue(
      new Error('remote down')
    )

    await refreshKnownRemoteActor({
      database: mockDatabase,
      actor: remoteActor
    })
    await expect(
      refreshKnownRemoteActor({ database: mockDatabase, actor: remoteActor })
    ).resolves.toBe(remoteActor)

    expect(recordActorIfNeeded).toHaveBeenCalledTimes(1)
  })

  it('treats an empty refresh result as a failure for the backoff', async () => {
    ;(recordActorIfNeeded as jest.Mock).mockResolvedValue(undefined)

    await refreshKnownRemoteActor({
      database: mockDatabase,
      actor: remoteActor
    })
    await refreshKnownRemoteActor({
      database: mockDatabase,
      actor: remoteActor
    })

    expect(recordActorIfNeeded).toHaveBeenCalledTimes(1)
  })

  it('retries a failed refresh once the cooldown expires', async () => {
    vi.useFakeTimers()
    ;(recordActorIfNeeded as jest.Mock).mockRejectedValue(
      new Error('remote down')
    )

    await refreshKnownRemoteActor({
      database: mockDatabase,
      actor: remoteActor
    })
    vi.advanceTimersByTime(FAILURE_COOLDOWN_MS + 1)
    await refreshKnownRemoteActor({
      database: mockDatabase,
      actor: remoteActor
    })

    expect(recordActorIfNeeded).toHaveBeenCalledTimes(2)
  })

  it('clears the failure backoff after a successful refresh', async () => {
    vi.useFakeTimers()
    const refreshedActor = { ...remoteActor, name: 'Refreshed' }
    ;(recordActorIfNeeded as jest.Mock)
      .mockRejectedValueOnce(new Error('remote down'))
      .mockResolvedValue(refreshedActor)

    await refreshKnownRemoteActor({
      database: mockDatabase,
      actor: remoteActor
    })
    vi.advanceTimersByTime(FAILURE_COOLDOWN_MS + 1)
    await refreshKnownRemoteActor({
      database: mockDatabase,
      actor: remoteActor
    })
    await refreshKnownRemoteActor({
      database: mockDatabase,
      actor: remoteActor
    })

    expect(recordActorIfNeeded).toHaveBeenCalledTimes(3)
  })

  it('shares a single in-flight refresh across concurrent requests', async () => {
    const refreshedActor = { ...remoteActor, name: 'Refreshed' }
    let resolveRefresh: (value: Actor) => void = () => {}
    ;(recordActorIfNeeded as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        })
    )

    const first = refreshKnownRemoteActor({
      database: mockDatabase,
      actor: remoteActor
    })
    const second = refreshKnownRemoteActor({
      database: mockDatabase,
      actor: remoteActor
    })
    resolveRefresh(refreshedActor)

    await expect(first).resolves.toBe(refreshedActor)
    await expect(second).resolves.toBe(refreshedActor)
    expect(recordActorIfNeeded).toHaveBeenCalledTimes(1)
  })

  it('serves the stored actor when the refresh exceeds the wait budget', async () => {
    vi.useFakeTimers()
    ;(recordActorIfNeeded as jest.Mock).mockImplementation(
      () => new Promise(() => {})
    )

    const pending = refreshKnownRemoteActor({
      database: mockDatabase,
      actor: remoteActor
    })
    await vi.advanceTimersByTimeAsync(REFRESH_WAIT_BUDGET_MS + 1)

    await expect(pending).resolves.toBe(remoteActor)
  })
})

describe('recordRemoteActorBestEffort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRefreshRemoteActorStateForTesting()
  })

  it('records and returns the remote actor', async () => {
    const recordedActor = { ...remoteActor, name: 'Recorded' }
    ;(recordActorIfNeeded as jest.Mock).mockResolvedValue(recordedActor)

    await expect(
      recordRemoteActorBestEffort({
        actorId: remoteActor.id,
        database: mockDatabase
      })
    ).resolves.toBe(recordedActor)
    expect(recordActorIfNeeded).toHaveBeenCalledWith({
      actorId: remoteActor.id,
      database: mockDatabase,
      signingActor: undefined
    })
  })

  it('returns null when recording yields nothing', async () => {
    ;(recordActorIfNeeded as jest.Mock).mockResolvedValue(undefined)

    await expect(
      recordRemoteActorBestEffort({
        actorId: remoteActor.id,
        database: mockDatabase
      })
    ).resolves.toBeNull()
  })

  it('returns null when recording fails', async () => {
    ;(recordActorIfNeeded as jest.Mock).mockRejectedValue(
      new Error('remote down')
    )

    await expect(
      recordRemoteActorBestEffort({
        actorId: remoteActor.id,
        database: mockDatabase
      })
    ).resolves.toBeNull()
  })
})

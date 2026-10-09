import { register } from '@/instrumentation'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { startActorDeletionSweep } from '@/lib/services/actors/actorDeletion'
import { startDatabaseQueueRunner } from '@/lib/services/queue/databaseRunner'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/actors/actorDeletion', () => ({
  startActorDeletionSweep: vi.fn()
}))

vi.mock('@/lib/services/queue/databaseRunner', () => ({
  startDatabaseQueueRunner: vi.fn()
}))

const mockGetConfig = vi.mocked(getConfig)
const mockGetDatabase = vi.mocked(getDatabase)
const database = { id: 'database' } as unknown as ReturnType<typeof getDatabase>

describe('register', () => {
  const originalRuntime = process.env.NEXT_RUNTIME

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_RUNTIME = 'nodejs'
    mockGetDatabase.mockReturnValue(database)
  })

  afterAll(() => {
    if (originalRuntime === undefined) {
      delete process.env.NEXT_RUNTIME
    } else {
      process.env.NEXT_RUNTIME = originalRuntime
    }
  })

  it('starts the actor deletion sweep under the in-process queue', async () => {
    // The sweep is the only thing that carries out a delayed actor deletion
    // when no real queue is configured.
    mockGetConfig.mockReturnValue({} as ReturnType<typeof getConfig>)

    await register()

    expect(startActorDeletionSweep).toHaveBeenCalledWith(database)
    expect(startDatabaseQueueRunner).not.toHaveBeenCalled()
  })

  it('starts both the database queue runner and the sweep for the database queue', async () => {
    mockGetConfig.mockReturnValue({
      queue: { type: 'database', pollIntervalMs: 1234 }
    } as ReturnType<typeof getConfig>)

    await register()

    expect(startDatabaseQueueRunner).toHaveBeenCalledWith(database, {
      pollIntervalMs: 1234
    })
    expect(startActorDeletionSweep).toHaveBeenCalledWith(database)
  })

  it('starts nothing without a database', async () => {
    mockGetConfig.mockReturnValue({
      queue: { type: 'database', pollIntervalMs: 1234 }
    } as ReturnType<typeof getConfig>)
    mockGetDatabase.mockReturnValue(null)

    await register()

    expect(startDatabaseQueueRunner).not.toHaveBeenCalled()
    expect(startActorDeletionSweep).not.toHaveBeenCalled()
  })

  it('starts nothing outside the Node.js runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    mockGetConfig.mockReturnValue({} as ReturnType<typeof getConfig>)

    await register()

    expect(startActorDeletionSweep).not.toHaveBeenCalled()
  })
})

import { getDatabase } from '@/lib/database'
import { startServedDomainRefresher } from '@/lib/services/domains/servedDomainSnapshot'
import { startDatabaseQueueRunner } from '@/lib/services/queue/databaseRunner'

vi.mock('@next/env', () => ({ loadEnvConfig: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ queue: { type: 'database', pollIntervalMs: 1234 } })
}))

vi.mock('@/lib/database', () => ({ getDatabase: vi.fn() }))

vi.mock('@/lib/services/domains/servedDomainSnapshot', () => ({
  startServedDomainRefresher: vi.fn()
}))

vi.mock('@/lib/services/queue/databaseRunner', () => ({
  startDatabaseQueueRunner: vi.fn()
}))

describe('runQueueWorker', () => {
  it('starts the served-domain refresher next to the queue runner', async () => {
    const database = { id: 'database' }
    vi.mocked(getDatabase).mockReturnValue(
      database as unknown as ReturnType<typeof getDatabase>
    )
    // The script installs signal handlers and logs on start.
    const processOn = vi.spyOn(process, 'on').mockReturnValue(process)
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await import('./runQueueWorker')
      await vi.waitFor(() => {
        expect(startDatabaseQueueRunner).toHaveBeenCalled()
      })

      // Jobs decide what is local from the served domains, which include the
      // active Admin › Served domains rows only once the refresher has loaded them.
      expect(startServedDomainRefresher).toHaveBeenCalledWith(database)
    } finally {
      processOn.mockRestore()
      consoleLog.mockRestore()
    }
  })
})

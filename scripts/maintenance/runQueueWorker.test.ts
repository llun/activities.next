import { getDatabase, getKysely } from '@/lib/database'
import { startServedDomainRefresher } from '@/lib/services/domains/servedDomainSnapshot'
import { startDatabaseQueueRunner } from '@/lib/services/queue/databaseRunner'
import { createStaticJobHandle } from '@/lib/services/queue/staticJobHandle'
import { startSemanticSearch } from '@/lib/services/search/semantic/startup'

vi.mock('@next/env', () => ({ loadEnvConfig: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ queue: { type: 'database', pollIntervalMs: 1234 } })
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(),
  getKysely: vi.fn()
}))

vi.mock('@/lib/services/search/semantic/startup', () => ({
  startSemanticSearch: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/domains/servedDomainSnapshot', () => ({
  startServedDomainRefresher: vi.fn()
}))

vi.mock('@/lib/services/queue/databaseRunner', () => ({
  startDatabaseQueueRunner: vi.fn()
}))

const staticJobHandle = vi.fn()
vi.mock('@/lib/services/queue/staticJobHandle', () => ({
  createStaticJobHandle: vi.fn(() => staticJobHandle)
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
      // Jobs write search documents, so the semantic search hook listens here.
      expect(startSemanticSearch).toHaveBeenCalledWith(getKysely)
      // Under tsx/cjs the runner's lazy job-registry import cannot resolve, so
      // the worker hands it the statically imported registry.
      expect(createStaticJobHandle).toHaveBeenCalledWith('database')
      expect(startDatabaseQueueRunner).toHaveBeenCalledWith(
        database,
        expect.objectContaining({ handleJob: staticJobHandle })
      )
    } finally {
      processOn.mockRestore()
      consoleLog.mockRestore()
    }
  })
})

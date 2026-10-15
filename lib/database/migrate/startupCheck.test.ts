import { sql } from 'kysely'

import type { DatabaseConfig } from '@/lib/config/database'
import {
  type DatabaseHandle,
  createDatabaseConnection
} from '@/lib/database/connection'
import { migrateToLatest } from '@/lib/database/migrate'
import { warnAboutPendingMigrations } from '@/lib/database/migrate/startupCheck'
import { logger } from '@/lib/utils/logger'
import { MIGRATION_NAMES } from '@/migrations/names'

// The startup check only logs; the status it reads is tested on both
// backends in index.test.ts.
describe('warnAboutPendingMigrations', () => {
  const config: DatabaseConfig = {
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  }
  let connection: DatabaseHandle

  beforeEach(() => {
    connection = createDatabaseConnection(config)
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await connection.destroy()
  })

  it('logs the pending migrations, and writes nothing', async () => {
    await warnAboutPendingMigrations({ db: connection.db, config })

    expect(logger.error).toHaveBeenCalledWith(
      { pending: [...MIGRATION_NAMES] },
      expect.stringContaining('The database has migrations pending')
    )
    const { rows } = await sql`select name from sqlite_master`.execute(
      connection.db
    )
    expect(rows).toEqual([])
  })

  it('logs nothing once the database is up to date', async () => {
    await migrateToLatest({ db: connection.db, config })

    await warnAboutPendingMigrations({ db: connection.db, config })

    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs why a database would be refused', async () => {
    await sql`create table accounts (id text)`.execute(connection.db)

    await warnAboutPendingMigrations({ db: connection.db, config })

    expect(logger.error).toHaveBeenCalledWith(
      { reason: 'unknown-schema', pending: [...MIGRATION_NAMES] },
      expect.stringContaining('but no migration history')
    )
  })

  it('only warns when it cannot read the database', async () => {
    await connection.destroy()

    await expect(
      warnAboutPendingMigrations({ db: connection.db, config })
    ).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Could not check the database for pending migrations'
    )
    connection = createDatabaseConnection(config)
  })

  // instrumentation.ts loads the check at every boot: it reads the status
  // without loading Kysely's Migrator (runner.ts), the migration modules or
  // the migration entry point (lib/database/migrate).
  it('loads neither the runner nor the migrations', async () => {
    vi.resetModules()
    const loaded: string[] = []
    const refuse = (name: string) => () => {
      loaded.push(name)
      throw new Error(`${name} was loaded`)
    }
    vi.doMock('@/lib/database/migrate/runner', refuse('runner'))
    vi.doMock('@/lib/database/migrate', refuse('lib/database/migrate'))
    vi.doMock('@/migrations/index', refuse('migrations/index'))
    vi.doMock('@/migrations/20261014000000_baseline', refuse('baseline'))
    vi.doMock('kysely/migration', refuse('kysely/migration'))
    try {
      const { warnAboutPendingMigrations: check } =
        await import('@/lib/database/migrate/startupCheck')
      // The freshly loaded modules have a logger of their own.
      const { logger: freshLogger } = await import('@/lib/utils/logger')
      const error = vi.spyOn(freshLogger, 'error').mockImplementation(() => {})
      await check({ db: connection.db, config })
      expect(loaded).toEqual([])
      expect(error).toHaveBeenCalledWith(
        { pending: [...MIGRATION_NAMES] },
        expect.stringContaining('The database has migrations pending')
      )
    } finally {
      vi.doUnmock('@/lib/database/migrate/runner')
      vi.doUnmock('@/lib/database/migrate')
      vi.doUnmock('@/migrations/index')
      vi.doUnmock('@/migrations/20261014000000_baseline')
      vi.doUnmock('kysely/migration')
      vi.resetModules()
    }
  })
})

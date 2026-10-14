import { sql } from 'kysely'

import type { DatabaseConfig } from '@/lib/config/database'
import {
  type DatabaseHandle,
  createDatabaseConnection
} from '@/lib/database/connection'
import { BASELINE_MIGRATION, migrateToLatest } from '@/lib/database/migrate'
import { warnAboutPendingMigrations } from '@/lib/database/migrate/startupCheck'
import { logger } from '@/lib/utils/logger'

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
      { pending: [BASELINE_MIGRATION] },
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
      { reason: 'unknown-schema', pending: [BASELINE_MIGRATION] },
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
})

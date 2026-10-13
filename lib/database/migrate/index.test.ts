import fs from 'fs/promises'
import { sql } from 'kysely'
import os from 'os'
import path from 'path'

import type { DatabaseConfig } from '@/lib/config/database'
import { createDatabaseConnection } from '@/lib/database/connection'
import { inTransaction } from '@/lib/database/kysely'
import {
  getAppliedMigrationNames,
  getKnownMigrationNames,
  migrateToLatest
} from '@/lib/database/migrate'
import {
  getTestDatabaseConfig,
  getTestPgDatabaseName
} from '@/lib/database/testing/createTestDatabase'
import {
  getTestPgConnection,
  recreatePgDatabase
} from '@/lib/database/testing/postgres'

// Runs on SQLite by default and on PostgreSQL under TEST_DATABASE_TYPE=pg,
// against an empty database: the migrations themselves run, as `yarn migrate`
// runs them.
const backend = process.env.TEST_DATABASE_TYPE === 'pg' ? 'pg' : 'sqlite'

// Running every migration takes a while, on PostgreSQL especially.
const MIGRATION_TIMEOUT_MS = 180_000

describe('lib/database/migrate', () => {
  let tempDir: string
  let config: DatabaseConfig

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-seam-test-'))
    if (backend === 'pg') {
      await recreatePgDatabase(
        getTestPgConnection(),
        getTestPgDatabaseName(true)
      )
      config = getTestDatabaseConfig('pg', true)
    } else {
      config = {
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: path.join(tempDir, 'migrate.sqlite') }
      }
    }
  })

  afterAll(async () => {
    await fs.rm(tempDir, { force: true, recursive: true })
  })

  it('knows the migration files this checkout ships', async () => {
    const files = await fs.readdir(path.join(process.cwd(), 'migrations'))
    const known = await getKnownMigrationNames()

    expect(known).toEqual(files.filter((file) => file.endsWith('.js')).sort())
    expect(known).toContain('20260324120000_seed_nodeinfo_counters.js')
    expect(known).not.toContain('migration.stub')
    expect(known).not.toContain('schema.sql')
  })

  it(
    'migrates an empty database to the latest migration, once',
    async () => {
      const connection = createDatabaseConnection(config)
      const target = { db: connection.db, config }
      try {
        expect(await getAppliedMigrationNames(target)).toEqual([])

        await migrateToLatest(target)

        const known = await getKnownMigrationNames()
        const applied = await getAppliedMigrationNames(target)
        // In the order they ran, which is the files' order.
        expect(applied).toEqual(known)

        const { rows: accounts } = await sql<{ count: number | string }>`
          select count(*) as count from accounts
        `.execute(connection.db)
        expect(Number(accounts[0].count)).toBe(0)

        // A second run has nothing to do.
        const { rows: before } = await sql<{ count: number | string }>`
          select count(*) as count from knex_migrations
        `.execute(connection.db)
        await migrateToLatest(target)
        const { rows: after } = await sql<{ count: number | string }>`
          select count(*) as count from knex_migrations
        `.execute(connection.db)
        expect(Number(after[0].count)).toBe(Number(before[0].count))
        expect(Number(after[0].count)).toBe(known.length)

        // Read inside a transaction too, as the production archive does.
        await expect(
          inTransaction(connection.db, (trx) =>
            getAppliedMigrationNames({ db: trx, config })
          )
        ).resolves.toEqual(known)
      } finally {
        await connection.destroy()
      }
    },
    MIGRATION_TIMEOUT_MS
  )

  it.runIf(backend === 'sqlite')(
    'refuses an in-memory SQLite database, which the migrations could not reach',
    async () => {
      const memoryConfig = getTestDatabaseConfig('sqlite')
      const connection = createDatabaseConnection(memoryConfig)
      try {
        await expect(
          migrateToLatest({ db: connection.db, config: memoryConfig })
        ).rejects.toThrow('Cannot migrate an in-memory SQLite database')
      } finally {
        await connection.destroy()
      }
    }
  )
})

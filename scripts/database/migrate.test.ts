import fs from 'fs/promises'
import { sql } from 'kysely'
import os from 'os'
import path from 'path'

import { createDatabaseConnection } from '@/lib/database/connection'
import {
  BASELINE_MIGRATION,
  MIGRATION_LOCKED_MESSAGE
} from '@/lib/database/migrate'
import {
  getTestDatabaseConfig,
  getTestPgDatabaseName
} from '@/lib/database/testing/createTestDatabase'
import {
  getTestPgConnection,
  recreatePgDatabase
} from '@/lib/database/testing/postgres'
import { logger } from '@/lib/utils/logger'

import { describeConnection } from '../fitness/describeConnection'
import {
  getMigrationDatabaseConfig,
  makeMigration,
  readStatus,
  runMigrateCommand
} from './migrate'

// The CLI behind `yarn migrate`, `yarn migrate:status`, `yarn migrate:down`,
// `yarn migrate:unlock` and `yarn migrate:make`, on SQLite files (the runner
// itself is tested on both backends in lib/database/migrate/index.test.ts).
// Under TEST_DATABASE_TYPE=pg it also checks that `migrate:status` reads
// PostgreSQL in a read-only transaction.
const backend = process.env.TEST_DATABASE_TYPE === 'pg' ? 'pg' : 'sqlite'

const clearDatabaseEnvironment = () => {
  for (const key of Object.keys(process.env)) {
    if (
      key === 'ACTIVITIES_DATABASE' ||
      key.startsWith('ACTIVITIES_DATABASE_') ||
      key === 'ACTIVITIES_DEFAULT_DATABASE_SQLITE_FILENAME'
    ) {
      vi.stubEnv(key, undefined)
    }
  }
}

describe('scripts/database/migrate', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-cli-test-'))
    clearDatabaseEnvironment()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await fs.rm(tempDir, { force: true, recursive: true })
  })

  describe('getMigrationDatabaseConfig', () => {
    it('falls back to ./activities.sqlite when nothing is configured', () => {
      expect(getMigrationDatabaseConfig()).toEqual({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: './activities.sqlite' }
      })
    })

    it('reads a bare SQLite file name as SQLite, without warnings', () => {
      const warn = vi.spyOn(logger, 'warn')
      vi.stubEnv('ACTIVITIES_DATABASE_SQLITE_FILENAME', '/data/app.sqlite')

      expect(getMigrationDatabaseConfig()).toEqual({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: '/data/app.sqlite' }
      })
      expect(warn).not.toHaveBeenCalled()
    })

    it('reads the PostgreSQL variables', () => {
      vi.stubEnv('ACTIVITIES_DATABASE_CLIENT', 'pg')
      vi.stubEnv('ACTIVITIES_DATABASE_PG_HOST', 'db.internal')
      vi.stubEnv('ACTIVITIES_DATABASE_PG_PORT', '5433')
      vi.stubEnv('ACTIVITIES_DATABASE_PG_USER', 'activities')
      vi.stubEnv('ACTIVITIES_DATABASE_PG_DATABASE', 'activities')

      expect(getMigrationDatabaseConfig()).toEqual({
        client: 'pg',
        connection: {
          host: 'db.internal',
          port: '5433',
          user: 'activities',
          database: 'activities'
        }
      })
    })

    it('shows the PG* variables a PostgreSQL configuration without connection settings falls back to', () => {
      vi.stubEnv('ACTIVITIES_DATABASE', JSON.stringify({ client: 'pg' }))
      vi.stubEnv('PGHOST', '/tmp')
      vi.stubEnv('PGPORT', '5596')
      vi.stubEnv('PGDATABASE', 'legacy')
      vi.stubEnv('PGUSER', 'operator')
      expect(describeConnection(getMigrationDatabaseConfig()).target).toBe(
        'host /tmp:5596 / db legacy / user operator ' +
          '(from PGHOST, PGPORT, PGDATABASE, PGUSER)'
      )

      // A configured value wins; only the ones taken from PG* are marked.
      vi.stubEnv(
        'ACTIVITIES_DATABASE',
        JSON.stringify({
          client: 'pg',
          connection: { host: 'db.internal', database: 'activities' }
        })
      )
      expect(describeConnection(getMigrationDatabaseConfig()).target).toBe(
        'host db.internal:5596 / db activities / user operator ' +
          '(from PGPORT, PGUSER)'
      )
    })

    it('shows what node-postgres uses for settings neither configured nor in PG*', () => {
      for (const variable of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER']) {
        vi.stubEnv(variable, undefined)
      }
      vi.stubEnv('USER', 'alice')
      vi.stubEnv('USERNAME', 'alice')
      vi.stubEnv('ACTIVITIES_DATABASE', JSON.stringify({ client: 'pg' }))
      // localhost, 5432 and the OS user; the database is the user's name.
      expect(describeConnection(getMigrationDatabaseConfig())).toEqual({
        client: 'pg',
        target:
          'host localhost:5432 / db alice / user alice ' +
          '(node-postgres default host, port, user; db defaults to the user)',
        isLocal: true
      })

      // A configured host with the database from PGDATABASE, and a
      // configured user that is also the database when PGDATABASE is unset.
      vi.stubEnv(
        'ACTIVITIES_DATABASE',
        JSON.stringify({
          client: 'pg',
          connection: { host: 'db.internal', user: 'activities' }
        })
      )
      vi.stubEnv('PGDATABASE', 'legacy')
      expect(describeConnection(getMigrationDatabaseConfig())).toEqual({
        client: 'pg',
        target:
          'host db.internal:5432 / db legacy / user activities ' +
          '(from PGDATABASE; node-postgres default port)',
        isLocal: false
      })
      vi.stubEnv('PGDATABASE', undefined)
      expect(describeConnection(getMigrationDatabaseConfig()).target).toBe(
        'host db.internal:5432 / db activities / user activities ' +
          '(node-postgres default port; db defaults to the user)'
      )

      // A unix socket directory is local.
      vi.stubEnv('PGHOST', '/var/run/postgresql')
      vi.stubEnv(
        'ACTIVITIES_DATABASE',
        JSON.stringify({ client: 'pg', connection: { database: 'app' } })
      )
      expect(describeConnection(getMigrationDatabaseConfig())).toEqual({
        client: 'pg',
        target:
          'host /var/run/postgresql:5432 / db app / user alice ' +
          '(from PGHOST; node-postgres default port, user)',
        isLocal: true
      })
    })

    it('hides a connectionString in the connection object, without the PG* variables it overrides', () => {
      vi.stubEnv('PGHOST', 'localhost')
      vi.stubEnv('PGPORT', '5596')
      vi.stubEnv('PGDATABASE', 'postgres')
      vi.stubEnv('PGUSER', 'postgres')
      vi.stubEnv(
        'ACTIVITIES_DATABASE',
        JSON.stringify({
          client: 'pg',
          connection: {
            connectionString: 'postgresql://u@db.internal/x',
            ssl: true
          }
        })
      )
      const info = describeConnection(getMigrationDatabaseConfig())
      expect(info).toEqual({
        client: 'pg',
        target: '(connection string — hidden)',
        isLocal: false
      })
      expect(info.target).not.toContain('PGHOST')

      // An empty one is ignored, as node-postgres ignores it.
      vi.stubEnv(
        'ACTIVITIES_DATABASE',
        JSON.stringify({
          client: 'pg',
          connection: { connectionString: '', database: 'app' }
        })
      )
      expect(describeConnection(getMigrationDatabaseConfig()).target).toBe(
        'host localhost:5596 / db app / user postgres ' +
          '(from PGHOST, PGPORT, PGUSER)'
      )
    })

    it('lets the ACTIVITIES_DATABASE JSON win, and refuses one that is not JSON', () => {
      vi.stubEnv(
        'ACTIVITIES_DATABASE',
        JSON.stringify({ client: 'pg', connection: 'postgres://db/app' })
      )
      vi.stubEnv('ACTIVITIES_DATABASE_SQLITE_FILENAME', '/data/app.sqlite')
      expect(getMigrationDatabaseConfig()).toEqual({
        client: 'pg',
        connection: 'postgres://db/app'
      })

      vi.stubEnv('ACTIVITIES_DATABASE', 'activities')
      expect(() => getMigrationDatabaseConfig()).toThrow(
        'ACTIVITIES_DATABASE must be a JSON Knex configuration'
      )
    })
  })

  describe('makeMigration', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(tempDir, 'migrations'))
      await fs.copyFile(
        path.join(process.cwd(), 'migrations', 'migration.stub'),
        path.join(tempDir, 'migrations', 'migration.stub')
      )
    })

    it('writes a timestamped TypeScript migration from the stub', async () => {
      const file = await makeMigration('add_things', {
        now: new Date(Date.UTC(2026, 9, 14, 3, 4, 5)),
        cwd: tempDir
      })

      expect(file).toBe(path.join('migrations', '20261014030405_add_things.ts'))
      expect(await fs.readFile(path.join(tempDir, file), 'utf8')).toBe(
        await fs.readFile(
          path.join(process.cwd(), 'migrations', 'migration.stub'),
          'utf8'
        )
      )
      // The stub is a migration module whose steps run.
      const module = await import(path.join(tempDir, file))
      const connection = createDatabaseConnection({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: ':memory:' }
      })
      try {
        await expect(module.up(connection.db)).resolves.toBeUndefined()
        await expect(module.down(connection.db)).resolves.toBeUndefined()
      } finally {
        await connection.destroy()
      }
    })

    it('refuses a missing or unusable name, and an existing file', async () => {
      await expect(makeMigration(undefined, { cwd: tempDir })).rejects.toThrow(
        'Usage: yarn migrate:make <name>'
      )
      await expect(
        makeMigration('../escape', { cwd: tempDir })
      ).rejects.toThrow('Usage: yarn migrate:make <name>')

      const now = new Date(Date.UTC(2026, 9, 14))
      await makeMigration('twice', { now, cwd: tempDir })
      await expect(
        makeMigration('twice', { now, cwd: tempDir })
      ).rejects.toThrow('EEXIST')
    })
  })

  describe('runMigrateCommand', () => {
    const run = async (args: string[]) => {
      const output: string[] = []
      vi.spyOn(console, 'log').mockImplementation((...line) => {
        output.push(line.join(' '))
      })
      vi.spyOn(console, 'error').mockImplementation((...line) => {
        output.push(line.join(' '))
      })
      const exitCode = await runMigrateCommand(args)
      vi.mocked(console.log).mockRestore()
      vi.mocked(console.error).mockRestore()
      return { exitCode, output: output.join('\n') }
    }

    it('prints the database, migrates, and reports the status', async () => {
      const filename = path.join(tempDir, 'cli.sqlite')
      vi.stubEnv('ACTIVITIES_DATABASE_SQLITE_FILENAME', filename)

      // Status never creates the database file.
      const before = await run(['status'])
      expect(before.exitCode).toBe(0)
      expect(before.output).toContain(
        `Database: better-sqlite3 — file ${filename}`
      )
      expect(before.output).toContain('The database file does not exist yet')
      await expect(fs.access(filename)).rejects.toThrow()

      const migrated = await run(['latest'])
      expect(migrated.exitCode).toBe(0)
      expect(migrated.output).toContain(
        `Database: better-sqlite3 — file ${filename}`
      )
      expect(migrated.output).toContain(
        `Applied 1 migration(s):\n  ${BASELINE_MIGRATION}`
      )
      expect((await run(['latest'])).output).toContain('Already up to date.')

      const status = await run(['status'])
      expect(status.exitCode).toBe(0)
      expect(status.output).toContain(
        `Handover: recorded: ${BASELINE_MIGRATION} is applied.`
      )
      expect(status.output).toMatch(
        new RegExp(`Applied \\(1\\):\\n  ${BASELINE_MIGRATION}  \\S+Z`)
      )
      expect(status.output).toContain('Pending (0):')

      vi.spyOn(console, 'log').mockImplementation(() => {})
      await expect(runMigrateCommand(['down'])).rejects.toThrow(
        `Nothing to roll back above the baseline: ${BASELINE_MIGRATION}`
      )
    })

    it('reports a database it would refuse, without writing to it', async () => {
      const filename = path.join(tempDir, 'refused.sqlite')
      vi.stubEnv('ACTIVITIES_DATABASE_SQLITE_FILENAME', filename)
      const connection = createDatabaseConnection({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename }
      })
      try {
        await sql`create table accounts (id text)`.execute(connection.db)
      } finally {
        await connection.destroy()
      }

      const status = await run(['status'])
      expect(status.exitCode).toBe(1)
      expect(status.output).toContain('Handover: REFUSED (unknown-schema)')
      expect(status.output).toContain(`Pending (1):\n  ${BASELINE_MIGRATION}`)

      const check = createDatabaseConnection({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename }
      })
      try {
        const { rows } = await sql<{ name: string }>`
          select name from sqlite_master where type = 'table'
        `.execute(check.db)
        expect(rows).toEqual([{ name: 'accounts' }])
      } finally {
        await check.destroy()
      }
    })

    it('prints the PG* fallbacks in the banner before it connects', async () => {
      vi.stubEnv('ACTIVITIES_DATABASE', JSON.stringify({ client: 'pg' }))
      // A directory with no server socket in it: the connection fails.
      vi.stubEnv('PGHOST', tempDir)
      vi.stubEnv('PGPORT', '5596')
      vi.stubEnv('PGDATABASE', 'legacy')
      vi.stubEnv('PGUSER', 'operator')
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})

      await expect(runMigrateCommand(['status'])).rejects.toThrow()
      expect(log).toHaveBeenCalledWith(
        `Database: pg — host ${tempDir}:5596 / db legacy / user operator ` +
          '(from PGHOST, PGPORT, PGDATABASE, PGUSER)'
      )
    })

    it('releases the SQLite lock a killed run left held', async () => {
      const filename = path.join(tempDir, 'locked.sqlite')
      vi.stubEnv('ACTIVITIES_DATABASE_SQLITE_FILENAME', filename)
      expect((await run(['latest'])).exitCode).toBe(0)
      const connection = createDatabaseConnection({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename }
      })
      try {
        // What a run killed while it held the lock leaves behind.
        await sql`
          update kysely_migration_lock set is_locked = 1
        `.execute(connection.db)
      } finally {
        await connection.destroy()
      }

      vi.spyOn(console, 'log').mockImplementation(() => {})
      await expect(runMigrateCommand(['latest'])).rejects.toThrow(
        MIGRATION_LOCKED_MESSAGE
      )
      vi.mocked(console.log).mockRestore()

      const unlocked = await run(['unlock'])
      expect(unlocked.exitCode).toBe(0)
      expect(unlocked.output).toContain(
        'Released the migration lock (kysely_migration_lock).'
      )
      expect((await run(['latest'])).output).toContain('Already up to date.')
      expect((await run(['unlock'])).output).toContain(
        'The migration lock was not held; nothing to release.'
      )
    })

    it('refuses an unknown command', async () => {
      const { exitCode, output } = await run(['rollback'])
      expect(exitCode).toBe(1)
      expect(output).toContain('Usage: scripts/database/migrate.ts')
    })
  })

  describe('readStatus', () => {
    it.runIf(backend === 'pg')(
      'reads PostgreSQL in a read-only transaction',
      async () => {
        await recreatePgDatabase(
          getTestPgConnection(),
          getTestPgDatabaseName(true)
        )
        const config = getTestDatabaseConfig('pg', true)
        const connection = createDatabaseConnection(config)
        const statements: string[] = []
        const stop = connection.onQuery(({ sql: statement }) => {
          statements.push(statement.trim().toLowerCase())
        })
        try {
          const status = await readStatus({ db: connection.db, config })
          expect(status.handover).toEqual({ kind: 'empty' })
          // Every read inside one transaction the server keeps read-only.
          expect(statements[0]).toBe('start transaction read only')
          expect(statements.at(-1)).toBe('commit')
          expect(
            statements.filter((statement) =>
              /^(begin|start transaction)/.test(statement)
            )
          ).toHaveLength(1)
        } finally {
          stop()
          await connection.destroy()
        }
      }
    )
  })
})

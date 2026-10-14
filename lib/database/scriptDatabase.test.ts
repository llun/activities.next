import { sql } from 'kysely'

import type { DatabaseConfig } from '@/lib/config/database'
import { openScriptDatabase } from '@/lib/database/scriptDatabase'
import {
  TEST_PG_DATABASE,
  getTestPgConnection,
  recreatePgDatabase
} from '@/lib/database/testing/postgres'

const sqliteConfig: DatabaseConfig = {
  client: 'better-sqlite3',
  useNullAsDefault: true,
  connection: { filename: ':memory:' }
}

describe('openScriptDatabase', () => {
  it('opens a Kysely connection of its own on SQLite', async () => {
    const { db, destroy } = openScriptDatabase(sqliteConfig)
    try {
      const { rows } = await sql<{ one: number }>`select 1 as one`.execute(db)
      expect(rows).toEqual([{ one: 1 }])
    } finally {
      await destroy()
    }
  })

  it('names its backend and normalises results unless told not to', async () => {
    const normalised = openScriptDatabase(sqliteConfig)
    const stored = openScriptDatabase(sqliteConfig, {
      normalizeResults: false
    })
    try {
      expect(normalised.backend).toBe('sqlite')
      expect(stored.backend).toBe('sqlite')
      for (const { db } of [normalised, stored]) {
        await sql`create table flags (flag boolean)`.execute(db)
        await sql`insert into flags (flag) values (${true})`.execute(db)
      }
      await expect(
        sql`select flag from flags`.execute(normalised.db)
      ).resolves.toMatchObject({ rows: [{ flag: true }] })
      await expect(
        sql`select flag from flags`.execute(stored.db)
      ).resolves.toMatchObject({ rows: [{ flag: 1 }] })
    } finally {
      await normalised.destroy()
      await stored.destroy()
    }
  })

  it('closes the pool on destroy', async () => {
    const { db, destroy } = openScriptDatabase(sqliteConfig)
    await sql`select 1`.execute(db)

    await destroy()

    await expect(sql`select 1`.execute(db)).rejects.toThrow()
  })

  it('gives each call its own connection', async () => {
    const first = openScriptDatabase(sqliteConfig)
    const second = openScriptDatabase(sqliteConfig)
    try {
      await sql`create table only_in_first (id integer)`.execute(first.db)
      const { rows } =
        await sql`select name from sqlite_master where name = 'only_in_first'`.execute(
          second.db
        )
      expect(rows).toEqual([])
    } finally {
      await first.destroy()
      await second.destroy()
    }
  })

  it('throws for a client the connection does not support', () => {
    expect(() =>
      openScriptDatabase({ client: 'mysql2' } as unknown as DatabaseConfig)
    ).toThrow(/Unsupported database client "mysql2".*only better-sqlite3/s)
  })

  it.runIf(process.env.TEST_DATABASE_TYPE === 'pg')(
    'opens a Kysely connection of its own on PostgreSQL',
    async () => {
      const connection = getTestPgConnection()
      await recreatePgDatabase(connection, TEST_PG_DATABASE)
      const { db, destroy } = openScriptDatabase({
        client: 'pg',
        connection: { ...connection, database: TEST_PG_DATABASE }
      })
      try {
        const { rows } = await sql<{ one: number }>`select 1 as one`.execute(db)
        expect(rows).toEqual([{ one: 1 }])
      } finally {
        await destroy()
      }
    }
  )
})

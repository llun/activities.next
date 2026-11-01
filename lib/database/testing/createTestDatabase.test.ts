import { sql } from 'kysely'
import type { Client as PostgresClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Db } from '@/lib/database/kysely'
import {
  createTestDatabase,
  getTestPgDatabaseName
} from '@/lib/database/testing/createTestDatabase'
import {
  computeSchemaFingerprint,
  getTestPgConnection
} from '@/lib/database/testing/postgres'

const expectedBackend =
  process.env.TEST_DATABASE_TYPE === 'pg' ? 'pg' : 'sqlite'

describe('createTestDatabase', () => {
  const testDatabase = createTestDatabase()
  const { database, db } = testDatabase

  beforeAll(async () => {
    await testDatabase.prepare()
    await database.migrate()
  }, 30000)

  afterAll(async () => {
    await testDatabase.destroy()
  })

  it('defaults to the backend named by TEST_DATABASE_TYPE', async () => {
    expect(testDatabase.backend).toBe(expectedBackend)
    // Ask the server which engine it is: only PostgreSQL has version().
    const probe =
      expectedBackend === 'pg'
        ? sql<{ engine: string }>`select version() as engine`
        : sql<{
            engine: string
          }>`select 'SQLite ' || sqlite_version() as engine`
    const { rows } = await probe.execute(db)
    expect(rows[0].engine).toMatch(
      expectedBackend === 'pg' ? /^PostgreSQL / : /^SQLite /
    )
  })

  it('migrate() loads the schema from the committed dump', async () => {
    if (expectedBackend === 'pg') {
      // prepare() has already replayed the dump, which would leave migrate()
      // a no-op and this test vacuous: empty the database first, so migrate()
      // really has to load the dump (prepare → prepareEmpty → migrate).
      await testDatabase.prepareEmpty()
      await database.migrate()
    }
    // On SQLite prepare() is a no-op, so the schema below can only have come
    // from the migrate() in beforeAll. The count fails when no dump was
    // loaded at all.
    const countTables =
      expectedBackend === 'pg'
        ? sql<{ total: number }>`
            select count(*)::int as total
            from information_schema.tables
            where table_schema = 'public'`
        : sql<{ total: number }>`
            select count(*) as total
            from sqlite_master
            where type = 'table' and name = 'server_settings'`
    expect((await countTables.execute(db)).rows[0].total).toBeGreaterThan(0)
    // A key of its own, so the assertion holds whatever order the tests of
    // this suite ran in (--sequence.shuffle) and whatever rows they left.
    await expect(
      db
        .selectFrom('server_settings')
        .select('key')
        .where('key', '=', 'createTestDatabase.migrate.probe')
        .execute()
    ).resolves.toEqual([])
    // Earlier tests may have left rows behind (--sequence.shuffle), so the
    // assertion is only that the query runs against the migrated schema:
    // with no schema loaded it would reject with a missing table.
    await expect(database.getAllServerSettings()).resolves.toBeInstanceOf(Array)
  })

  it('reads a row written through db via database', async () => {
    await db
      .insertInto('server_settings')
      .values({
        key: 'created.by.kysely',
        value: JSON.stringify('kysely'),
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .execute()

    const settings = await database.getAllServerSettings()
    expect(
      settings.filter(({ key }) => key === 'created.by.kysely')
    ).toMatchObject([{ key: 'created.by.kysely', value: 'kysely' }])
  })

  it('reads a row written through database via db', async () => {
    await database.setServerSettings([
      { key: 'created.by.facade', value: 'facade' }
    ])

    const row = await db
      .selectFrom('server_settings')
      .selectAll()
      .where('key', '=', 'created.by.facade')
      .executeTakeFirstOrThrow()
    expect(JSON.parse(row.value)).toBe('facade')
  })
})

describe('createTestDatabase backends', () => {
  it('builds an in-memory SQLite database on request, with a no-op prepare', async () => {
    const testDatabase = createTestDatabase({ backend: 'sqlite' })
    expect(testDatabase.backend).toBe('sqlite')
    expect(await testDatabase.prepare()).toBeUndefined()
    await testDatabase.database.migrate()
    await expect(testDatabase.database.getAllServerSettings()).resolves.toEqual(
      []
    )
    await testDatabase.destroy()
  })

  it('destroy() closes the connection', async () => {
    const testDatabase = createTestDatabase()
    await testDatabase.prepare()
    await testDatabase.database.migrate()
    await testDatabase.destroy()

    // The driver is destroyed and hands out no more connections.
    await expect(
      testDatabase.db.selectFrom('server_settings').select('key').execute()
    ).rejects.toThrow('driver has already been destroyed')
  })
})

// PostgreSQL only: the fingerprint/truncate fast path behind `prepare` has no
// SQLite counterpart.
describe.skipIf(process.env.TEST_DATABASE_TYPE !== 'pg')(
  'createTestDatabase prepare on PostgreSQL',
  () => {
    it('leaves rows gone and identities restarted after the next prepare', async () => {
      const first = createTestDatabase()
      await first.prepare()
      await first.database.migrate()
      // `bookmarks.id` defaults to nextval(bookmarks_id_seq) and carries no
      // foreign keys, so two raw inserts reach both the rows and the identity.
      await sql`insert into public.bookmarks ("actorId", "statusId") values ('actor-a', 'status-a'), ('actor-b', 'status-b')`.execute(
        first.db
      )
      await expect(
        sql`select id from public.bookmarks order by id`.execute(first.db)
      ).resolves.toMatchObject({ rows: [{ id: 1 }, { id: 2 }] })
      await first.destroy()

      const second = createTestDatabase()
      await second.prepare()
      await expect(
        sql`select "actorId" from public.bookmarks`.execute(second.db)
      ).resolves.toMatchObject({ rows: [] })
      await sql`insert into public.bookmarks ("actorId", "statusId") values ('actor-c', 'status-c')`.execute(
        second.db
      )
      // RESTART IDENTITY wound bookmarks_id_seq back to its start.
      await expect(
        sql`select id from public.bookmarks`.execute(second.db)
      ).resolves.toMatchObject({ rows: [{ id: 1 }] })
      await second.destroy()
    })

    // Pins the fast path: on an unchanged schema a second prepare must
    // truncate the tables in place — the table keeps its `pg_class.oid` —
    // while a schema-altering change forces the rebuild, which hands out a
    // new oid.
    it('a second prepare on an unchanged schema truncates instead of rebuilding', async () => {
      const oidOfBookmarks = (
        instance: ReturnType<typeof createTestDatabase>
      ) =>
        sql<{ oid: string }>`select c.oid::text as oid
                            from pg_class c
                            join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname = 'public'
                              and c.relname = 'bookmarks'`.execute(instance.db)

      const first = createTestDatabase()
      await first.prepare()
      const oidBefore = (await oidOfBookmarks(first)).rows[0].oid
      await sql`insert into public.bookmarks ("actorId", "statusId") values ('oid-a', 'oid-s')`.execute(
        first.db
      )
      await first.destroy()

      const second = createTestDatabase()
      await second.prepare()
      // Unchanged schema: the table survived the truncate — same oid — and
      // its rows are gone.
      expect((await oidOfBookmarks(second)).rows[0].oid).toBe(oidBefore)
      await expect(
        second.db.selectFrom('bookmarks').selectAll().execute()
      ).resolves.toEqual([])

      // A schema-altering change forces the rebuild path: a new table oid.
      await second.db.schema
        .alterTable('server_settings')
        .addColumn('probe', 'integer')
        .execute()
      await second.destroy()
      const third = createTestDatabase()
      await third.prepare()
      expect((await oidOfBookmarks(third)).rows[0].oid).not.toBe(oidBefore)
      await third.destroy()
    })

    it('rebuilds the schema for the next prepare after a test alters it', async () => {
      const first = createTestDatabase()
      await first.prepare()
      await first.db.schema
        .alterTable('server_settings')
        .addColumn('probe', 'integer')
        .execute()
      await first.destroy()

      const second = createTestDatabase()
      await second.prepare()
      // The altered column is gone: prepare saw the fingerprint mismatch and
      // rebuilt from the dump.
      await expect(
        sql`select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'server_settings'
              and column_name = 'probe'`.execute(second.db)
      ).resolves.toMatchObject({ rows: [] })
      // The rebuilt schema is the dump's, so migrate() stays a no-op and the
      // table it names is there.
      await second.database.migrate()
      await expect(
        second.db.selectFrom('server_settings').select('key').execute()
      ).resolves.toEqual([])
      await second.destroy()
    })

    it('prepare leaves the dump schema in place and migrate a no-op', async () => {
      const testDatabase = createTestDatabase()
      await testDatabase.prepare()
      const countTables = () =>
        sql<{ total: number }>`select count(*)::int as total
                              from information_schema.tables
                              where table_schema = 'public'`.execute(
          testDatabase.db
        )
      const { rows } = await countTables()
      expect(rows[0].total).toBeGreaterThan(0)
      // The dump's kysely_migration is empty, and a no-op migrate() leaves it
      // that way: nothing ran the migrations.
      await testDatabase.database.migrate()
      await expect(
        sql<{
          total: number
        }>`select count(*)::int as total from kysely_migration`.execute(
          testDatabase.db
        )
      ).resolves.toMatchObject({ rows: [{ total: 0 }] })
      await testDatabase.destroy()
    })

    it('prepareEmpty hands over a really empty database', async () => {
      const testDatabase = createTestDatabase()
      await testDatabase.prepareEmpty()
      await expect(
        sql<{ total: number }>`select count(*)::int as total
                              from information_schema.tables
                              where table_schema = 'public'`.execute(
          testDatabase.db
        )
      ).resolves.toMatchObject({ rows: [{ total: 0 }] })
      await testDatabase.destroy()
    })

    it('migrate() rebuilds the schema after prepare → prepareEmpty', async () => {
      const testDatabase = createTestDatabase()
      await testDatabase.prepare()
      await testDatabase.prepareEmpty()
      await testDatabase.database.migrate()
      // prepareEmpty dropped the database, so migrate() had to reload the
      // dump: the schema is present again, not left empty.
      const { rows } = await sql<{ total: number }>`
        select count(*)::int as total from information_schema.tables
        where table_schema = 'public'`.execute(testDatabase.db)
      expect(rows[0].total).toBeGreaterThan(0)
      await expect(
        testDatabase.db.selectFrom('server_settings').select('key').execute()
      ).resolves.toEqual([])
      await testDatabase.destroy()
    })

    it('recovers when a test dropped the public schema entirely', async () => {
      const first = createTestDatabase()
      await first.prepare()
      await sql`drop schema public cascade`.execute(first.db)
      await first.destroy()

      // The fingerprint query must not throw on the missing schema: prepare
      // sees an empty schema, mismatches, and rebuilds from the dump.
      const second = createTestDatabase()
      await second.prepare()
      const { rows } = await sql<{ total: number }>`
        select count(*)::int as total from information_schema.tables
        where table_schema = 'public'`.execute(second.db)
      expect(rows[0].total).toBeGreaterThan(0)
      await expect(
        second.db.selectFrom('server_settings').select('key').execute()
      ).resolves.toEqual([])
      await second.destroy()
    })

    // A changed function body or trigger state leaves the same object in the
    // catalog — only the fingerprint query can see the difference, so each
    // case fingerprints the prepared schema, changes the object in place and
    // fingerprints again: the two values must differ.
    const fingerprintDuring = async (
      run: (client: PostgresClient) => Promise<void>
    ) => {
      const { Client } = await import('pg')
      const client = new Client({
        ...getTestPgConnection(),
        database: getTestPgDatabaseName()
      })
      await client.connect()
      try {
        await run(client)
      } finally {
        await client.end()
      }
    }

    it('fingerprints a changed function body in place', async () => {
      const testDatabase = createTestDatabase()
      await testDatabase.prepare()
      try {
        await fingerprintDuring(async (client) => {
          await client.query(
            'create function public.probe_fn() returns integer language sql as $body$ select 1 $body$'
          )
          const before = await computeSchemaFingerprint(client)
          // Same name, signature and return type — only the body changes.
          await client.query(
            'create or replace function public.probe_fn() returns integer language sql as $body$ select 2 $body$'
          )
          await expect(computeSchemaFingerprint(client)).resolves.not.toBe(
            before
          )
        })
      } finally {
        await testDatabase.destroy()
      }

      // The fingerprint mismatch makes the next prepare rebuild the schema,
      // dropping the probe function.
      const second = createTestDatabase()
      await second.prepare()
      await expect(
        sql<{ total: number }>`select count(*)::int as total
                              from pg_proc p
                              join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'public'
                                and p.proname = 'probe_fn'`.execute(second.db)
      ).resolves.toMatchObject({ rows: [{ total: 0 }] })
      await second.destroy()
    })

    it('fingerprints a trigger disabled in place', async () => {
      const testDatabase = createTestDatabase()
      await testDatabase.prepare()
      try {
        await fingerprintDuring(async (client) => {
          await client.query(
            'create function public.probe_trg_fn() returns trigger language plpgsql as $body$ begin return null; end $body$'
          )
          await client.query(
            'create trigger probe_trg before insert on public.server_settings for each row execute function public.probe_trg_fn()'
          )
          const before = await computeSchemaFingerprint(client)
          // The trigger keeps its name and definition — pg_get_triggerdef
          // renders a disabled trigger like an enabled one, so only the
          // tgenabled column can tell the fingerprints apart.
          await client.query(
            'alter table public.server_settings disable trigger probe_trg'
          )
          await expect(computeSchemaFingerprint(client)).resolves.not.toBe(
            before
          )
        })
      } finally {
        await testDatabase.destroy()
      }

      // The fingerprint mismatch makes the next prepare rebuild the schema,
      // dropping the probe trigger.
      const second = createTestDatabase()
      await second.prepare()
      await expect(
        sql<{ total: number }>`select count(*)::int as total
                              from pg_trigger tr
                              join pg_class c on c.oid = tr.tgrelid
                              join pg_namespace n on n.oid = c.relnamespace
                              where n.nspname = 'public'
                                and tr.tgname = 'probe_trg'`.execute(second.db)
      ).resolves.toMatchObject({ rows: [{ total: 0 }] })
      await second.destroy()
    })

    // Each case alters the worker's database in a way only the matching
    // fingerprint section sees — every one must make the next prepare
    // notice the mismatch and rebuild from the dump.
    it.each([
      {
        name: 'an altered sequence',
        alter: async (db: Db) => {
          await sql`alter sequence public.bookmarks_id_seq increment by 7`.execute(
            db
          )
        },
        gone: (db: Db) =>
          sql<{ total: number }>`select count(*)::int as total
                                from pg_sequences
                                where schemaname = 'public'
                                  and sequencename = 'bookmarks_id_seq'
                                  and increment_by <> 1`.execute(db)
      },
      {
        name: 'a non-public schema',
        alter: async (db: Db) => {
          await sql`create schema probe_schema`.execute(db)
        },
        gone: (db: Db) =>
          sql<{ total: number }>`select count(*)::int as total
                                from pg_namespace
                                where nspname = 'probe_schema'`.execute(db)
      }
    ])('rebuilds after $name', async ({ alter, gone }) => {
      const first = createTestDatabase()
      await first.prepare()
      await alter(first.db)
      await first.destroy()

      const second = createTestDatabase()
      await second.prepare()
      // The alteration is gone: prepare saw the fingerprint mismatch and
      // rebuilt from the dump.
      const { rows } = await gone(second.db)
      expect(rows[0].total).toBe(0)
      // The rebuilt schema is the dump's, so migrate() stays a no-op and the
      // table it names is there.
      await second.database.migrate()
      await expect(
        second.db.selectFrom('server_settings').select('key').execute()
      ).resolves.toEqual([])
      await second.destroy()
    })
  }
)

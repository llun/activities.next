import BetterSqlite3 from 'better-sqlite3'
import knex from 'knex'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getPublicIdTimestamp, isPublicId } from '@/lib/utils/publicId'
import * as migration from '@/migrations/20260808000000_add_public_ids'

describe('public ids migration', () => {
  let database: knex.Knex
  let logMessages: string[]
  let onLogMessage: ((message: string) => void) | null
  let restoreConsoleLog: () => void

  beforeEach(async () => {
    logMessages = []
    onLogMessage = null
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      const message = args.map(String).join(' ')
      logMessages.push(message)
      onLogMessage?.(message)
    })
    restoreConsoleLog = () => logSpy.mockRestore()

    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('statuses', (table) => {
      table.string('id').primary()
      table.datetime('createdAt')
    })
    await database.schema.createTable('actors', (table) => {
      table.string('id')
      table.datetime('createdAt')
    })
  })

  afterEach(async () => {
    await database.destroy()
    restoreConsoleLog()
  })

  it('runs without a wrapping transaction', () => {
    expect(migration.config).toEqual({ transaction: false })
  })

  it('backfills v7 publicIds whose timestamps match createdAt', async () => {
    const older = Date.UTC(2020, 0, 1)
    const newer = Date.UTC(2023, 5, 15)
    await database('statuses').insert([
      { id: 'https://llun.test/users/a/statuses/1', createdAt: older },
      { id: 'https://llun.test/users/a/statuses/2', createdAt: newer }
    ])
    await database('actors').insert([
      { id: 'https://llun.test/users/a', createdAt: older }
    ])

    await migration.up(database)

    const statuses = await database('statuses')
      .select('id', 'publicId', 'createdAt')
      .orderBy('createdAt', 'asc')
    for (const row of statuses) {
      expect(isPublicId(row.publicId)).toBe(true)
      expect(getPublicIdTimestamp(row.publicId)).toBe(row.createdAt)
    }
    // lexicographic order == chronological order
    expect(statuses[0].publicId < statuses[1].publicId).toBe(true)

    const [actor] = await database('actors').select('publicId')
    expect(isPublicId(actor.publicId)).toBe(true)
  })

  it('is idempotent and preserves existing publicIds on re-run', async () => {
    await database('statuses').insert([
      {
        id: 'https://llun.test/users/a/statuses/1',
        createdAt: Date.UTC(2021, 0, 1)
      }
    ])
    await migration.up(database)
    const [first] = await database('statuses').select('publicId')
    await migration.up(database)
    const [second] = await database('statuses').select('publicId')
    expect(second.publicId).toBe(first.publicId)
  })

  it('handles SQLite CURRENT_TIMESTAMP string values', async () => {
    await database('statuses').insert([
      {
        id: 'https://llun.test/users/a/statuses/s',
        createdAt: '2024-03-04 05:06:07'
      }
    ])
    await migration.up(database)
    const [row] = await database('statuses').select('publicId')
    expect(getPublicIdTimestamp(row.publicId)).toBe(
      Date.UTC(2024, 2, 4, 5, 6, 7)
    )
  })

  it('creates the missing unique index on a re-run after an interrupted first run', async () => {
    // Simulates a process interruption between the column-add and index-add
    // statements: the column exists (with a value already backfilled by the
    // interrupted run) but the unique index does not.
    await database('statuses').insert([
      {
        id: 'https://llun.test/users/a/statuses/1',
        createdAt: Date.UTC(2022, 3, 1)
      }
    ])
    await database.schema.alterTable('statuses', (table) => {
      table.string('publicId', 36).nullable()
    })
    const partialPublicId = 'not-yet-backfilled-marker'
    await database('statuses').update({ publicId: partialPublicId })

    await expect(
      database.raw("PRAGMA index_list('statuses')")
    ).resolves.not.toContainEqual(
      expect.objectContaining({ name: 'statuses_publicid_unique' })
    )

    await migration.up(database)

    const indexes = await database.raw("PRAGMA index_list('statuses')")
    expect(indexes).toContainEqual(
      expect.objectContaining({ name: 'statuses_publicid_unique' })
    )
    // Re-running up() must not touch a row that already has a (non-v7, in
    // this test) publicId value — only the missing schema object is added.
    const [row] = await database('statuses').select('publicId')
    expect(row.publicId).toBe(partialPublicId)

    // The unique index is now actually enforced.
    await database('statuses').insert([
      {
        id: 'https://llun.test/users/a/statuses/2',
        createdAt: Date.UTC(2022, 3, 2)
      }
    ])
    await expect(
      database('statuses')
        .where('id', 'https://llun.test/users/a/statuses/2')
        .update({ publicId: partialPublicId })
    ).rejects.toThrow()
  })

  it('backfills rows inserted behind the cursor while the backfill is running', async () => {
    // The forward keyset walk only ever moves forward, but production runs
    // this migration online: the still-deployed app keeps inserting rows whose
    // uuid-tailed ids sort uniformly, so some land BEHIND the cursor mid-run.
    // A SQLite trigger reproduces that deterministically by inserting a
    // lower-sorting row the moment the last walked row is updated.
    const straggler = {
      id: 'https://llun.test/users/a/statuses/a-inserted-mid-run',
      createdAt: Date.UTC(2024, 6, 2)
    }
    const walked = [
      {
        id: 'https://llun.test/users/a/statuses/b',
        createdAt: Date.UTC(2024, 6, 1)
      },
      {
        id: 'https://llun.test/users/a/statuses/c',
        createdAt: Date.UTC(2024, 6, 1)
      }
    ]
    const lastWalkedId = walked[walked.length - 1].id
    expect(straggler.id < lastWalkedId).toBe(true)

    await database('statuses').insert(walked)
    // The column has to exist before a trigger can reference it; up() then
    // skips the column add and still creates the index and backfills.
    await database.schema.alterTable('statuses', (table) => {
      table.string('publicId', 36).nullable()
    })
    await database.raw(`
      CREATE TRIGGER simulate_concurrent_insert
      AFTER UPDATE OF "publicId" ON "statuses"
      WHEN NEW."id" = '${lastWalkedId}'
      BEGIN
        INSERT INTO "statuses" ("id", "createdAt")
        VALUES ('${straggler.id}', ${straggler.createdAt});
      END;
    `)

    await migration.up(database)

    const [row] = await database('statuses')
      .select('publicId', 'createdAt')
      .where('id', straggler.id)
    expect(isPublicId(row.publicId)).toBe(true)
    expect(getPublicIdTimestamp(row.publicId)).toBe(row.createdAt)

    const missing = await database('statuses').whereNull('publicId').count({
      cnt: '*'
    })
    expect(Number(missing[0].cnt)).toBe(0)
  })

  it('backfills a straggler inserted after the forward walk has finished', async () => {
    // The deployed app keeps inserting for the whole migration, including after
    // the forward walk has run out of rows. Such a row is invisible to the walk
    // wherever its id sorts: this one sorts AFTER every walked row, so reaching
    // it cannot be credited to the walk (a straggler that already exists when a
    // run starts is always walked, because the walk restarts its cursor at '').
    // Only the sweep, which keeps re-selecting on `publicId IS NULL` until a
    // pass comes back empty, converges on it.
    //
    // Two triggers reproduce that deterministically: the first inserts a row
    // behind the walk cursor — the only kind of row the sweep, and nothing
    // else, fills — and the second fires on that sweep UPDATE, i.e. strictly
    // after the walk has finished, to insert the high-sorting straggler.
    const walked = [
      {
        id: 'https://llun.test/users/a/statuses/b',
        createdAt: Date.UTC(2024, 6, 1)
      },
      {
        id: 'https://llun.test/users/a/statuses/c',
        createdAt: Date.UTC(2024, 6, 2)
      }
    ]
    const lastWalkedId = walked[walked.length - 1].id
    const behindCursor = {
      id: 'https://llun.test/users/a/statuses/a-behind-cursor',
      createdAt: Date.UTC(2024, 6, 3)
    }
    const afterWalk = {
      id: 'https://llun.test/users/a/statuses/z-after-walk',
      createdAt: Date.UTC(2024, 6, 4)
    }
    expect(behindCursor.id < lastWalkedId).toBe(true)
    expect(afterWalk.id > lastWalkedId).toBe(true)

    await database('statuses').insert(walked)
    await database.schema.alterTable('statuses', (table) => {
      table.string('publicId', 36).nullable()
    })
    await database.raw(`
      CREATE TRIGGER insert_behind_cursor
      AFTER UPDATE OF "publicId" ON "statuses"
      WHEN NEW."id" = '${lastWalkedId}'
      BEGIN
        INSERT INTO "statuses" ("id", "createdAt")
        VALUES ('${behindCursor.id}', ${behindCursor.createdAt});
      END;
    `)
    await database.raw(`
      CREATE TRIGGER insert_after_walk
      AFTER UPDATE OF "publicId" ON "statuses"
      WHEN NEW."id" = '${behindCursor.id}'
      BEGIN
        INSERT INTO "statuses" ("id", "createdAt")
        VALUES ('${afterWalk.id}', ${afterWalk.createdAt});
      END;
    `)

    await migration.up(database)

    const straggler = await database('statuses')
      .select('publicId', 'createdAt')
      .where('id', afterWalk.id)
      .first()
    expect(straggler).toBeDefined()
    expect(isPublicId(straggler.publicId)).toBe(true)
    expect(getPublicIdTimestamp(straggler.publicId)).toBe(straggler.createdAt)

    const missing = await database('statuses').whereNull('publicId').count({
      cnt: '*'
    })
    expect(Number(missing[0].cnt)).toBe(0)
  })

  it('stops sweeping when a selected row disappears before its update', async () => {
    // Models a row deleted between the sweep's SELECT and its UPDATE: the row
    // comes back from the SELECT, the UPDATE then matches nothing, and the
    // sweep has to stop instead of re-selecting for another pass. SQLite
    // reproduces it exactly — an update whose row a BEFORE UPDATE trigger
    // deletes is abandoned and reports zero changed rows.
    const walked = [
      {
        id: 'https://llun.test/users/a/statuses/b',
        createdAt: Date.UTC(2024, 7, 1)
      },
      {
        id: 'https://llun.test/users/a/statuses/c',
        createdAt: Date.UTC(2024, 7, 2)
      }
    ]
    const lastWalkedId = walked[walked.length - 1].id
    const vanishing = {
      id: 'https://llun.test/users/a/statuses/a-vanishing',
      createdAt: Date.UTC(2024, 7, 3)
    }
    expect(vanishing.id < lastWalkedId).toBe(true)

    await database('statuses').insert(walked)
    await database.schema.alterTable('statuses', (table) => {
      table.string('publicId', 36).nullable()
    })
    // Only the sweep ever selects this row: it is inserted behind the walk
    // cursor while the walk is updating its last row.
    await database.raw(`
      CREATE TRIGGER insert_behind_cursor
      AFTER UPDATE OF "publicId" ON "statuses"
      WHEN NEW."id" = '${lastWalkedId}'
      BEGIN
        INSERT INTO "statuses" ("id", "createdAt")
        VALUES ('${vanishing.id}', ${vanishing.createdAt});
      END;
    `)
    await database.raw(`
      CREATE TRIGGER delete_before_update
      BEFORE UPDATE OF "publicId" ON "statuses"
      WHEN OLD."id" = '${vanishing.id}'
      BEGIN
        DELETE FROM "statuses" WHERE "id" = OLD."id";
      END;
    `)

    await expect(migration.up(database)).resolves.toBeUndefined()

    await expect(
      database('statuses').where('id', vanishing.id).first()
    ).resolves.toBeUndefined()
    expect(logMessages).toContainEqual(
      expect.stringContaining(
        'statuses: sweep made no progress on 1 row(s), stopping'
      )
    )
    // The sweep stopped on that pass rather than running another one.
    expect(logMessages).toContainEqual(
      expect.stringContaining('statuses: 0 straggler(s) backfilled over 1 pass')
    )
  })

  it('fails the migration instead of leaving rows permanently unbackfilled', async () => {
    // RAISE(IGNORE) in a BEFORE UPDATE trigger models an UPDATE that silently
    // takes no effect: the row keeps its NULL publicId and stays selectable, so
    // the sweep stops making progress with work left to do. up() must reject —
    // resolving would let knex record the migration, `knex migrate:latest`
    // would skip it on every later run, and the rows would stay NULL forever
    // with no way for an operator to repair them.
    const stubborn = {
      id: 'https://llun.test/users/a/statuses/stubborn',
      createdAt: Date.UTC(2024, 8, 1)
    }
    await database('statuses').insert([stubborn])
    await database.schema.alterTable('statuses', (table) => {
      table.string('publicId', 36).nullable()
    })
    await database.raw(`
      CREATE TRIGGER ignore_public_id_writes
      BEFORE UPDATE OF "publicId" ON "statuses"
      WHEN OLD."id" = '${stubborn.id}'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `)

    const failure = await migration.up(database).then(
      () => null,
      (error: unknown) => error as Error
    )
    expect(failure?.message).toContain(
      'statuses: 1 row(s) still have a NULL publicId after 1 sweep pass(es)'
    )
    expect(failure?.message).toContain('the sweep made no progress on 1 row(s)')
    expect(failure?.message).toContain('re-run `yarn migrate`')

    // The remedy the message promises: up() is idempotent, so once the cause is
    // gone a re-run resumes the backfill.
    await database.raw('DROP TRIGGER ignore_public_id_writes')

    await expect(migration.up(database)).resolves.toBeUndefined()

    const [row] = await database('statuses').select('publicId', 'createdAt')
    expect(isPublicId(row.publicId)).toBe(true)
    expect(getPublicIdTimestamp(row.publicId)).toBe(row.createdAt)
  })

  it('completes when a concurrent insert lands after the sweep converged', async () => {
    // The production flow runs `yarn migrate` against a live database while an
    // app keeps inserting. Once the sweep's SELECT comes back empty the backfill
    // is done: any row counted afterwards was written after that SELECT, by the
    // running app rather than by this migration. Failing on it would break a
    // perfectly healthy deploy — and a retry pays another O(N) forward walk only
    // to race the same way — so the converged exit reports the count instead.
    //
    // A file-backed database plus a SECOND better-sqlite3 connection reproduces
    // a genuinely concurrent writer (an in-memory database is private to its own
    // connection). The write is fired from the "Sweep done." log line, which the
    // migration emits between the sweep's last empty SELECT and the completeness
    // count.
    const directory = await mkdtemp(join(tmpdir(), 'public-ids-migration-'))
    const filename = join(directory, 'concurrent.sqlite3')
    const fileDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename }
    })
    const concurrentWriter = new BetterSqlite3(filename)

    try {
      await fileDatabase.schema.createTable('statuses', (table) => {
        table.string('id').primary()
        table.datetime('createdAt')
      })
      await fileDatabase.schema.createTable('actors', (table) => {
        table.string('id')
        table.datetime('createdAt')
      })
      await fileDatabase('statuses').insert([
        {
          id: 'https://llun.test/users/a/statuses/1',
          createdAt: Date.UTC(2024, 10, 1)
        }
      ])

      const concurrentInsert = {
        id: 'https://llun.test/users/a/statuses/inserted-after-convergence',
        createdAt: Date.UTC(2024, 10, 2)
      }
      onLogMessage = (message) => {
        if (!message.startsWith('Sweep done. statuses:')) return
        onLogMessage = null
        concurrentWriter
          .prepare('INSERT INTO "statuses" ("id", "createdAt") VALUES (?, ?)')
          .run(concurrentInsert.id, concurrentInsert.createdAt)
      }

      await expect(migration.up(fileDatabase)).resolves.toBeUndefined()

      expect(logMessages).toContainEqual(
        expect.stringContaining(
          'statuses: 1 row(s) were inserted after the sweep converged'
        )
      )
      // The row is left exactly as the concurrent writer wrote it: this
      // migration does not own it.
      const [row] = await fileDatabase('statuses')
        .select('publicId')
        .where('id', concurrentInsert.id)
      expect(row.publicId).toBeNull()
      // Every row the migration DID own was still backfilled.
      const [backfilled] = await fileDatabase('statuses')
        .select('publicId')
        .where('id', 'https://llun.test/users/a/statuses/1')
      expect(isPublicId(backfilled.publicId)).toBe(true)
    } finally {
      concurrentWriter.close()
      await fileDatabase.destroy()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('skips rows with a null id instead of aborting on the unique index', async () => {
    // actors.id is nullable in both schema dumps — it carries a unique index
    // rather than a primary key, and that index permits multiple NULLs. knex
    // compiles `.where('id', null)` to `id IS NULL`, so addressing such a row
    // by id matches every null-id row at once and writes one publicId to all of
    // them, which the new unique index rejects and the migration dies on.
    await database('actors').insert([
      { id: null, createdAt: Date.UTC(2024, 9, 1) },
      { id: null, createdAt: Date.UTC(2024, 9, 2) },
      { id: 'https://llun.test/users/a', createdAt: Date.UTC(2024, 9, 3) }
    ])

    await expect(migration.up(database)).resolves.toBeUndefined()

    const [addressable] = await database('actors')
      .select('publicId')
      .whereNotNull('id')
    expect(isPublicId(addressable.publicId)).toBe(true)

    const skipped = await database('actors').select('publicId').whereNull('id')
    expect(skipped).toHaveLength(2)
    expect(skipped.every((row) => row.publicId === null)).toBe(true)
    expect(logMessages).toContainEqual(
      expect.stringContaining('actors: 2 row(s) with a NULL id were skipped')
    )
  })

  it('rolls back cleanly', async () => {
    await migration.up(database)
    await migration.down(database)
    await expect(
      database.schema.hasColumn('statuses', 'publicId')
    ).resolves.toBe(false)
    await expect(database.schema.hasColumn('actors', 'publicId')).resolves.toBe(
      false
    )
  })
})

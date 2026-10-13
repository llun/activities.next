import { sql } from 'kysely'

import {
  type DatabaseConfig,
  parseKnexDatabaseConfig
} from '@/lib/config/database'
import {
  DEFAULT_ACQUIRE_CONNECTION_TIMEOUT_MS,
  type DatabaseHandle,
  POOL_IDLE_TIMEOUT_MS,
  type QueryEndEvent,
  type QueryEvent,
  createDatabaseConnection
} from '@/lib/database/connection'
import {
  createTestDatabase,
  getTestDatabaseConfig
} from '@/lib/database/testing/createTestDatabase'
import {
  type HeldTransaction,
  holdTransaction
} from '@/lib/database/testing/heldTransaction'
import { logger } from '@/lib/utils/logger'

const backend = process.env.TEST_DATABASE_TYPE === 'pg' ? 'pg' : 'sqlite'

// Runs on SQLite by default and on PostgreSQL under TEST_DATABASE_TYPE=pg.
// What each column type reads back as is pinned in
// lib/database/kysely/normalizeGolden.test.ts.
describe('createDatabaseConnection', () => {
  const testDb = createTestDatabase()
  const { db } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('opens the backend the configuration names', () => {
    expect(
      createDatabaseConnection(getTestDatabaseConfig('sqlite')).backend
    ).toBe('sqlite')
    expect(
      createDatabaseConnection({
        client: 'pg',
        connection: { host: '127.0.0.1' }
      }).backend
    ).toBe('pg')
  })

  it.each(['mysql2', 'sqlite3', 'pg-native', undefined])(
    'throws for the unsupported %s client, naming the supported ones',
    (client) => {
      expect(() =>
        createDatabaseConnection({ client } as unknown as DatabaseConfig)
      ).toThrow(
        `Unsupported database client "${client}": only better-sqlite3 ` +
          '(SQLite) and pg (PostgreSQL) are supported'
      )
    }
  )

  it('keeps the timeouts Knex used', () => {
    expect(DEFAULT_ACQUIRE_CONNECTION_TIMEOUT_MS).toBe(60_000)
    expect(POOL_IDLE_TIMEOUT_MS).toBe(30_000)
  })

  it('binds Date and boolean values and reads them back normalised', async () => {
    const createdAt = new Date('2026-02-03T04:05:06.789Z')
    await db
      .insertInto('customEmojis')
      .values({
        id: 'connection-emoji-1',
        shortcode: 'connection_one',
        url: 'https://llun.test/one.png',
        staticUrl: 'https://llun.test/one.png',
        disabled: true,
        visibleInPicker: false,
        createdAt,
        updatedAt: createdAt
      })
      .execute()

    const row = await db
      .selectFrom('customEmojis')
      .select(['disabled', 'visibleInPicker', 'createdAt'])
      .where('id', '=', 'connection-emoji-1')
      .executeTakeFirstOrThrow()
    expect(row).toEqual({
      disabled: true,
      visibleInPicker: false,
      createdAt: createdAt.getTime()
    })

    // Stored the way Knex stored them: epoch ms and 0/1 on SQLite. Read as
    // expressions, which the SQLite normalisation leaves as they are (it
    // converts a column by its declared type).
    const { rows } = await sql<{ storedFlag: unknown; storedTime: unknown }>`
      select ${sql.raw(
        backend === 'pg'
          ? `"disabled"::text as "storedFlag", (extract(epoch from "createdAt") * 1000)::bigint as "storedTime"`
          : `"disabled" + 0 as "storedFlag", "createdAt" + 0 as "storedTime"`
      )} from "customEmojis" where id = 'connection-emoji-1'
    `.execute(db)
    expect(rows).toEqual([
      {
        storedFlag: backend === 'pg' ? 'true' : 1,
        storedTime: createdAt.getTime()
      }
    ])
  })

  // PostgreSQL streams through a cursor, which the app does not configure.
  it.runIf(backend === 'sqlite')(
    'streams rows on SQLite, normalised like the rest',
    async () => {
      await db
        .insertInto('counters')
        .values({ id: 'connection-stream', value: 7, createdAt: new Date(0) })
        .execute()
      const streamed: unknown[] = []
      for await (const row of db
        .selectFrom('counters')
        .select(['value', 'createdAt'])
        .where('id', '=', 'connection-stream')
        .stream()) {
        streamed.push(row)
      }
      expect(streamed).toEqual([{ value: 7, createdAt: 0 }])
    }
  )

  describe('statement listeners', () => {
    it('announces each statement before it runs and reports when it ends', async () => {
      const handle = createDatabaseConnection(getTestDatabaseConfig('sqlite'))
      const events: string[] = []
      const ended: QueryEndEvent[] = []
      const stopQuery = handle.onQuery(({ sql }) => {
        events.push(`start ${sql}`)
      })
      const stopEnd = handle.onQueryEnd((event) => {
        events.push(`end ${event.sql}`)
        ended.push(event)
      })
      try {
        await sql`select ${1} as one`.execute(handle.db)
        await expect(
          sql`select * from no_such_table`.execute(handle.db)
        ).rejects.toThrow('no_such_table')
      } finally {
        stopQuery()
        stopEnd()
        await handle.destroy()
      }

      expect(events).toEqual([
        'start select ? as one',
        'end select ? as one',
        'start select * from no_such_table',
        'end select * from no_such_table'
      ])
      expect(ended[0]).toMatchObject({ bindings: [1] })
      expect(ended[0].error).toBeUndefined()
      expect(ended[0].durationMs).toBeGreaterThanOrEqual(0)
      expect(String(ended[1].error)).toContain('no_such_table')
      expect(Object.keys(ended[1]).sort()).toEqual([
        'bindings',
        'connection',
        'durationMs',
        'error',
        'sql'
      ])
    })

    it('fails the statement whose listener throws, before it runs', async () => {
      const handle = createDatabaseConnection(getTestDatabaseConfig('sqlite'))
      const ended: QueryEndEvent[] = []
      handle.onQueryEnd((event) => ended.push(event))
      const stop = handle.onQuery(({ sql }) => {
        if (sql.startsWith('create')) throw new Error('refused')
      })
      try {
        await expect(
          sql`create table refused (id integer)`.execute(handle.db)
        ).rejects.toThrow('refused')
        stop()
        // Never sent, so the table does not exist.
        await expect(
          sql`select * from refused`.execute(handle.db)
        ).rejects.toThrow('no such table')
      } finally {
        await handle.destroy()
      }
      expect(ended.map(({ sql }) => sql)).toEqual(['select * from refused'])
    })

    it('keeps the statement when an end listener throws', async () => {
      const handle = createDatabaseConnection(getTestDatabaseConfig('sqlite'))
      handle.onQueryEnd(() => {
        throw new Error('observer failed')
      })
      try {
        const { rows } = await sql<{
          one: number
        }>`select 1 as one`.execute(handle.db)
        expect(rows).toEqual([{ one: 1 }])
      } finally {
        await handle.destroy()
      }
    })

    it('names the connection each statement ran on', async () => {
      const events: QueryEvent[] = []
      const stop = testDb.onQuery((event) => events.push(event))
      try {
        await db.transaction().execute(async (trx) => {
          await sql`select 1`.execute(trx)
        })
      } finally {
        stop()
      }
      expect(events.map(({ sql }) => sql)).toEqual([
        'begin',
        'select 1',
        'commit'
      ])
      expect(new Set(events.map(({ connection }) => connection)).size).toBe(1)
    })
  })

  describe('destroy', () => {
    it('closes the connection, after which queries fail', async () => {
      const handle = createDatabaseConnection(
        getTestDatabaseConfig(backend, true)
      )
      if (backend === 'pg')
        await createTestDatabase({ isolated: true }).prepare()
      await sql`select 1`.execute(handle.db)
      await handle.destroy()
      await expect(sql`select 1`.execute(handle.db)).rejects.toThrow(
        'driver has already been destroyed'
      )
      // A second destroy is harmless.
      await expect(handle.destroy()).resolves.toBeUndefined()
    })

    // Kysely's own destroy skips a driver that never connected, which would
    // let a later query open a pool nobody closes.
    it('is final even before the first query', async () => {
      const handle = createDatabaseConnection(
        getTestDatabaseConfig(backend, true)
      )
      await expect(handle.destroy()).resolves.toBeUndefined()
      await expect(sql`select 1`.execute(handle.db)).rejects.toThrow(
        'driver has already been destroyed'
      )
      await expect(handle.executeScript('select 1')).rejects.toThrow(
        'driver has already been destroyed'
      )
    })
  })

  describe('executeScript', () => {
    it('runs several statements at once', async () => {
      const handle = createDatabaseConnection(
        getTestDatabaseConfig(backend, true)
      )
      if (backend === 'pg')
        await createTestDatabase({ isolated: true }).prepare()
      try {
        await handle.executeScript(
          'create table script_one (id integer); create table script_two (id integer);'
        )
        await expect(
          sql`select count(*) as total from script_one, script_two`.execute(
            handle.db
          )
        ).resolves.toMatchObject({ rows: [{ total: 0 }] })
      } finally {
        await handle.destroy()
      }
    })
  })

  it.runIf(backend === 'sqlite')(
    'counts callers queued for the single SQLite connection',
    async () => {
      const held = await holdTransaction(db)
      let queued: Promise<unknown> | undefined
      try {
        expect(testDb.pendingAcquires()).toBe(0)
        queued = sql`select 1`.execute(db)
        await expect.poll(() => testDb.pendingAcquires()).toBe(1)
      } finally {
        await held.commit()
      }
      await expect(queued).resolves.toBeDefined()
      expect(testDb.pendingAcquires()).toBe(0)
    }
  )
})

// The pool keeps Knex's effective behaviour: `max` connections at most, a
// query that cannot get one fails after the acquire timeout instead of
// waiting forever, and a connection the server drops is replaced.
describe.runIf(backend === 'pg')('PostgreSQL pool', () => {
  const testDb = createTestDatabase({ isolated: true })
  const APPLICATION = 'activities-pool-test'
  let observer: DatabaseHandle

  const open = (
    pool: { min?: number; max?: number },
    acquireConnectionTimeout?: number
  ) => {
    const config = getTestDatabaseConfig('pg', true)
    if (config.client !== 'pg' || typeof config.connection === 'string') {
      throw new Error('expected a pg configuration object')
    }
    return createDatabaseConnection({
      ...config,
      connection: { ...config.connection, application_name: APPLICATION },
      pool,
      ...(acquireConnectionTimeout ? { acquireConnectionTimeout } : {})
    })
  }

  // Backends of the pool under test, as the server sees them.
  const backendPids = async () => {
    const { rows } = await sql<{ pid: number }>`
      select pid from pg_stat_activity
      where application_name = ${APPLICATION} and datname = current_database()
      order by pid
    `.execute(observer.db)
    return rows.map(({ pid }) => pid)
  }

  beforeAll(async () => {
    await testDb.prepare()
    observer = createDatabaseConnection(getTestDatabaseConfig('pg', true))
  })

  afterAll(async () => {
    await observer.destroy()
    await testDb.destroy()
  })

  it('names its connections Activities.next unless configured otherwise', async () => {
    const { rows } = await sql<{
      name: string
    }>`select current_setting('application_name') as name`.execute(observer.db)
    expect(rows).toEqual([{ name: 'Activities.next' }])
  })

  // A Knex-shaped ACTIVITIES_DATABASE without `connection` leaves the
  // connection settings to node-postgres' PG* environment variables.
  it('connects through the PG* variables when the JSON has no connection', async () => {
    const config = getTestDatabaseConfig('pg', true)
    if (config.client !== 'pg' || typeof config.connection === 'string') {
      throw new Error('expected a pg configuration object')
    }
    const { host, port, user, password, database } = config.connection
    const variables = {
      PGHOST: host,
      PGPORT: port,
      PGUSER: user,
      PGPASSWORD: password,
      PGDATABASE: database
    }
    const saved = Object.fromEntries(
      Object.keys(variables).map((name) => [name, process.env[name]])
    )
    for (const [name, value] of Object.entries(variables)) {
      if (value === undefined || value === null) delete process.env[name]
      else process.env[name] = String(value)
    }
    const handle = createDatabaseConnection(
      parseKnexDatabaseConfig({ client: 'pg' })
    )
    try {
      const { rows } = await sql<{
        name: string
      }>`select current_database() as name`.execute(handle.db)
      expect(rows).toEqual([{ name: database }])
    } finally {
      await handle.destroy()
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it('never opens more than max connections', async () => {
    const handle = open({ min: 0, max: 2 })
    const connections = new Set<string>()
    handle.onQuery(({ connection }) => connections.add(connection))
    try {
      let busiest = 0
      const watching = (async () => {
        for (let i = 0; i < 20; i += 1) {
          busiest = Math.max(busiest, (await backendPids()).length)
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
      })()
      await Promise.all(
        Array.from({ length: 8 }, () =>
          sql`select pg_sleep(0.05)`.execute(handle.db)
        )
      )
      await watching
      expect(connections.size).toBe(2)
      expect(busiest).toBeLessThanOrEqual(2)
      expect(busiest).toBeGreaterThan(0)
    } finally {
      await handle.destroy()
    }
  })

  it('fails a query that waits longer than the acquire timeout', async () => {
    const handle = open({ min: 0, max: 1 }, 300)
    const held = await holdTransaction(handle.db)
    try {
      const startedAt = Date.now()
      const waiting = sql`select 1`.execute(handle.db)
      await expect.poll(() => handle.pendingAcquires()).toBe(1)
      await expect(waiting).rejects.toThrow(
        'timeout exceeded when trying to connect'
      )
      expect(Date.now() - startedAt).toBeLessThan(5_000)
      expect(handle.pendingAcquires()).toBe(0)
    } finally {
      await held.commit()
      await handle.destroy()
    }
  })

  it('survives the server dropping an idle connection, and reconnects', async () => {
    const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const handle = open({ min: 1, max: 1 })
    try {
      const pid = async () => {
        const { rows } = await sql<{
          pid: number
        }>`select pg_backend_pid() as pid`.execute(handle.db)
        return rows[0].pid
      }
      const first = await pid()
      await sql`select pg_terminate_backend(${first})`.execute(observer.db)
      // The pool reports the idle client's error instead of crashing.
      await expect
        .poll(() => errors.mock.calls.length, { timeout: 5_000 })
        .toBeGreaterThan(0)
      expect(errors).toHaveBeenCalledWith(
        {
          err: expect.objectContaining({
            type: 'DatabaseError',
            code: '57P01',
            message: 'terminating connection due to administrator command'
          })
        },
        'PostgreSQL idle client error'
      )
      // The client node-postgres attaches to the error stays out of the log.
      for (const [entry] of errors.mock.calls) {
        expect(entry).not.toHaveProperty('err.client')
      }
      const second = await pid()
      expect(second).not.toBe(first)
      // Logged once: the pool reports an idle client's error, and the
      // client's own listener stays quiet while the client is idle.
      expect(errors).toHaveBeenCalledTimes(1)
    } finally {
      errors.mockRestore()
      await handle.destroy()
    }
  })

  // While a client is checked out, here by a transaction left open while the
  // app awaits something else, the pool has no listener on it. Without the
  // connection's own listener the server ending the backend would emit an
  // unhandled `error` and crash the process.
  it('survives the server dropping a connection inside an open transaction', async () => {
    const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const crashes: unknown[] = []
    const onCrash = (error: unknown) => {
      crashes.push(error)
    }
    process.on('uncaughtException', onCrash)
    process.on('unhandledRejection', onCrash)
    const handle = open({ min: 0, max: 1 })
    let held: HeldTransaction | undefined
    try {
      held = await holdTransaction(handle.db)
      const { rows } = await sql<{
        pid: number
      }>`select pg_backend_pid() as pid`.execute(held.trx)
      await sql`select pg_terminate_backend(${rows[0].pid})`.execute(
        observer.db
      )
      await expect
        .poll(() => errors.mock.calls.length, { timeout: 5_000 })
        .toBeGreaterThan(0)
      expect(errors).toHaveBeenCalledWith(
        {
          err: expect.objectContaining({
            type: 'DatabaseError',
            code: '57P01',
            message: 'terminating connection due to administrator command'
          })
        },
        'PostgreSQL client error'
      )
      for (const [, message] of errors.mock.calls) {
        expect(message).toBe('PostgreSQL client error')
      }
      // The transaction ended with its connection; the pool replaces it.
      await held.rollback().catch(() => undefined)
      held = undefined
      const after = await sql<{
        one: number
      }>`select 1 as one`.execute(handle.db)
      expect(after.rows).toEqual([{ one: 1 }])
      expect(crashes).toEqual([])
    } finally {
      await held?.rollback().catch(() => undefined)
      process.off('uncaughtException', onCrash)
      process.off('unhandledRejection', onCrash)
      errors.mockRestore()
      await handle.destroy()
    }
  })

  // node-postgres hands the new client to a connect() that was already in
  // flight when the pool started ending; unreleased, it would keep destroy()
  // waiting forever.
  it('does not hang when destroyed while a query is still connecting', async () => {
    const { default: pg } = await import('pg')
    const connect = pg.Client.prototype.connect
    let connecting = () => {}
    const started = new Promise<void>((resolve) => {
      connecting = resolve
    })
    const delayed = vi
      .spyOn(pg.Client.prototype, 'connect')
      .mockImplementation(function (
        this: InstanceType<typeof pg.Client>,
        ...args: Parameters<typeof connect>
      ) {
        connecting()
        setTimeout(() => connect.apply(this, args), 200)
        return undefined as unknown as ReturnType<typeof connect>
      } as typeof connect)
    const handle = open({ min: 0, max: 2 })
    try {
      const query = sql`select 1`.execute(handle.db).then(
        () => 'resolved',
        (error: Error) => error.message
      )
      await started
      await handle.destroy()
      await expect(query).resolves.toBe('driver has already been destroyed')
      await expect.poll(backendPids).toEqual([])
    } finally {
      delayed.mockRestore()
    }
  })

  it('closes every connection on destroy', async () => {
    const handle = open({ min: 1, max: 3 })
    await Promise.all(
      Array.from({ length: 3 }, () =>
        sql`select pg_sleep(0.05)`.execute(handle.db)
      )
    )
    expect((await backendPids()).length).toBeGreaterThan(0)
    await handle.destroy()
    await expect.poll(backendPids).toEqual([])
  })
})

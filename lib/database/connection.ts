import {
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresDialect,
  type PostgresPool,
  type QueryCompiler,
  type QueryResult,
  SqliteAdapter,
  type SqliteDatabase,
  SqliteDialect,
  type TransactionSettings
} from 'kysely'
import type { Pool, PoolConfig } from 'pg'

import {
  DEFAULT_POSTGRES_POOL,
  type DatabaseConfig,
  type PostgresDatabaseConfig
} from '@/lib/config/database'
import type { DB } from '@/lib/database/kysely/db'
import {
  type DatabaseKey,
  assertOutsideTransactionScope
} from '@/lib/database/kysely/guard'
import {
  createPostgresTypeParsers,
  createRawPostgresTypeParsers,
  normalizeSqliteRows,
  toSqliteBinding
} from '@/lib/database/kysely/normalize'
import { getTraceparentCommentSuffix } from '@/lib/database/sqlcommenter'
import { dynamicImport } from '@/lib/utils/dynamicImport'
import { logger } from '@/lib/utils/logger'

// The application's own database connection: Kysely's stock SQLite and
// PostgreSQL dialects, with a driver decorator (`InstrumentedDriver`) that
//
// - refuses a root-instance query inside a transaction of the same database
//   (lib/database/kysely/guard.ts) before it waits for a connection;
// - appends the sqlcommenter `traceparent` comment when `sqlcommenter` is on
//   (the application's instance; scripts and tests leave it off);
// - tells `onQuery` / `onQueryEnd` listeners about every statement.
//
// Results come back normalised (lib/database/kysely/normalize.ts) on both
// backends: on SQLite by the statement wrapper below, from each statement's
// declared column types; on PostgreSQL by the type parsers every pooled client
// is created with. `normalizeResults: false` turns both off for the production
// archive, which reads and writes rows as the drivers read them, except that
// PostgreSQL dates and timestamps stay the text the server sends, in ISO
// style and UTC (`CANONICAL_DATE_OUTPUT`).

export type DatabaseBackend = 'sqlite' | 'pg'

/** A statement as it is sent: the SQL, its bindings and its connection. */
export type QueryEvent = {
  sql: string
  bindings: unknown[]
  /**
   * An opaque id of the database connection that ran the statement: two
   * statements ran on the same connection exactly when these are equal.
   */
  connection: string
}

/** A statement once it has finished, successfully or not. */
export type QueryEndEvent = QueryEvent & {
  durationMs: number
  /** What the statement failed with; absent when it succeeded. */
  error?: unknown
}

export type CreateDatabaseConnectionOptions = {
  /** Append the sqlcommenter `traceparent` comment to every statement. */
  sqlcommenter?: boolean
  /**
   * Normalise results (lib/database/kysely/normalize.ts); on by default.
   * Off, rows come back close to how the driver reads them: on PostgreSQL
   * node-postgres's default types (int8 and numeric as strings, booleans,
   * JSON parsed), except that `date`, `timestamp` and `timestamptz` values
   * are the text the server sends, with each connection's `DateStyle` set to
   * ISO and `TimeZone` to UTC (`2026-01-02`, `2026-02-03 04:05:06.789123+00`),
   * rather than a `Date`, which would lose microseconds and read a `date` as
   * local midnight; on SQLite the stored values (0/1, epoch ms or text, JSON
   * text). For the production archive, which exports and restores rows in
   * these forms. Bindings are encoded the same way either way.
   */
  normalizeResults?: boolean
}

export type DatabaseHandle = {
  backend: DatabaseBackend
  /** The root Kysely instance. */
  db: Kysely<DB>
  /** Closes the pool (PostgreSQL) or the database handle (SQLite). */
  destroy: () => Promise<void>
  /**
   * Calls `listener` for every statement, just before it is sent. A listener
   * that throws fails that statement. Returns the function that stops it.
   */
  onQuery: (listener: (event: QueryEvent) => void) => () => void
  /** Calls `listener` when each statement has finished. */
  onQueryEnd: (listener: (event: QueryEndEvent) => void) => () => void
  /**
   * How many callers are waiting for a connection: on SQLite the ones queued
   * for its single connection, on PostgreSQL the ones waiting for a free
   * pooled client.
   */
  pendingAcquires: () => number
  /**
   * Runs a multi-statement SQL script (a schema dump) outside Kysely: with
   * better-sqlite3's `exec` on SQLite's connection, and on a PostgreSQL client
   * of its own that is closed afterwards, so session settings the script
   * changes (pg_dump's empty search_path) never reach the pool.
   */
  executeScript: (script: string) => Promise<void>
}

// How long a query waits for a free pooled connection before it fails, as
// Knex's acquireConnectionTimeout did. node-postgres waits forever by default.
export const DEFAULT_ACQUIRE_CONNECTION_TIMEOUT_MS = 60_000
// How long an idle pooled connection is kept above `min` (Knex's pool: 30 s).
export const POOL_IDLE_TIMEOUT_MS = 30_000
const APPLICATION_NAME = 'Activities.next'

// What the connection needs of better-sqlite3 (it ships no type declarations).
type BetterSqliteStatement = {
  readonly reader: boolean
  columns(): { name: string; type: string | null }[]
  all(parameters: unknown[]): Record<string, unknown>[]
  run(parameters: unknown[]): {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }
  iterate(parameters: unknown[]): IterableIterator<Record<string, unknown>>
}

type BetterSqliteDatabase = {
  prepare(sql: string): BetterSqliteStatement
  exec(sql: string): unknown
  close(): unknown
}

type BetterSqliteConstructor = new (filename: string) => BetterSqliteDatabase

type PgModule = typeof import('pg')

// Kysely's SQLite driver runs statements through this interface. Bindings are
// encoded the way Knex encoded them (Date -> epoch ms, boolean -> 0/1) and,
// unless `normalize` is off, rows are normalised by their declared column
// types.
const wrapBetterSqlite = (
  database: BetterSqliteDatabase,
  normalize: boolean
): SqliteDatabase => ({
  close: () => {
    database.close()
  },
  prepare(sql) {
    const statement = database.prepare(sql)
    const bind = (parameters: ReadonlyArray<unknown>) =>
      parameters.map(toSqliteBinding)
    if (!normalize) {
      return {
        reader: statement.reader,
        all: (parameters) => statement.all(bind(parameters)),
        run: (parameters) => statement.run(bind(parameters)),
        iterate: (parameters) => statement.iterate(bind(parameters))
      }
    }
    return {
      reader: statement.reader,
      all: (parameters) =>
        normalizeSqliteRows(
          statement.all(bind(parameters)),
          statement.columns()
        ),
      run: (parameters) => statement.run(bind(parameters)),
      *iterate(parameters) {
        const columns = statement.columns()
        for (const row of statement.iterate(bind(parameters))) {
          yield normalizeSqliteRows([row], columns)[0]
        }
      }
    }
  }
})

// Kysely only gives its own SQLite driver a mutex when the adapter says the
// backend has a single connection, and it takes the mutex BEFORE asking the
// driver for the connection, so a guarded driver could never refuse a
// root-instance query inside a transaction: the query would already be
// waiting for the transaction's connection. This adapter lets the
// instrumented driver hold that mutex itself, after the guard.
class SerializedSqliteAdapter extends SqliteAdapter {
  override get supportsMultipleConnections() {
    return true
  }
}

// The one-at-a-time lock of SQLite's single connection, with a count of who
// is waiting.
class ConnectionMutex {
  #locked = false
  readonly #waiting: (() => void)[] = []

  get waiting() {
    return this.#waiting.length
  }

  async lock() {
    if (!this.#locked) {
      this.#locked = true
      return
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve))
  }

  unlock() {
    const next = this.#waiting.shift()
    if (next) next()
    else this.#locked = false
  }
}

type Listeners = {
  query: Set<(event: QueryEvent) => void>
  end: Set<(event: QueryEndEvent) => void>
}

// Exported for the tests that stage a concurrent write between two of a
// method's statements on the statement's own connection.
export class InstrumentedConnection implements DatabaseConnection {
  readonly inner: DatabaseConnection
  readonly #id: string
  readonly #sqlcommenter: boolean
  readonly #listeners: Listeners

  constructor(
    inner: DatabaseConnection,
    id: string,
    sqlcommenter: boolean,
    listeners: Listeners
  ) {
    this.inner = inner
    this.#id = id
    this.#sqlcommenter = sqlcommenter
    this.#listeners = listeners
  }

  // The statement as it is sent, and its announcement.
  #prepare(compiledQuery: CompiledQuery) {
    const suffix = this.#sqlcommenter ? getTraceparentCommentSuffix() : null
    const query: CompiledQuery = suffix
      ? { ...compiledQuery, sql: `${compiledQuery.sql}${suffix}` }
      : compiledQuery
    const event: QueryEvent = {
      sql: query.sql,
      bindings: [...compiledQuery.parameters],
      connection: this.#id
    }
    // Each listener gets its own copy of the bindings.
    for (const listener of this.#listeners.query) {
      listener({ ...event, bindings: [...event.bindings] })
    }
    return { query, event }
  }

  #settle(event: QueryEvent, startedAt: number, error?: unknown) {
    if (this.#listeners.end.size === 0) return
    const durationMs = performance.now() - startedAt
    for (const listener of this.#listeners.end) {
      try {
        listener({
          ...event,
          bindings: [...event.bindings],
          durationMs,
          ...(error === undefined ? {} : { error })
        })
      } catch {
        // A finished statement's result does not depend on its observers.
      }
    }
  }

  async executeQuery<R>(
    compiledQuery: CompiledQuery,
    options?: Parameters<DatabaseConnection['executeQuery']>[1]
  ): Promise<QueryResult<R>> {
    const { query, event } = this.#prepare(compiledQuery)
    const startedAt = performance.now()
    try {
      const result = await this.inner.executeQuery<R>(query, options)
      this.#settle(event, startedAt)
      return result
    } catch (error) {
      this.#settle(event, startedAt, error)
      throw error
    }
  }

  async *streamQuery<R>(
    compiledQuery: CompiledQuery,
    chunkSize: number,
    options?: Parameters<DatabaseConnection['streamQuery']>[2]
  ): AsyncIterableIterator<QueryResult<R>> {
    const { query, event } = this.#prepare(compiledQuery)
    const startedAt = performance.now()
    try {
      yield* this.inner.streamQuery<R>(query, chunkSize, options)
      this.#settle(event, startedAt)
    } catch (error) {
      this.#settle(event, startedAt, error)
      throw error
    }
  }
}

const unwrap = (connection: DatabaseConnection) =>
  connection instanceof InstrumentedConnection ? connection.inner : connection

class InstrumentedDriver implements Driver {
  readonly #inner: Driver
  readonly #key: DatabaseKey
  readonly #sqlcommenter: boolean
  readonly #listeners: Listeners
  readonly #mutex: ConnectionMutex | null
  readonly #connections = new WeakMap<
    DatabaseConnection,
    InstrumentedConnection
  >()
  #connectionCount = 0
  #destroyed = false

  constructor({
    inner,
    key,
    sqlcommenter,
    listeners,
    mutex
  }: {
    inner: Driver
    key: DatabaseKey
    sqlcommenter: boolean
    listeners: Listeners
    mutex: ConnectionMutex | null
  }) {
    this.#inner = inner
    this.#key = key
    this.#sqlcommenter = sqlcommenter
    this.#listeners = listeners
    this.#mutex = mutex
  }

  // Kysely's own destroy does nothing on a driver that never connected, and
  // its next query would then open a pool nobody closes. So the handle marks
  // the driver destroyed first, and it refuses to start again.
  markDestroyed() {
    this.#destroyed = true
  }

  assertNotDestroyed() {
    if (this.#destroyed) throw new Error('driver has already been destroyed')
  }

  async init(options?: Parameters<Driver['init']>[0]) {
    this.assertNotDestroyed()
    await this.#inner.init(options)
  }

  async acquireConnection(
    options?: Parameters<Driver['acquireConnection']>[0]
  ): Promise<DatabaseConnection> {
    this.assertNotDestroyed()
    assertOutsideTransactionScope(this.#key)
    await this.#mutex?.lock()
    let inner: DatabaseConnection
    try {
      inner = await this.#inner.acquireConnection(options)
    } catch (error) {
      this.#mutex?.unlock()
      throw error
    }
    let connection = this.#connections.get(inner)
    if (!connection) {
      this.#connectionCount += 1
      connection = new InstrumentedConnection(
        inner,
        `connection-${this.#connectionCount}`,
        this.#sqlcommenter,
        this.#listeners
      )
      this.#connections.set(inner, connection)
    }
    return connection
  }

  async releaseConnection(
    connection: DatabaseConnection,
    options?: Parameters<Driver['releaseConnection']>[1]
  ) {
    try {
      await this.#inner.releaseConnection(unwrap(connection), options)
    } finally {
      this.#mutex?.unlock()
    }
  }

  // The stock drivers run these through `connection.executeQuery`, so passing
  // the instrumented connection reports `begin`, `commit`, `rollback` and the
  // savepoint statements like any other.
  beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings
  ) {
    return this.#inner.beginTransaction(connection, settings)
  }

  commitTransaction(connection: DatabaseConnection) {
    return this.#inner.commitTransaction(connection)
  }

  rollbackTransaction(connection: DatabaseConnection) {
    return this.#inner.rollbackTransaction(connection)
  }

  async savepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler['compileQuery']
  ) {
    await this.#inner.savepoint?.(connection, savepointName, compileQuery)
  }

  async rollbackToSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler['compileQuery']
  ) {
    await this.#inner.rollbackToSavepoint?.(
      connection,
      savepointName,
      compileQuery
    )
  }

  async releaseSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler['compileQuery']
  ) {
    await this.#inner.releaseSavepoint?.(
      connection,
      savepointName,
      compileQuery
    )
  }

  async destroy(options?: Parameters<Driver['destroy']>[0]) {
    await this.#inner.destroy(options)
  }

  get pendingAcquires() {
    return this.#mutex?.waiting ?? 0
  }
}

const loadPg = async (): Promise<PgModule> => {
  // Through dynamicImport so the bundler never resolves `pg`: the minimal
  // image is built without it (it comes with the @activities/pg workspace).
  const loaded = await dynamicImport<PgModule & { default?: PgModule }>('pg')
  return loaded.default ?? loaded
}

const getPostgresClientConfig = (config: PostgresDatabaseConfig) => {
  const connection =
    typeof config.connection === 'string'
      ? { connectionString: config.connection }
      : config.connection
  return { application_name: APPLICATION_NAME, ...connection } as PoolConfig
}

const createPool = (
  pg: PgModule,
  config: PostgresDatabaseConfig,
  normalize: boolean
): Pool => {
  const pool = new pg.Pool({
    ...getPostgresClientConfig(config),
    min: config.pool?.min ?? DEFAULT_POSTGRES_POOL.min,
    max: config.pool?.max ?? DEFAULT_POSTGRES_POOL.max,
    connectionTimeoutMillis:
      config.acquireConnectionTimeout ?? DEFAULT_ACQUIRE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    // Not normalising, node-postgres's defaults (the global `pg.types`),
    // except for dates and timestamps, which stay text.
    types: normalize
      ? createPostgresTypeParsers(pg.types)
      : createRawPostgresTypeParsers(pg.types)
  })
  // A client's connection can fail (a server restart, pg_terminate_backend, a
  // network drop) while it is idle in the pool or while it is checked out
  // between statements, for example in an open transaction while the app
  // awaits something else. node-postgres emits `error` on the client, and an
  // `error` event without a listener crashes the process. For an idle client
  // the pool's own listener drops the client and re-emits the error on the
  // pool; while the client is checked out the pool has no listener on it, so
  // each client gets one of its own. The pool's listener logs an idle
  // client's error and the client's listener a checked-out client's, so each
  // failure is logged once. The next query gets a new connection.
  const checkedOut = new WeakSet<object>()
  pool.on('acquire', (client) => checkedOut.add(client))
  pool.on('release', (_error, client) => checkedOut.delete(client))
  pool.on('error', (error) => {
    logger.error({ err: describeError(error) }, 'PostgreSQL idle client error')
  })
  pool.on('connect', (client) => {
    client.on('error', (error) => {
      if (!checkedOut.has(client)) return
      logger.error({ err: describeError(error) }, 'PostgreSQL client error')
    })
  })
  return pool
}

// node-postgres attaches the client to an idle client's error (`err.client`);
// the log gets the error without it, so a whole client object and its
// connection settings never reach the log.
const describeError = (error: Error) => {
  const { client: _client, ...fields } = error as Error & { client?: unknown }
  // The spread copies the error's own fields (code, severity, detail, ...);
  // message and stack are not own enumerable fields, so they are set after.
  return {
    ...fields,
    type: error.constructor.name,
    message: error.message,
    stack: error.stack
  }
}

// A connection that does not normalise results (the production archive's)
// reads dates and timestamps as the text the server sends, which depends on
// the session's `DateStyle` and `TimeZone`. Each new connection sets both
// (ISO, UTC), so the text is the same whatever the server, database or role
// defaults are: `2026-01-02`, `2026-02-03 04:05:06.789123+00`. A statement
// rather than the `options` startup parameter, so it works with any
// connection configuration (a connection string, a socket, a connector's
// stream) and through poolers that reject startup options. It runs in the
// pool below, before Kysely's driver gets the client, so `onQuery` listeners
// do not see it. The app's normalising connection keeps the server's
// settings.
const CANONICAL_DATE_OUTPUT =
  "select set_config('DateStyle', 'ISO', false), " +
  "set_config('TimeZone', 'UTC', false)"

// The pool Kysely's driver gets.
//
// node-postgres still hands a client to a `connect()` that was already waiting
// for a new connection when `end()` was called. Kysely's driver drops its pool
// before calling `end()`, so it fails on that client without releasing it,
// and `end()` then waits for the client forever. This pool releases such a
// client itself and fails that `connect()`.
//
// With `canonicalDates`, it also runs `CANONICAL_DATE_OUTPUT` once on each new
// physical connection (node-postgres creates a new `Client` for each), and
// checks for `end()` again afterwards. Kysely's own `onCreateConnection` hook
// would not release a client whose statement fails, so `end()` would wait for
// it forever; here the failed client is released with the error, which
// destroys it, and the `connect()` fails.
const releaseLateClients = (
  pool: Pool,
  pg: PgModule,
  canonicalDates: boolean
): PostgresPool => {
  let ending = false
  const prepared = new WeakSet<object>()
  return {
    // What Kysely's driver reads off a pg Pool besides these two methods.
    Client: pg.Client as PostgresPool['Client'],
    options: pool.options,
    async connect() {
      const client = await pool.connect()
      if (ending) {
        client.release()
        throw new Error('driver has already been destroyed')
      }
      if (canonicalDates && !prepared.has(client)) {
        try {
          await client.query(CANONICAL_DATE_OUTPUT)
        } catch (error) {
          client.release(error as Error)
          throw error
        }
        prepared.add(client)
        // end() may have been called while the statement ran.
        if (ending) {
          client.release()
          throw new Error('driver has already been destroyed')
        }
      }
      return client
    },
    async end() {
      ending = true
      await pool.end()
    }
  }
}

/**
 * Opens a database connection on Kysely's own dialects. Nothing connects
 * until the first query. Only better-sqlite3 and pg are supported.
 */
export const createDatabaseConnection = (
  config: DatabaseConfig,
  {
    sqlcommenter = false,
    normalizeResults = true
  }: CreateDatabaseConnectionOptions = {}
): DatabaseHandle => {
  // Typed as a supported client, but it comes from the environment.
  const client: unknown = (config as { client?: unknown } | undefined)?.client
  if (client !== 'better-sqlite3' && client !== 'pg') {
    throw new Error(
      `Unsupported database client "${String(client)}": only ` +
        'better-sqlite3 (SQLite) and pg (PostgreSQL) are supported; set ' +
        'ACTIVITIES_DATABASE_CLIENT accordingly (see docs/setup.md).'
    )
  }
  const backend: DatabaseBackend =
    config.client === 'better-sqlite3' ? 'sqlite' : 'pg'
  const listeners: Listeners = { query: new Set(), end: new Set() }

  let sqliteDatabase: BetterSqliteDatabase | null = null
  let pool: Pool | null = null
  let pg: PgModule | null = null

  const stock: Dialect =
    config.client === 'better-sqlite3'
      ? new SqliteDialect({
          database: async () => {
            // A literal specifier so the Next.js standalone trace keeps it.
            // @ts-expect-error better-sqlite3 does not ship type declarations
            const module = await import('better-sqlite3')
            const Database = (module.default ??
              module) as BetterSqliteConstructor
            sqliteDatabase = new Database(config.connection.filename)
            return wrapBetterSqlite(sqliteDatabase, normalizeResults)
          }
        })
      : new PostgresDialect({
          pool: async () => {
            pg = await loadPg()
            pool = createPool(pg, config, normalizeResults)
            return releaseLateClients(pool, pg, !normalizeResults)
          }
        })

  const adapter =
    backend === 'sqlite' ? new SerializedSqliteAdapter() : new PostgresAdapter()
  const driver = new InstrumentedDriver({
    inner: stock.createDriver(),
    key: adapter,
    sqlcommenter,
    listeners,
    mutex: backend === 'sqlite' ? new ConnectionMutex() : null
  })
  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => adapter,
      createDriver: () => driver,
      createQueryCompiler: () => stock.createQueryCompiler(),
      createIntrospector: (kysely) => stock.createIntrospector(kysely)
    }
  })

  const subscribe =
    <L>(set: Set<L>) =>
    (listener: L) => {
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    }

  return {
    backend,
    db,
    destroy: async () => {
      driver.markDestroyed()
      await db.destroy()
    },
    onQuery: subscribe(listeners.query),
    onQueryEnd: subscribe(listeners.end),
    pendingAcquires: () =>
      backend === 'sqlite'
        ? driver.pendingAcquires
        : ((pool as Pool | null)?.waitingCount ?? 0),
    async executeScript(script) {
      driver.assertNotDestroyed()
      if (config.client === 'better-sqlite3') {
        // Holds the single connection (opening it on first use) while the
        // script runs.
        await db.connection().execute(async () => {
          ;(sqliteDatabase as BetterSqliteDatabase | null)?.exec(script)
        })
        return
      }
      const module = pg ?? (await loadPg())
      const client = new module.Client(getPostgresClientConfig(config))
      await client.connect()
      try {
        await client.query(script)
      } finally {
        await client.end()
      }
    }
  }
}

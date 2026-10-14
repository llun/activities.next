import { type DatabaseConfig, getDatabaseConfig } from '@/lib/config/database'

// Standalone so every recovery script can print WHICH database it is about to
// touch. @next/env loads `.env.local` at higher precedence than `.env.production`
// even under NODE_ENV=production, so a stray `.env.local` silently points a
// recovery script at local SQLite and it then reports "nothing to do". Imports
// only from '@/lib/config/database' so scripts keep running standalone via
// scripts/run.cjs.

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'activities.local',
  'host.docker.internal',
  'postgres'
])

const POSTGRES_CLIENTS = new Set(['pg', 'postgres', 'postgresql'])

/**
 * The host a connection string names, as node-postgres's parser
 * (pg-connection-string) reads it: a `host` query parameter wins over the
 * URL's host; `''` when it names none (node-postgres then takes PGHOST, else
 * localhost). A unix socket comes back as its path (a string starting with
 * `/`, a `socket:` URL, or a `host` parameter such as Cloud SQL's
 * `/cloudsql/…`). `undefined` when the string cannot be parsed.
 */
const getConnectionStringHost = (
  connectionString: string
): string | undefined => {
  if (connectionString.startsWith('/')) return connectionString.split(' ')[0]
  try {
    const encoded = / |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(connectionString)
      ? encodeURI(connectionString).replace(/%25(\d\d)/g, '%$1')
      : connectionString
    let url: URL
    let dummyHost = false
    try {
      url = new URL(encoded, 'postgres://base')
    } catch {
      // `postgresql://user@/db?host=…` has no host; parse it with a dummy one.
      url = new URL(encoded.replace('@/', '@___DUMMY___/'), 'postgres://base')
      dummyHost = true
    }
    if (url.protocol === 'socket:') return decodeURI(url.pathname)
    const queryHost = url.searchParams.get('host')
    if (queryHost) return queryHost
    return decodeURIComponent(
      (dummyHost ? '' : url.hostname).replace(/^\[(.+)\]$/, '$1')
    )
  } catch {
    return undefined
  }
}

export interface ConnectionInfo {
  client: string
  target: string
  isLocal: boolean
}

/**
 * Describes `database`: the app's configured database unless the caller
 * resolved one itself (the migration CLI resolves it as the Knex CLI did).
 */
export const describeConnection = (
  database: DatabaseConfig | null = getDatabaseConfig()?.database ?? null
): ConnectionInfo => {
  if (!database) {
    return { client: '(unset)', target: '(no database config)', isLocal: true }
  }

  const client = String(database.client ?? '(unknown)')
  const conn = database.connection as
    | {
        host?: string
        port?: number
        database?: string
        user?: string
        filename?: string
        connectionString?: unknown
      }
    | string
    | undefined

  if (client.includes('sqlite')) {
    const filename =
      typeof conn === 'object' && conn
        ? (conn.filename ?? '(memory)')
        : '(memory)'
    return { client, target: `file ${filename}`, isLocal: true }
  }

  // node-postgres takes a `connectionString` key over the object's other
  // settings (pg/lib/connection-parameters.js), so it is a connection string
  // here too. An empty one is ignored, as node-postgres ignores it.
  const connectionString =
    typeof conn === 'string'
      ? conn
      : conn &&
          typeof conn === 'object' &&
          typeof conn.connectionString === 'string' &&
          conn.connectionString !== ''
        ? conn.connectionString
        : undefined
  if (connectionString !== undefined) {
    // A connection URI may embed the password — never print it. It is local
    // only when the host node-postgres connects to is: its own host, else
    // PGHOST, else localhost.
    const host = getConnectionStringHost(connectionString)
    return {
      client,
      target: '(connection string — hidden)',
      isLocal:
        host !== undefined &&
        LOCAL_HOSTS.has(host || process.env.PGHOST || 'localhost')
    }
  }

  if (POSTGRES_CLIENTS.has(client) && typeof conn !== 'string') {
    // What node-postgres connects to (pg/lib/connection-parameters.js): each
    // setting from the configuration, else its PG* environment variable, else
    // node-postgres's default (localhost, 5432, the OS user); the database
    // defaults to the user name. Say where each one not configured came from.
    const settings = conn ?? {}
    const fromEnvironment: string[] = []
    const defaulted: string[] = []
    const setting = (
      value: string | number | undefined,
      variable: string,
      name: string,
      fallback?: string
    ): string | undefined => {
      // node-postgres takes a configured value only when it is truthy.
      if (value) return String(value)
      const fromVariable = process.env[variable]
      if (fromVariable) {
        fromEnvironment.push(variable)
        return fromVariable
      }
      if (fallback) defaulted.push(name)
      return fallback || undefined
    }
    const osUser =
      process.platform === 'win32' ? process.env.USERNAME : process.env.USER
    const host = setting(settings.host, 'PGHOST', 'host', 'localhost')
    const port = setting(settings.port, 'PGPORT', 'port', '5432')
    let db = setting(settings.database, 'PGDATABASE', 'db')
    const user = setting(settings.user, 'PGUSER', 'user', osUser)
    const dbIsUser = db === undefined && user !== undefined
    if (dbIsUser) db = user
    const sources = [
      ...(fromEnvironment.length > 0
        ? [`from ${fromEnvironment.join(', ')}`]
        : []),
      ...(defaulted.length > 0
        ? [`node-postgres default ${defaulted.join(', ')}`]
        : []),
      ...(dbIsUser ? ['db defaults to the user'] : [])
    ]
    const source = sources.length > 0 ? ` (${sources.join('; ')})` : ''
    return {
      client,
      target: `host ${host}:${port} / db ${db ?? '(unset)'} / user ${user ?? '(unset)'}${source}`,
      // A unix socket directory is not counted as local: Cloud SQL's
      // (/cloudsql/…) is one.
      isLocal: LOCAL_HOSTS.has(host ?? '')
    }
  }

  if (conn && typeof conn === 'object') {
    const host = conn.host ?? '(unset)'
    const db = conn.database ?? '(unset)'
    return {
      client,
      target: `host ${host}${conn.port ? `:${conn.port}` : ''} / db ${db} / user ${conn.user ?? '(unset)'}`,
      isLocal: LOCAL_HOSTS.has(host)
    }
  }

  return { client, target: '(unknown connection)', isLocal: true }
}

/**
 * Print the resolved database target and a loud warning when it looks local, so
 * an operator sees which database a recovery script is about to mutate. Returns
 * the {@link ConnectionInfo} so callers can branch on `isLocal` if they want.
 */
export const printDatabaseBanner = (): ConnectionInfo => {
  const info = describeConnection()
  console.log(`Database: ${info.client} — ${info.target}`)
  if (info.isLocal) {
    console.log(
      '  ! This looks LOCAL — the script would run against this, NOT production.\n' +
        '    If you meant production, move .env.local aside so .env.production wins:\n' +
        '    mv .env.local .env.local.off   (restore it after)'
    )
  }
  return info
}

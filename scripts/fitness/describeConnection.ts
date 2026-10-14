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

  if (typeof conn === 'string') {
    // A connection URI may embed the password — never print it. Best-effort
    // local detection: a bare local host, a unix socket path, or a URL whose
    // host is local. `new URL` throws on a plain hostname, so guard it.
    let isLocal = LOCAL_HOSTS.has(conn) || conn.startsWith('/')
    if (!isLocal) {
      try {
        isLocal = LOCAL_HOSTS.has(new URL(conn).hostname)
      } catch {
        isLocal = [...LOCAL_HOSTS].some((host) => conn.includes(host))
      }
    }
    return { client, target: '(connection string — hidden)', isLocal }
  }

  const isPostgres = POSTGRES_CLIENTS.has(client)
  if (
    (conn && typeof conn === 'object') ||
    (isPostgres && conn === undefined)
  ) {
    const settings = conn ?? {}
    // node-postgres reads the PG* environment variables for whatever the
    // configuration leaves out, so show those, and say where they came from.
    const fromEnvironment: string[] = []
    const setting = (
      value: string | number | undefined,
      variable: string
    ): string | undefined => {
      if (value !== undefined && value !== '') return String(value)
      const fallback = isPostgres ? process.env[variable] : undefined
      if (!fallback) return undefined
      fromEnvironment.push(variable)
      return fallback
    }
    const host = setting(settings.host, 'PGHOST') ?? '(unset)'
    const port = setting(settings.port, 'PGPORT')
    const db = setting(settings.database, 'PGDATABASE') ?? '(unset)'
    const user = setting(settings.user, 'PGUSER') ?? '(unset)'
    const source =
      fromEnvironment.length > 0 ? ` (from ${fromEnvironment.join(', ')})` : ''
    return {
      client,
      target: `host ${host}${port ? `:${port}` : ''} / db ${db} / user ${user}${source}`,
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

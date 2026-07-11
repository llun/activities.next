import { getDatabaseConfig } from '@/lib/config/database'

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

export interface ConnectionInfo {
  client: string
  target: string
  isLocal: boolean
}

export const describeConnection = (): ConnectionInfo => {
  const dbConfig = getDatabaseConfig()
  if (!dbConfig) {
    return { client: '(unset)', target: '(no database config)', isLocal: true }
  }

  const client = String(dbConfig.database.client ?? '(unknown)')
  const conn = dbConfig.database.connection as
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

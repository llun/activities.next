import { describeConnection, printDatabaseBanner } from './describeConnection'

// `isLocal` decides whether the mock seed (scripts/mock/) runs and whether the
// recovery scripts' banner says "This looks LOCAL". It must be true only for
// a host node-postgres reaches on this machine's loopback (or the local
// development aliases), read through the app's own configuration path.
const clearDatabaseEnvironment = () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ACTIVITIES_DATABASE') || key.startsWith('PG')) {
      vi.stubEnv(key, undefined)
    }
  }
}

const withConnectionString = (connectionString: string) =>
  vi.stubEnv(
    'ACTIVITIES_DATABASE',
    JSON.stringify({ client: 'pg', connection: { connectionString } })
  )

describe('describeConnection', () => {
  beforeEach(() => {
    clearDatabaseEnvironment()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('does not count a unix socket as local, including the Cloud SQL one', () => {
    vi.stubEnv('ACTIVITIES_DATABASE_CLIENT', 'pg')
    vi.stubEnv(
      'ACTIVITIES_DATABASE_PG_HOST',
      '/cloudsql/proj:asia-southeast1:prod'
    )
    expect(describeConnection().isLocal).toBe(false)

    vi.stubEnv('ACTIVITIES_DATABASE_PG_HOST', '/var/run/postgresql')
    expect(describeConnection().isLocal).toBe(false)

    // Through PGHOST, and as a connection string in each socket form.
    vi.stubEnv('ACTIVITIES_DATABASE_PG_HOST', undefined)
    vi.stubEnv('PGHOST', '/var/run/postgresql')
    expect(describeConnection().isLocal).toBe(false)
    vi.stubEnv('PGHOST', undefined)
    for (const connectionString of [
      '/var/run/postgresql app',
      'socket:/var/run/postgresql?db=app',
      'postgresql://u@%2Fvar%2Frun%2Fpostgresql/app',
      'postgresql://u:p@/db?host=/cloudsql/proj:r:i'
    ]) {
      withConnectionString(connectionString)
      expect({ connectionString, ...describeConnection() }).toEqual({
        connectionString,
        client: 'pg',
        target: '(connection string — hidden)',
        isLocal: false
      })
    }
  })

  it('takes the host parameter of a connection string over its host, as node-postgres does', () => {
    for (const connectionString of [
      'postgresql://u:p@localhost/db?host=/cloudsql/proj:r:i',
      'postgresql://u:p@localhost/db?host=prod.example.com',
      'postgresql://u@localhost/db?host=db.internal'
    ]) {
      withConnectionString(connectionString)
      expect({
        connectionString,
        isLocal: describeConnection().isLocal
      }).toEqual({ connectionString, isLocal: false })
    }

    withConnectionString('postgresql://u@prod.example.com/db?host=localhost')
    expect(describeConnection().isLocal).toBe(true)

    // The bare string form is read the same way.
    vi.stubEnv(
      'ACTIVITIES_DATABASE',
      JSON.stringify({
        client: 'pg',
        connection: 'postgresql://u:p@localhost/db?host=/cloudsql/proj:r:i'
      })
    )
    expect(describeConnection().isLocal).toBe(false)
  })

  it('reads a connection string without a host as node-postgres does: PGHOST, else localhost', () => {
    withConnectionString('postgresql:///db')
    expect(describeConnection().isLocal).toBe(true)

    vi.stubEnv('PGHOST', '10.1.2.3')
    expect(describeConnection().isLocal).toBe(false)
    vi.stubEnv('PGHOST', '/cloudsql/proj:r:i')
    expect(describeConnection().isLocal).toBe(false)
    vi.stubEnv('PGHOST', 'localhost')
    expect(describeConnection().isLocal).toBe(true)
  })

  it('does not count a connection string it cannot parse as local', () => {
    // `new URL` rejects the port; a substring match on the scheme
    // ("postgres") once counted it as local.
    withConnectionString('postgresql://u@localhost:99999999/db')
    expect(describeConnection().isLocal).toBe(false)
  })

  it('counts localhost, 127.0.0.1 and ::1 as local', () => {
    vi.stubEnv('ACTIVITIES_DATABASE_CLIENT', 'pg')
    for (const host of ['localhost', '127.0.0.1', '::1']) {
      vi.stubEnv('ACTIVITIES_DATABASE_PG_HOST', host)
      expect({ host, isLocal: describeConnection().isLocal }).toEqual({
        host,
        isLocal: true
      })
    }
    vi.stubEnv('ACTIVITIES_DATABASE_PG_HOST', 'db.internal')
    expect(describeConnection().isLocal).toBe(false)

    vi.stubEnv('ACTIVITIES_DATABASE_CLIENT', undefined)
    vi.stubEnv('ACTIVITIES_DATABASE_PG_HOST', undefined)
    for (const connectionString of [
      'postgresql://u@localhost/db',
      'postgresql://u:p@127.0.0.1:5432/db',
      'postgresql://u@[::1]:5432/db'
    ]) {
      withConnectionString(connectionString)
      expect({
        connectionString,
        isLocal: describeConnection().isLocal
      }).toEqual({ connectionString, isLocal: true })
    }
  })

  it('prints no LOCAL warning for a Cloud SQL socket', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('ACTIVITIES_DATABASE_CLIENT', 'pg')
    vi.stubEnv('ACTIVITIES_DATABASE_PG_HOST', '/cloudsql/proj:r:i')
    printDatabaseBanner()
    expect(log.mock.calls.flat().join('\n')).not.toContain('LOCAL')

    vi.stubEnv('ACTIVITIES_DATABASE_PG_HOST', 'localhost')
    printDatabaseBanner()
    expect(log.mock.calls.flat().join('\n')).toContain('This looks LOCAL')
  })
})

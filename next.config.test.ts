import fs from 'fs'
import os from 'os'
import path from 'path'

const loadGetProxyHostConfigEnv = async () => {
  jest.resetModules()
  const nextConfig = await import('./next.config')
  return nextConfig.getProxyHostConfigEnv
}

describe('getProxyHostConfigEnv', () => {
  const originalCwd = process.cwd()
  const previousEnv = {
    ACTIVITIES_ALLOW_ACTOR_DOMAINS: process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS,
    ACTIVITIES_ALLOW_EMAILS: process.env.ACTIVITIES_ALLOW_EMAILS,
    ACTIVITIES_DATABASE_CLIENT: process.env.ACTIVITIES_DATABASE_CLIENT,
    ACTIVITIES_DATABASE_SQLITE_FILENAME:
      process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME,
    ACTIVITIES_HOST: process.env.ACTIVITIES_HOST,
    ACTIVITIES_SECRET_PHASE: process.env.ACTIVITIES_SECRET_PHASE,
    ACTIVITIES_TRUSTED_HOSTS: process.env.ACTIVITIES_TRUSTED_HOSTS,
    NEXT_PHASE: process.env.NEXT_PHASE
  }

  let tempDirectory: string

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-next-'))
    process.chdir(tempDirectory)
    process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS = JSON.stringify([
      'env-actor.example.com'
    ])
    process.env.ACTIVITIES_ALLOW_EMAILS = JSON.stringify([])
    process.env.ACTIVITIES_DATABASE_CLIENT = 'better-sqlite3'
    process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME = ':memory:'
    process.env.ACTIVITIES_HOST = 'env-public.example.com'
    process.env.ACTIVITIES_SECRET_PHASE = 'test-secret'
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'env-edge.example.com'
    ])
    process.env.NEXT_PHASE = 'phase-production-build'
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDirectory, { force: true, recursive: true })
    jest.resetModules()

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('uses file host settings when the full app file config is valid', async () => {
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        host: 'file-public.example.com',
        secretPhase: 'file-secret',
        allowEmails: [],
        database: {
          client: 'better-sqlite3',
          connection: {
            filename: ':memory:'
          }
        },
        allowActorDomains: ['file-actor.example.com'],
        trustedHosts: ['file-edge.example.com']
      })
    )

    const getProxyHostConfigEnv = await loadGetProxyHostConfigEnv()

    expect(
      JSON.parse(getProxyHostConfigEnv().ACTIVITIES_PROXY_HOST_CONFIG)
    ).toEqual({
      host: 'file-public.example.com',
      allowActorDomains: ['file-actor.example.com'],
      trustedHosts: ['file-edge.example.com']
    })
  })

  it('falls back to environment host settings when raw file config fails full app config validation', async () => {
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        host: 'raw-file-public.example.com',
        trustedHosts: ['raw-file-edge.example.com']
      })
    )

    const getProxyHostConfigEnv = await loadGetProxyHostConfigEnv()

    expect(
      JSON.parse(getProxyHostConfigEnv().ACTIVITIES_PROXY_HOST_CONFIG)
    ).toEqual({
      host: 'env-public.example.com',
      allowActorDomains: ['env-actor.example.com'],
      trustedHosts: ['env-edge.example.com']
    })
  })
})

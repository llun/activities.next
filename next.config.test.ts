import fs from 'fs'
import os from 'os'
import path from 'path'

const loadNextConfig = async () => {
  jest.resetModules()
  return import('./next.config')
}

describe('getProxyHostConfigEnv', () => {
  const originalCwd = process.cwd()
  const previousActivitiesHost = process.env.ACTIVITIES_HOST
  const previousTrustedHosts = process.env.ACTIVITIES_TRUSTED_HOSTS

  let tempDirectory: string

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-next-'))
    process.chdir(tempDirectory)
    delete process.env.ACTIVITIES_HOST
    delete process.env.ACTIVITIES_TRUSTED_HOSTS
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDirectory, { force: true, recursive: true })
    jest.resetModules()

    if (previousActivitiesHost === undefined) {
      delete process.env.ACTIVITIES_HOST
    } else {
      process.env.ACTIVITIES_HOST = previousActivitiesHost
    }

    if (previousTrustedHosts === undefined) {
      delete process.env.ACTIVITIES_TRUSTED_HOSTS
    } else {
      process.env.ACTIVITIES_TRUSTED_HOSTS = previousTrustedHosts
    }
  })

  it('injects file-based proxy host config without actor domain allowlists', async () => {
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        host: 'file-public.example.com',
        allowActorDomains: ['external-actor.example.com'],
        trustedHosts: ['file-edge.example.com']
      })
    )

    const { getProxyHostConfigEnv } = await loadNextConfig()

    expect(
      JSON.parse(getProxyHostConfigEnv().ACTIVITIES_PROXY_HOST_CONFIG)
    ).toEqual({
      host: 'file-public.example.com',
      trustedHosts: ['file-edge.example.com']
    })
  })

  it('does not snapshot runtime environment proxy host config at build time', async () => {
    process.env.ACTIVITIES_HOST = 'env-public.example.com'
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'env-edge.example.com'
    ])

    const { default: nextConfig, getProxyHostConfigEnv } =
      await loadNextConfig()

    expect(getProxyHostConfigEnv()).toEqual({})
    expect(nextConfig.env).toBeUndefined()
  })
})

import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  getHostConfigFromEnvironment,
  getProxyHostConfig,
  resetHostConfigCacheForTests
} from './host'

describe('getHostConfigFromEnvironment', () => {
  const previousAllowActorDomains = process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
  const previousTrustedHosts = process.env.ACTIVITIES_TRUSTED_HOSTS

  afterEach(() => {
    resetHostConfigCacheForTests()

    if (previousAllowActorDomains === undefined) {
      delete process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
    } else {
      process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS = previousAllowActorDomains
    }

    if (previousTrustedHosts === undefined) {
      delete process.env.ACTIVITIES_TRUSTED_HOSTS
    } else {
      process.env.ACTIVITIES_TRUSTED_HOSTS = previousTrustedHosts
    }
  })

  it('throws on parseable non-array list values in strict mode', () => {
    process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS = '"not-an-array"'
    process.env.ACTIVITIES_TRUSTED_HOSTS = '{}'

    expect(() =>
      getHostConfigFromEnvironment({ onInvalidList: 'throw' })
    ).toThrow('ACTIVITIES_ALLOW_ACTOR_DOMAINS must be a JSON array')
  })

  it('uses an empty list for parseable non-array list values outside strict mode', () => {
    process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS = '"not-an-array"'
    process.env.ACTIVITIES_TRUSTED_HOSTS = '{}'

    expect(getHostConfigFromEnvironment()).toMatchObject({
      allowActorDomains: [],
      trustedHosts: []
    })
  })
})

describe('getProxyHostConfig', () => {
  const originalCwd = process.cwd()
  const previousEnv = {
    ACTIVITIES_ALLOW_ACTOR_DOMAINS: process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS,
    ACTIVITIES_HOST: process.env.ACTIVITIES_HOST,
    ACTIVITIES_PROXY_HOST_CONFIG: process.env.ACTIVITIES_PROXY_HOST_CONFIG,
    ACTIVITIES_TRUSTED_HOSTS: process.env.ACTIVITIES_TRUSTED_HOSTS
  }

  let tempDirectory: string

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-next-'))
    process.chdir(tempDirectory)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDirectory, { force: true, recursive: true })
    resetHostConfigCacheForTests()

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('uses runtime environment host settings instead of stale injected proxy config', () => {
    process.env.ACTIVITIES_HOST = 'runtime.example.com'
    process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS = JSON.stringify([
      'runtime-actor.example.com'
    ])
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'runtime-edge.example.com'
    ])
    process.env.ACTIVITIES_PROXY_HOST_CONFIG = JSON.stringify({
      host: 'build.example.com',
      allowActorDomains: ['build-actor.example.com'],
      trustedHosts: ['build-edge.example.com']
    })

    expect(getProxyHostConfig()).toEqual({
      host: 'runtime.example.com',
      allowActorDomains: ['runtime-actor.example.com'],
      trustedHosts: ['runtime-edge.example.com']
    })
  })

  it('loads proxy host settings from config.json at runtime', () => {
    process.env.ACTIVITIES_HOST = 'runtime.example.com'
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'runtime-edge.example.com'
    ])
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        host: 'file.example.com',
        allowActorDomains: ['file-actor.example.com'],
        trustedHosts: ['file-edge.example.com']
      })
    )

    expect(getProxyHostConfig()).toEqual({
      host: 'file.example.com',
      allowActorDomains: ['file-actor.example.com'],
      trustedHosts: ['file-edge.example.com']
    })
  })
})

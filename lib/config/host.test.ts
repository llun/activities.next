import fs from 'fs'
import path from 'path'

import {
  getHostConfigFromEnvironment,
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
  it('uses static ACTIVITIES_PROXY_HOST_CONFIG env access for Next config injection', () => {
    const source = fs.readFileSync(path.join(__dirname, 'host.ts'), 'utf-8')

    expect(source).toContain('process.env.ACTIVITIES_PROXY_HOST_CONFIG')
    expect(source).not.toContain('process.env[PROXY_HOST_CONFIG]')
  })
})

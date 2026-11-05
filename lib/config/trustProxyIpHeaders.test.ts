import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  getTrustProxyIpHeaderConfig,
  getTrustProxyIpHeadersConfig,
  resetTrustProxyIpHeadersConfigCacheForTests
} from './trustProxyIpHeaders'

describe('getTrustProxyIpHeadersConfig', () => {
  const originalCwd = process.cwd()
  const originalEnv = {
    ACTIVITIES_ALLOW_EMAILS: process.env.ACTIVITIES_ALLOW_EMAILS,
    ACTIVITIES_TRUST_PROXY_IP_HEADERS:
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS,
    ACTIVITIES_TRUST_PROXY_IP_HEADER:
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER
  }
  let tempDirectory: string

  beforeEach(() => {
    resetTrustProxyIpHeadersConfigCacheForTests()
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-next-'))
    process.chdir(tempDirectory)
    delete process.env.ACTIVITIES_ALLOW_EMAILS
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER
  })

  afterEach(() => {
    resetTrustProxyIpHeadersConfigCacheForTests()
    process.chdir(originalCwd)
    fs.rmSync(tempDirectory, { force: true, recursive: true })

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('returns false when proxy IP headers are not explicitly trusted', () => {
    process.env.ACTIVITIES_ALLOW_EMAILS = 'not-json'

    expect(getTrustProxyIpHeadersConfig()).toBe(false)
  })

  it('uses the scoped runtime environment flag without full config validation', () => {
    process.env.ACTIVITIES_ALLOW_EMAILS = 'not-json'
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = 'true'

    expect(getTrustProxyIpHeadersConfig()).toBe(true)
  })

  it('ignores runtime config file settings when the environment flag is absent', () => {
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({ trustProxyIpHeaders: true })
    )

    expect(getTrustProxyIpHeadersConfig()).toBe(false)
  })

  describe('getTrustProxyIpHeaderConfig', () => {
    it('is null when ACTIVITIES_TRUST_PROXY_IP_HEADER is unset', () => {
      expect(getTrustProxyIpHeaderConfig()).toBeNull()
    })

    it('accepts an allow-listed header name case-insensitively', () => {
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER = ' X-Real-IP '
      expect(getTrustProxyIpHeaderConfig()).toBe('x-real-ip')
    })

    it('rejects a header name outside the allow-list', () => {
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADER = 'x-client-ip'
      expect(() => getTrustProxyIpHeaderConfig()).toThrow(
        'ACTIVITIES_TRUST_PROXY_IP_HEADER must be one of cf-connecting-ip, x-real-ip, x-forwarded-for, fly-client-ip, true-client-ip'
      )
    })
  })

  it('caches the resolved setting for repeated app registration requests', () => {
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = 'true'
    expect(getTrustProxyIpHeadersConfig()).toBe(true)

    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    expect(getTrustProxyIpHeadersConfig()).toBe(true)
  })
})

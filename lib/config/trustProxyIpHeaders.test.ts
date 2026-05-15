import fs from 'fs'
import os from 'os'
import path from 'path'

import { getTrustProxyIpHeadersConfig } from './trustProxyIpHeaders'

describe('getTrustProxyIpHeadersConfig', () => {
  const originalCwd = process.cwd()
  const originalEnv = {
    ACTIVITIES_ALLOW_EMAILS: process.env.ACTIVITIES_ALLOW_EMAILS,
    ACTIVITIES_TRUST_PROXY_IP_HEADERS:
      process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
  }
  let tempDirectory: string

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-next-'))
    process.chdir(tempDirectory)
    delete process.env.ACTIVITIES_ALLOW_EMAILS
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
  })

  afterEach(() => {
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

  it('uses runtime config file settings when the environment flag is absent', () => {
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({ trustProxyIpHeaders: true })
    )

    expect(getTrustProxyIpHeadersConfig()).toBe(true)
  })
})

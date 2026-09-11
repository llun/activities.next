import type { BetterAuthOptions } from '@better-auth/core'
import type { Knex } from 'knex'

import { getConfig } from '@/lib/config'

import { getAuth } from './auth'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    host: 'test.example.com',
    serviceName: 'Activities.next Test',
    secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
    trustedHosts: [],
    auth: { enableCredential: true }
  })),
  getBaseURL: () => 'https://test.example.com'
}))

vi.mock('@/lib/database', () => ({
  getKnex: () =>
    ({
      client: { config: { client: 'better-sqlite3' } }
    }) as unknown as Knex,
  getDatabase: () => null
}))

describe('better-auth instrumentation configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables experimental instrumentation by default', () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'default.example.com',
      serviceName: 'Activities.next Test',
      secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
      trustedHosts: [],
      auth: { enableCredential: true }
    } as never)

    const auth = getAuth('https://default.example.com')
    const options = auth.options as BetterAuthOptions

    expect(options.experimental?.instrumentation?.enabled).toBe(false)
  })

  it('enables experimental instrumentation when configured', () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'enabled.example.com',
      serviceName: 'Activities.next Test',
      secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
      trustedHosts: [],
      auth: { enableCredential: true, enableInstrumentation: true }
    } as never)

    const auth = getAuth('https://enabled.example.com')
    const options = auth.options as BetterAuthOptions

    expect(options.experimental?.instrumentation?.enabled).toBe(true)
  })

  it('keeps experimental instrumentation disabled when explicitly set to false', () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'disabled.example.com',
      serviceName: 'Activities.next Test',
      secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
      trustedHosts: [],
      auth: { enableCredential: true, enableInstrumentation: false }
    } as never)

    const auth = getAuth('https://disabled.example.com')
    const options = auth.options as BetterAuthOptions

    expect(options.experimental?.instrumentation?.enabled).toBe(false)
  })
})

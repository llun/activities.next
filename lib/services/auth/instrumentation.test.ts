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
    vi.mocked(getConfig).mockReset()
  })

  it.each([
    {
      description:
        'disables experimental instrumentation by default when auth config is omitted',
      host: 'no-auth.example.com',
      auth: undefined,
      expected: false
    },
    {
      description:
        'disables experimental instrumentation by default when unconfigured',
      host: 'default.example.com',
      auth: { enableCredential: true },
      expected: false
    },
    {
      description: 'enables experimental instrumentation when configured',
      host: 'enabled.example.com',
      auth: { enableCredential: true, enableInstrumentation: true },
      expected: true
    },
    {
      description:
        'keeps experimental instrumentation disabled when explicitly set to false',
      host: 'disabled.example.com',
      auth: { enableCredential: true, enableInstrumentation: false },
      expected: false
    }
  ])('$description', ({ host, auth, expected }) => {
    vi.mocked(getConfig).mockReturnValue({
      host,
      serviceName: 'Activities.next Test',
      secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
      trustedHosts: [],
      ...(auth ? { auth } : {})
    } as unknown as ReturnType<typeof getConfig>)

    const result = getAuth(`https://${host}`)
    const options = result.options as BetterAuthOptions

    expect(options.experimental?.instrumentation?.enabled).toBe(expected)
  })
})

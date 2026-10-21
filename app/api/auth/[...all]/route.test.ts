import { getAuth } from '@/lib/services/auth/auth'
import { resolveAuthServiceName } from '@/lib/services/auth/authServiceName'
import {
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'

import { GET } from './route'

vi.mock('@/lib/services/auth/auth', () => ({ getAuth: vi.fn() }))

vi.mock('@/lib/database', () => ({ getDatabase: () => null }))

// Each domain's name, as its identity would answer it.
vi.mock('@/lib/services/auth/authServiceName', () => ({
  resolveAuthServiceName: vi.fn()
}))

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({
    GET: async () => new Response(null, { status: 204 }),
    POST: async () => new Response(null, { status: 204 })
  })
}))

describe('/api/auth/[...all]', () => {
  beforeEach(() => {
    vi.mocked(getAuth).mockReset()
    vi.mocked(resolveAuthServiceName).mockReset()
    vi.mocked(resolveAuthServiceName).mockImplementation(
      async (_database, baseURL) =>
        baseURL === 'https://run.example' ? 'Run Club' : 'Activities.next'
    )
    resetServedDomainsForTests()
  })

  afterEach(() => {
    resetServedDomainsForTests()
  })

  // The global config mock serves test.llun.dev.
  it.each([
    {
      description: 'a domain turned on in Admin › Domains',
      host: 'run.example',
      expected: 'https://run.example',
      name: 'Run Club'
    },
    {
      description: 'an unknown host, on the primary',
      host: 'evil.example',
      expected: 'https://test.llun.dev',
      name: 'Activities.next'
    }
  ])(
    'builds the auth instance and name for $description',
    async ({ host, expected, name }) => {
      setServedDomainsForTests(['run.example'])
      const response = await GET(
        new Request(`https://${host}/api/auth/get-session`, {
          headers: { host }
        })
      )
      expect(response.status).toBe(204)
      // The name comes from the resolved base URL, never the raw Host.
      expect(resolveAuthServiceName).toHaveBeenCalledWith(null, expected)
      expect(getAuth).toHaveBeenCalledWith(expected, name)
    }
  )
})

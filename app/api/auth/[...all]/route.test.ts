import { getAuth } from '@/lib/services/auth/auth'
import {
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'

import { GET } from './route'

vi.mock('@/lib/services/auth/auth', () => ({ getAuth: vi.fn() }))

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({
    GET: async () => new Response(null, { status: 204 }),
    POST: async () => new Response(null, { status: 204 })
  })
}))

describe('/api/auth/[...all]', () => {
  beforeEach(() => {
    vi.mocked(getAuth).mockReset()
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
      expected: 'https://run.example'
    },
    {
      description: 'an unknown host, on the primary',
      host: 'evil.example',
      expected: 'https://test.llun.dev'
    }
  ])(
    'builds the auth instance for $description',
    async ({ host, expected }) => {
      setServedDomainsForTests(['run.example'])
      const response = await GET(
        new Request(`https://${host}/api/auth/get-session`, {
          headers: { host }
        })
      )
      expect(response.status).toBe(204)
      expect(getAuth).toHaveBeenCalledWith(expected)
    }
  )
})

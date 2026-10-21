import { resolveDomainIdentity } from '@/lib/services/domains/domainIdentity'

import { resolveAuthServiceName } from './authServiceName'

vi.mock('@/lib/services/domains/domainIdentity', () => ({
  resolveDomainIdentity: vi.fn()
}))

const anIdentity = (domain: string, name: string) => ({
  domain,
  source: 'database' as const,
  name,
  description: '',
  contactEmail: '',
  termsOfService: null,
  privacyPolicy: null,
  disabledFeatures: []
})

describe('resolveAuthServiceName', () => {
  beforeEach(() => {
    vi.mocked(resolveDomainIdentity).mockReset()
  })

  it.each([
    {
      description: 'a served domain',
      baseURL: 'https://run.example',
      host: 'run.example',
      identity: anIdentity('run.example', 'Run Club'),
      expected: 'Run Club'
    },
    {
      description: 'a host with a port',
      baseURL: 'http://localhost:3000',
      host: 'localhost:3000',
      identity: anIdentity('localhost:3000', 'Local'),
      expected: 'Local'
    },
    {
      description: 'a domain with a blank name',
      baseURL: 'https://run.example',
      host: 'run.example',
      identity: anIdentity('run.example', ''),
      expected: 'run.example'
    }
  ])(
    'names $description from the base URL host',
    async ({ baseURL, host, identity, expected }) => {
      vi.mocked(resolveDomainIdentity).mockResolvedValue(identity)
      const database = {} as Parameters<typeof resolveAuthServiceName>[0]

      await expect(resolveAuthServiceName(database, baseURL)).resolves.toBe(
        expected
      )
      expect(resolveDomainIdentity).toHaveBeenCalledWith(database, host)
    }
  )
})

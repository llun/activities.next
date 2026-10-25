import { Database } from '@/lib/database/types'
import {
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'

import {
  createLocalDomainMatcher,
  getServedLinkDomain,
  isLocalDomain
} from './localDomains'

const mockGetConfig = vi.fn()
vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

const database = {} as Database

const mockConfig = ({
  host = 'llun.test',
  trustedHosts = ['alias.llun.test', '*.preview.example'] as string[]
} = {}) => {
  mockGetConfig.mockReturnValue({ host, trustedHosts })
}

describe('isLocalDomain', () => {
  beforeEach(() => {
    mockGetConfig.mockReset()
    mockConfig()
  })

  // Served domains are this server's federation identity: the primary host and
  // the concrete trusted hosts. A wildcard trusted host only says which
  // forwarded hosts to believe, so its subdomains are not ours.
  it.each([
    { description: 'the primary host', value: 'llun.test', expected: true },
    {
      description: 'a concrete trusted host',
      value: 'https://alias.llun.test/users/a',
      expected: true
    },
    {
      description: 'a subdomain of a wildcard trusted host',
      value: 'https://pr-1.preview.example/users/a',
      expected: false
    },
    {
      description: 'a remote domain',
      value: 'https://remote.example/users/a',
      expected: false
    }
  ])('answers $expected for $description', async ({ value, expected }) => {
    await expect(isLocalDomain(database, value)).resolves.toBe(expected)
  })

  it('counts a domain turned on in Admin › Served domains as local', async () => {
    setServedDomainsForTests(['run.example'])
    try {
      await expect(
        isLocalDomain(database, 'https://run.example/users/a')
      ).resolves.toBe(true)
    } finally {
      resetServedDomainsForTests()
    }
  })
})

describe('createLocalDomainMatcher', () => {
  it('prepares one matcher per config object', () => {
    const config = { host: 'llun.test', trustedHosts: ['alias.llun.test'] }
    const isLocal = createLocalDomainMatcher(config)

    expect(createLocalDomainMatcher(config)).toBe(isLocal)
    expect(isLocal('https://llun.test/inbox')).toBeTrue()
    expect(isLocal('https://alias.llun.test/inbox')).toBeTrue()
    expect(isLocal('https://remote.example/inbox')).toBeFalse()
  })
})

describe('getServedLinkDomain', () => {
  beforeEach(() => {
    mockGetConfig.mockReset()
    mockConfig()
  })

  // Gated on the hosts better-auth trusts as origins (primary + trusted hosts,
  // wildcards included), never on `federation.allowActorDomains`, which can
  // name remote servers.
  it.each([
    {
      description: 'a concrete trusted host',
      domain: 'alias.llun.test',
      expected: 'alias.llun.test'
    },
    {
      description: 'a trusted host in another spelling',
      domain: 'ALIAS.llun.test.',
      expected: 'alias.llun.test'
    },
    {
      description: 'a subdomain of a wildcard trusted host',
      domain: 'pr-1.preview.example',
      expected: 'pr-1.preview.example'
    },
    {
      description: 'the primary host, which keeps the default link',
      domain: 'llun.test',
      expected: null
    },
    {
      description: 'a domain this server does not answer on',
      domain: 'actors.example',
      expected: null
    },
    {
      description: 'a domain carrying a path',
      domain: 'alias.llun.test/evil',
      expected: null
    },
    { description: 'a missing domain', domain: null, expected: null }
  ])('returns $expected for $description', ({ domain, expected }) => {
    expect(getServedLinkDomain(domain)).toBe(expected)
  })
})

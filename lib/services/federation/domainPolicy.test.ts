import { DEFAULT_SERVER_SETTINGS } from '@/lib/config/serverSettings'
import { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

import {
  canFederateWithDomain,
  filterFederatedUrls,
  isDomainAllowed,
  isLocalFederationDomain
} from './domainPolicy'

const mockGetConfig = vi.fn()
vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn()
}))

// The host stays env-configured; the federation mode + actor allow-list are
// resolved from server settings.
const mockFederation = ({
  host = 'local.test',
  trustedHosts = [] as string[],
  mode = 'open' as 'open' | 'allowlist',
  allowActorDomains = [] as string[]
} = {}) => {
  mockGetConfig.mockReturnValue({ host, trustedHosts })
  vi.mocked(getResolvedServerSettings).mockResolvedValue({
    ...structuredClone(DEFAULT_SERVER_SETTINGS),
    federation: { mode, allowActorDomains }
  })
}

const createDatabase = (params: { blocks?: string[]; allows?: string[] }) => {
  const findBlock = (domain: string) =>
    params.blocks?.some(
      (block) => domain === block || domain.endsWith(`.${block}`)
    )
      ? {
          id: 'block',
          type: 'block' as const,
          domain,
          severity: 'suspend' as const,
          rejectMedia: false,
          rejectReports: false,
          privateComment: null,
          publicComment: null,
          obfuscate: false,
          source: null,
          createdAt: 0,
          updatedAt: 0
        }
      : null
  const findAllow = (domain: string) => {
    const allow = params.allows?.find(
      (rule) => domain === rule || domain.endsWith(`.${rule}`)
    )

    return allow
      ? {
          id: 'allow',
          type: 'allow' as const,
          domain: allow,
          createdAt: 0,
          updatedAt: 0
        }
      : null
  }

  return {
    getDomainBlockForDomain: vi.fn(async (domain: string) => findBlock(domain)),
    getDomainAllowForDomain: vi.fn(async (domain: string) => findAllow(domain)),
    getDomainBlocksForDomains: vi.fn(async (domains: string[]) =>
      Object.fromEntries(domains.map((domain) => [domain, findBlock(domain)]))
    ),
    getDomainAllowsForDomains: vi.fn(async (domains: string[]) =>
      Object.fromEntries(domains.map((domain) => [domain, findAllow(domain)]))
    )
  } as unknown as Database
}

describe('domainPolicy', () => {
  beforeEach(() => {
    mockFederation()
  })

  it('rejects suspended blocked domains in open federation mode', async () => {
    const database = createDatabase({ blocks: ['blocked.test'] })

    await expect(
      canFederateWithDomain(database, 'https://blocked.test/users/a')
    ).resolves.toBe(false)
    await expect(
      canFederateWithDomain(database, 'https://allowed.test/users/a')
    ).resolves.toBe(true)
  })

  it('requires allow entries in allowlist mode', async () => {
    mockFederation({ mode: 'allowlist' })
    const database = createDatabase({ allows: ['trusted.test'] })

    await expect(
      canFederateWithDomain(database, 'https://trusted.test/users/a')
    ).resolves.toBe(true)
    await expect(
      canFederateWithDomain(database, 'https://other.test/users/a')
    ).resolves.toBe(false)
  })

  it('always allows local actor domains', async () => {
    mockFederation({ mode: 'allowlist', allowActorDomains: ['alias.test'] })
    const database = createDatabase({})

    await expect(isDomainAllowed(database, 'alias.test')).resolves.toBe(true)
    await expect(
      canFederateWithDomain(database, 'https://alias.test/users/a')
    ).resolves.toBe(true)
  })

  it('treats only exact local domains and configured wildcards as local', async () => {
    mockFederation({ allowActorDomains: ['alias.test', '*.trusted.test'] })
    const database = createDatabase({})

    await expect(
      isLocalFederationDomain(database, 'https://local.test/users/a')
    ).resolves.toBe(true)
    await expect(
      isLocalFederationDomain(database, 'https://evil.local.test/users/a')
    ).resolves.toBe(false)
    await expect(
      isLocalFederationDomain(database, 'https://alias.test/users/a')
    ).resolves.toBe(true)
    await expect(
      isLocalFederationDomain(database, 'https://sub.alias.test/users/a')
    ).resolves.toBe(false)
    await expect(
      isLocalFederationDomain(database, 'https://sub.trusted.test/users/a')
    ).resolves.toBe(true)
  })

  // One definition of "our domains": the trusted hosts this server answers on
  // are as local as the primary host and the actor allow-list, for every
  // policy decision — not only for `isOwnInstanceHost`.
  it('treats trusted hosts, including wildcard ones, as local', async () => {
    mockFederation({
      mode: 'allowlist',
      trustedHosts: ['alias.test', '*.edge.test']
    })
    const database = createDatabase({ blocks: ['alias.test'] })

    await expect(
      isLocalFederationDomain(database, 'https://alias.test/users/a')
    ).resolves.toBe(true)
    await expect(
      canFederateWithDomain(database, 'https://ALIAS.test./users/a')
    ).resolves.toBe(true)
    await expect(
      isLocalFederationDomain(database, 'https://cdn.edge.test/users/a')
    ).resolves.toBe(true)
    await expect(
      isLocalFederationDomain(database, 'https://edge.test/users/a')
    ).resolves.toBe(false)
    await expect(
      filterFederatedUrls(database, [
        'https://alias.test/inbox',
        'https://cdn.edge.test/inbox',
        'https://other.test/inbox'
      ])
    ).resolves.toEqual([
      'https://alias.test/inbox',
      'https://cdn.edge.test/inbox'
    ])
  })

  // Nothing a remote server sends can widen "local": the rules are operator
  // configuration, and an authority spelled as a rule is not a host.
  it.each([
    {
      description: 'a wildcard rule spelled as the host',
      value: 'https://*.edge.test/users/a'
    },
    {
      description: 'a percent-encoded wildcard host',
      value: 'https://%2a.edge.test/users/a'
    },
    {
      description: 'our host as userinfo in front of another host',
      value: 'https://local.test@evil.test/users/a'
    },
    {
      description: 'a host that only ends in our host',
      value: 'https://evil-local.test/users/a'
    },
    {
      description: 'our host on another port',
      value: 'https://local.test:8443/users/a'
    }
  ])('does not treat $description as local', async ({ value }) => {
    mockFederation({ trustedHosts: ['*.edge.test'] })
    const database = createDatabase({})

    await expect(isLocalFederationDomain(database, value)).resolves.toBe(false)
  })

  // The served-domain rules compare the port, which `getDomainFromUrl` drops,
  // so locality is decided on the URL: a development instance on
  // `localhost:3000` must still deliver to its own inboxes in allowlist mode.
  it('keeps inboxes on a configured host with a port in allowlist mode', async () => {
    mockFederation({ host: 'localhost:3000', mode: 'allowlist' })
    const database = createDatabase({})

    await expect(
      filterFederatedUrls(database, ['http://localhost:3000/inbox'])
    ).resolves.toEqual(['http://localhost:3000/inbox'])
    await expect(
      canFederateWithDomain(database, 'http://localhost:3000/users/a')
    ).resolves.toBe(true)
  })

  it('filters URLs with a batched block lookup', async () => {
    const database = createDatabase({ blocks: ['blocked.test'] })

    await expect(
      filterFederatedUrls(database, [
        'https://blocked.test/users/a/inbox',
        'https://blocked.test/users/b/inbox',
        'https://ok.test/users/a/inbox',
        'https://ok.test/users/a/inbox'
      ])
    ).resolves.toEqual(['https://ok.test/users/a/inbox'])
    expect(database.getDomainBlocksForDomains).toHaveBeenCalledWith([
      'blocked.test',
      'ok.test'
    ])
    expect(database.getDomainBlockForDomain).not.toHaveBeenCalled()
  })

  it('filters URLs with batched allow lookups in allowlist mode', async () => {
    mockFederation({ mode: 'allowlist' })
    const database = createDatabase({ allows: ['trusted.test'] })

    await expect(
      filterFederatedUrls(database, [
        'https://trusted.test/users/a/inbox',
        'https://other.test/users/a/inbox',
        'https://trusted.test/users/a/inbox'
      ])
    ).resolves.toEqual(['https://trusted.test/users/a/inbox'])
    expect(database.getDomainBlocksForDomains).toHaveBeenCalledWith([
      'trusted.test',
      'other.test'
    ])
    expect(database.getDomainAllowsForDomains).toHaveBeenCalledWith([
      'trusted.test',
      'other.test'
    ])
    expect(database.getDomainAllowForDomain).not.toHaveBeenCalled()
  })
})

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
  mode = 'open' as 'open' | 'allowlist',
  allowActorDomains = [] as string[]
} = {}) => {
  mockGetConfig.mockReturnValue({ host })
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

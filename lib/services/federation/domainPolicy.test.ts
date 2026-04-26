import { Database } from '@/lib/database/types'

import {
  canFederateWithDomain,
  filterFederatedUrls,
  isDomainAllowed,
  isLocalFederationDomain
} from './domainPolicy'

const mockGetConfig = jest.fn()
jest.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

const createDatabase = (params: { blocks?: string[]; allows?: string[] }) =>
  ({
    getDomainBlockForDomain: async (domain: string) =>
      params.blocks?.some(
        (block) => domain === block || domain.endsWith(`.${block}`)
      )
        ? {
            id: 'block',
            type: 'block',
            domain,
            severity: 'suspend',
            rejectMedia: false,
            rejectReports: false,
            privateComment: null,
            publicComment: null,
            obfuscate: false,
            source: null,
            createdAt: 0,
            updatedAt: 0
          }
        : null,
    getDomainAllowForDomain: async (domain: string) => {
      const allow = params.allows?.find(
        (rule) => domain === rule || domain.endsWith(`.${rule}`)
      )

      return allow
        ? {
            id: 'allow',
            type: 'allow',
            domain: allow,
            createdAt: 0,
            updatedAt: 0
          }
        : null
    }
  }) as unknown as Database

describe('domainPolicy', () => {
  beforeEach(() => {
    mockGetConfig.mockReturnValue({
      host: 'local.test',
      allowActorDomains: [],
      federationMode: 'open'
    })
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
    mockGetConfig.mockReturnValue({
      host: 'local.test',
      allowActorDomains: [],
      federationMode: 'allowlist'
    })
    const database = createDatabase({ allows: ['trusted.test'] })

    await expect(
      canFederateWithDomain(database, 'https://trusted.test/users/a')
    ).resolves.toBe(true)
    await expect(
      canFederateWithDomain(database, 'https://other.test/users/a')
    ).resolves.toBe(false)
  })

  it('always allows local actor domains', async () => {
    mockGetConfig.mockReturnValue({
      host: 'local.test',
      allowActorDomains: ['alias.test'],
      federationMode: 'allowlist'
    })
    const database = createDatabase({})

    await expect(isDomainAllowed(database, 'alias.test')).resolves.toBe(true)
    await expect(
      canFederateWithDomain(database, 'https://alias.test/users/a')
    ).resolves.toBe(true)
  })

  it('treats only exact local domains and configured wildcards as local', () => {
    mockGetConfig.mockReturnValue({
      host: 'local.test',
      allowActorDomains: ['alias.test', '*.trusted.test'],
      federationMode: 'open'
    })

    expect(isLocalFederationDomain('https://local.test/users/a')).toBe(true)
    expect(isLocalFederationDomain('https://evil.local.test/users/a')).toBe(
      false
    )
    expect(isLocalFederationDomain('https://alias.test/users/a')).toBe(true)
    expect(isLocalFederationDomain('https://sub.alias.test/users/a')).toBe(
      false
    )
    expect(isLocalFederationDomain('https://sub.trusted.test/users/a')).toBe(
      true
    )
  })

  it('filters URLs with one lookup per unique domain', async () => {
    const database = createDatabase({ blocks: ['blocked.test'] })
    const blockLookup = jest.spyOn(database, 'getDomainBlockForDomain')

    await expect(
      filterFederatedUrls(database, [
        'https://blocked.test/users/a/inbox',
        'https://blocked.test/users/b/inbox',
        'https://ok.test/users/a/inbox',
        'https://ok.test/users/a/inbox'
      ])
    ).resolves.toEqual(['https://ok.test/users/a/inbox'])
    expect(blockLookup).toHaveBeenCalledTimes(2)
  })
})

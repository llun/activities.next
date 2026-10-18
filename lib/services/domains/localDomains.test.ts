import { DEFAULT_SERVER_SETTINGS } from '@/lib/config/serverSettings'
import { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

import {
  getLocalDomainMatcher,
  getServedLinkDomain,
  isLocalDomain
} from './localDomains'

const mockGetConfig = vi.fn()
vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn()
}))

const database = {} as Database

const mockSources = ({
  host = 'llun.test',
  trustedHosts = ['alias.llun.test'] as string[],
  allowActorDomains = [] as string[]
} = {}) => {
  mockGetConfig.mockReturnValue({ host, trustedHosts })
  vi.mocked(getResolvedServerSettings).mockResolvedValue({
    ...structuredClone(DEFAULT_SERVER_SETTINGS),
    federation: { mode: 'open', allowActorDomains }
  })
}

describe('isLocalDomain', () => {
  beforeEach(() => {
    vi.mocked(getResolvedServerSettings).mockReset()
    mockSources()
  })

  it.each([
    { description: 'the primary host', value: 'llun.test', expected: true },
    {
      description: 'a trusted host',
      value: 'https://alias.llun.test/users/a',
      expected: true
    },
    {
      description: 'an actor domain from the resolved setting',
      value: 'https://actors.example/users/a',
      expected: true
    },
    {
      description: 'a remote domain',
      value: 'https://remote.example/users/a',
      expected: false
    }
  ])('answers $expected for $description', async ({ value, expected }) => {
    mockSources({ allowActorDomains: ['actors.example'] })
    await expect(isLocalDomain(database, value)).resolves.toBe(expected)
  })

  it('resolves the settings once for a matcher used many times', async () => {
    const isLocal = await getLocalDomainMatcher(database)

    expect(isLocal('https://llun.test/inbox')).toBeTrue()
    expect(isLocal('https://alias.llun.test/inbox')).toBeTrue()
    expect(isLocal('https://remote.example/inbox')).toBeFalse()
    expect(getResolvedServerSettings).toHaveBeenCalledTimes(1)
    expect(getResolvedServerSettings).toHaveBeenCalledWith(database)
  })
})

describe('getServedLinkDomain', () => {
  beforeEach(() => {
    vi.mocked(getResolvedServerSettings).mockReset()
    mockSources({ allowActorDomains: ['llun.test', 'Actors.Example'] })
  })

  it.each([
    {
      description: 'an actor domain this server serves',
      domain: 'actors.example',
      expected: 'actors.example'
    },
    {
      description: 'a served domain in another spelling',
      domain: 'ACTORS.example.',
      expected: 'actors.example'
    },
    {
      description: 'a trusted host',
      domain: 'alias.llun.test',
      expected: 'alias.llun.test'
    },
    {
      description: 'the primary host, which keeps the default link',
      domain: 'llun.test',
      expected: null
    },
    {
      description: 'a domain this server does not serve',
      domain: 'remote.example',
      expected: null
    },
    {
      description: 'a domain carrying a path',
      domain: 'actors.example/evil',
      expected: null
    },
    { description: 'a missing domain', domain: null, expected: null }
  ])('returns $expected for $description', async ({ domain, expected }) => {
    await expect(getServedLinkDomain(database, domain)).resolves.toBe(expected)
  })
})

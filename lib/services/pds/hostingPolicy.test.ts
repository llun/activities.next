import type { BlueskyPdsConfig } from '@/lib/config/blueskyPds'
import type { ServedDomainData } from '@/lib/database/domains/servedDomain/types'
import type { Database } from '@/lib/database/types'
import { getEnvDomains } from '@/lib/services/domains/envDomains'
import { resetServedDomainsForTests } from '@/lib/services/domains/servedDomainSnapshot'

import { getEffectiveHostingPolicy, isHostingAllowed } from './hostingPolicy'

vi.mock('@/lib/services/domains/envDomains', () => ({
  getEnvDomains: vi.fn(() => ({ primary: null, trusted: [], wildcards: [] }))
}))

const DOMAIN = 'social.example'
const PDS_HOSTNAME = `pds.${DOMAIN}`

const config = ({
  enabled = true,
  allowEmails = [],
  allowActors = []
}: {
  enabled?: boolean
  allowEmails?: string[]
  allowActors?: string[]
} = {}): BlueskyPdsConfig => ({
  [DOMAIN]: {
    domain: DOMAIN,
    enabled,
    hostname: PDS_HOSTNAME,
    did: `did:web:${PDS_HOSTNAME}`,
    allowEmails,
    allowActors,
    relays: ['https://bsky.network']
  }
})

const row = (overrides: Partial<ServedDomainData> = {}): ServedDomainData => ({
  id: 'row',
  domain: DOMAIN,
  status: 'on',
  name: null,
  description: null,
  contactEmail: null,
  disabledFeatures: [],
  signupsOpen: false,
  allowedEmails: [],
  allowExistingUsers: false,
  blueskyHostingPolicy: null,
  blueskyHostingAllowEmails: null,
  blueskyHostingAllowActors: null,
  lastCheckedAt: null,
  lastCheckStatus: null,
  lastCheckResult: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides
})

const databaseWith = (saved: ServedDomainData | null) =>
  ({
    getServedDomain: vi.fn(async () => saved)
  }) as unknown as Database

const envPins = (domain: string) =>
  vi.mocked(getEnvDomains).mockReturnValue({
    primary: domain,
    trusted: [],
    wildcards: []
  })

describe('Bluesky hosting policy', () => {
  beforeEach(() => {
    vi.mocked(getEnvDomains).mockReturnValue({
      primary: null,
      trusted: [],
      wildcards: []
    })
    resetServedDomainsForTests()
  })

  afterEach(() => {
    resetServedDomainsForTests()
  })

  describe('getEffectiveHostingPolicy', () => {
    it('is null for a domain with no PDS entry', async () => {
      expect(
        await getEffectiveHostingPolicy(
          databaseWith(null),
          'other.example',
          config()
        )
      ).toBeNull()
    })

    it('falls back to the environment allowlists when the row has no saved policy', async () => {
      expect(
        await getEffectiveHostingPolicy(
          databaseWith(row()),
          DOMAIN,
          config({
            allowEmails: ['alice@social.example'],
            allowActors: ['bob@social.example']
          })
        )
      ).toEqual({
        source: 'environment',
        policy: 'listed',
        allowEmails: ['alice@social.example'],
        allowActors: ['bob@social.example']
      })
    })

    it('falls back to the environment when the domain has no row and the environment pins it', async () => {
      envPins(DOMAIN)

      expect(
        await getEffectiveHostingPolicy(
          databaseWith(null),
          DOMAIN,
          config({ allowActors: ['bob@social.example'] })
        )
      ).toMatchObject({ source: 'environment', policy: 'listed' })
    })

    it('is null when the domain has no row and the environment does not pin it', async () => {
      expect(
        await getEffectiveHostingPolicy(databaseWith(null), DOMAIN, config())
      ).toBeNull()
    })

    it('uses the saved setting over the environment lists', async () => {
      expect(
        await getEffectiveHostingPolicy(
          databaseWith(
            row({
              blueskyHostingPolicy: 'listed',
              blueskyHostingAllowEmails: ['carol@social.example'],
              blueskyHostingAllowActors: ['dave@social.example']
            })
          ),
          DOMAIN,
          config({ allowEmails: ['alice@social.example'] })
        )
      ).toEqual({
        source: 'domain',
        policy: 'listed',
        allowEmails: ['carol@social.example'],
        allowActors: ['dave@social.example']
      })
    })

    it('normalises the domain before looking it up', async () => {
      expect(
        await getEffectiveHostingPolicy(
          databaseWith(row()),
          'SOCIAL.EXAMPLE',
          config()
        )
      ).toMatchObject({ source: 'environment' })
    })
  })

  describe('isHostingAllowed', () => {
    it('is false when the domain has no PDS entry', async () => {
      expect(
        await isHostingAllowed({
          database: databaseWith(null),
          actorUsernameAtDomain: 'alice@other.example',
          domain: 'other.example',
          config: config()
        })
      ).toBe(false)
    })

    it('is false when the PDS is disabled, whatever the policy', async () => {
      expect(
        await isHostingAllowed({
          database: databaseWith(row({ blueskyHostingPolicy: 'everyone' })),
          actorUsernameAtDomain: 'alice@social.example',
          domain: DOMAIN,
          config: config({ enabled: false })
        })
      ).toBe(false)
    })

    it('is false on a domain that is not served, even under "everyone"', async () => {
      expect(
        await isHostingAllowed({
          database: databaseWith(
            row({ status: 'off', blueskyHostingPolicy: 'everyone' })
          ),
          actorUsernameAtDomain: 'alice@social.example',
          domain: DOMAIN,
          config: config()
        })
      ).toBe(false)
    })

    it('allows a served domain under "everyone"', async () => {
      expect(
        await isHostingAllowed({
          database: databaseWith(row({ blueskyHostingPolicy: 'everyone' })),
          actorUsernameAtDomain: 'anyone@social.example',
          domain: DOMAIN,
          config: config()
        })
      ).toBe(true)
    })

    it('allows only the environment lists when the row has no setting', async () => {
      const pdsConfig = config({
        allowEmails: ['alice@social.example'],
        allowActors: ['bob@social.example']
      })
      const database = databaseWith(row())

      expect(
        await isHostingAllowed({
          database,
          email: 'alice@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(true)
      expect(
        await isHostingAllowed({
          database,
          actorUsernameAtDomain: 'bob@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(true)
      expect(
        await isHostingAllowed({
          database,
          actorUsernameAtDomain: 'carol@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(false)
    })

    it('allows nobody under "nobody", even an allowlisted profile', async () => {
      expect(
        await isHostingAllowed({
          database: databaseWith(row({ blueskyHostingPolicy: 'nobody' })),
          email: 'alice@social.example',
          actorUsernameAtDomain: 'alice@social.example',
          domain: DOMAIN,
          config: config({ allowActors: ['alice@social.example'] })
        })
      ).toBe(false)
    })

    it('allows only the saved lists under "listed", ignoring the environment', async () => {
      const database = databaseWith(
        row({
          blueskyHostingPolicy: 'listed',
          blueskyHostingAllowEmails: ['carol@social.example'],
          blueskyHostingAllowActors: ['dave@social.example']
        })
      )
      const pdsConfig = config({ allowActors: ['alice@social.example'] })

      expect(
        await isHostingAllowed({
          database,
          actorUsernameAtDomain: 'dave@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(true)
      expect(
        await isHostingAllowed({
          database,
          email: 'carol@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(true)
      expect(
        await isHostingAllowed({
          database,
          actorUsernameAtDomain: 'alice@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(false)
    })

    it('refuses a saved "nobody" even when the served-domain snapshot is stale', async () => {
      const database = databaseWith(row({ blueskyHostingPolicy: 'nobody' }))
      resetServedDomainsForTests()

      expect(
        await isHostingAllowed({
          database,
          email: 'alice@social.example',
          actorUsernameAtDomain: 'alice@social.example',
          domain: DOMAIN,
          config: config({ allowActors: ['alice@social.example'] })
        })
      ).toBe(false)
    })

    it('allows the environment lists on an env-pinned domain with no row', async () => {
      envPins(DOMAIN)

      expect(
        await isHostingAllowed({
          database: databaseWith(null),
          actorUsernameAtDomain: 'bob@social.example',
          domain: DOMAIN,
          config: config({ allowActors: ['bob@social.example'] })
        })
      ).toBe(true)
    })
  })
})

import type { BlueskyPdsConfig } from '@/lib/config/blueskyPds'
import {
  resetServedDomainsForTests,
  setServedDomainsForTests,
  setServedHostingPoliciesForTests
} from '@/lib/services/domains/servedDomainSnapshot'

import { getEffectiveHostingPolicy, isHostingAllowed } from './hostingPolicy'

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

describe('Bluesky hosting policy', () => {
  beforeEach(() => {
    resetServedDomainsForTests()
    setServedDomainsForTests([])
  })

  afterEach(() => {
    resetServedDomainsForTests()
  })

  describe('getEffectiveHostingPolicy', () => {
    it('is null for a domain with no PDS entry', () => {
      expect(getEffectiveHostingPolicy('other.example', config())).toBeNull()
    })

    it('falls back to the environment allowlists when the domain has no setting', () => {
      expect(
        getEffectiveHostingPolicy(
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

    it('uses the saved setting over the environment lists', () => {
      setServedHostingPoliciesForTests({
        [DOMAIN]: {
          policy: 'listed',
          allowEmails: ['carol@social.example'],
          allowActors: ['dave@social.example']
        }
      })

      expect(
        getEffectiveHostingPolicy(
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

    it('falls back to the environment when the snapshot is stale', () => {
      setServedHostingPoliciesForTests({
        [DOMAIN]: { policy: 'nobody', allowEmails: [], allowActors: [] }
      })
      resetServedDomainsForTests()

      expect(
        getEffectiveHostingPolicy(
          DOMAIN,
          config({ allowActors: ['bob@social.example'] })
        )
      ).toMatchObject({ source: 'environment', policy: 'listed' })
    })

    it('normalises the domain before looking it up', () => {
      expect(
        getEffectiveHostingPolicy('SOCIAL.EXAMPLE', config())
      ).toMatchObject({ source: 'environment' })
    })
  })

  describe('isHostingAllowed', () => {
    it('is false when the domain has no PDS entry', () => {
      expect(
        isHostingAllowed({
          actorUsernameAtDomain: 'alice@other.example',
          domain: 'other.example',
          config: config()
        })
      ).toBe(false)
    })

    it('is false when the PDS is disabled, whatever the policy', () => {
      setServedHostingPoliciesForTests({
        [DOMAIN]: { policy: 'everyone', allowEmails: [], allowActors: [] }
      })

      expect(
        isHostingAllowed({
          actorUsernameAtDomain: 'alice@social.example',
          domain: DOMAIN,
          config: config({ enabled: false })
        })
      ).toBe(false)
    })

    it('allows only the environment lists when the domain has no setting', () => {
      const pdsConfig = config({
        allowEmails: ['alice@social.example'],
        allowActors: ['bob@social.example']
      })

      expect(
        isHostingAllowed({
          email: 'alice@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(true)
      expect(
        isHostingAllowed({
          actorUsernameAtDomain: 'bob@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(true)
      expect(
        isHostingAllowed({
          actorUsernameAtDomain: 'carol@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(false)
    })

    it('allows nobody under "nobody", even an allowlisted profile', () => {
      setServedHostingPoliciesForTests({
        [DOMAIN]: { policy: 'nobody', allowEmails: [], allowActors: [] }
      })

      expect(
        isHostingAllowed({
          email: 'alice@social.example',
          actorUsernameAtDomain: 'alice@social.example',
          domain: DOMAIN,
          config: config({ allowActors: ['alice@social.example'] })
        })
      ).toBe(false)
    })

    it('allows only the saved lists under "listed", ignoring the environment', () => {
      setServedHostingPoliciesForTests({
        [DOMAIN]: {
          policy: 'listed',
          allowEmails: ['carol@social.example'],
          allowActors: ['dave@social.example']
        }
      })
      const pdsConfig = config({ allowActors: ['alice@social.example'] })

      expect(
        isHostingAllowed({
          actorUsernameAtDomain: 'dave@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(true)
      expect(
        isHostingAllowed({
          email: 'carol@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(true)
      expect(
        isHostingAllowed({
          actorUsernameAtDomain: 'alice@social.example',
          domain: DOMAIN,
          config: pdsConfig
        })
      ).toBe(false)
    })

    it('allows every profile under "everyone"', () => {
      setServedHostingPoliciesForTests({
        [DOMAIN]: { policy: 'everyone', allowEmails: [], allowActors: [] }
      })

      expect(
        isHostingAllowed({
          actorUsernameAtDomain: 'anyone@social.example',
          domain: DOMAIN,
          config: config()
        })
      ).toBe(true)
    })
  })
})

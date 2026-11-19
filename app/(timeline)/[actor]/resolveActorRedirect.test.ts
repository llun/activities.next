import { Database } from '@/lib/database/types'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { FederationPolicyUnavailableError } from '@/lib/services/federation/policyUnavailable'

import { getNonLocalActorRedirectTarget } from './resolveActorRedirect'

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  isLocalFederationDomain: vi.fn()
}))

const database = {} as Database

describe('getNonLocalActorRedirectTarget', () => {
  it('redirects a remote actor to its own server', async () => {
    vi.mocked(isLocalFederationDomain).mockResolvedValue(false)
    await expect(
      getNonLocalActorRedirectTarget(
        database,
        'bob',
        'remote.test',
        '/followers'
      )
    ).resolves.toBe('https://remote.test/@bob/followers')
  })

  // A redirect loop or a 500 would follow from guessing either way.
  it('redirects nowhere while federation policy cannot be decided', async () => {
    vi.mocked(isLocalFederationDomain).mockRejectedValue(
      new FederationPolicyUnavailableError()
    )
    await expect(
      getNonLocalActorRedirectTarget(
        database,
        'bob',
        'alias.test',
        '/followers'
      )
    ).resolves.toBeNull()
  })

  it('still throws any other error', async () => {
    vi.mocked(isLocalFederationDomain).mockRejectedValue(new Error('boom'))
    await expect(
      getNonLocalActorRedirectTarget(database, 'bob', 'alias.test', '')
    ).rejects.toThrow('boom')
  })
})

import type { Database } from '@/lib/database/types'
import { isBlueskyAllowed } from '@/lib/services/bluesky/policy'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { FederationPolicyUnavailableError } from '@/lib/services/federation/policyUnavailable'

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))

describe('isBlueskyAllowed', () => {
  const database = {} as Database

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns true when bsky.app is allowed by federation policy', async () => {
    vi.mocked(canFederateWithDomain).mockResolvedValue(true)

    await expect(isBlueskyAllowed(database)).resolves.toBe(true)
    expect(canFederateWithDomain).toHaveBeenCalledWith(database, 'bsky.app')
  })

  it('returns false when bsky.app is blocked or outside the allowlist', async () => {
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)

    await expect(isBlueskyAllowed(database)).resolves.toBe(false)
    expect(canFederateWithDomain).toHaveBeenCalledWith(database, 'bsky.app')
  })

  it('returns false when federation policy is unavailable', async () => {
    vi.mocked(canFederateWithDomain).mockRejectedValue(
      new FederationPolicyUnavailableError()
    )

    await expect(isBlueskyAllowed(database)).resolves.toBe(false)
  })

  it('propagates non-policy errors', async () => {
    vi.mocked(canFederateWithDomain).mockRejectedValue(new Error('db down'))

    await expect(isBlueskyAllowed(database)).rejects.toThrow('db down')
  })
})

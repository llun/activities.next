import type { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { isFederatedRedirect } from '@/lib/services/federation/federatedRedirect'

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn<() => Database | null>(() => ({}) as Database)
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))

describe('isFederatedRedirect', () => {
  beforeEach(() => {
    mockGetDatabase.mockReturnValue({} as Database)
    vi.mocked(canFederateWithDomain).mockReset().mockResolvedValue(true)
  })

  it.each([
    'https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx',
    'https://bsky.app/inbox',
    'http://bsky.app/profile/alice.bsky.social',
    'https://BSKY.APP./users/alice'
  ])(
    'returns false for bsky.app URL %s even when policy allows it',
    async (href) => {
      await expect(isFederatedRedirect(new URL(href))).resolves.toBe(false)
      expect(canFederateWithDomain).not.toHaveBeenCalled()
    }
  )

  it('delegates non-bsky.app hosts to federation domain policy', async () => {
    await expect(
      isFederatedRedirect(new URL('https://mastodon.social/users/alice'))
    ).resolves.toBe(true)
    expect(canFederateWithDomain).toHaveBeenCalledWith(
      expect.anything(),
      'https://mastodon.social/users/alice'
    )

    vi.mocked(canFederateWithDomain).mockResolvedValueOnce(false)
    await expect(
      isFederatedRedirect(new URL('https://blocked.example/users/bob'))
    ).resolves.toBe(false)
  })
})

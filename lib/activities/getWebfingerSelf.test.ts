import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { request } from '@/lib/utils/request'

vi.mock('@/lib/utils/request', () => ({ request: vi.fn() }))

describe('getWebfingerSelf', () => {
  const mockRequest = vi.mocked(request)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    {
      account: 'alice@example.com',
      expectedResource: 'acct:alice@example.com',
      domain: 'example.com'
    },
    {
      account: '@alice@example.com',
      expectedResource: 'acct:alice@example.com',
      domain: 'example.com'
    },
    {
      account: 'acct:alice@example.com',
      expectedResource: 'acct:alice@example.com',
      domain: 'example.com'
    },
    {
      account: 'acct:@alice@example.com',
      expectedResource: 'acct:alice@example.com',
      domain: 'example.com'
    }
  ])(
    'resolves self link for account format "$account"',
    async ({ account, expectedResource, domain }) => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: JSON.stringify({
          subject: expectedResource,
          links: [
            {
              rel: 'self',
              type: 'application/activity+json',
              href: 'https://example.com/users/alice'
            }
          ]
        })
      })

      const result = await getWebfingerSelf({ account })

      expect(result).toBe('https://example.com/users/alice')
      expect(mockRequest).toHaveBeenCalledWith({
        url: `https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(
          expectedResource
        )}`,
        headers: {
          Accept: 'application/jrd+json, application/json'
        }
      })
    }
  )

  it.each(['alice', '@alice', 'alice@example.com@extra', ''])(
    'returns null for invalid account input "%s"',
    async (invalidAccount) => {
      const result = await getWebfingerSelf({ account: invalidAccount })
      expect(result).toBeNull()
      expect(mockRequest).not.toHaveBeenCalled()
    }
  )

  it('returns null when webfinger endpoint answers 404', async () => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 404,
      headers: {},
      body: 'Not Found'
    })

    const result = await getWebfingerSelf({ account: 'bob@example.com' })
    expect(result).toBeNull()
  })

  it('returns null when webfinger document lacks a self link', async () => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({
        subject: 'acct:bob@example.com',
        links: [
          {
            rel: 'http://webfinger.net/rel/profile-page',
            type: 'text/html',
            href: 'https://example.com/@bob'
          }
        ]
      })
    })

    const result = await getWebfingerSelf({ account: 'bob@example.com' })
    expect(result).toBeNull()
  })

  it('returns null and handles network error gracefully', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Connection timed out'))

    const result = await getWebfingerSelf({ account: 'bob@example.com' })
    expect(result).toBeNull()
  })
})

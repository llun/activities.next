import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { request } from '@/lib/utils/request'

vi.mock('@/lib/services/federation/federatedRedirect', () => ({
  isFederatedRedirect: vi.fn(async () => true)
}))

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
        },
        allowCrossHostRedirects: expect.any(Function)
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

  it.each([
    {
      name: 'prefers the ActivityPub self link over an earlier HTML one',
      links: [
        { rel: 'self', type: 'text/html', href: 'https://example.com/@bob' },
        {
          rel: 'self',
          type: 'application/activity+json',
          href: 'https://example.com/users/bob'
        }
      ],
      expected: 'https://example.com/users/bob'
    },
    {
      name: 'accepts the ld+json ActivityStreams profile type',
      links: [
        { rel: 'self', type: 'text/html', href: 'https://example.com/@bob' },
        {
          rel: 'self',
          type: 'application/ld+json;profile="https://www.w3.org/ns/activitystreams"',
          href: 'https://example.com/users/bob'
        }
      ],
      expected: 'https://example.com/users/bob'
    },
    {
      name: 'accepts an ld+json profile naming the ActivityStreams context among others',
      links: [
        { rel: 'self', type: 'text/html', href: 'https://example.com/@bob' },
        {
          rel: 'self',
          type: 'application/ld+json; profile="https://www.w3.org/ns/activitystreams https://example.com/x"',
          href: 'https://example.com/users/bob'
        }
      ],
      expected: 'https://example.com/users/bob'
    },
    {
      name: 'falls back to the first self link when no self link has a type',
      links: [
        { rel: 'self', href: 'https://example.com/users/bob' },
        { rel: 'self', href: 'https://example.com/other' }
      ],
      expected: 'https://example.com/users/bob'
    },
    {
      name: 'returns null when typed self links are none of ActivityPub',
      links: [
        { rel: 'self', type: 'text/html', href: 'https://example.com/@bob' },
        { rel: 'self', href: 'https://example.com/users/bob' }
      ],
      expected: null
    }
  ])('$name', async ({ links, expected }) => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ subject: 'acct:bob@example.com', links })
    })

    await expect(
      getWebfingerSelf({ account: 'bob@example.com' })
    ).resolves.toBe(expected)
  })

  it('returns null and handles network error gracefully', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Connection timed out'))

    const result = await getWebfingerSelf({ account: 'bob@example.com' })
    expect(result).toBeNull()
  })
})

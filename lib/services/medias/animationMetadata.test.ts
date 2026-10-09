import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getServerSoftware } from '@/lib/services/federation/serverSoftware'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  clearAnimationMetadataCacheForTests,
  extractMastodonStatusInfo,
  getAnimationMetadataCacheSizeForTests,
  isSameAuthor,
  resolveAnimationMetadata
} from './animationMetadata'

vi.mock('@/lib/services/federation/serverSoftware', () => ({
  getServerSoftware: vi.fn()
}))

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

describe('extractMastodonStatusInfo', () => {
  it('extracts domain and status ID from /users/:user/statuses/:id URLs', () => {
    const result = extractMastodonStatusInfo(
      'https://mastodon.social/@cheeaun/111000',
      'https://mastodon.social/users/cheeaun/statuses/111000'
    )
    expect(result).toEqual({
      domain: 'mastodon.social',
      statusId: '111000'
    })
  })

  it('extracts domain and status ID from /@:user/:id URLs', () => {
    const result = extractMastodonStatusInfo(
      'https://mastodon.social/@cheeaun/111000'
    )
    expect(result).toEqual({
      domain: 'mastodon.social',
      statusId: '111000'
    })
  })

  it('extracts domain and status ID from /statuses/:id URLs', () => {
    const result = extractMastodonStatusInfo(
      'https://hometown.example/statuses/abcdef123'
    )
    expect(result).toEqual({
      domain: 'hometown.example',
      statusId: 'abcdef123'
    })
  })

  it('returns null for non-matching URLs', () => {
    expect(extractMastodonStatusInfo('https://example.com/about')).toBeNull()
    expect(extractMastodonStatusInfo(null, 'invalid-id')).toBeNull()
  })
})

describe('resolveAnimationMetadata', () => {
  beforeEach(() => {
    clearAnimationMetadataCacheForTests()
    vi.clearAllMocks()
    vi.mocked(getServerSoftware).mockResolvedValue('mastodon')
  })

  afterEach(() => {
    clearAnimationMetadataCacheForTests()
  })

  it('resolves gifv playbackType for matched Mastodon attachment', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        id: '111000',
        uri: 'https://mastodon.social/users/cheeaun/statuses/111000',
        url: 'https://mastodon.social/@cheeaun/111000',
        account: {
          url: 'https://mastodon.social/@cheeaun'
        },
        media_attachments: [
          {
            id: 'med-1',
            type: 'gifv',
            url: 'https://files.mastodon.social/media/video.mp4',
            preview_url: 'https://files.mastodon.social/media/preview.jpg'
          }
        ]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://mastodon.social/api/v1/statuses/111000'
    })

    const result = await resolveAnimationMetadata({
      statusUrl: 'https://mastodon.social/@cheeaun/111000',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/111000',
      authorId: 'https://mastodon.social/users/cheeaun',
      attachments: [
        {
          url: 'https://files.mastodon.social/media/video.mp4',
          mediaType: 'video/mp4'
        }
      ]
    })

    expect(result['https://files.mastodon.social/media/video.mp4']).toEqual({
      playbackType: 'gifv',
      previewUrl: 'https://files.mastodon.social/media/preview.jpg',
      definitive: true
    })

    expect(safeRemoteFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://mastodon.social/api/v1/statuses/111000',
        timeoutInMilliseconds: 5000
      })
    )
  })

  it('distinguishes video from gifv', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        id: '111000',
        uri: 'https://mastodon.social/users/cheeaun/statuses/111000',
        account: {
          url: 'https://mastodon.social/@cheeaun'
        },
        media_attachments: [
          {
            id: 'med-1',
            type: 'video',
            url: 'https://files.mastodon.social/media/movie.mp4',
            preview_url: 'https://files.mastodon.social/media/thumb.jpg'
          }
        ]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://mastodon.social/api/v1/statuses/111000'
    })

    const result = await resolveAnimationMetadata({
      statusUrl: 'https://mastodon.social/@cheeaun/111000',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/111000',
      authorId: 'https://mastodon.social/users/cheeaun',
      attachments: [
        {
          url: 'https://files.mastodon.social/media/movie.mp4',
          mediaType: 'video/mp4'
        }
      ]
    })

    expect(result['https://files.mastodon.social/media/movie.mp4']).toEqual({
      playbackType: 'video',
      previewUrl: 'https://files.mastodon.social/media/thumb.jpg',
      definitive: true
    })
  })

  it('caches results and does not make duplicate remote calls', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        id: '111000',
        account: {
          url: 'https://mastodon.social/@cheeaun'
        },
        media_attachments: [
          {
            id: 'med-1',
            type: 'gifv',
            url: 'https://files.mastodon.social/media/video.mp4',
            preview_url: 'https://files.mastodon.social/media/preview.jpg'
          }
        ]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://mastodon.social/api/v1/statuses/111000'
    })

    await resolveAnimationMetadata({
      statusUrl: 'https://mastodon.social/@cheeaun/111000',
      statusId: '111000',
      authorId: 'https://mastodon.social/users/cheeaun',
      attachments: [
        {
          url: 'https://files.mastodon.social/media/video.mp4',
          mediaType: 'video/mp4'
        }
      ]
    })

    expect(getAnimationMetadataCacheSizeForTests()).toBe(1)

    // Second call should hit the cache
    await resolveAnimationMetadata({
      statusUrl: 'https://mastodon.social/@cheeaun/111000',
      statusId: '111000',
      authorId: 'https://mastodon.social/users/cheeaun',
      attachments: [
        {
          url: 'https://files.mastodon.social/media/video.mp4',
          mediaType: 'video/mp4'
        }
      ]
    })

    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent requests for the same status', async () => {
    vi.mocked(safeRemoteFetch).mockImplementation(
      async () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              statusCode: 200,
              body: JSON.stringify({
                id: '111000',
                account: {
                  url: 'https://mastodon.social/@cheeaun'
                },
                media_attachments: [
                  {
                    id: 'med-1',
                    type: 'gifv',
                    url: 'https://files.mastodon.social/media/video.mp4',
                    preview_url: null
                  }
                ]
              }),
              bodyTruncated: false,
              headers: {},
              url: 'https://mastodon.social/api/v1/statuses/111000'
            })
          }, 20)
        })
    )

    const [res1, res2] = await Promise.all([
      resolveAnimationMetadata({
        statusUrl: 'https://mastodon.social/@cheeaun/111000',
        statusId: '111000',
        authorId: 'https://mastodon.social/users/cheeaun',
        attachments: [
          {
            url: 'https://files.mastodon.social/media/video.mp4',
            mediaType: 'video/mp4'
          }
        ]
      }),
      resolveAnimationMetadata({
        statusUrl: 'https://mastodon.social/@cheeaun/111000',
        statusId: '111000',
        authorId: 'https://mastodon.social/users/cheeaun',
        attachments: [
          {
            url: 'https://files.mastodon.social/media/video.mp4',
            mediaType: 'video/mp4'
          }
        ]
      })
    ])

    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
    expect(res1).toEqual(res2)
  })

  it('rejects status with mismatched ID', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        id: '999999', // Different status ID
        account: {
          url: 'https://mastodon.social/@cheeaun'
        },
        media_attachments: [
          {
            id: 'med-1',
            type: 'gifv',
            url: 'https://files.mastodon.social/media/video.mp4'
          }
        ]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://mastodon.social/api/v1/statuses/111000'
    })

    const result = await resolveAnimationMetadata({
      statusUrl: 'https://mastodon.social/@cheeaun/111000',
      statusId: '111000',
      authorId: 'https://mastodon.social/users/cheeaun',
      attachments: [
        {
          url: 'https://files.mastodon.social/media/video.mp4',
          mediaType: 'video/mp4'
        }
      ]
    })

    expect(result['https://files.mastodon.social/media/video.mp4']).toEqual({
      playbackType: 'unknown',
      previewUrl: null,
      definitive: true
    })
  })

  it('rejects status with mismatched author attribution', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        id: '111000',
        account: {
          url: 'https://mastodon.social/@attacker'
        },
        media_attachments: [
          {
            id: 'med-1',
            type: 'gifv',
            url: 'https://files.mastodon.social/media/video.mp4'
          }
        ]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://mastodon.social/api/v1/statuses/111000'
    })

    const result = await resolveAnimationMetadata({
      statusUrl: 'https://mastodon.social/@cheeaun/111000',
      statusId: '111000',
      authorId: 'https://mastodon.social/users/cheeaun',
      attachments: [
        {
          url: 'https://files.mastodon.social/media/video.mp4',
          mediaType: 'video/mp4'
        }
      ]
    })

    expect(result['https://files.mastodon.social/media/video.mp4']).toEqual({
      playbackType: 'unknown',
      previewUrl: null,
      definitive: true
    })
  })

  it('skips lookup for non-Mastodon servers', async () => {
    vi.mocked(getServerSoftware).mockResolvedValue('pixelfed')

    const result = await resolveAnimationMetadata({
      statusUrl: 'https://pixelfed.social/p/user/111000',
      statusId: '111000',
      attachments: [
        {
          url: 'https://pixelfed.social/video.mp4',
          mediaType: 'video/mp4'
        }
      ]
    })

    expect(safeRemoteFetch).not.toHaveBeenCalled()
    expect(result['https://pixelfed.social/video.mp4']).toEqual({
      playbackType: 'unknown',
      previewUrl: null,
      definitive: true
    })
  })

  it('handles remote fetch errors gracefully and preserves non-definitive state on cache hit', async () => {
    vi.mocked(safeRemoteFetch).mockRejectedValue(new Error('Network timeout'))

    const result = await resolveAnimationMetadata({
      statusUrl: 'https://mastodon.social/@cheeaun/111000',
      statusId: '111000',
      attachments: [
        {
          url: 'https://files.mastodon.social/media/video.mp4',
          mediaType: 'video/mp4'
        }
      ]
    })

    expect(result['https://files.mastodon.social/media/video.mp4']).toEqual({
      playbackType: 'unknown',
      previewUrl: null,
      definitive: false
    })

    // Second call hitting failure cache must still preserve definitive: false
    const cachedResult = await resolveAnimationMetadata({
      statusUrl: 'https://mastodon.social/@cheeaun/111000',
      statusId: '111000',
      authorId: 'https://mastodon.social/users/cheeaun',
      attachments: [
        {
          url: 'https://files.mastodon.social/media/video.mp4',
          mediaType: 'video/mp4'
        }
      ]
    })

    expect(
      cachedResult['https://files.mastodon.social/media/video.mp4']
    ).toEqual({
      playbackType: 'unknown',
      previewUrl: null,
      definitive: false
    })
  })
})

describe('isSameAuthor', () => {
  it('matches author when account URL matches authorId', () => {
    expect(
      isSameAuthor(
        { url: 'https://mastodon.social/@cheeaun' },
        'https://mastodon.social/users/cheeaun'
      )
    ).toBe(true)
  })

  it('verifies host when account url is omitted and acct contains remote host', () => {
    expect(
      isSameAuthor(
        { username: 'cheeaun', acct: 'cheeaun@mastodon.social' },
        'https://mastodon.social/users/cheeaun',
        'mastodon.social'
      )
    ).toBe(true)

    // Rejects if acct domain does not match author host
    expect(
      isSameAuthor(
        { username: 'cheeaun', acct: 'cheeaun@evil.com' },
        'https://mastodon.social/users/cheeaun',
        'evil.com'
      )
    ).toBe(false)
  })

  it('verifies host when account url is omitted and user is local to server', () => {
    expect(
      isSameAuthor(
        { username: 'cheeaun', acct: 'cheeaun' },
        'https://mastodon.social/users/cheeaun',
        'mastodon.social'
      )
    ).toBe(true)

    expect(
      isSameAuthor(
        { username: 'cheeaun', acct: 'cheeaun' },
        'https://mastodon.social/users/cheeaun',
        'other-instance.example'
      )
    ).toBe(false)
  })
})

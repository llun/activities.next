import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getServerSoftware } from '@/lib/services/federation/serverSoftware'
import { MediaDatabase } from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  clearAnimationMetadataCacheForTests,
  enrichStatusAttachments,
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

describe('enrichStatusAttachments', () => {
  beforeEach(() => {
    clearAnimationMetadataCacheForTests()
    vi.clearAllMocks()
    vi.mocked(getServerSoftware).mockResolvedValue('mastodon')
  })

  it('enriches attachments and updates database when provided', async () => {
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

    const mockDb = {
      updateAttachmentPlayback: vi.fn().mockResolvedValue(true)
    } as unknown as MediaDatabase

    const attachment: Attachment = {
      id: 'att-1',
      actorId: 'act-1',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/111000',
      mediaType: 'video/mp4',
      type: 'Document',
      url: 'https://files.mastodon.social/media/video.mp4',
      name: 'Animation',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const status = {
      id: 'https://mastodon.social/users/cheeaun/statuses/111000',
      url: 'https://mastodon.social/@cheeaun/111000',
      actorId: 'https://mastodon.social/users/cheeaun',
      attachments: [attachment]
    }

    const enriched = await enrichStatusAttachments(status, mockDb)

    expect(enriched.attachments[0].playbackType).toBe('gifv')
    expect(enriched.attachments[0].thumbnailUrl).toBe(
      'https://files.mastodon.social/media/preview.jpg'
    )
    expect(mockDb.updateAttachmentPlayback).toHaveBeenCalledWith({
      id: 'att-1',
      playbackType: 'gifv',
      thumbnailUrl: 'https://files.mastodon.social/media/preview.jpg'
    })
  })

  it('skips attachments that already have playbackType set', async () => {
    const attachment: Attachment = {
      id: 'att-1',
      actorId: 'act-1',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/111000',
      mediaType: 'video/mp4',
      name: '',
      type: 'Document',
      url: 'https://files.mastodon.social/media/video.mp4',
      playbackType: 'video',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const status = {
      id: 'https://mastodon.social/users/cheeaun/statuses/111000',
      url: 'https://mastodon.social/@cheeaun/111000',
      attachments: [attachment]
    }

    await enrichStatusAttachments(status)
    expect(safeRemoteFetch).not.toHaveBeenCalled()
  })

  it('does not write playbackType: unknown to database on transient fetch failure even across multiple calls', async () => {
    vi.mocked(safeRemoteFetch).mockRejectedValue(new Error('Network error'))

    const mockDb = {
      updateAttachmentPlayback: vi.fn()
    } as unknown as MediaDatabase

    const attachment: Attachment = {
      id: 'att-transient',
      actorId: 'act-1',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/111000',
      mediaType: 'video/mp4',
      type: 'Document',
      url: 'https://files.mastodon.social/media/video.mp4',
      name: 'Animation',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const status = {
      id: 'https://mastodon.social/users/cheeaun/statuses/111000',
      url: 'https://mastodon.social/@cheeaun/111000',
      actorId: 'https://mastodon.social/users/cheeaun',
      attachments: [attachment]
    }

    await enrichStatusAttachments(status, mockDb)
    // Second call hitting cache
    await enrichStatusAttachments(status, mockDb)

    expect(mockDb.updateAttachmentPlayback).not.toHaveBeenCalled()
    expect(attachment.playbackType).toBeUndefined()
  })

  it('writes playbackType: unknown to database on definitive 404', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 404,
      body: 'Not Found',
      bodyTruncated: false,
      headers: {},
      url: 'https://mastodon.social/api/v1/statuses/111000'
    })

    const mockDb = {
      updateAttachmentPlayback: vi.fn().mockResolvedValue(true)
    } as unknown as MediaDatabase

    const attachment: Attachment = {
      id: 'att-404',
      actorId: 'act-1',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/111000',
      mediaType: 'video/mp4',
      type: 'Document',
      url: 'https://files.mastodon.social/media/video.mp4',
      name: 'Animation',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const status = {
      id: 'https://mastodon.social/users/cheeaun/statuses/111000',
      url: 'https://mastodon.social/@cheeaun/111000',
      actorId: 'https://mastodon.social/users/cheeaun',
      attachments: [attachment]
    }

    await enrichStatusAttachments(status, mockDb)

    expect(mockDb.updateAttachmentPlayback).toHaveBeenCalledWith({
      id: 'att-404',
      playbackType: 'unknown',
      thumbnailUrl: null
    })
    expect(attachment.playbackType).toBe('unknown')
  })
})

describe('caching and bounds', () => {
  beforeEach(() => {
    clearAnimationMetadataCacheForTests()
    vi.clearAllMocks()
    vi.mocked(getServerSoftware).mockResolvedValue('mastodon')
  })

  it('negative caches failures so subsequent requests do not re-probe immediately', async () => {
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 404,
      body: 'Not Found',
      bodyTruncated: false,
      headers: {},
      url: 'https://mastodon.social/api/v1/statuses/111000'
    })

    await resolveAnimationMetadata({
      statusUrl: 'https://mastodon.social/@cheeaun/111000',
      statusId: '111000',
      attachments: [
        {
          url: 'https://files.mastodon.social/video.mp4',
          mediaType: 'video/mp4'
        }
      ]
    })

    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)

    // Second request should use negative cache
    await resolveAnimationMetadata({
      statusUrl: 'https://mastodon.social/@cheeaun/111000',
      statusId: '111000',
      attachments: [
        {
          url: 'https://files.mastodon.social/video.mp4',
          mediaType: 'video/mp4'
        }
      ]
    })

    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)
  })

  it('bounds cache size to MAX_CACHED_STATUSES', async () => {
    vi.mocked(safeRemoteFetch).mockImplementation(async (opts) => {
      const match = opts.url.match(/\/statuses\/(\d+)/)
      const id = match ? match[1] : '1'
      return {
        statusCode: 200,
        body: JSON.stringify({ id, media_attachments: [] }),
        bodyTruncated: false,
        headers: {},
        url: opts.url
      }
    })

    for (let i = 0; i < 515; i++) {
      await resolveAnimationMetadata({
        statusUrl: `https://mastodon.social/@user/${i}`,
        statusId: `${i}`,
        attachments: [
          {
            url: `https://files.mastodon.social/video${i}.mp4`,
            mediaType: 'video/mp4'
          }
        ]
      })
    }

    expect(getAnimationMetadataCacheSizeForTests()).toBe(512)
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

describe('definitive negative resolution persistence', () => {
  beforeEach(() => {
    clearAnimationMetadataCacheForTests()
    vi.clearAllMocks()
  })

  it('persists playbackType: unknown for definitive non-animation attachments to prevent re-probing', async () => {
    vi.mocked(getServerSoftware).mockResolvedValue('mastodon')
    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        id: '111000',
        account: { url: 'https://mastodon.social/@cheeaun' },
        media_attachments: [
          {
            id: 'med-1',
            type: 'video', // Standard video, not a gifv
            url: 'https://files.mastodon.social/media/video.mp4'
          }
        ]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://mastodon.social/api/v1/statuses/111000'
    })

    const mockDb = {
      updateAttachmentPlayback: vi.fn().mockResolvedValue(true)
    } as unknown as MediaDatabase

    const attachment: Attachment = {
      id: 'att-1',
      actorId: 'act-1',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/111000',
      mediaType: 'video/mp4',
      type: 'Document',
      url: 'https://files.mastodon.social/media/video.mp4',
      name: 'Video',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const status = {
      id: 'https://mastodon.social/users/cheeaun/statuses/111000',
      url: 'https://mastodon.social/@cheeaun/111000',
      actorId: 'https://mastodon.social/users/cheeaun',
      attachments: [attachment]
    }

    const enriched = await enrichStatusAttachments(status, mockDb)
    expect(enriched.attachments[0].playbackType).toBe('video')
    expect(mockDb.updateAttachmentPlayback).toHaveBeenCalledWith({
      id: 'att-1',
      playbackType: 'video',
      thumbnailUrl: null
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getServerSoftware } from '@/lib/services/federation/serverSoftware'
import { MediaDatabase } from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  BATCH_ANIMATION_METADATA_TIMEOUT_MS,
  MAX_BATCH_ANIMATION_METADATA_LOOKUPS,
  clearAnimationMetadataCacheForTests,
  enrichStatusAttachments,
  enrichStatusesAttachments,
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
      thumbnailUrl: 'https://files.mastodon.social/media/preview.jpg',
      onlyIfUnset: true
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
      thumbnailUrl: null,
      onlyIfUnset: true
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
      thumbnailUrl: null,
      onlyIfUnset: true
    })
  })
})

describe('enrichStatusesAttachments', () => {
  const mockDb: MediaDatabase = {
    updateAttachmentPlayback: vi.fn().mockResolvedValue(true)
  } as unknown as MediaDatabase

  beforeEach(() => {
    clearAnimationMetadataCacheForTests()
    vi.mocked(getServerSoftware).mockReset()
    vi.mocked(safeRemoteFetch).mockReset()
    vi.mocked(mockDb.updateAttachmentPlayback).mockReset()
    vi.mocked(getServerSoftware).mockResolvedValue('mastodon')
  })

  it('returns empty array when given empty or null statuses', async () => {
    expect(await enrichStatusesAttachments([])).toEqual([])
  })

  it('enriches a batch containing Notes, Polls, and Announce boosts', async () => {
    const noteAttachment: Attachment = {
      id: 'note-att-1',
      actorId: 'https://mastodon.social/users/cheeaun',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/1001',
      type: 'Document',
      mediaType: 'video/mp4',
      url: 'https://files.mastodon.social/media/1001.mp4',
      name: 'Note video',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const noteStatus: StatusNote = {
      id: 'https://mastodon.social/users/cheeaun/statuses/1001',
      url: 'https://mastodon.social/@cheeaun/1001',
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: 'Note text',
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [noteAttachment],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const pollAttachment: Attachment = {
      id: 'poll-att-1',
      actorId: 'https://mastodon.social/users/cheeaun',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/1002',
      type: 'Document',
      mediaType: 'video/mp4',
      url: 'https://files.mastodon.social/media/1002.mp4',
      name: 'Poll video',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const pollStatus: StatusPoll = {
      ...noteStatus,
      id: 'https://mastodon.social/users/cheeaun/statuses/1002',
      url: 'https://mastodon.social/@cheeaun/1002',
      type: StatusType.enum.Poll,
      choices: [],
      endAt: Date.now() + 10000,
      pollType: 'oneOf',
      attachments: [pollAttachment]
    }

    const boostOriginalAttachment: Attachment = {
      id: 'boost-orig-att-1',
      actorId: 'https://mastodon.social/users/cheeaun',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/1003',
      type: 'Document',
      mediaType: 'video/mp4',
      url: 'https://files.mastodon.social/media/1003.mp4',
      name: 'Boost original video',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const boostOriginalStatus: StatusNote = {
      ...noteStatus,
      id: 'https://mastodon.social/users/cheeaun/statuses/1003',
      url: 'https://mastodon.social/@cheeaun/1003',
      attachments: [boostOriginalAttachment]
    }

    const boostStatus: StatusAnnounce = {
      id: 'https://llun.test/users/booster/statuses/boost-1',
      actorId: 'https://llun.test/users/booster',
      actor: null,
      type: StatusType.enum.Announce,
      to: [],
      cc: [],
      edits: [],
      isLocalActor: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      originalStatus: boostOriginalStatus
    }

    vi.mocked(safeRemoteFetch).mockImplementation(async ({ url }) => {
      if (url.includes('1001')) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            id: '1001',
            uri: noteStatus.id,
            url: noteStatus.url,
            account: { url: 'https://mastodon.social/@cheeaun' },
            media_attachments: [
              {
                id: 'm1',
                type: 'gifv',
                url: 'https://files.mastodon.social/media/1001.mp4',
                preview_url:
                  'https://files.mastodon.social/media/1001-preview.png'
              }
            ]
          }),
          bodyTruncated: false,
          headers: {},
          url
        }
      }
      if (url.includes('1002')) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            id: '1002',
            uri: pollStatus.id,
            url: pollStatus.url,
            account: { url: 'https://mastodon.social/@cheeaun' },
            media_attachments: [
              {
                id: 'm2',
                type: 'gifv',
                url: 'https://files.mastodon.social/media/1002.mp4',
                preview_url:
                  'https://files.mastodon.social/media/1002-preview.png'
              }
            ]
          }),
          bodyTruncated: false,
          headers: {},
          url
        }
      }
      if (url.includes('1003')) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            id: '1003',
            uri: boostOriginalStatus.id,
            url: boostOriginalStatus.url,
            account: { url: 'https://mastodon.social/@cheeaun' },
            media_attachments: [
              {
                id: 'm3',
                type: 'gifv',
                url: 'https://files.mastodon.social/media/1003.mp4',
                preview_url:
                  'https://files.mastodon.social/media/1003-preview.png'
              }
            ]
          }),
          bodyTruncated: false,
          headers: {},
          url
        }
      }
      return {
        statusCode: 404,
        body: '',
        bodyTruncated: false,
        headers: {},
        url
      }
    })

    const results = await enrichStatusesAttachments(
      [noteStatus, pollStatus, boostStatus],
      mockDb
    )

    expect(results).toHaveLength(3)
    // Note status enriched
    expect(noteAttachment.playbackType).toBe('gifv')
    expect(noteAttachment.thumbnailUrl).toBe(
      'https://files.mastodon.social/media/1001-preview.png'
    )
    // Poll status enriched
    expect(pollAttachment.playbackType).toBe('gifv')
    expect(pollAttachment.thumbnailUrl).toBe(
      'https://files.mastodon.social/media/1002-preview.png'
    )
    // Announce original enriched
    expect(boostOriginalAttachment.playbackType).toBe('gifv')
    expect(boostOriginalAttachment.thumbnailUrl).toBe(
      'https://files.mastodon.social/media/1003-preview.png'
    )

    // DB calls were made with onlyIfUnset: true
    expect(mockDb.updateAttachmentPlayback).toHaveBeenCalledWith({
      id: 'note-att-1',
      playbackType: 'gifv',
      thumbnailUrl: 'https://files.mastodon.social/media/1001-preview.png',
      onlyIfUnset: true
    })
    expect(mockDb.updateAttachmentPlayback).toHaveBeenCalledWith({
      id: 'poll-att-1',
      playbackType: 'gifv',
      thumbnailUrl: 'https://files.mastodon.social/media/1002-preview.png',
      onlyIfUnset: true
    })
    expect(mockDb.updateAttachmentPlayback).toHaveBeenCalledWith({
      id: 'boost-orig-att-1',
      playbackType: 'gifv',
      thumbnailUrl: 'https://files.mastodon.social/media/1003-preview.png',
      onlyIfUnset: true
    })
  })

  it('deduplicates repeated Announce originals and triggers only one remote lookup', async () => {
    const sharedAttachment: Attachment = {
      id: 'shared-att-1',
      actorId: 'https://mastodon.social/users/cheeaun',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/shared',
      type: 'Document',
      mediaType: 'video/mp4',
      url: 'https://files.mastodon.social/media/shared.mp4',
      name: 'Shared video',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const originalNote: StatusNote = {
      id: 'https://mastodon.social/users/cheeaun/statuses/shared',
      url: 'https://mastodon.social/@cheeaun/shared',
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: 'Original shared note',
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [sharedAttachment],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const boost1: StatusAnnounce = {
      id: 'https://llun.test/users/booster1/statuses/b1',
      actorId: 'https://llun.test/users/booster1',
      actor: null,
      type: StatusType.enum.Announce,
      to: [],
      cc: [],
      edits: [],
      isLocalActor: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      originalStatus: originalNote
    }

    // A separate clone/instance of the same original note
    const clonedOriginalNote: StatusNote = {
      ...originalNote,
      attachments: [{ ...sharedAttachment }]
    }

    const boost2: StatusAnnounce = {
      id: 'https://llun.test/users/booster2/statuses/b2',
      actorId: 'https://llun.test/users/booster2',
      actor: null,
      type: StatusType.enum.Announce,
      to: [],
      cc: [],
      edits: [],
      isLocalActor: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      originalStatus: clonedOriginalNote
    }

    vi.mocked(safeRemoteFetch).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        id: 'shared',
        uri: originalNote.id,
        url: originalNote.url,
        account: { url: 'https://mastodon.social/@cheeaun' },
        media_attachments: [
          {
            id: 'm-shared',
            type: 'gifv',
            url: 'https://files.mastodon.social/media/shared.mp4',
            preview_url: 'https://files.mastodon.social/media/shared-thumb.png'
          }
        ]
      }),
      bodyTruncated: false,
      headers: {},
      url: 'https://mastodon.social/api/v1/statuses/shared'
    })

    const results = await enrichStatusesAttachments([boost1, boost2], mockDb)
    expect(results).toHaveLength(2)

    // safeRemoteFetch was called exactly ONCE for the shared original
    expect(safeRemoteFetch).toHaveBeenCalledTimes(1)

    // Both boost original instances were enriched
    expect(sharedAttachment.playbackType).toBe('gifv')
    expect(clonedOriginalNote.attachments[0].playbackType).toBe('gifv')
    expect(clonedOriginalNote.attachments[0].thumbnailUrl).toBe(
      'https://files.mastodon.social/media/shared-thumb.png'
    )
  })

  it('skips statuses that already have playbackType set', async () => {
    const classifiedAttachment: Attachment = {
      id: 'att-already-gifv',
      actorId: 'https://mastodon.social/users/cheeaun',
      statusId: 'https://mastodon.social/users/cheeaun/statuses/999',
      type: 'Document',
      mediaType: 'video/mp4',
      url: 'https://files.mastodon.social/media/999.mp4',
      name: 'Classified',
      playbackType: 'gifv',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const status: StatusNote = {
      id: 'https://mastodon.social/users/cheeaun/statuses/999',
      url: 'https://mastodon.social/@cheeaun/999',
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: 'Already classified',
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [classifiedAttachment],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    await enrichStatusesAttachments([status], mockDb)
    expect(safeRemoteFetch).not.toHaveBeenCalled()
  })

  it('bounds candidate lookups to MAX_BATCH_ANIMATION_METADATA_LOOKUPS (20)', async () => {
    const statuses: StatusNote[] = Array.from({ length: 25 }, (_, i) => ({
      id: `https://mastodon.social/users/cheeaun/statuses/bound-${i}`,
      url: `https://mastodon.social/@cheeaun/bound-${i}`,
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: `Bound note ${i}`,
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [
        {
          id: `bound-att-${i}`,
          actorId: 'https://mastodon.social/users/cheeaun',
          statusId: `https://mastodon.social/users/cheeaun/statuses/bound-${i}`,
          type: 'Document',
          mediaType: 'video/mp4',
          url: `https://files.mastodon.social/media/bound-${i}.mp4`,
          name: `bound-${i}`,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now() - i * 1000,
      updatedAt: Date.now() - i * 1000
    }))

    vi.mocked(safeRemoteFetch).mockImplementation(async ({ url }) => {
      const match = url.match(/bound-(\d+)/)
      const index = match ? match[1] : '0'
      return {
        statusCode: 200,
        body: JSON.stringify({
          id: `bound-${index}`,
          uri: `https://mastodon.social/users/cheeaun/statuses/bound-${index}`,
          url: `https://mastodon.social/@cheeaun/bound-${index}`,
          account: { url: 'https://mastodon.social/@cheeaun' },
          media_attachments: [
            {
              id: `m-bound-${index}`,
              type: 'gifv',
              url: `https://files.mastodon.social/media/bound-${index}.mp4`
            }
          ]
        }),
        bodyTruncated: false,
        headers: {},
        url
      }
    })

    const results = await enrichStatusesAttachments(statuses, mockDb)
    expect(results).toHaveLength(25)
    // Exactly MAX_BATCH_ANIMATION_METADATA_LOOKUPS (20) lookups were performed
    expect(safeRemoteFetch).toHaveBeenCalledTimes(
      MAX_BATCH_ANIMATION_METADATA_LOOKUPS
    )

    // First 20 are enriched
    for (let i = 0; i < MAX_BATCH_ANIMATION_METADATA_LOOKUPS; i++) {
      expect((results[i] as StatusNote).attachments[0].playbackType).toBe(
        'gifv'
      )
    }
    // Remaining 5 are left unclassified
    for (let i = MAX_BATCH_ANIMATION_METADATA_LOOKUPS; i < 25; i++) {
      expect(
        (results[i] as StatusNote).attachments[0].playbackType
      ).toBeUndefined()
    }
  })

  it('handles timeout when batch execution exceeds BATCH_ANIMATION_METADATA_TIMEOUT_MS', async () => {
    const status: StatusNote = {
      id: 'https://mastodon.social/users/cheeaun/statuses/timeout-test',
      url: 'https://mastodon.social/@cheeaun/timeout-test',
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: 'Timeout test',
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [
        {
          id: 'timeout-att',
          actorId: 'https://mastodon.social/users/cheeaun',
          statusId:
            'https://mastodon.social/users/cheeaun/statuses/timeout-test',
          type: 'Document',
          mediaType: 'video/mp4',
          url: 'https://files.mastodon.social/media/timeout.mp4',
          name: 'timeout',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      // safeRemoteFetch never resolves
      vi.mocked(safeRemoteFetch).mockImplementation(() => new Promise(() => {}))

      const enrichPromise = enrichStatusesAttachments([status], mockDb)
      await vi.advanceTimersByTimeAsync(
        BATCH_ANIMATION_METADATA_TIMEOUT_MS + 50
      )
      const results = await enrichPromise

      expect(results).toHaveLength(1)
      expect(
        (results[0] as StatusNote).attachments[0].playbackType
      ).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Batch animation metadata enrichment timed out'
        })
      )
    } finally {
      vi.useRealTimers()
      warnSpy.mockRestore()
    }
  })

  it('isolates candidate errors so other candidates in the batch succeed', async () => {
    const failingStatus: StatusNote = {
      id: 'https://mastodon.social/users/cheeaun/statuses/failing-candidate',
      url: 'https://mastodon.social/@cheeaun/failing-candidate',
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: 'Failing candidate',
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [
        {
          id: 'fail-att',
          actorId: 'https://mastodon.social/users/cheeaun',
          statusId:
            'https://mastodon.social/users/cheeaun/statuses/failing-candidate',
          type: 'Document',
          mediaType: 'video/mp4',
          url: 'https://files.mastodon.social/media/fail.mp4',
          name: 'fail',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const succeedingStatus: StatusNote = {
      id: 'https://mastodon.social/users/cheeaun/statuses/succeeding-candidate',
      url: 'https://mastodon.social/@cheeaun/succeeding-candidate',
      actorId: 'https://mastodon.social/users/cheeaun',
      actor: null,
      type: StatusType.enum.Note,
      text: 'Succeeding candidate',
      summary: null,
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      to: [],
      cc: [],
      edits: [],
      attachments: [
        {
          id: 'success-att',
          actorId: 'https://mastodon.social/users/cheeaun',
          statusId:
            'https://mastodon.social/users/cheeaun/statuses/succeeding-candidate',
          type: 'Document',
          mediaType: 'video/mp4',
          url: 'https://files.mastodon.social/media/success.mp4',
          name: 'success',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ],
      tags: [],
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    try {
      vi.mocked(safeRemoteFetch).mockImplementation(async ({ url }) => ({
        statusCode: 200,
        body: JSON.stringify({
          id: url.includes('failing')
            ? 'failing-candidate'
            : 'succeeding-candidate',
          uri: url.includes('failing') ? failingStatus.id : succeedingStatus.id,
          url,
          account: { url: 'https://mastodon.social/@cheeaun' },
          media_attachments: [
            {
              id: 'm-anim',
              type: 'gifv',
              url: url.includes('failing')
                ? 'https://files.mastodon.social/media/fail.mp4'
                : 'https://files.mastodon.social/media/success.mp4'
            }
          ]
        }),
        bodyTruncated: false,
        headers: {},
        url
      }))

      vi.mocked(mockDb.updateAttachmentPlayback).mockImplementation(
        async ({ id }) => {
          if (id === 'fail-att') {
            throw new Error('Database write error')
          }
          return true
        }
      )

      const results = await enrichStatusesAttachments(
        [failingStatus, succeedingStatus],
        mockDb
      )
      expect(results).toHaveLength(2)
      // Succeeding candidate was successfully enriched and updated
      expect((results[1] as StatusNote).attachments[0].playbackType).toBe(
        'gifv'
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to enrich status attachments in batch',
          statusId: failingStatus.id
        })
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})

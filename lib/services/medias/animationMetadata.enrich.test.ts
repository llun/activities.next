import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getServerSoftware } from '@/lib/services/federation/serverSoftware'
import { MediaDatabase } from '@/lib/types/database/operations'
import { Attachment } from '@/lib/types/domain/attachment'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  clearAnimationMetadataCacheForTests,
  enrichStatusAttachments,
  getAnimationMetadataCacheSizeForTests,
  resolveAnimationMetadata
} from './animationMetadata'

vi.mock('@/lib/services/federation/serverSoftware', () => ({
  getServerSoftware: vi.fn()
}))

vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: vi.fn()
}))

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
      statusId: 'https://mastodon.social/users/cheeaun/statuses/111000',
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
      statusId: 'https://mastodon.social/users/cheeaun/statuses/111000',
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
      statusId: 'https://mastodon.social/users/cheeaun/statuses/111000',
      playbackType: 'video',
      thumbnailUrl: null,
      onlyIfUnset: true
    })
  })
})

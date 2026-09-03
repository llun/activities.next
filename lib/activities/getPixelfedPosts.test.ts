import { enableFetchMocks } from 'jest-fetch-mock'

import { MockActivityPubPerson } from '@/lib/stub/person'
import { Actor } from '@/lib/types/activitypub'
import { StatusType } from '@/lib/types/domain/status'

import {
  fromPixelfedStatus,
  getPixelfedAccountId,
  getPixelfedPosts
} from './getPixelfedPosts'

enableFetchMocks()

describe('getPixelfedPosts', () => {
  const actorId = 'https://pixelfed.example/users/dansup'
  const person = MockActivityPubPerson({
    id: actorId,
    withContext: true
  }) as Actor

  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getPixelfedAccountId', () => {
    it('returns account id when lookup succeeds', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ id: '42' }))
      const accountId = await getPixelfedAccountId('pixelfed.example', 'dansup')
      expect(accountId).toBe('42')
    })

    it('returns null when lookup returns non-200 or error', async () => {
      fetchMock.mockResponseOnce('Not Found', { status: 404 })
      const accountId = await getPixelfedAccountId('pixelfed.example', 'dansup')
      expect(accountId).toBeNull()
    })
  })

  describe('fromPixelfedStatus', () => {
    it('correctly maps Pixelfed status fields to StatusNote', () => {
      const pixelfedStatus = {
        id: '1001',
        uri: 'https://pixelfed.example/p/dansup/1001',
        url: 'https://pixelfed.example/p/dansup/1001',
        content: '<p>A beautiful sunset #nature</p>',
        created_at: '2026-08-31T17:15:56.000Z',
        favourites_count: 62,
        reblogs_count: 9,
        reply_count: 4,
        media_attachments: [
          {
            id: '501',
            type: 'image',
            url: 'https://pixelfed.example/storage/1.jpg',
            preview_url: 'https://pixelfed.example/storage/1_thumb.jpg',
            description: 'Sunset over mountains',
            blurhash: 'U123456',
            meta: {
              original: { width: 1920, height: 1080 }
            }
          }
        ],
        tags: [{ name: 'nature', url: 'https://pixelfed.example/tags/nature' }]
      }

      const status = fromPixelfedStatus(pixelfedStatus, person, null)
      expect(status.type).toBe(StatusType.enum.Note)
      if (status.type === StatusType.enum.Note) {
        expect(status.id).toBe('https://pixelfed.example/p/dansup/1001')
        expect(status.totalLikes).toBe(62)
        expect(status.totalShares).toBe(9)
        expect(status.totalReplies).toBe(4)
        expect(status.attachments).toHaveLength(1)
        expect(status.attachments[0]).toMatchObject({
          url: 'https://pixelfed.example/storage/1.jpg',
          thumbnailUrl: 'https://pixelfed.example/storage/1_thumb.jpg',
          name: 'Sunset over mountains',
          blurhash: 'U123456',
          width: 1920,
          height: 1080
        })
      }
    })
  })

  describe('getPixelfedPosts', () => {
    it('fetches statuses from Pixelfed API and resolves pagination', async () => {
      const mockStatuses = Array.from({ length: 20 }, (_, i) => ({
        id: String(2000 - i),
        uri: `https://pixelfed.example/p/dansup/${2000 - i}`,
        url: `https://pixelfed.example/p/dansup/${2000 - i}`,
        content: `<p>Post ${i}</p>`,
        created_at: '2026-08-31T17:15:56.000Z',
        favourites_count: i * 5,
        reblogs_count: i,
        reply_count: i * 2,
        media_attachments: [
          {
            id: `media-${i}`,
            type: 'image',
            url: `https://pixelfed.example/storage/${i}.jpg`
          }
        ]
      }))

      fetchMock.mockResponse(async (req) => {
        if (
          req.url ===
          'https://pixelfed.example/api/v1/accounts/lookup?acct=dansup'
        ) {
          return {
            status: 200,
            body: JSON.stringify({ id: '2' })
          }
        }
        if (
          req.url ===
          'https://pixelfed.example/api/pixelfed/v1/accounts/2/statuses?limit=20'
        ) {
          return {
            status: 200,
            body: JSON.stringify(mockStatuses)
          }
        }
        return { status: 404, body: 'Not found' }
      })

      const result = await getPixelfedPosts({ person })
      expect(result).not.toBeNull()
      expect(result?.statuses).toHaveLength(20)
      expect(result?.statusesCount).toBe(20)
      expect(result?.nextPageUrl).toBe(
        'https://pixelfed.example/api/pixelfed/v1/accounts/2/statuses?limit=20&max_id=1981'
      )
    })

    it('returns null when account lookup fails', async () => {
      fetchMock.mockResponse(async () => ({
        status: 404,
        body: 'Not found'
      }))

      const result = await getPixelfedPosts({ person })
      expect(result).toBeNull()
    })
  })
})

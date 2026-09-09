import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Announcement } from '@/lib/types/mastodon/announcement'

import {
  addAnnouncementReaction,
  dismissAnnouncement,
  getAnnouncements,
  removeAnnouncementReaction
} from './announcements'

describe('announcements client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  const mockAnnouncement: Announcement = {
    id: 'announcement-1',
    content: '<p>Hello world</p>',
    starts_at: null,
    ends_at: null,
    all_day: false,
    published_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    read: false,
    mentions: [],
    statuses: [],
    tags: [],
    emojis: [],
    reactions: []
  }

  describe('getAnnouncements', () => {
    it('fetches and returns announcements on successful response', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockAnnouncement]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

      const result = await getAnnouncements()

      expect(result).toEqual([mockAnnouncement])
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/announcements', {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    })

    it('returns empty array when response is not ok', async () => {
      fetchMock.mockResponseOnce('Server error', { status: 500 })

      const result = await getAnnouncements()

      expect(result).toEqual([])
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/announcements', {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    })
  })

  describe('dismissAnnouncement', () => {
    it('returns true on successful dismissal', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const result = await dismissAnnouncement('announcement-1')

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/announcements/announcement-1/dismiss',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }
      )
    })

    it('returns false when dismissal fails', async () => {
      fetchMock.mockResponseOnce('Error', { status: 400 })

      const result = await dismissAnnouncement('announcement-1')

      expect(result).toBe(false)
    })

    it('encodes URI components in the URL', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      await dismissAnnouncement('id with spaces')

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/announcements/id%20with%20spaces/dismiss',
        expect.any(Object)
      )
    })
  })

  describe('addAnnouncementReaction', () => {
    it('returns true on successful reaction addition', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const result = await addAnnouncementReaction('announcement-1', '👍')

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/announcements/announcement-1/reactions/${encodeURIComponent('👍')}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' }
        }
      )
    })

    it('returns false when reaction addition fails', async () => {
      fetchMock.mockResponseOnce('Error', { status: 400 })

      const result = await addAnnouncementReaction('announcement-1', '👍')

      expect(result).toBe(false)
    })
  })

  describe('removeAnnouncementReaction', () => {
    it('returns true on successful reaction removal', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const result = await removeAnnouncementReaction('announcement-1', '👍')

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/announcements/announcement-1/reactions/${encodeURIComponent('👍')}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        }
      )
    })

    it('returns false when reaction removal fails', async () => {
      fetchMock.mockResponseOnce('Error', { status: 400 })

      const result = await removeAnnouncementReaction('announcement-1', '👍')

      expect(result).toBe(false)
    })
  })
})

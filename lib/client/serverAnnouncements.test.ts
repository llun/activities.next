import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  type ServerAnnouncement,
  type ServerAnnouncementInput,
  createServerAnnouncement,
  deleteServerAnnouncement,
  getServerAnnouncements,
  updateServerAnnouncement
} from './serverAnnouncements'

describe('serverAnnouncements client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  const mockAnnouncement: ServerAnnouncement = {
    id: 'announcement-1',
    text: 'Scheduled maintenance tonight',
    published: true,
    all_day: false,
    starts_at: 1700000000000,
    ends_at: 1700003600000,
    published_at: 1699999000000,
    created_at: 1699999000000,
    updated_at: 1699999000000
  }

  describe('getServerAnnouncements', () => {
    it('fetches and returns announcements on successful response', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockAnnouncement]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

      const result = await getServerAnnouncements()

      expect(result).toEqual([mockAnnouncement])
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/announcements', {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    })

    it('throws when response is not ok', async () => {
      fetchMock.mockResponseOnce('Server error', { status: 500 })

      await expect(getServerAnnouncements()).rejects.toThrow(
        'Failed to load announcements (500)'
      )
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/announcements', {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    })
  })

  describe('createServerAnnouncement', () => {
    const input: ServerAnnouncementInput = {
      text: 'New announcement',
      published: true,
      all_day: true
    }

    it('creates announcement and returns ServerAnnouncement on successful response', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockAnnouncement), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

      const result = await createServerAnnouncement(input)

      expect(result).toEqual(mockAnnouncement)
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
    })

    it('returns null when response is not ok', async () => {
      fetchMock.mockResponseOnce('Unprocessable Entity', { status: 422 })

      const result = await createServerAnnouncement(input)

      expect(result).toBeNull()
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
    })
  })

  describe('updateServerAnnouncement', () => {
    const input: Partial<ServerAnnouncementInput> = {
      text: 'Updated announcement text'
    }

    it('updates announcement and returns ServerAnnouncement on successful response', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          ...mockAnnouncement,
          text: 'Updated announcement text'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )

      const result = await updateServerAnnouncement('announcement-1', input)

      expect(result).toEqual({
        ...mockAnnouncement,
        text: 'Updated announcement text'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/announcements/announcement-1',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        }
      )
    })

    it('escapes announcement id with special characters', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockAnnouncement), {
        status: 200
      })

      await updateServerAnnouncement('announcement/with spaces', input)

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/announcements/announcement%2Fwith%20spaces',
        expect.objectContaining({ method: 'PUT' })
      )
    })

    it('returns null when response is not ok', async () => {
      fetchMock.mockResponseOnce('Not Found', { status: 404 })

      const result = await updateServerAnnouncement('announcement-1', input)

      expect(result).toBeNull()
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/announcements/announcement-1',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        }
      )
    })
  })

  describe('deleteServerAnnouncement', () => {
    it('deletes announcement and returns true on successful response', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const result = await deleteServerAnnouncement('announcement-1')

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/announcements/announcement-1',
        { method: 'DELETE' }
      )
    })

    it('escapes announcement id with special characters', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      await deleteServerAnnouncement('announcement/with spaces')

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/announcements/announcement%2Fwith%20spaces',
        { method: 'DELETE' }
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce('Not Found', { status: 404 })

      const result = await deleteServerAnnouncement('announcement-1')

      expect(result).toBe(false)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/announcements/announcement-1',
        { method: 'DELETE' }
      )
    })
  })
})

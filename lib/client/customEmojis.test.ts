import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AdminCustomEmoji } from '@/lib/types/domain/customEmoji'
import type { CustomEmoji } from '@/lib/types/mastodon/customEmoji'

import {
  adminCreateCustomEmoji,
  adminDeleteCustomEmoji,
  adminListCustomEmojis,
  adminUpdateCustomEmoji,
  getCustomEmojis
} from './customEmojis'

describe('customEmojis client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getCustomEmojis', () => {
    it('fetches custom emojis and returns them on success', async () => {
      const mockEmojis: CustomEmoji[] = [
        {
          shortcode: 'party_blob',
          url: 'https://example.com/emojis/party_blob.png',
          static_url: 'https://example.com/emojis/party_blob.png',
          visible_in_picker: true,
          category: 'Party'
        }
      ]

      fetchMock.mockResponseOnce(JSON.stringify(mockEmojis), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

      const result = await getCustomEmojis()

      expect(result).toEqual(mockEmojis)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/custom_emojis', {
        headers: { Accept: 'application/json' }
      })
    })

    it('returns empty array when response is not ok', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Server error' }), {
        status: 500
      })

      const result = await getCustomEmojis()

      expect(result).toEqual([])
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/custom_emojis', {
        headers: { Accept: 'application/json' }
      })
    })

    it('returns empty array when fetch throws an error', async () => {
      fetchMock.mockRejectOnce(new Error('Network failure'))

      const result = await getCustomEmojis()

      expect(result).toEqual([])
    })
  })

  describe('adminListCustomEmojis', () => {
    it('fetches admin custom emojis successfully', async () => {
      const mockAdminEmojis: AdminCustomEmoji[] = [
        {
          id: 'emoji-1',
          shortcode: 'thumbsup',
          url: 'https://example.com/emojis/thumbsup.png',
          static_url: 'https://example.com/emojis/thumbsup.png',
          category: 'Reactions',
          visible_in_picker: true,
          disabled: false
        }
      ]

      fetchMock.mockResponseOnce(JSON.stringify(mockAdminEmojis), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

      const result = await adminListCustomEmojis()

      expect(result).toEqual(mockAdminEmojis)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/custom_emojis', {
        headers: { Accept: 'application/json' }
      })
    })

    it('throws error when response is not ok', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401
      })

      await expect(adminListCustomEmojis()).rejects.toThrow(
        'Failed to load custom emoji'
      )
    })
  })

  describe('adminCreateCustomEmoji', () => {
    it('creates custom emoji with form data and returns created emoji', async () => {
      const mockCreated: AdminCustomEmoji = {
        id: 'emoji-2',
        shortcode: 'celebrate',
        url: 'https://example.com/emojis/celebrate.png',
        static_url: 'https://example.com/emojis/celebrate.png',
        category: 'Custom',
        visible_in_picker: true,
        disabled: false
      }

      fetchMock.mockResponseOnce(JSON.stringify(mockCreated), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      })

      const file = new File(['fake-content'], 'celebrate.png', {
        type: 'image/png'
      })

      const result = await adminCreateCustomEmoji({
        shortcode: 'celebrate',
        image: file,
        category: 'Custom',
        visibleInPicker: true
      })

      expect(result).toEqual(mockCreated)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/v1/admin/custom_emojis')
      expect(init?.method).toBe('POST')
      expect(init?.body).toBeInstanceOf(FormData)

      const body = init?.body as FormData
      expect(body.get('shortcode')).toBe('celebrate')
      expect(body.get('image')).toBe(file)
      expect(body.get('category')).toBe('Custom')
      expect(body.get('visible_in_picker')).toBe('true')
    })

    it('creates custom emoji with visibleInPicker false and no category', async () => {
      const mockCreated: AdminCustomEmoji = {
        id: 'emoji-3',
        shortcode: 'stealth',
        url: 'https://example.com/emojis/stealth.png',
        static_url: 'https://example.com/emojis/stealth.png',
        category: null,
        visible_in_picker: false,
        disabled: false
      }

      fetchMock.mockResponseOnce(JSON.stringify(mockCreated), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

      const file = new File(['data'], 'stealth.png', { type: 'image/png' })

      const result = await adminCreateCustomEmoji({
        shortcode: 'stealth',
        image: file,
        visibleInPicker: false
      })

      expect(result).toEqual(mockCreated)
      const body = fetchMock.mock.calls[0][1]?.body as FormData
      expect(body.get('shortcode')).toBe('stealth')
      expect(body.get('category')).toBeNull()
      expect(body.get('visible_in_picker')).toBe('false')
    })

    it('throws server error message on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Shortcode already taken' }),
        { status: 422 }
      )

      const file = new File(['data'], 'taken.png', { type: 'image/png' })

      await expect(
        adminCreateCustomEmoji({
          shortcode: 'taken',
          image: file
        })
      ).rejects.toThrow('Shortcode already taken')
    })

    it('throws fallback error message when response body cannot be parsed', async () => {
      fetchMock.mockResponseOnce('Not JSON', { status: 500 })

      const file = new File(['data'], 'error.png', { type: 'image/png' })

      await expect(
        adminCreateCustomEmoji({
          shortcode: 'error',
          image: file
        })
      ).rejects.toThrow('Failed to create custom emoji')
    })
  })

  describe('adminUpdateCustomEmoji', () => {
    it('updates custom emoji fields and returns updated emoji', async () => {
      const mockUpdated: AdminCustomEmoji = {
        id: 'emoji-1',
        shortcode: 'thumbsup',
        url: 'https://example.com/emojis/thumbsup.png',
        static_url: 'https://example.com/emojis/thumbsup.png',
        category: 'New Category',
        visible_in_picker: false,
        disabled: true
      }

      fetchMock.mockResponseOnce(JSON.stringify(mockUpdated), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

      const result = await adminUpdateCustomEmoji({
        id: 'emoji-1',
        category: 'New Category',
        visibleInPicker: false,
        disabled: true
      })

      expect(result).toEqual(mockUpdated)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/custom_emojis/emoji-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'New Category',
            visible_in_picker: false,
            disabled: true
          })
        }
      )
    })

    it('supports updating only specific fields', async () => {
      const mockUpdated: AdminCustomEmoji = {
        id: 'emoji-1',
        shortcode: 'thumbsup',
        url: 'https://example.com/emojis/thumbsup.png',
        static_url: 'https://example.com/emojis/thumbsup.png',
        category: null,
        visible_in_picker: true,
        disabled: false
      }

      fetchMock.mockResponseOnce(JSON.stringify(mockUpdated), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })

      const result = await adminUpdateCustomEmoji({
        id: 'emoji-1',
        category: null
      })

      expect(result).toEqual(mockUpdated)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/custom_emojis/emoji-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: null
          })
        }
      )
    })

    it('throws error when update fails', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Not found' }), {
        status: 404
      })

      await expect(
        adminUpdateCustomEmoji({
          id: 'missing-id',
          disabled: true
        })
      ).rejects.toThrow('Failed to update custom emoji')
    })
  })

  describe('adminDeleteCustomEmoji', () => {
    it('sends DELETE request successfully', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({}), { status: 200 })

      await expect(
        adminDeleteCustomEmoji('emoji-to-delete')
      ).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/custom_emojis/emoji-to-delete',
        {
          method: 'DELETE'
        }
      )
    })

    it('throws error when delete fails', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Forbidden' }), {
        status: 403
      })

      await expect(adminDeleteCustomEmoji('emoji-to-delete')).rejects.toThrow(
        'Failed to delete custom emoji'
      )
    })
  })
})

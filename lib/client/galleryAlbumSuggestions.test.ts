import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getGalleryAlbumSuggestionMedia,
  getGalleryAlbumSuggestions
} from './galleryAlbumSuggestions'

enableFetchMocks()

const GET_INIT = { method: 'GET', headers: { Accept: 'application/json' } }

describe('gallery album suggestions client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getGalleryAlbumSuggestions', () => {
    it('reads the suggestions without a zone by default', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ suggestions: [] }))

      expect(await getGalleryAlbumSuggestions()).toEqual({ suggestions: [] })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/gallery/albums/suggestions',
        GET_INIT
      )
    })

    it('sends the viewer time zone, encoded', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ suggestions: [] }))

      await getGalleryAlbumSuggestions({ timeZone: 'America/New_York' })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/gallery/albums/suggestions?time_zone=America%2FNew_York',
        GET_INIT
      )
    })

    it('throws the error message of a failed read', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Too many requests' }),
        {
          status: 429
        }
      )

      await expect(getGalleryAlbumSuggestions()).rejects.toThrow(
        'Too many requests'
      )
    })

    it('falls back to a plain message when the failure has none', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(getGalleryAlbumSuggestions()).rejects.toThrow(
        'Failed to load suggestions.'
      )
    })
  })

  describe('getGalleryAlbumSuggestionMedia', () => {
    it('asks for the ids as one comma separated parameter', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ items: [] }))

      expect(await getGalleryAlbumSuggestionMedia(['3', '1', '2'])).toEqual({
        items: []
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/gallery/albums/suggestions/media?media_ids=3%2C1%2C2',
        GET_INIT
      )
    })

    it('does not call the server for no ids', async () => {
      expect(await getGalleryAlbumSuggestionMedia([])).toEqual({ items: [] })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses more than 100 ids rather than sending a request that would fail', async () => {
      const ids = Array.from({ length: 101 }, (_, index) => String(index + 1))

      await expect(getGalleryAlbumSuggestionMedia(ids)).rejects.toThrow(
        'at most 100'
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('throws the error message of a failed read', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Unprocessable' }), {
        status: 422
      })

      await expect(getGalleryAlbumSuggestionMedia(['1'])).rejects.toThrow(
        'Unprocessable'
      )
    })
  })
})

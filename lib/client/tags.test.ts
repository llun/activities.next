import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  addFeaturedTag,
  getFeaturedTagSuggestions,
  getFeaturedTags,
  removeFeaturedTag
} from './tags'

enableFetchMocks()

describe('client tags module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getFeaturedTags', () => {
    it('returns featured tags on 200', async () => {
      const mockTags = [{ id: 'tag-1', name: 'running' }]
      fetchMock.mockResponse(JSON.stringify(mockTags), { status: 200 })

      const res = await getFeaturedTags()
      expect(res).toEqual(mockTags)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/featured_tags',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('throws error when response is not ok', async () => {
      fetchMock.mockResponse('', { status: 500 })

      await expect(getFeaturedTags()).rejects.toThrow(
        'Failed to load featured tags: 500'
      )
    })
  })

  describe('addFeaturedTag', () => {
    it('returns tag on success', async () => {
      const mockTag = { id: 'tag-1', name: 'running' }
      fetchMock.mockResponse(JSON.stringify(mockTag), { status: 200 })

      const res = await addFeaturedTag('running')
      expect(res).toEqual({ tag: mockTag })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/featured_tags',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'running' })
        })
      )
    })

    it('returns error message on non-ok response', async () => {
      fetchMock.mockResponse(
        JSON.stringify({ error: 'Hashtag already featured' }),
        { status: 422 }
      )

      const res = await addFeaturedTag('running')
      expect(res).toEqual({ error: 'Hashtag already featured' })
    })

    it('returns error message on network failure', async () => {
      fetchMock.mockReject(new Error('Network error'))

      const res = await addFeaturedTag('running')
      expect(res).toEqual({ error: 'Failed to feature hashtag' })
    })
  })

  describe('removeFeaturedTag', () => {
    it('returns true on success', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await removeFeaturedTag('tag-1')
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/featured_tags/tag-1',
        expect.objectContaining({
          method: 'DELETE',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns false on error status', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await removeFeaturedTag('tag-1')
      expect(res).toBe(false)
    })

    it('returns false on network failure', async () => {
      fetchMock.mockReject(new Error('Network error'))

      const res = await removeFeaturedTag('tag-1')
      expect(res).toBe(false)
    })
  })

  describe('getFeaturedTagSuggestions', () => {
    it('returns suggestions on success', async () => {
      const mockSuggestions = [{ name: 'running' }]
      fetchMock.mockResponse(JSON.stringify(mockSuggestions), { status: 200 })

      const res = await getFeaturedTagSuggestions()
      expect(res).toEqual(mockSuggestions)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/featured_tags/suggestions',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty array when response is not ok', async () => {
      fetchMock.mockResponse('', { status: 500 })

      const res = await getFeaturedTagSuggestions()
      expect(res).toEqual([])
    })
  })
})

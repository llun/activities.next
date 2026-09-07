import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  getTrendingLinks,
  getTrendingStatuses,
  getTrendingTags
} from './trends'

enableFetchMocks()

describe('client trends module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getTrendingTags', () => {
    it('requests trending tags with a limit and returns the payload', async () => {
      const tags = [
        { name: 'gravel', url: 'https://llun.test/tags/gravel', history: [] }
      ]
      fetchMock.mockResponseOnce(JSON.stringify(tags), { status: 200 })

      await expect(getTrendingTags(10)).resolves.toEqual(tags)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/trends/tags?limit=10',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('omits the limit query when none is provided', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

      await getTrendingTags()
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/trends/tags',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('throws when trending tags respond non-OK', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(getTrendingTags()).rejects.toThrow(
        'Failed to load trending tags: 500'
      )
    })

    it('coerces non-array responses to empty list', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'none' }), {
        status: 200
      })

      await expect(getTrendingTags()).resolves.toEqual([])
    })
  })

  describe('getTrendingStatuses', () => {
    it('throws when trending statuses respond non-OK', async () => {
      fetchMock.mockResponseOnce('', { status: 503 })

      await expect(getTrendingStatuses(20)).rejects.toThrow(
        'Failed to load trending statuses: 503'
      )
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/trends/statuses?format=activities_next&limit=20',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('returns the domain trending statuses payload', async () => {
      const statuses = [{ id: 'https://llun.test/users/a/statuses/1' }]
      fetchMock.mockResponseOnce(JSON.stringify(statuses), { status: 200 })

      await expect(getTrendingStatuses()).resolves.toEqual(statuses)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/trends/statuses?format=activities_next',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('coerces a non-array trending statuses response to an empty list', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({}), { status: 200 })

      await expect(getTrendingStatuses()).resolves.toEqual([])
    })
  })

  describe('getTrendingLinks', () => {
    it('returns trending links from the payload with limit', async () => {
      const links = [{ url: 'https://example.com/news', title: 'News' }]
      fetchMock.mockResponseOnce(JSON.stringify(links), { status: 200 })

      await expect(getTrendingLinks(5)).resolves.toEqual(links)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/trends/links?limit=5',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('returns trending links without limit', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

      await expect(getTrendingLinks()).resolves.toEqual([])
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/trends/links',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('throws when trending links respond non-OK', async () => {
      fetchMock.mockResponseOnce('', { status: 502 })

      await expect(getTrendingLinks()).rejects.toThrow(
        'Failed to load trending links: 502'
      )
    })
  })
})

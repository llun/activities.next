import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { search, searchAccounts } from './search'

enableFetchMocks()

describe('client search module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { origin: 'https://llun.test' }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  describe('search', () => {
    it('builds the v2 search URL with typed filters and forwards abort signals', async () => {
      const abortController = new AbortController()
      fetchMock.mockResponseOnce(
        JSON.stringify({
          accounts: [],
          statuses: [{ id: 'status-1' }],
          hashtags: []
        }),
        { status: 200 }
      )

      await expect(
        search({
          q: 'trail run',
          type: 'statuses',
          limit: 10,
          offset: 20,
          resolve: true,
          signal: abortController.signal
        })
      ).resolves.toEqual({
        accounts: [],
        statuses: [{ id: 'status-1' }],
        hashtags: []
      })

      const [url, init] = fetchMock.mock.calls[0]
      const parsedUrl = new URL(url as string, 'https://llun.test')
      expect(parsedUrl.pathname).toBe('/api/v2/search')
      expect(parsedUrl.searchParams.get('q')).toBe('trail run')
      expect(parsedUrl.searchParams.get('type')).toBe('statuses')
      expect(parsedUrl.searchParams.get('limit')).toBe('10')
      expect(parsedUrl.searchParams.get('offset')).toBe('20')
      expect(parsedUrl.searchParams.get('resolve')).toBe('true')
      expect(parsedUrl.searchParams.get('format')).toBe('activities_next')
      expect(init).toEqual(
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: abortController.signal
        })
      )
    })

    it('returns an empty result when the search response is not JSON', async () => {
      fetchMock.mockResponseOnce('<html>bad gateway</html>', { status: 200 })

      await expect(search({ q: 'trail' })).resolves.toEqual({
        accounts: [],
        statuses: [],
        hashtags: []
      })
    })

    it('throws a detailed error when the search request is rejected', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401
      })

      await expect(search({ q: 'trail' })).rejects.toThrow(
        'Search request failed (401): Unauthorized'
      )
    })

    it('throws raw response text when the search error response is not JSON', async () => {
      fetchMock.mockResponseOnce('Bad gateway', { status: 502 })

      await expect(search({ q: 'trail' })).rejects.toThrow(
        'Search request failed (502): Bad gateway'
      )
    })

    it('truncates long raw response text from failed search requests', async () => {
      const longResponseText = 'x'.repeat(250)
      fetchMock.mockResponseOnce(longResponseText, { status: 502 })

      await expect(search({ q: 'trail' })).rejects.toThrow(
        `Search request failed (502): ${'x'.repeat(200)}...`
      )
    })

    it('truncates long JSON messages from failed search requests', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ message: 'x'.repeat(250) }), {
        status: 502
      })

      await expect(search({ q: 'trail' })).rejects.toThrow(
        `Search request failed (502): ${'x'.repeat(200)}...`
      )
    })
  })

  describe('searchAccounts', () => {
    it('fetches accounts with default limit and resolve params', async () => {
      const mockAccounts = [{ id: 'acc-1', username: 'alice' }]
      fetchMock.mockResponseOnce(JSON.stringify(mockAccounts), { status: 200 })

      const result = await searchAccounts({ q: 'alice' })

      expect(result).toEqual(mockAccounts)
      const [url, init] = fetchMock.mock.calls[0]
      const parsedUrl = new URL(url as string)
      expect(parsedUrl.origin).toBe('https://llun.test')
      expect(parsedUrl.pathname).toBe('/api/v1/accounts/search')
      expect(parsedUrl.searchParams.get('q')).toBe('alice')
      expect(parsedUrl.searchParams.get('limit')).toBe('5')
      expect(parsedUrl.searchParams.get('resolve')).toBe('true')
      expect(init).toEqual(
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('passes custom limit and resolve params and forwards abort signal', async () => {
      const abortController = new AbortController()
      fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

      const result = await searchAccounts({
        q: 'bob',
        limit: 10,
        resolve: false,
        signal: abortController.signal
      })

      expect(result).toEqual([])
      const [url, init] = fetchMock.mock.calls[0]
      const parsedUrl = new URL(url as string)
      expect(parsedUrl.searchParams.get('limit')).toBe('10')
      expect(parsedUrl.searchParams.get('resolve')).toBe('false')
      expect(init).toEqual(
        expect.objectContaining({
          signal: abortController.signal
        })
      )
    })

    it('returns empty array when the response is not ok', async () => {
      fetchMock.mockResponseOnce('Server error', { status: 500 })

      const result = await searchAccounts({ q: 'carol' })

      expect(result).toEqual([])
    })
  })
})

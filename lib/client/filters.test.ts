import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  type ClientFilter,
  type FilterInput,
  createFilter,
  createFilterRequest,
  createServerFilter,
  deleteFilter,
  deleteFilterRequest,
  deleteServerFilter,
  filterRequestBody,
  getFilters,
  getServerFilters,
  requestFilters,
  updateFilter,
  updateFilterRequest,
  updateServerFilter
} from './filters'

enableFetchMocks()

describe('client filters module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  const sampleInput: FilterInput = {
    title: 'Muted words',
    context: ['home', 'public'],
    filterAction: 'warn',
    expiresIn: 3600,
    keywords: [
      { keyword: 'crypto', wholeWord: true },
      { id: 'kw-1', keyword: 'spam', wholeWord: false, _destroy: true }
    ]
  }

  const mockFilter: ClientFilter = {
    id: 'filter-123',
    title: 'Muted words',
    context: ['home', 'public'],
    filter_action: 'warn',
    expires_at: '2026-09-08T12:00:00Z',
    keywords: [{ id: 'kw-1', keyword: 'crypto', whole_word: true }],
    statuses: []
  }

  describe('filterRequestBody', () => {
    it('correctly maps input fields to API payload format', () => {
      const body = filterRequestBody(sampleInput)
      expect(body).toEqual({
        title: 'Muted words',
        context: ['home', 'public'],
        filter_action: 'warn',
        expires_in: 3600,
        keywords_attributes: [
          { keyword: 'crypto', whole_word: true },
          { id: 'kw-1', keyword: 'spam', whole_word: false, _destroy: true }
        ]
      })
    })

    it('handles keywords without id or _destroy', () => {
      const body = filterRequestBody({
        title: 'Test',
        context: ['notifications'],
        filterAction: 'hide',
        expiresIn: null,
        keywords: [{ keyword: 'test', wholeWord: false }]
      })
      expect(body.keywords_attributes).toEqual([
        { keyword: 'test', whole_word: false }
      ])
    })
  })

  describe('requestFilters', () => {
    it('returns filters on successful response', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockFilter]), { status: 200 })

      const result = await requestFilters('/api/v2/filters')
      expect(result).toEqual([mockFilter])
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/filters', {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    })

    it('throws when response is not ok', async () => {
      fetchMock.mockResponseOnce('Internal Error', { status: 500 })

      await expect(requestFilters('/api/v2/filters')).rejects.toThrow(
        'Failed to load filters (500)'
      )
    })
  })

  describe('createFilterRequest', () => {
    it('creates filter and returns ClientFilter on 200', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockFilter), { status: 200 })

      const result = await createFilterRequest('/api/v2/filters', sampleInput)
      expect(result).toEqual(mockFilter)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/filters',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(filterRequestBody(sampleInput))
        })
      )
    })

    it('returns null on failure', async () => {
      fetchMock.mockResponseOnce('Unauthorized', { status: 401 })

      const result = await createFilterRequest('/api/v2/filters', sampleInput)
      expect(result).toBeNull()
    })
  })

  describe('updateFilterRequest', () => {
    it('updates filter and returns ClientFilter on 200', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockFilter), { status: 200 })

      const result = await updateFilterRequest(
        '/api/v2/filters/123',
        sampleInput
      )
      expect(result).toEqual(mockFilter)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/filters/123',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(filterRequestBody(sampleInput))
        })
      )
    })

    it('returns null on failure', async () => {
      fetchMock.mockResponseOnce('Bad Request', { status: 400 })

      const result = await updateFilterRequest(
        '/api/v2/filters/123',
        sampleInput
      )
      expect(result).toBeNull()
    })
  })

  describe('deleteFilterRequest', () => {
    it('returns true on 200', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const result = await deleteFilterRequest('/api/v2/filters/123')
      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith('/api/v2/filters/123', {
        method: 'DELETE'
      })
    })

    it('returns false on error', async () => {
      fetchMock.mockResponseOnce('Not Found', { status: 404 })

      const result = await deleteFilterRequest('/api/v2/filters/123')
      expect(result).toBe(false)
    })
  })

  describe('convenience methods', () => {
    it('getFilters calls /api/v2/filters', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockFilter]))
      const result = await getFilters()
      expect(result).toEqual([mockFilter])
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/filters',
        expect.anything()
      )
    })

    it('createFilter calls /api/v2/filters with POST', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockFilter))
      const result = await createFilter(sampleInput)
      expect(result).toEqual(mockFilter)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/filters',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('updateFilter calls /api/v2/filters/:id with PUT', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockFilter))
      const result = await updateFilter('id with space', sampleInput)
      expect(result).toEqual(mockFilter)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/filters/id%20with%20space',
        expect.objectContaining({ method: 'PUT' })
      )
    })

    it('deleteFilter calls /api/v2/filters/:id with DELETE', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })
      const result = await deleteFilter('id with space')
      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/filters/id%20with%20space',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('getServerFilters calls /api/v2/admin/filters', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockFilter]))
      const result = await getServerFilters()
      expect(result).toEqual([mockFilter])
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/filters',
        expect.anything()
      )
    })

    it('createServerFilter calls /api/v2/admin/filters with POST', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockFilter))
      const result = await createServerFilter(sampleInput)
      expect(result).toEqual(mockFilter)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/filters',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('updateServerFilter calls /api/v2/admin/filters/:id with PUT', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockFilter))
      const result = await updateServerFilter('id with space', sampleInput)
      expect(result).toEqual(mockFilter)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/filters/id%20with%20space',
        expect.objectContaining({ method: 'PUT' })
      )
    })

    it('deleteServerFilter calls /api/v2/admin/filters/:id with DELETE', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })
      const result = await deleteServerFilter('id with space')
      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v2/admin/filters/id%20with%20space',
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

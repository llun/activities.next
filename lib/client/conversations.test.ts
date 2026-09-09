import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  getConversationStatuses,
  getConversations,
  hideConversation,
  markConversationRead
} from './conversations'

enableFetchMocks()

describe('client conversations module', () => {
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

  describe('getConversations', () => {
    it('fetches conversations with format activities_next and default params', async () => {
      const mockConversations = [
        {
          id: 'conv-1',
          unread: false,
          accounts: [{ id: 'acc-1', username: 'alice' }]
        }
      ]
      fetchMock.mockResponseOnce(
        JSON.stringify({ conversations: mockConversations }),
        { status: 200 }
      )

      const result = await getConversations()

      expect(result).toEqual({ conversations: mockConversations })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://llun.test/api/v1/conversations?format=activities_next',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('passes limit, maxId, and minId query params', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ conversations: [] }), {
        status: 200
      })

      const result = await getConversations({
        limit: 25,
        maxId: 'max-123',
        minId: 'min-456'
      })

      expect(result).toEqual({ conversations: [] })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://llun.test/api/v1/conversations?format=activities_next&limit=25&max_id=max-123&min_id=min-456',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty conversations when response is not ok', async () => {
      fetchMock.mockResponseOnce('Server error', { status: 500 })

      const result = await getConversations()

      expect(result).toEqual({ conversations: [] })
    })

    it('returns empty array when response json does not contain conversations property', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({}), { status: 200 })

      const result = await getConversations()

      expect(result).toEqual({ conversations: [] })
    })
  })

  describe('getConversationStatuses', () => {
    it('fetches conversation statuses with format activities_next', async () => {
      const mockStatuses = [
        { id: 'status-1', content: 'hello' },
        { id: 'status-2', content: 'world' }
      ]
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: mockStatuses,
          nextMaxStatusId: 'status-2'
        }),
        { status: 200 }
      )

      const result = await getConversationStatuses({
        conversationId: 'conv-123'
      })

      expect(result).toEqual({
        statuses: mockStatuses,
        nextMaxStatusId: 'status-2'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://llun.test/api/v1/conversations/conv-123/statuses?format=activities_next',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('passes pagination and limit query params', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [],
          nextMaxStatusId: null
        }),
        { status: 200 }
      )

      const result = await getConversationStatuses({
        conversationId: 'conv-123',
        maxStatusId: 'max-1',
        minStatusId: 'min-1',
        limit: 10
      })

      expect(result).toEqual({
        statuses: [],
        nextMaxStatusId: null
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://llun.test/api/v1/conversations/conv-123/statuses?format=activities_next&max_id=max-1&min_id=min-1&limit=10',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty statuses and null nextMaxStatusId on error response', async () => {
      fetchMock.mockResponseOnce('Not found', { status: 404 })

      const result = await getConversationStatuses({
        conversationId: 'conv-404'
      })

      expect(result).toEqual({
        statuses: [],
        nextMaxStatusId: null
      })
    })

    it('handles missing fields in response payload gracefully', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({}), { status: 200 })

      const result = await getConversationStatuses({
        conversationId: 'conv-123'
      })

      expect(result).toEqual({
        statuses: [],
        nextMaxStatusId: null
      })
    })
  })

  describe('markConversationRead', () => {
    it('sends POST request and returns true on success', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200
      })

      const ok = await markConversationRead({ conversationId: 'conv-1' })

      expect(ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/conversations/conv-1/read',
        expect.objectContaining({
          method: 'POST',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce('Internal server error', { status: 500 })

      const ok = await markConversationRead({ conversationId: 'conv-1' })

      expect(ok).toBe(false)
    })
  })

  describe('hideConversation', () => {
    it('sends DELETE request and returns true on success', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200
      })

      const ok = await hideConversation({ conversationId: 'conv-2' })

      expect(ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/conversations/conv-2',
        expect.objectContaining({
          method: 'DELETE',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce('Forbidden', { status: 403 })

      const ok = await hideConversation({ conversationId: 'conv-2' })

      expect(ok).toBe(false)
    })
  })
})

import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  acceptFollowRequest,
  createActor,
  createReport,
  follow,
  getActorDomains,
  getFollowStatus,
  isFollowing,
  rejectFollowRequest,
  switchActor,
  unfollow
} from './accounts'

enableFetchMocks()

describe('client accounts module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('createReport', () => {
    it('creates report and returns true on 200', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await createReport({
        targetActorId: 'actor-123',
        statusId: 'status-456',
        category: 'spam',
        comment: 'Spam post'
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/reports',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: 'actor-123',
            status_ids: ['status-456'],
            category: 'spam',
            comment: 'Spam post'
          })
        })
      )
    })

    it('returns false on non-200 status', async () => {
      fetchMock.mockResponse('', { status: 400 })

      const res = await createReport({ targetActorId: 'actor-123' })
      expect(res).toBe(false)
    })
  })

  describe('getFollowStatus', () => {
    it('returns following when following is true', async () => {
      fetchMock.mockResponse(
        JSON.stringify([
          { id: 'actor-123', following: true, requested: false }
        ]),
        { status: 200 }
      )

      const res = await getFollowStatus({ targetActorId: 'actor-123' })
      expect(res).toBe('following')
    })

    it('returns requested when requested is true', async () => {
      fetchMock.mockResponse(
        JSON.stringify([
          { id: 'actor-123', following: false, requested: true }
        ]),
        { status: 200 }
      )

      const res = await getFollowStatus({ targetActorId: 'actor-123' })
      expect(res).toBe('requested')
    })

    it('returns not_following when relationship not present or neither flag is set', async () => {
      fetchMock.mockResponse(
        JSON.stringify([
          { id: 'actor-123', following: false, requested: false }
        ]),
        { status: 200 }
      )

      const res = await getFollowStatus({ targetActorId: 'actor-123' })
      expect(res).toBe('not_following')

      fetchMock.mockResponse(JSON.stringify([]), { status: 200 })
      const resEmpty = await getFollowStatus({ targetActorId: 'actor-123' })
      expect(resEmpty).toBe('not_following')
    })

    it('returns not_following on non-200 status', async () => {
      fetchMock.mockResponse('', { status: 500 })

      const res = await getFollowStatus({ targetActorId: 'actor-123' })
      expect(res).toBe('not_following')
    })
  })

  describe('isFollowing', () => {
    it('returns true when getFollowStatus is following', async () => {
      fetchMock.mockResponse(
        JSON.stringify([{ id: 'actor-123', following: true }]),
        { status: 200 }
      )

      const res = await isFollowing({ targetActorId: 'actor-123' })
      expect(res).toBe(true)
    })

    it('returns false when getFollowStatus is not following', async () => {
      fetchMock.mockResponse(
        JSON.stringify([
          { id: 'actor-123', following: false, requested: true }
        ]),
        { status: 200 }
      )

      const res = await isFollowing({ targetActorId: 'actor-123' })
      expect(res).toBe(false)
    })
  })

  describe('follow', () => {
    it('calls follow endpoint and returns true on 200', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await follow({ targetActorId: 'actor-123' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/actor-123/follow',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('returns false on error status', async () => {
      fetchMock.mockResponse('', { status: 400 })

      const res = await follow({ targetActorId: 'actor-123' })
      expect(res).toBe(false)
    })
  })

  describe('unfollow', () => {
    it('calls unfollow endpoint and returns true on 200', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await unfollow({ targetActorId: 'actor-123' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/actor-123/unfollow',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('returns false on error status', async () => {
      fetchMock.mockResponse('', { status: 400 })

      const res = await unfollow({ targetActorId: 'actor-123' })
      expect(res).toBe(false)
    })
  })

  describe('acceptFollowRequest', () => {
    it('calls authorize endpoint and returns true on success', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await acceptFollowRequest({ id: 'req-123' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/follow_requests/req-123/authorize',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await acceptFollowRequest({ id: 'req-123' })
      expect(res).toBe(false)
    })
  })

  describe('rejectFollowRequest', () => {
    it('calls reject endpoint and returns true on success', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await rejectFollowRequest({ id: 'req-123' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/follow_requests/req-123/reject',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await rejectFollowRequest({ id: 'req-123' })
      expect(res).toBe(false)
    })
  })

  describe('switchActor', () => {
    it('calls switch endpoint with actorId and returns true on success', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await switchActor({ actorId: 'actor-456' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/switch',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: 'actor-456' })
        })
      )
    })

    it('returns false when switch fails', async () => {
      fetchMock.mockResponse('', { status: 400 })

      const res = await switchActor({ actorId: 'actor-456' })
      expect(res).toBe(false)
    })
  })

  describe('getActorDomains', () => {
    it('fetches actor domains successfully', async () => {
      fetchMock.mockResponse(
        JSON.stringify({
          domains: ['example.com', 'test.org'],
          host: 'example.com'
        }),
        { status: 200 }
      )

      const res = await getActorDomains()
      expect(res).toEqual({
        domains: ['example.com', 'test.org'],
        host: 'example.com'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/domains',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('handles missing domains or host gracefully in response', async () => {
      fetchMock.mockResponse(JSON.stringify({}), { status: 200 })

      const res = await getActorDomains()
      expect(res).toEqual({
        domains: [],
        host: ''
      })
    })

    it('throws error when fetch fails', async () => {
      fetchMock.mockResponse(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401
      })

      await expect(getActorDomains()).rejects.toThrow('Unauthorized')

      fetchMock.mockResponse(JSON.stringify({}), {
        status: 500
      })

      await expect(getActorDomains()).rejects.toThrow(
        'Failed to fetch actor domains'
      )
    })
  })

  describe('createActor', () => {
    it('creates actor and returns result on success', async () => {
      const mockResult = {
        id: 'actor-new',
        username: 'alice',
        domain: 'example.com'
      }
      fetchMock.mockResponse(JSON.stringify(mockResult), { status: 200 })

      const res = await createActor({
        username: 'alice',
        domain: 'example.com'
      })
      expect(res).toEqual(mockResult)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'alice',
            domain: 'example.com'
          })
        })
      )
    })

    it('throws error when actor creation fails', async () => {
      fetchMock.mockResponse(
        JSON.stringify({ error: 'Username already exists' }),
        { status: 422 }
      )

      await expect(
        createActor({ username: 'alice', domain: 'example.com' })
      ).rejects.toThrow('Username already exists')

      fetchMock.mockResponse(JSON.stringify({}), {
        status: 500
      })

      await expect(
        createActor({ username: 'alice', domain: 'example.com' })
      ).rejects.toThrow('Failed to create actor')
    })
  })
})

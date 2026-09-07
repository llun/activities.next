import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  acceptFollowRequest,
  block,
  cancelActorDeletion,
  createActor,
  createReport,
  deleteAccountMedia,
  deleteActor,
  follow,
  getActorDomains,
  getActorStatuses,
  getBlocks,
  getFollowStatus,
  getRelationship,
  isFollowing,
  mute,
  rejectFollowRequest,
  setDefaultActor,
  switchActor,
  unblock,
  unfollow,
  unmute
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

  describe('cancelActorDeletion', () => {
    it('cancels deletion and returns result on success', async () => {
      const mockResult = { actorId: 'actor-1', status: 'cancelled' }
      fetchMock.mockResponse(JSON.stringify(mockResult), { status: 200 })

      const res = await cancelActorDeletion({ actorId: 'actor-1' })
      expect(res).toEqual(mockResult)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/cancel-deletion',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: 'actor-1' })
        })
      )
    })

    it('throws error when cancel deletion fails', async () => {
      fetchMock.mockResponse(JSON.stringify({ error: 'Not scheduled' }), {
        status: 400
      })

      await expect(cancelActorDeletion({ actorId: 'actor-1' })).rejects.toThrow(
        'Not scheduled'
      )

      fetchMock.mockResponse(JSON.stringify({}), { status: 500 })
      await expect(cancelActorDeletion({ actorId: 'actor-1' })).rejects.toThrow(
        'Failed to cancel actor deletion'
      )
    })
  })

  describe('setDefaultActor', () => {
    it('sets default actor and returns result on success', async () => {
      const mockResult = {
        defaultActorId: 'actor-1',
        id: 'actor-1',
        username: 'alice',
        domain: 'example.com'
      }
      fetchMock.mockResponse(JSON.stringify(mockResult), { status: 200 })

      const res = await setDefaultActor({ actorId: 'actor-1' })
      expect(res).toEqual(mockResult)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/default',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: 'actor-1' })
        })
      )
    })

    it('throws error when updating default actor fails', async () => {
      fetchMock.mockResponse(JSON.stringify({ error: 'Actor not found' }), {
        status: 404
      })

      await expect(setDefaultActor({ actorId: 'actor-1' })).rejects.toThrow(
        'Actor not found'
      )

      fetchMock.mockResponse(JSON.stringify({}), { status: 500 })
      await expect(setDefaultActor({ actorId: 'actor-1' })).rejects.toThrow(
        'Failed to update default actor'
      )
    })
  })

  describe('deleteActor', () => {
    it('schedules deletion and returns result on success', async () => {
      const mockResult = {
        actorId: 'actor-1',
        status: 'scheduled',
        scheduledAt: '2026-09-14T00:00:00Z',
        immediate: false
      }
      fetchMock.mockResponse(JSON.stringify(mockResult), { status: 200 })

      const res = await deleteActor({ actorId: 'actor-1', delayDays: 7 })
      expect(res).toEqual(mockResult)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/delete',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: 'actor-1', delayDays: 7 })
        })
      )
    })

    it('defaults delayDays to 0 when omitted', async () => {
      const mockResult = {
        actorId: 'actor-1',
        status: 'deleted',
        scheduledAt: null,
        immediate: true
      }
      fetchMock.mockResponse(JSON.stringify(mockResult), { status: 200 })

      const res = await deleteActor({ actorId: 'actor-1' })
      expect(res).toEqual(mockResult)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/delete',
        expect.objectContaining({
          body: JSON.stringify({ actorId: 'actor-1', delayDays: 0 })
        })
      )
    })

    it('throws error when deletion fails', async () => {
      fetchMock.mockResponse(
        JSON.stringify({ error: 'Cannot delete default actor' }),
        {
          status: 422
        }
      )

      await expect(deleteActor({ actorId: 'actor-1' })).rejects.toThrow(
        'Cannot delete default actor'
      )

      fetchMock.mockResponse(JSON.stringify({}), { status: 500 })
      await expect(deleteActor({ actorId: 'actor-1' })).rejects.toThrow(
        'Failed to delete actor'
      )
    })
  })

  describe('deleteAccountMedia', () => {
    it('deletes media and returns true on success', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await deleteAccountMedia({ mediaId: 'media-123' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/media/media-123',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('throws error when delete media fails', async () => {
      fetchMock.mockResponse(JSON.stringify({ error: 'Media not found' }), {
        status: 404
      })

      await expect(
        deleteAccountMedia({ mediaId: 'media-123' })
      ).rejects.toThrow('Media not found')

      fetchMock.mockResponse(JSON.stringify({}), { status: 500 })
      await expect(
        deleteAccountMedia({ mediaId: 'media-123' })
      ).rejects.toThrow('Failed to delete media')
    })
  })

  describe('getRelationship', () => {
    it('fetches and returns relationship object on 200', async () => {
      const mockRelationship = {
        id: 'actor-target',
        following: true,
        followedBy: false,
        blocking: false,
        muting: false
      }
      fetchMock.mockResponse(JSON.stringify([mockRelationship]), {
        status: 200
      })

      const res = await getRelationship({ targetActorId: 'actor-target' })
      expect(res).toEqual(mockRelationship)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/relationships?id[]=actor-target',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns null when response is not 200', async () => {
      fetchMock.mockResponse('', { status: 500 })

      const res = await getRelationship({ targetActorId: 'actor-target' })
      expect(res).toBeNull()
    })

    it('returns null when relationships array is empty', async () => {
      fetchMock.mockResponse(JSON.stringify([]), { status: 200 })

      const res = await getRelationship({ targetActorId: 'actor-target' })
      expect(res).toBeNull()
    })
  })

  describe('block', () => {
    it('blocks an account and returns the relationship on 200', async () => {
      const mockRel = { id: 'actor-1', blocking: true }
      fetchMock.mockResponse(JSON.stringify(mockRel), { status: 200 })

      const res = await block({ targetActorId: 'actor-1' })
      expect(res).toEqual(mockRel)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/actor-1/block',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('returns null on non-200', async () => {
      fetchMock.mockResponse('', { status: 400 })
      const res = await block({ targetActorId: 'actor-1' })
      expect(res).toBeNull()
    })
  })

  describe('unblock', () => {
    it('unblocks an account and returns the relationship on 200', async () => {
      const mockRel = { id: 'actor-1', blocking: false }
      fetchMock.mockResponse(JSON.stringify(mockRel), { status: 200 })

      const res = await unblock({ targetActorId: 'actor-1' })
      expect(res).toEqual(mockRel)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/actor-1/unblock',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('returns null on non-200', async () => {
      fetchMock.mockResponse('', { status: 500 })
      const res = await unblock({ targetActorId: 'actor-1' })
      expect(res).toBeNull()
    })
  })

  describe('getBlocks', () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { origin: 'https://local.example' }
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'window')
    })

    it('fetches blocks with pagination query params and parses Link header', async () => {
      const mockAccounts = [{ id: 'acc-1' }]
      fetchMock.mockResponse(JSON.stringify(mockAccounts), {
        status: 200,
        headers: {
          Link: '<https://local.example/api/v1/blocks?max_id=next-max>; rel="next", <https://local.example/api/v1/blocks?min_id=prev-min>; rel="prev"'
        }
      })

      const res = await getBlocks({ limit: 10, maxId: 'm1', minId: 'm2' })
      expect(res).toEqual({
        accounts: mockAccounts,
        nextMaxId: 'next-max',
        prevMinId: 'prev-min'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://local.example/api/v1/blocks?limit=10&max_id=m1&min_id=m2',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty result on non-200', async () => {
      fetchMock.mockResponse('', { status: 500 })
      const res = await getBlocks()
      expect(res).toEqual({
        accounts: [],
        nextMaxId: null,
        prevMinId: null
      })
    })
  })

  describe('mute', () => {
    it('mutes account with notifications flag and returns relationship', async () => {
      const mockRel = { id: 'actor-1', muting: true }
      fetchMock.mockResponse(JSON.stringify(mockRel), { status: 200 })

      const res = await mute({ targetActorId: 'actor-1', notifications: true })
      expect(res).toEqual(mockRel)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/actor-1/mute',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notifications: true })
        })
      )
    })

    it('mutes account without notifications flag when omitted', async () => {
      const mockRel = { id: 'actor-1', muting: true }
      fetchMock.mockResponse(JSON.stringify(mockRel), { status: 200 })

      const res = await mute({ targetActorId: 'actor-1' })
      expect(res).toEqual(mockRel)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/actor-1/mute',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        })
      )
    })

    it('returns null on non-200', async () => {
      fetchMock.mockResponse('', { status: 400 })
      const res = await mute({ targetActorId: 'actor-1' })
      expect(res).toBeNull()
    })
  })

  describe('unmute', () => {
    it('unmutes account and returns relationship on 200', async () => {
      const mockRel = { id: 'actor-1', muting: false }
      fetchMock.mockResponse(JSON.stringify(mockRel), { status: 200 })

      const res = await unmute({ targetActorId: 'actor-1' })
      expect(res).toEqual(mockRel)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/actor-1/unmute',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('returns null on non-200', async () => {
      fetchMock.mockResponse('', { status: 404 })
      const res = await unmute({ targetActorId: 'actor-1' })
      expect(res).toBeNull()
    })
  })

  describe('getActorStatuses', () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { origin: 'https://local.example' }
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'window')
    })

    it('fetches actor statuses with pageUrl if provided', async () => {
      const mockResult = {
        statuses: [],
        statusesCount: 0,
        nextPageUrl: null,
        prevPageUrl: null
      }
      fetchMock.mockResponse(JSON.stringify(mockResult), { status: 200 })

      const res = await getActorStatuses({
        actorId: 'actor-123',
        pageUrl: 'https://local.example/next'
      })
      expect(res).toEqual(mockResult)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://local.example/api/v1/accounts/actor-123/remote-statuses?page_url=https%3A%2F%2Flocal.example%2Fnext',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('throws when status is not 200', async () => {
      fetchMock.mockResponse('', { status: 500 })

      await expect(getActorStatuses({ actorId: 'actor-123' })).rejects.toThrow(
        'Failed to load actor statuses: 500'
      )
    })
  })
})

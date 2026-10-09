import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { generatePublicId } from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

import {
  acceptFollowRequest,
  block,
  cancelActorDeletion,
  createActor,
  createReport,
  deleteAccountMedia,
  deleteActor,
  deleteSession,
  follow,
  getActorDomains,
  getActorStatuses,
  getBlocks,
  getFollowStatus,
  getMutes,
  getRelationship,
  isFollowing,
  mute,
  rejectFollowRequest,
  revokeConnectedApp,
  revokeOtherSessions,
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

  describe.each([
    {
      name: 'follow',
      call: () => follow({ targetActorId: 'actor-123' }),
      path: '/api/v1/accounts/actor-123/follow',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      failStatus: 400
    },
    {
      name: 'unfollow',
      call: () => unfollow({ targetActorId: 'actor-123' }),
      path: '/api/v1/accounts/actor-123/unfollow',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      failStatus: 400
    },
    {
      name: 'acceptFollowRequest',
      call: () => acceptFollowRequest({ id: 'req-123' }),
      path: '/api/v1/follow_requests/req-123/authorize',
      init: { method: 'POST' },
      failStatus: 404
    },
    {
      name: 'rejectFollowRequest',
      call: () => rejectFollowRequest({ id: 'req-123' }),
      path: '/api/v1/follow_requests/req-123/reject',
      init: { method: 'POST' },
      failStatus: 404
    }
  ])('$name', ({ call, path, init, failStatus }) => {
    it('calls the endpoint and returns true on 200', async () => {
      fetchMock.mockResponse('', { status: 200 })

      await expect(call()).resolves.toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        path,
        expect.objectContaining(init)
      )
    })

    it('returns false on error status', async () => {
      fetchMock.mockResponse('', { status: failStatus })

      await expect(call()).resolves.toBe(false)
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

    it('forwards the abort signal', async () => {
      const controller = new AbortController()
      fetchMock.mockResponse(JSON.stringify({ domains: [], host: '' }), {
        status: 200
      })

      await getActorDomains({ signal: controller.signal })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/domains',
        expect.objectContaining({ signal: controller.signal })
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

    it('omits domain from request body when domain is undefined', async () => {
      fetchMock.mockResponse(JSON.stringify({ id: 'actor-new' }), {
        status: 200
      })

      await createActor({ username: 'newuser' })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors',
        expect.objectContaining({
          body: JSON.stringify({ username: 'newuser' })
        })
      )
    })

    it('preserves explicit empty string domain in request body for server validation', async () => {
      fetchMock.mockResponse(JSON.stringify({ id: 'actor-new' }), {
        status: 200
      })

      await createActor({ username: 'newuser', domain: '' })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors',
        expect.objectContaining({
          body: JSON.stringify({ username: 'newuser', domain: '' })
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

    it('encodes mediaId in path', async () => {
      fetchMock.mockResponse('', { status: 200 })

      await deleteAccountMedia({ mediaId: 'path/with/slash' })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/media/path%2Fwith%2Fslash',
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

  describe.each([
    { name: 'getActorDomains', call: () => getActorDomains() },
    {
      name: 'createActor',
      call: () => createActor({ username: 'bob', domain: 'example.com' })
    },
    {
      name: 'cancelActorDeletion',
      call: () => cancelActorDeletion({ actorId: 'actor-1' })
    },
    { name: 'switchActor', call: () => switchActor({ actorId: 'actor-1' }) },
    {
      name: 'setDefaultActor',
      call: () => setDefaultActor({ actorId: 'actor-1' })
    },
    { name: 'deleteActor', call: () => deleteActor({ actorId: 'actor-1' }) },
    {
      name: 'deleteAccountMedia',
      call: () => deleteAccountMedia({ mediaId: 'media-1' })
    }
  ])('$name', ({ call }) => {
    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network error'))

      await expect(call()).rejects.toThrow('Network error')
    })
  })

  // Every id-accepting route resolves all three client-facing forms: a UUIDv7
  // publicId, the legacy colon/`apurl_` encoding, and a raw AP URI. The client
  // must hand back whatever id it was given. Re-encoding is not merely
  // redundant: `urlToId` parses a bare uuid as a URL host and returns it with a
  // trailing colon, an id no resolver can decode. That silently broke the
  // "Follow back" button once Account ids flipped to publicIds.
  describe('actor id forms', () => {
    const PUBLIC_ID = generatePublicId()
    const RAW_ACTOR_URI = 'https://remote.example/users/actor'
    const RAW_STATUS_URI = 'https://remote.example/users/actor/statuses/post-1'

    const ACTOR_ID_FORMS = [
      { description: 'public id', actorId: PUBLIC_ID, expected: PUBLIC_ID },
      {
        description: 'colon form',
        actorId: 'remote.example:users:actor',
        expected: 'remote.example:users:actor'
      },
      {
        description: 'raw AP URI',
        actorId: RAW_ACTOR_URI,
        expected: urlToId(RAW_ACTOR_URI)
      }
    ]

    it.each(ACTOR_ID_FORMS)(
      'follows and unfollows an account given a $description',
      async ({ actorId, expected }) => {
        fetchMock.mockResponse('[]', { status: 200 })

        await follow({ targetActorId: actorId })
        await unfollow({ targetActorId: actorId })

        expect(fetchMock).toHaveBeenNthCalledWith(
          1,
          `/api/v1/accounts/${expected}/follow`,
          expect.objectContaining({ method: 'POST' })
        )
        expect(fetchMock).toHaveBeenNthCalledWith(
          2,
          `/api/v1/accounts/${expected}/unfollow`,
          expect.objectContaining({ method: 'POST' })
        )
      }
    )

    it.each(ACTOR_ID_FORMS)(
      'reads the relationship of an account given a $description',
      async ({ actorId }) => {
        fetchMock.mockResponse('[]', { status: 200 })

        await getFollowStatus({ targetActorId: actorId })

        // The relationships route reads `id[]` and resolves each entry itself,
        // so the id is only percent-escaped for the query string, never
        // re-encoded.
        const requestUrl = new URL(
          fetchMock.mock.calls[0][0] as string,
          'https://local.example'
        )
        expect(requestUrl.pathname).toBe('/api/v1/accounts/relationships')
        expect(requestUrl.searchParams.get('id[]')).toBe(actorId)
      }
    )

    it('resolves a public id follow to true without mangling the id', async () => {
      fetchMock.mockResponseOnce('{}', { status: 200 })

      await expect(follow({ targetActorId: PUBLIC_ID })).resolves.toBe(true)
      expect(fetchMock.mock.calls[0][0]).not.toContain(`${PUBLIC_ID}:`)
    })

    it('sends report ids in the body without re-encoding them', async () => {
      fetchMock.mockResponse('{}', { status: 200 })

      await createReport({
        targetActorId: PUBLIC_ID,
        statusId: RAW_STATUS_URI,
        category: 'spam'
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/reports',
        expect.objectContaining({
          body: JSON.stringify({
            account_id: PUBLIC_ID,
            status_ids: [RAW_STATUS_URI],
            category: 'spam'
          })
        })
      )
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

  describe.each([
    {
      name: 'block',
      call: () => block({ targetActorId: 'actor-1' }),
      path: '/api/v1/accounts/actor-1/block',
      relationship: { id: 'actor-1', blocking: true },
      failStatus: 400
    },
    {
      name: 'unblock',
      call: () => unblock({ targetActorId: 'actor-1' }),
      path: '/api/v1/accounts/actor-1/unblock',
      relationship: { id: 'actor-1', blocking: false },
      failStatus: 500
    },
    {
      name: 'mute',
      call: () => mute({ targetActorId: 'actor-1' }),
      path: '/api/v1/accounts/actor-1/mute',
      relationship: { id: 'actor-1', muting: true },
      failStatus: 400
    },
    {
      name: 'unmute',
      call: () => unmute({ targetActorId: 'actor-1' }),
      path: '/api/v1/accounts/actor-1/unmute',
      relationship: { id: 'actor-1', muting: false },
      failStatus: 404
    }
  ])('$name', ({ call, path, relationship, failStatus }) => {
    it('posts to the endpoint and returns the relationship on 200', async () => {
      fetchMock.mockResponse(JSON.stringify(relationship), { status: 200 })

      await expect(call()).resolves.toEqual(relationship)
      expect(fetchMock).toHaveBeenCalledWith(
        path,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('returns null on non-200', async () => {
      fetchMock.mockResponse('', { status: failStatus })

      await expect(call()).resolves.toBeNull()
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

  describe('mute request body', () => {
    it('mutes account with notifications flag', async () => {
      fetchMock.mockResponse(JSON.stringify({ id: 'actor-1', muting: true }), {
        status: 200
      })

      await mute({ targetActorId: 'actor-1', notifications: true })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/actor-1/mute',
        expect.objectContaining({
          body: JSON.stringify({ notifications: true })
        })
      )
    })

    it('mutes account without notifications flag when omitted', async () => {
      fetchMock.mockResponse(JSON.stringify({ id: 'actor-1', muting: true }), {
        status: 200
      })

      await mute({ targetActorId: 'actor-1' })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/actor-1/mute',
        expect.objectContaining({ body: JSON.stringify({}) })
      )
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

  describe('deleteSession', () => {
    it('deletes session and returns true on 200', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await deleteSession({ id: 'sess-id-123' })
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/sessions/sess-id-123',
        expect.objectContaining({
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('returns false when status is not 200', async () => {
      fetchMock.mockResponse('', { status: 404 })

      const res = await deleteSession({ id: 'invalid' })
      expect(res).toBe(false)
    })
  })

  describe('revokeOtherSessions', () => {
    it('revokes other sessions and returns true on ok response', async () => {
      fetchMock.mockResponse('', { status: 200 })

      const res = await revokeOtherSessions()
      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/sessions',
        expect.objectContaining({
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('returns false on non-ok response', async () => {
      fetchMock.mockResponse('', { status: 500 })

      const res = await revokeOtherSessions()
      expect(res).toBe(false)
    })
  })

  describe('getMutes', () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { origin: 'https://llun.test' }
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'window')
    })

    it('fetches mutes and parses link headers', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify([{ id: 'actor-1', username: 'muted_user' }]),
        {
          status: 200,
          headers: {
            Link: '<https://llun.test/api/v1/mutes?max_id=next-cursor>; rel="next", <https://llun.test/api/v1/mutes?min_id=prev-cursor>; rel="prev"'
          }
        }
      )

      const res = await getMutes({ limit: 20, maxId: 'm1', minId: 'm2' })
      expect(res.accounts).toEqual([{ id: 'actor-1', username: 'muted_user' }])
      expect(res.nextMaxId).toBe('next-cursor')
      expect(res.prevMinId).toBe('prev-cursor')
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/mutes?limit=20&max_id=m1&min_id=m2'),
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('returns empty accounts array when status is not 200', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      const res = await getMutes()
      expect(res).toEqual({
        accounts: [],
        nextMaxId: null,
        prevMinId: null
      })
    })
  })

  describe('revokeConnectedApp', () => {
    it('revokes a connected app with actorId query', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const res = await revokeConnectedApp({
        clientId: 'app-client-123',
        actorId: 'https://llun.test/users/actor-1'
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/v1/accounts/connected-apps/app-client-123?actorId=https%3A%2F%2Fllun.test%2Fusers%2Factor-1'
        ),
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('revokes a connected app without actorId query', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      const res = await revokeConnectedApp({
        clientId: 'app-client-123',
        actorId: null
      })

      expect(res).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/connected-apps/app-client-123',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('returns false when status is not ok', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      const res = await revokeConnectedApp({
        clientId: 'app-client-123',
        actorId: null
      })

      expect(res).toBe(false)
    })
  })
})

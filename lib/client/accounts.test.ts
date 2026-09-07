import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  createReport,
  follow,
  getFollowStatus,
  isFollowing,
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
})

import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import { getAccountBootstrap } from './bootstrap'
import { TimelineRequestError } from './timelines'

enableFetchMocks()

describe('getAccountBootstrap', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('fetches account bootstrap snapshot with credentials: include and cache: no-store', async () => {
    const payload = {
      profile: { id: 'actor-1', username: 'alice' },
      preferences: { 'posting:default:visibility': 'public' }
    }
    fetchMock.mockResponseOnce(JSON.stringify(payload), { status: 200 })

    const res = await getAccountBootstrap()

    expect(res).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/accounts/bootstrap', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: undefined
    })
  })

  it('forwards signal to fetch', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true }), { status: 200 })

    const controller = new AbortController()
    await getAccountBootstrap({ signal: controller.signal })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/accounts/bootstrap',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('throws TimelineRequestError on 401 Unauthorized', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'Session required' }), {
      status: 401
    })

    await expect(getAccountBootstrap()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TimelineRequestError)
      const err = error as TimelineRequestError
      expect(err.message).toBe('Session required')
      expect(err.status).toBe(401)
      expect(err.isUnauthorized).toBe(true)
      return true
    })
  })

  it('throws TimelineRequestError on 500 Internal Server Error', async () => {
    fetchMock.mockResponseOnce('Server crashed', { status: 500 })

    await expect(getAccountBootstrap()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TimelineRequestError)
      const err = error as TimelineRequestError
      expect(err.status).toBe(500)
      expect(err.isUnauthorized).toBe(false)
      return true
    })
  })

  it('throws TimelineRequestError on network failures', async () => {
    fetchMock.mockRejectOnce(new Error('Network offline'))

    await expect(getAccountBootstrap()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TimelineRequestError)
      const err = error as TimelineRequestError
      expect(err.message).toBe('Network offline')
      expect(err.status).toBeUndefined()
      expect(err.isUnauthorized).toBe(false)
      return true
    })
  })
})

import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import { refreshAuthSession } from './session'

describe('refreshAuthSession', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('reads the session through the better-auth get-session endpoint and returns true on success', async () => {
    fetchMock.mockResponseOnce('null', { status: 200 })

    const result = await refreshAuthSession()

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/get-session', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    })
  })

  it('returns false when the response is not ok', async () => {
    fetchMock.mockResponseOnce('Unauthorized', { status: 401 })

    const result = await refreshAuthSession()

    expect(result).toBe(false)
  })

  it('returns false when the request fails', async () => {
    fetchMock.mockRejectOnce(new Error('offline'))

    await expect(refreshAuthSession()).resolves.toBe(false)
  })
})

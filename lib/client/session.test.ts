import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import { refreshAuthSession } from './session'

describe('refreshAuthSession', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('reads the session through the better-auth get-session endpoint', async () => {
    fetchMock.mockResponseOnce('null', { status: 200 })

    await refreshAuthSession()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/get-session', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    })
  })

  it('resolves when the request fails', async () => {
    fetchMock.mockRejectOnce(new Error('offline'))

    await expect(refreshAuthSession()).resolves.toBeUndefined()
  })
})

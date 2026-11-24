import fetchMock from 'jest-fetch-mock'

import { setBlueskyCrosspostByDefault } from './blueskyAccount'

describe('setBlueskyCrosspostByDefault', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    fetchMock.doMock()
  })
  afterEach(() => {
    fetchMock.dontMock()
  })

  it('patches the account with the new default', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ account: null }))
    await setBlueskyCrosspostByDefault(false)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/bluesky/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crosspostByDefault: false })
    })
  })

  it('surfaces the server’s error message', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ error: 'No Bluesky account is linked.' }),
      { status: 404 }
    )
    await expect(setBlueskyCrosspostByDefault(true)).rejects.toThrow(
      'No Bluesky account is linked.'
    )
  })
})

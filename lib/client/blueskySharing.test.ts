import fetchMock from 'jest-fetch-mock'

import { updateBlueskySharing } from './blueskySharing'

describe('updateBlueskySharing', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    fetchMock.doMock()
  })
  afterEach(() => {
    fetchMock.dontMock()
  })

  it('posts the choice and returns the stored status', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ status: 'Setting up' }))
    expect(await updateBlueskySharing(true)).toEqual({ status: 'Setting up' })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/accounts/bluesky-sharing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    })
  })

  it('surfaces the server’s Mastodon-shaped error message', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ error: 'Add a profile picture.' }),
      { status: 422 }
    )
    await expect(updateBlueskySharing(true)).rejects.toThrow(
      'Add a profile picture.'
    )
  })
})

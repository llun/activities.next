import fetchMock from 'jest-fetch-mock'

import {
  cancelHostedBlueskyMoveOut,
  copyHostedBlueskyMoveOutBlobs,
  finishHostedBlueskyMoveOut,
  getHostedBlueskyMoveOut,
  sendHostedBlueskyMoveOutRepo,
  startHostedBlueskyMoveOut
} from './blueskyHosted'

describe('hosted Bluesky move', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    fetchMock.doMock()
  })
  afterEach(() => {
    fetchMock.dontMock()
  })

  it('posts the start body to the move route', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ moveOut: null, state: {} }))
    await startHostedBlueskyMoveOut({
      pdsUrl: 'https://bsky.social',
      handle: 'alex.bsky.social',
      email: 'alex@example.com',
      password: 'hunter2',
      currentPassword: 'local-secret',
      inviteCode: 'code'
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/bluesky/hosted/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step: 'start',
        pdsUrl: 'https://bsky.social',
        handle: 'alex.bsky.social',
        email: 'alex@example.com',
        password: 'hunter2',
        currentPassword: 'local-secret',
        inviteCode: 'code'
      })
    })
  })

  it('passes the cursor to the blobs step', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ copied: 1, failed: [], cursor: 'c2', done: false })
    )
    await copyHostedBlueskyMoveOutBlobs({ cursor: 'c1' })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/bluesky/hosted/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'blobs', cursor: 'c1' })
    })
  })

  it('posts finish with the current password', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        movedTo: 'bsky.social',
        handle: 'alex.bsky.social',
        state: {}
      })
    )
    await finishHostedBlueskyMoveOut('hunter2')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/bluesky/hosted/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'finish', currentPassword: 'hunter2' })
    })
  })

  it('cancels with DELETE and no body', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ cancelled: true }))
    await cancelHostedBlueskyMoveOut()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/bluesky/hosted/move', {
      method: 'DELETE'
    })
  })

  it('reads the move progress', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ progress: null, state: {} }))
    await getHostedBlueskyMoveOut()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/bluesky/hosted/move', {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
  })

  it('surfaces the server’s error message', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ error: 'Enter a valid email address.' }),
      { status: 422 }
    )
    await expect(sendHostedBlueskyMoveOutRepo()).rejects.toThrow(
      'Enter a valid email address.'
    )
  })
})

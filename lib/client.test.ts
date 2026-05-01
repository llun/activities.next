import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getActorStatuses, updateNote } from './client'

enableFetchMocks()

describe('client updateNote', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    fetchMock.mockResponse(
      JSON.stringify({
        id: '123',
        content: '',
        created_at: '2026-04-26T10:00:00.000Z',
        edited_at: null,
        in_reply_to_id: null
      })
    )
  })

  it('omits empty status text for content-warning-only edits', async () => {
    await updateNote({
      statusId: '123',
      message: '',
      contentWarning: 'Updated warning'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/statuses/123',
      expect.objectContaining({
        body: JSON.stringify({
          spoiler_text: 'Updated warning'
        })
      })
    )
  })
})

describe('client getActorStatuses', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        origin: 'https://local.example'
      }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('throws when the remote statuses request fails', async () => {
    fetchMock.mockResponseOnce('', { status: 500 })

    await expect(
      getActorStatuses({
        actorId: 'https://remote.example/users/actor',
        pageUrl: 'https://remote.example/users/actor/outbox?page=true'
      })
    ).rejects.toThrow('Failed to load actor statuses: 500')
  })
})

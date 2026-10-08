import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { describeMedia, getMedia, updateMediaDetails } from './media'

enableFetchMocks()

describe('client media details functions', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('getMedia fetches the owner entity', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: 'a/b' }))
    expect(await getMedia('a/b')).toEqual({ id: 'a/b' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/media/a%2Fb')
  })

  it('getMedia rejects on failure', async () => {
    fetchMock.mockResponseOnce('{}', { status: 404 })
    await expect(getMedia('x')).rejects.toThrow()
  })

  it('updateMediaDetails PUTs only the given fields', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: 'm1' }))
    await updateMediaDetails('m1', { subject_name: 'Owl', in_gallery: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/media/m1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject_name: 'Owl', in_gallery: true })
    })
  })

  it('updateMediaDetails surfaces the server error', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ error: 'Unknown camera gear' }),
      {
        status: 422
      }
    )
    await expect(
      updateMediaDetails('m1', { camera_gear_id: 'zzz' })
    ).rejects.toThrow()
  })

  it('describeMedia returns the description', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ description: 'A bird' }))
    expect(await describeMedia('m1')).toBe('A bird')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/media/m1/describe')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
  })

  it('describeMedia rejects when unavailable', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'off' }), {
      status: 503
    })
    await expect(describeMedia('m1')).rejects.toThrow()
  })
})

import { getStravaUpload } from './activity'

const mockFetch = jest.fn()
global.fetch = mockFetch

describe('getStravaUpload', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('returns upload data when Strava returns 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 67890,
          activity_id: 123,
          external_id: 'garmin.fit',
          error: null,
          status: 'Your activity is ready.'
        })
    })

    const result = await getStravaUpload({
      uploadId: 67890,
      accessToken: 'access-token'
    })

    expect(result).toEqual({
      id: 67890,
      activity_id: 123,
      external_id: 'garmin.fit',
      error: null,
      status: 'Your activity is ready.'
    })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/uploads/67890'),
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('returns null when upload is not found (404)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found')
    })

    const result = await getStravaUpload({
      uploadId: 99999,
      accessToken: 'access-token'
    })

    expect(result).toBeNull()
  })

  it('throws when Strava returns a non-404 error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error')
    })

    await expect(
      getStravaUpload({ uploadId: 67890, accessToken: 'access-token' })
    ).rejects.toThrow('500')
  })
})

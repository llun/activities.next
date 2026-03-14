import {
  buildGpxFromStravaStreams,
  buildTcxFromStravaStreams,
  getStravaActivityStreams,
  getStravaUpload
} from './activity'

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

  it('returns null when upload check is unauthorized (401)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Authorization Error')
    })

    const result = await getStravaUpload({
      uploadId: 67890,
      accessToken: 'access-token'
    })

    expect(result).toBeNull()
  })

  it('throws when Strava returns a non-404 non-401 error', async () => {
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

describe('getStravaActivityStreams', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('returns stream set when Strava returns 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          latlng: {
            type: 'latlng',
            data: [
              [37.7749, -122.4194],
              [37.775, -122.4195]
            ]
          },
          altitude: { type: 'altitude', data: [50.0, 51.2] },
          time: { type: 'time', data: [0, 10] },
          distance: { type: 'distance', data: [0, 13.5] }
        })
    })

    const result = await getStravaActivityStreams({
      activityId: '123',
      accessToken: 'access-token'
    })

    expect(result).not.toBeNull()
    expect(result?.latlng?.data).toHaveLength(2)
    expect(result?.time?.data).toEqual([0, 10])
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/activities/123/streams'),
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('returns null when activity has no streams (404)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found')
    })

    const result = await getStravaActivityStreams({
      activityId: '999',
      accessToken: 'access-token'
    })

    expect(result).toBeNull()
  })

  it('throws when Strava returns a non-404 error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable')
    })

    await expect(
      getStravaActivityStreams({
        activityId: '123',
        accessToken: 'access-token'
      })
    ).rejects.toThrow('503')
  })
})

describe('buildGpxFromStravaStreams', () => {
  const baseActivity = {
    id: 123,
    name: 'Morning Run',
    sport_type: 'Run',
    start_date: '2026-01-01T00:00:00Z'
  }

  it('returns null when latlng stream is absent', () => {
    const result = buildGpxFromStravaStreams(baseActivity, {
      time: { type: 'time', data: [0, 10] }
    })

    expect(result).toBeNull()
  })

  it('returns null when latlng data is empty', () => {
    const result = buildGpxFromStravaStreams(baseActivity, {
      latlng: { type: 'latlng', data: [] }
    })

    expect(result).toBeNull()
  })

  it('returns a GPX string with trkpt elements for each coordinate', () => {
    const result = buildGpxFromStravaStreams(baseActivity, {
      latlng: {
        type: 'latlng',
        data: [
          [37.7749, -122.4194],
          [37.775, -122.4195]
        ]
      }
    })

    expect(result).not.toBeNull()
    expect(result).toContain('<gpx')
    expect(result).toContain('trkpt lat="37.7749" lon="-122.4194"')
    expect(result).toContain('trkpt lat="37.775" lon="-122.4195"')
  })

  it('includes elevation elements when altitude stream is present', () => {
    const result = buildGpxFromStravaStreams(baseActivity, {
      latlng: { type: 'latlng', data: [[37.7749, -122.4194]] },
      altitude: { type: 'altitude', data: [50.5] }
    })

    expect(result).toContain('<ele>50.5</ele>')
  })

  it('includes ISO timestamps when time stream and activity start_date are present', () => {
    const result = buildGpxFromStravaStreams(baseActivity, {
      latlng: {
        type: 'latlng',
        data: [
          [37.7749, -122.4194],
          [37.775, -122.4195]
        ]
      },
      time: { type: 'time', data: [0, 10] }
    })

    // t=0 → 2026-01-01T00:00:00.000Z, t=10 → 2026-01-01T00:00:10.000Z
    expect(result).toContain('<time>2026-01-01T00:00:00.000Z</time>')
    expect(result).toContain('<time>2026-01-01T00:00:10.000Z</time>')
  })

  it('includes activity name and sport type in the track', () => {
    const result = buildGpxFromStravaStreams(baseActivity, {
      latlng: { type: 'latlng', data: [[37.7749, -122.4194]] }
    })

    expect(result).toContain('<name>Morning Run</name>')
    expect(result).toContain('<type>Run</type>')
  })

  it('escapes XML special characters in activity name and sport type', () => {
    const result = buildGpxFromStravaStreams(
      { ...baseActivity, name: 'Ride & Run <fast>', sport_type: 'Run"2"' },
      { latlng: { type: 'latlng', data: [[37.7749, -122.4194]] } }
    )

    expect(result).toContain('<name>Ride &amp; Run &lt;fast&gt;</name>')
    expect(result).toContain('<type>Run&quot;2&quot;</type>')
    expect(result).not.toContain('<fast>')
    expect(result).not.toContain('& Run')
  })
})

describe('buildTcxFromStravaStreams', () => {
  const baseActivity = {
    id: 125,
    sport_type: 'VirtualRide',
    start_date: '2026-01-01T00:00:00.000Z',
    distance: 20_000,
    elapsed_time: 3_600,
    moving_time: 3_500
  }

  it('returns null when streams are null and activity has no duration', () => {
    const result = buildTcxFromStravaStreams(
      { ...baseActivity, elapsed_time: 0, moving_time: 0 },
      null
    )
    expect(result).toBeNull()
  })

  it('returns TCX using elapsed_time when streams are null', () => {
    const result = buildTcxFromStravaStreams(baseActivity, null)

    expect(result).not.toBeNull()
    expect(result).toContain('<TrainingCenterDatabase')
    expect(result).toContain('<TotalTimeSeconds>3600</TotalTimeSeconds>')
    expect(result).toContain('<DistanceMeters>20000</DistanceMeters>')
    expect(result).toContain('Sport="VirtualRide"')
    expect(result).toContain('<Id>2026-01-01T00:00:00.000Z</Id>')
  })

  it('prefers last time stream value over activity elapsed_time for duration', () => {
    const result = buildTcxFromStravaStreams(baseActivity, {
      time: { type: 'time', data: [0, 600, 1200] }
    })

    expect(result).toContain('<TotalTimeSeconds>1200</TotalTimeSeconds>')
  })

  it('prefers last distance stream value over activity distance', () => {
    const result = buildTcxFromStravaStreams(baseActivity, {
      time: { type: 'time', data: [0, 600] },
      distance: { type: 'distance', data: [0, 10_500] }
    })

    expect(result).toContain('<DistanceMeters>10500</DistanceMeters>')
  })

  it('includes time-stamped track points when time stream and start_date are present', () => {
    const result = buildTcxFromStravaStreams(baseActivity, {
      time: { type: 'time', data: [0, 60] }
    })

    expect(result).toContain(
      '<Trackpoint><Time>2026-01-01T00:00:00.000Z</Time></Trackpoint>'
    )
    expect(result).toContain(
      '<Trackpoint><Time>2026-01-01T00:01:00.000Z</Time></Trackpoint>'
    )
  })

  it('includes altitude in track points when altitude stream is present', () => {
    const result = buildTcxFromStravaStreams(baseActivity, {
      time: { type: 'time', data: [0, 60] },
      altitude: { type: 'altitude', data: [100, 105] }
    })

    expect(result).toContain('<AltitudeMeters>100</AltitudeMeters>')
    expect(result).toContain('<AltitudeMeters>105</AltitudeMeters>')
  })

  it('escapes XML special characters in sport type', () => {
    const result = buildTcxFromStravaStreams(
      { ...baseActivity, sport_type: 'Run & Bike <test>' },
      null
    )

    expect(result).toContain('Sport="Run &amp; Bike &lt;test&gt;"')
  })
})

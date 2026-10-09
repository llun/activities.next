import { logger } from '@/lib/utils/logger'

import {
  buildGpxFromStravaStreams,
  buildStravaActivitySummary,
  buildTcxFromStravaStreams,
  getStravaActivity,
  getStravaActivityDurationSeconds,
  getStravaActivityPhotos,
  getStravaActivityStartTimeMs,
  getStravaActivityStreams,
  getStravaActivityUrl,
  getStravaUpload,
  getValidStravaAccessToken,
  isSupportedStravaPhotoMimeType
} from './activity'

const mockFetch = vi.fn()
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

describe('buildStravaActivitySummary', () => {
  it('does not embed the Strava activity link in the status text', () => {
    const summary = buildStravaActivitySummary({
      id: 123,
      name: 'Morning Run',
      distance: 10000,
      moving_time: 3000,
      total_elevation_gain: 50,
      description: 'Felt great',
      sport_type: 'Run'
    })

    expect(summary).not.toContain('strava.com')
    expect(summary).not.toContain('https://')
    expect(summary).toContain('Morning Run')
    expect(summary).toContain('Felt great')
  })

  it.each([
    {
      description: 'MountainBikeRide',
      sportType: 'MountainBikeRide',
      emoji: '🚵'
    },
    { description: 'GravelRide', sportType: 'GravelRide', emoji: '🚴' },
    { description: 'EBikeRide', sportType: 'EBikeRide', emoji: '🚴' },
    { description: 'VirtualRide', sportType: 'VirtualRide', emoji: '🚴' },
    { description: 'Ride', sportType: 'Ride', emoji: '🚴' },
    { description: 'Run', sportType: 'Run', emoji: '🏃' }
  ])('gives $description its own glyph', ({ sportType, emoji }) => {
    // The emoji is always visible: it prefixes the caption whether or not the
    // activity has a name. Matching substrings on Strava's raw `sport_type`
    // collapsed every bike sub-type onto the road-bike glyph, so a mountain
    // bike ride imported from Strava disagreed with the same ride out of a FIT
    // file. This is the ordinary import path, not only the streamless
    // fallback: a file-backed import's status is created with an empty body
    // and this summary is what fills it.
    const summary = buildStravaActivitySummary({
      id: 123,
      name: 'Morning ride',
      distance: 10000,
      moving_time: 3000,
      sport_type: sportType
    })

    expect(summary.startsWith(emoji)).toBe(true)
  })

  it('prettifies the sport when the activity has no name to show instead', () => {
    const summary = buildStravaActivitySummary({
      id: 123,
      distance: 10000,
      moving_time: 3000,
      sport_type: 'MountainBikeRide'
    })

    expect(summary).toContain('Mountain biking')
    expect(summary).not.toContain('MountainBikeRide')
  })

  it('presents a gym workout with proper casing', () => {
    const summary = buildStravaActivitySummary({
      id: 123,
      distance: 0,
      moving_time: 0,
      sport_type: 'WeightTraining'
    })

    expect(summary).toContain('Weight training')
  })

  it('keeps an unmodelled sport as the word Strava used', () => {
    const summary = buildStravaActivitySummary({
      id: 123,
      distance: 0,
      moving_time: 0,
      sport_type: 'Kayaking'
    })

    expect(summary).toContain('Kayaking')
  })
})

describe('getStravaActivityUrl', () => {
  it('builds the public activity URL from a numeric id', () => {
    expect(getStravaActivityUrl(123)).toBe(
      'https://www.strava.com/activities/123'
    )
    expect(getStravaActivityUrl('456')).toBe(
      'https://www.strava.com/activities/456'
    )
  })

  it('returns null for non-numeric ids (e.g. archive filename fallbacks)', () => {
    expect(getStravaActivityUrl('activities/run.gpx')).toBeNull()
    expect(getStravaActivityUrl('')).toBeNull()
    expect(getStravaActivityUrl(null)).toBeNull()
    expect(getStravaActivityUrl(undefined)).toBeNull()
  })
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

describe('getStravaActivityStartTimeMs', () => {
  it('parses start_date into epoch milliseconds', () => {
    expect(
      getStravaActivityStartTimeMs({
        id: 1,
        start_date: '2025-01-02T03:04:05Z'
      })
    ).toBe(Date.UTC(2025, 0, 2, 3, 4, 5))
  })

  it.each([
    ['missing', undefined],
    ['unparseable', 'yesterday-ish']
  ])('returns undefined when start_date is %s', (_, startDate) => {
    expect(
      getStravaActivityStartTimeMs({ id: 1, start_date: startDate })
    ).toBeUndefined()
  })
})

describe('getStravaActivityDurationSeconds', () => {
  it.each([
    ['elapsed time when both are positive', 3600, 3000, 3600],
    ['moving time when elapsed time is zero', 0, 3000, 3000],
    ['moving time when elapsed time is missing', undefined, 3000, 3000],
    ['moving time when elapsed time is not finite', Number.NaN, 3000, 3000],
    ['zero when neither is positive', 0, -5, 0],
    ['zero when both are missing', undefined, undefined, 0]
  ])('uses %s', (_, elapsed, moving, expected) => {
    expect(
      getStravaActivityDurationSeconds({
        elapsed_time: elapsed,
        moving_time: moving
      })
    ).toBe(expected)
  })
})

describe('buildStravaActivitySummary layout', () => {
  it('puts the name, distance with duration and elevation on separate lines, then the description', () => {
    expect(
      buildStravaActivitySummary({
        id: 1,
        name: '  Morning Run  ',
        sport_type: 'Run',
        distance: 12345,
        elapsed_time: 3725,
        total_elevation_gain: 80.4,
        description: '  Felt great  '
      })
    ).toBe('🏃 Morning Run\n12.3 km in 1:02:05 • 80 m gain\nFelt great')
  })

  it.each([
    ['distance only', { distance: 5000 }, '5.00 km'],
    ['duration only', { moving_time: 600 }, '10:00'],
    ['elevation only', { total_elevation_gain: 30 }, '30 m gain']
  ])('shows %s on the metrics line', (_, metrics, expected) => {
    const summary = buildStravaActivitySummary({
      id: 1,
      name: 'Walk',
      sport_type: 'Walk',
      ...metrics
    })

    expect(summary.split('\n')[1]).toBe(expected)
  })

  it('falls back to the sport label on the second line when there are no metrics', () => {
    const summary = buildStravaActivitySummary({
      id: 1,
      name: 'Stretch',
      sport_type: 'Yoga'
    })

    const [firstLine, secondLine] = summary.split('\n')
    expect(firstLine).toContain('Stretch')
    expect(secondLine).toBe('Yoga')
  })

  it('uses the legacy type field when sport_type is absent', () => {
    expect(
      buildStravaActivitySummary({
        id: 1,
        type: 'Run',
        name: 'Loop'
      }).startsWith('🏃')
    ).toBe(true)
  })
})

describe('isSupportedStravaPhotoMimeType', () => {
  it.each([
    ['image/jpeg', true],
    ['image/png', true],
    ['image/gif', false],
    ['video/mp4', false]
  ])('%s -> %s', (mime, expected) => {
    expect(isSupportedStravaPhotoMimeType(mime)).toBe(expected)
  })
})

describe('getStravaActivity', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('requests the encoded activity with the bearer token and returns the payload', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 42, name: 'Ride' }))

    const result = await getStravaActivity({
      activityId: 'a/b 42',
      accessToken: 'token-1'
    })

    expect(result).toEqual({ id: 42, name: 'Ride' })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.strava.com/api/v3/activities/a%2Fb%2042',
      { method: 'GET', headers: { Authorization: 'Bearer token-1' } }
    )
  })

  it.each([
    [
      'the Strava message',
      jsonResponse({ message: 'Authorization Error' }, 401),
      'Failed to fetch Strava activity (401): Authorization Error'
    ],
    [
      'the first error message',
      jsonResponse({ errors: [{}, { message: 'bad field' }] }, 400),
      'Failed to fetch Strava activity (400): bad field'
    ],
    [
      'the raw body when it is not JSON',
      new Response('upstream exploded', { status: 502 }),
      'Failed to fetch Strava activity (502): upstream exploded'
    ],
    [
      'the status text when the body is empty',
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
      'Failed to fetch Strava activity (503): Service Unavailable'
    ]
  ])('throws including %s', async (_, response, message) => {
    mockFetch.mockResolvedValueOnce(response)

    await expect(
      getStravaActivity({ activityId: '1', accessToken: 't' })
    ).rejects.toThrow(message)
  })
})

describe('getStravaActivityPhotos', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.spyOn(logger, 'warn').mockImplementation(() => logger)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests the photos endpoint with the bearer token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]))

    await getStravaActivityPhotos({ activityId: '99', accessToken: 'tok' })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.strava.com/api/v3/activities/99/photos?size=2048',
      { method: 'GET', headers: { Authorization: 'Bearer tok' } }
    )
  })

  it('picks the largest numeric size for each photo and drops entries with no usable url', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          unique_id: 'p1',
          urls: { '100': 'https://img/p1-100', '2048': 'https://img/p1-2048' }
        },
        { unique_id: 7, urls: { thumb: 'https://img/p2-thumb' } },
        { unique_id: 'p3', urls: { '600': '   ', '100': null } },
        { unique_id: 'p4', urls: null }
      ])
    )

    const photos = await getStravaActivityPhotos({
      activityId: '1',
      accessToken: 't'
    })

    expect(photos).toEqual([
      { id: 'p1', url: 'https://img/p1-2048' },
      { id: '7', url: 'https://img/p2-thumb' }
    ])
  })

  it('lists the activity primary photo first and de-duplicates it against the photo list', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { unique_id: 'primary', urls: { '2048': 'https://img/primary' } },
        { unique_id: 'other', urls: { '2048': 'https://img/other' } }
      ])
    )

    const photos = await getStravaActivityPhotos({
      activityId: '1',
      accessToken: 't',
      activity: {
        id: 1,
        photos: {
          primary: {
            unique_id: 'primary',
            urls: { '600': 'https://img/primary' }
          }
        }
      }
    })

    expect(photos).toEqual([
      { id: 'primary', url: 'https://img/primary' },
      { id: 'other', url: 'https://img/other' }
    ])
  })

  it('caps the result at the requested limit', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        [1, 2, 3, 4, 5].map((n) => ({
          unique_id: `p${n}`,
          urls: { '2048': `https://img/${n}` }
        }))
      )
    )

    const photos = await getStravaActivityPhotos({
      activityId: '1',
      accessToken: 't',
      limit: 2
    })

    expect(photos.map((photo) => photo.id)).toEqual(['p1', 'p2'])
  })

  it('returns no photos for a limit of zero', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ unique_id: 'p', urls: { '2048': 'https://img/p' } }])
    )

    await expect(
      getStravaActivityPhotos({ activityId: '1', accessToken: 't', limit: 0 })
    ).resolves.toEqual([])
  })

  it('ignores a photos payload that is not a list', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'nope' }))

    await expect(
      getStravaActivityPhotos({ activityId: '1', accessToken: 't' })
    ).resolves.toEqual([])
  })

  it('still returns the primary photo and logs a warning when the photos request fails', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ message: 'Rate Limit Exceeded' }, 429)
    )

    const photos = await getStravaActivityPhotos({
      activityId: '77',
      accessToken: 't',
      activity: {
        id: 77,
        photos: {
          primary: { unique_id: 12, urls: { '600': 'https://img/12' } }
        }
      }
    })

    expect(photos).toEqual([{ id: '12', url: 'https://img/12' }])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to fetch Strava activity photos',
        activityId: '77',
        status: 429,
        error: 'Rate Limit Exceeded'
      })
    )
  })
})

describe('getValidStravaAccessToken', () => {
  const NOW = new Date('2025-06-01T12:00:00.000Z').getTime()
  const baseSettings = {
    id: 'settings-1',
    actorId: 'https://llun.test/users/runner',
    accessToken: 'old-access',
    refreshToken: 'refresh-1',
    clientId: 'client-1',
    clientSecret: 'secret-1',
    tokenExpiresAt: NOW - 1000
  }
  const updateFitnessSettings = vi.fn()
  const database = { updateFitnessSettings } as unknown as Parameters<
    typeof getValidStravaAccessToken
  >[0]['database']
  const getToken = (overrides: Record<string, unknown> = {}) =>
    getValidStravaAccessToken({
      database,
      fitnessSettings: {
        ...baseSettings,
        ...overrides
      } as unknown as Parameters<
        typeof getValidStravaAccessToken
      >[0]['fitnessSettings']
    })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mockFetch.mockReset()
    updateFitnessSettings.mockReset()
    vi.spyOn(logger, 'warn').mockImplementation(() => logger)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns null when no access token is stored', async () => {
    await expect(getToken({ accessToken: undefined })).resolves.toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['the expiry is unknown', undefined],
    ['the token is valid for more than a minute', NOW + 120_000],
    ['the token is valid for one millisecond past the buffer', NOW + 60_001]
  ])('returns the stored token without refreshing when %s', async (_, exp) => {
    await expect(getToken({ tokenExpiresAt: exp })).resolves.toBe('old-access')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('refreshes a token that expires exactly at the edge of the one minute buffer', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        access_token: 'new-access',
        refresh_token: 'refresh-2',
        expires_at: 1_800_000_000
      })
    )

    await expect(getToken({ tokenExpiresAt: NOW + 60_000 })).resolves.toBe(
      'new-access'
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('refreshes a token that expires within the one minute buffer and stores the new credentials', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        access_token: 'new-access',
        refresh_token: 'refresh-2',
        expires_at: 1_800_000_000
      })
    )

    const token = await getToken({ tokenExpiresAt: NOW + 30_000 })

    expect(token).toBe('new-access')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://www.strava.com/oauth/token')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      client_id: 'client-1',
      client_secret: 'secret-1',
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1'
    })
    expect(updateFitnessSettings).toHaveBeenCalledWith({
      id: 'settings-1',
      accessToken: 'new-access',
      refreshToken: 'refresh-2',
      tokenExpiresAt: 1_800_000_000_000
    })
  })

  it.each([
    ['refresh token', { refreshToken: undefined }],
    ['client id', { clientId: undefined }],
    ['client secret', { clientSecret: undefined }]
  ])(
    'keeps the stale token and warns without calling Strava when the %s is missing',
    async (_, overrides) => {
      await expect(getToken(overrides)).resolves.toBe('old-access')

      expect(mockFetch).not.toHaveBeenCalled()
      expect(updateFitnessSettings).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Strava token appears expired and cannot be refreshed',
          actorId: baseSettings.actorId
        })
      )
    }
  )

  it('keeps the stale token, stores nothing and warns when Strava rejects the refresh', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ message: 'Bad Request' }, 400)
    )

    await expect(getToken()).resolves.toBe('old-access')

    expect(updateFitnessSettings).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to refresh Strava access token',
        actorId: baseSettings.actorId,
        status: 400,
        error: 'Bad Request'
      })
    )
  })

  it('propagates a network failure during refresh', async () => {
    mockFetch.mockRejectedValueOnce(new Error('socket hang up'))

    await expect(getToken()).rejects.toThrow('socket hang up')
    expect(updateFitnessSettings).not.toHaveBeenCalled()
  })
})

describe('buildGpxFromStravaStreams optional channels', () => {
  it('writes heart rate, cadence, speed and temperature as track point extensions', () => {
    const gpx = buildGpxFromStravaStreams(
      { id: 1, name: 'Ride', sport_type: 'Ride', start_date: undefined },
      {
        latlng: { type: 'latlng', data: [[1, 2]] },
        heartrate: { type: 'heartrate', data: [140] },
        cadence: { type: 'cadence', data: [85] },
        velocity_smooth: { type: 'velocity_smooth', data: [7.5] },
        temp: { type: 'temp', data: [21] }
      }
    )

    expect(gpx).toContain(
      '<trkpt lat="1" lon="2"><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad><gpxtpx:speed>7.5</gpxtpx:speed><gpxtpx:atemp>21</gpxtpx:atemp></gpxtpx:TrackPointExtension></extensions></trkpt>'
    )
  })

  it('omits timestamps when the activity has no start date', () => {
    const gpx = buildGpxFromStravaStreams(
      { id: 1, name: 'Ride', sport_type: 'Ride' },
      {
        latlng: { type: 'latlng', data: [[1, 2]] },
        time: { type: 'time', data: [10] }
      }
    )

    expect(gpx).not.toContain('<time>')
  })
})

describe('buildTcxFromStravaStreams optional channels', () => {
  it('writes position, heart rate, cadence, speed and power per trackpoint', () => {
    const tcx = buildTcxFromStravaStreams(
      { sport_type: 'Ride', start_date: '2025-01-01T00:00:00Z' },
      {
        time: { type: 'time', data: [0, 5] },
        latlng: {
          type: 'latlng',
          data: [
            [1, 2],
            [3, 4]
          ]
        },
        heartrate: { type: 'heartrate', data: [120, 130] },
        cadence: { type: 'cadence', data: [80, 82] },
        velocity_smooth: { type: 'velocity_smooth', data: [5, 6] },
        watts: { type: 'watts', data: [200, 210] }
      }
    )

    expect(tcx).toContain(
      '<Trackpoint><Time>2025-01-01T00:00:05.000Z</Time><Position><LatitudeDegrees>3</LatitudeDegrees><LongitudeDegrees>4</LongitudeDegrees></Position><HeartRateBpm><Value>130</Value></HeartRateBpm><Cadence>82</Cadence><Extensions><ns3:TPX xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><ns3:Speed>6</ns3:Speed><ns3:Watts>210</ns3:Watts></ns3:TPX></Extensions></Trackpoint>'
    )
  })

  it('omits the track and start time when the activity has no usable start date', () => {
    const tcx = buildTcxFromStravaStreams(
      { sport_type: 'Run', start_date: 'not a date', elapsed_time: 600 },
      { time: { type: 'time', data: [0, 5] } }
    )

    expect(tcx).toContain('<TotalTimeSeconds>5</TotalTimeSeconds>')
    expect(tcx).not.toContain('<Track>')
    expect(tcx).not.toContain('StartTime=')
    expect(tcx).not.toContain('<Id>')
  })
})

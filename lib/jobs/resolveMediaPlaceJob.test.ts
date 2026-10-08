import { Database } from '@/lib/database/types'
import { RESOLVE_MEDIA_PLACE_JOB_NAME } from '@/lib/jobs/names'
import { resolveMediaPlaceJob } from '@/lib/jobs/resolveMediaPlaceJob'
import { LookupError } from '@/lib/services/gallery/lookups/lookupRequest'
import { createNominatimClient } from '@/lib/services/gallery/lookups/nominatim'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'

const nominatim = { reverseGeocode: vi.fn() }
vi.mock('@/lib/services/gallery/lookups/nominatim', () => ({
  createNominatimClient: vi.fn(() => nominatim)
}))

const resolvedSettings = { network: { placeLookups: true } }
vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn(async () => resolvedSettings)
}))

const getMediaWithAttachedStatusIds = vi.fn()
const setMediaPlaceLookup = vi.fn()
const database = {
  getMediaWithAttachedStatusIds,
  setMediaPlaceLookup
} as unknown as Database

const message = (data: unknown) => ({
  id: 'job-1',
  name: RESOLVE_MEDIA_PLACE_JOB_NAME,
  data
})

const POINT = { placeLatitude: 14.534709, placeLongitude: 101.391256 }

const mediaWith = (details: Partial<MediaDetailsRecord>) =>
  getMediaWithAttachedStatusIds.mockResolvedValue({
    media: { id: '7', details },
    statusIds: []
  })

describe('resolveMediaPlaceJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolvedSettings.network.placeLookups = true
    setMediaPlaceLookup.mockResolvedValue(true)
    nominatim.reverseGeocode.mockResolvedValue({
      name: 'Pak Chong, Thailand',
      countryCode: 'TH'
    })
  })

  it('ignores a malformed message', async () => {
    await resolveMediaPlaceJob(database, message({ nope: true }))
    expect(getMediaWithAttachedStatusIds).not.toHaveBeenCalled()
  })

  it('returns when the media is gone or has no coordinates', async () => {
    getMediaWithAttachedStatusIds.mockResolvedValue(null)
    await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

    mediaWith({ placeLatitude: null, placeLongitude: null })
    await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

    mediaWith({ placeLatitude: 14.5, placeLongitude: null })
    await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

    expect(nominatim.reverseGeocode).not.toHaveBeenCalled()
    expect(setMediaPlaceLookup).not.toHaveBeenCalled()
  })

  it('geocodes the coordinates and writes the name and country', async () => {
    mediaWith({ ...POINT, placeName: null })

    await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

    expect(nominatim.reverseGeocode).toHaveBeenCalledWith({
      latitude: POINT.placeLatitude,
      longitude: POINT.placeLongitude
    })
    expect(setMediaPlaceLookup).toHaveBeenCalledWith({
      mediaId: '7',
      expect: POINT,
      patch: {
        placeName: 'Pak Chong, Thailand',
        placeCountryCode: 'TH',
        placeLookupStatus: 'resolved'
      }
    })
  })

  it('runs for a photo whose public precision is hidden', async () => {
    mediaWith({ ...POINT, placePrecision: 'hidden', placeName: null })

    await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

    expect(nominatim.reverseGeocode).toHaveBeenCalledTimes(1)
  })

  it('replaces a name the geocoder gave earlier', async () => {
    mediaWith({ ...POINT, placeName: 'Old name', placeNameSource: 'geocoder' })

    await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

    expect(setMediaPlaceLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ placeName: 'Pak Chong, Thailand' })
      })
    )
  })

  it.each([
    ['owner', 'owner' as const],
    ['legacy (no source)', null]
  ])(
    'never overwrites a name from the %s, but still sets the country',
    async (_label, source) => {
      mediaWith({ ...POINT, placeName: 'My garden', placeNameSource: source })

      await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

      expect(setMediaPlaceLookup).toHaveBeenCalledWith(
        expect.objectContaining({
          patch: { placeCountryCode: 'TH', placeLookupStatus: 'resolved' }
        })
      )
    }
  )

  it('sets only the country when Nominatim names no locality', async () => {
    nominatim.reverseGeocode.mockResolvedValue({
      name: null,
      countryCode: 'IS'
    })
    mediaWith({ ...POINT })

    await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

    expect(setMediaPlaceLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { placeCountryCode: 'IS', placeLookupStatus: 'resolved' }
      })
    )
  })

  it('records no-match when there is nothing at the cell (open sea)', async () => {
    nominatim.reverseGeocode.mockResolvedValue(null)
    mediaWith({ ...POINT })

    await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

    expect(setMediaPlaceLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { placeCountryCode: null, placeLookupStatus: 'no-match' }
      })
    )
  })

  it('is re-checked at run time: switched off records disabled and sends nothing', async () => {
    resolvedSettings.network.placeLookups = false
    mediaWith({ ...POINT })

    await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

    expect(nominatim.reverseGeocode).not.toHaveBeenCalled()
    expect(setMediaPlaceLookup).toHaveBeenCalledWith({
      mediaId: '7',
      expect: POINT,
      patch: { placeLookupStatus: 'disabled' }
    })
  })

  it.each(['resolved', 'no-match'] as const)(
    'keeps a finished %s result when switched off',
    async (placeLookupStatus) => {
      resolvedSettings.network.placeLookups = false
      mediaWith({ ...POINT, placeLookupStatus, placeCountryCode: 'TH' })

      await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

      expect(nominatim.reverseGeocode).not.toHaveBeenCalled()
      expect(setMediaPlaceLookup).not.toHaveBeenCalled()
    }
  )

  it.each([null, 'pending', 'failed'] as const)(
    'marks a %s place disabled when switched off',
    async (placeLookupStatus) => {
      resolvedSettings.network.placeLookups = false
      mediaWith({ ...POINT, placeLookupStatus })

      await resolveMediaPlaceJob(database, message({ mediaId: '7' }))

      expect(setMediaPlaceLookup).toHaveBeenCalledWith(
        expect.objectContaining({ patch: { placeLookupStatus: 'disabled' } })
      )
    }
  )

  it('asks Nominatim again past a remembered failure or miss only on a retry', async () => {
    mediaWith({ ...POINT })

    await resolveMediaPlaceJob(database, message({ mediaId: '7' }))
    expect(createNominatimClient).toHaveBeenLastCalledWith(
      expect.objectContaining({
        skipCachedErrors: false,
        skipCachedMiss: false
      })
    )

    await resolveMediaPlaceJob(database, message({ mediaId: '7', retry: true }))
    expect(createNominatimClient).toHaveBeenLastCalledWith(
      expect.objectContaining({ skipCachedErrors: true, skipCachedMiss: true })
    )
  })

  it('drops the result when the coordinates changed meanwhile (compare-and-set loses)', async () => {
    setMediaPlaceLookup.mockResolvedValue(false)
    mediaWith({ ...POINT })

    await expect(
      resolveMediaPlaceJob(database, message({ mediaId: '7' }))
    ).resolves.toBeUndefined()
    expect(setMediaPlaceLookup).toHaveBeenCalledTimes(1)
  })

  describe('provider errors', () => {
    it.each([
      [
        'rate limited',
        new LookupError('rate-limited', 'Nominatim rate limited')
      ],
      ['circuit open', new LookupError('circuit-open', 'down')],
      ['unexpected', new Error('boom')]
    ])('%s is swallowed and persisted as failed', async (_label, error) => {
      nominatim.reverseGeocode.mockRejectedValue(error)
      mediaWith({ ...POINT })

      await expect(
        resolveMediaPlaceJob(database, message({ mediaId: '7' }))
      ).resolves.toBeUndefined()

      expect(setMediaPlaceLookup).toHaveBeenCalledWith({
        mediaId: '7',
        expect: POINT,
        patch: { placeLookupStatus: 'failed' }
      })
    })

    it('still returns when recording the failure fails too', async () => {
      nominatim.reverseGeocode.mockRejectedValue(new Error('boom'))
      setMediaPlaceLookup.mockRejectedValue(new Error('db down'))
      mediaWith({ ...POINT })

      await expect(
        resolveMediaPlaceJob(database, message({ mediaId: '7' }))
      ).resolves.toBeUndefined()
    })
  })
})

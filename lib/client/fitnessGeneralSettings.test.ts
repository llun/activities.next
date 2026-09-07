import fetchMock from 'jest-fetch-mock'

import {
  getFitnessGeneralSettings,
  regenerateFitnessMaps,
  updateFitnessGeneralSettings
} from '@/lib/client/fitnessGeneralSettings'

describe('fitnessGeneralSettings client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getFitnessGeneralSettings', () => {
    it('returns privacy locations and home settings on success', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          privacyLocations: [
            { latitude: 10, longitude: 20, hideRadiusMeters: 500 }
          ],
          privacyHomeLatitude: 10,
          privacyHomeLongitude: 20,
          privacyHideRadiusMeters: 500
        }),
        { status: 200 }
      )

      const result = await getFitnessGeneralSettings()
      expect(result.privacyLocations).toHaveLength(1)
      expect(result.privacyHomeLatitude).toBe(10)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/general',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('throws error when response is not ok', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Server error' }), {
        status: 500
      })

      await expect(getFitnessGeneralSettings()).rejects.toThrow(
        'Failed to load fitness privacy settings'
      )
    })

    it('throws error when response body is invalid', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200
      })

      await expect(getFitnessGeneralSettings()).rejects.toThrow(
        'Unexpected fitness privacy settings response'
      )
    })
  })

  describe('updateFitnessGeneralSettings', () => {
    it('posts updated privacy locations and returns ok true with data', async () => {
      const locations = [
        { latitude: 12.34, longitude: 56.78, hideRadiusMeters: 200 }
      ]
      fetchMock.mockResponseOnce(
        JSON.stringify({
          privacyLocations: locations
        }),
        { status: 200 }
      )

      const result = await updateFitnessGeneralSettings(locations)
      expect(result.ok).toBe(true)
      expect(result.data.privacyLocations).toEqual(locations)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/general',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ privacyLocations: locations })
        })
      )
    })

    it('returns ok false when server responds with error status', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Invalid data' }), {
        status: 400
      })

      const result = await updateFitnessGeneralSettings([])
      expect(result.ok).toBe(false)
      expect(result.data.error).toBe('Invalid data')
    })
  })

  describe('regenerateFitnessMaps', () => {
    it('calls regenerate-maps endpoint and returns result', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ success: true, queuedCount: 3 }),
        { status: 200 }
      )

      const result = await regenerateFitnessMaps()
      expect(result.ok).toBe(true)
      expect(result.data.queuedCount).toBe(3)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/general/regenerate-maps',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })
})

import fetchMock from 'jest-fetch-mock'

import {
  PreferencesInput,
  updateNavigationPreferences,
  updatePreferences
} from './accountPreferences'

describe('accountPreferences client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('updatePreferences', () => {
    const preferences: PreferencesInput = {
      visibility: 'public',
      quotePolicy: 'public',
      sensitive: false,
      language: 'en',
      expandMedia: 'default',
      expandSpoilers: false,
      autoplayGifs: true
    }

    it('returns true when both posting and reading preferences are saved successfully', async () => {
      fetchMock
        .mockResponseOnce(JSON.stringify({ success: true }), { status: 200 })
        .mockResponseOnce(JSON.stringify({ success: true }), { status: 200 })

      const result = await updatePreferences(preferences)

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        '/api/v1/accounts/update_credentials',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: {
              privacy: 'public',
              quote_policy: 'public',
              sensitive: false,
              language: 'en'
            }
          })
        }
      )
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/v1/accounts/reading-preferences',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            readingExpandMedia: 'default',
            readingExpandSpoilers: false,
            readingAutoplayGifs: true
          })
        }
      )
    })

    it('returns false and skips reading preferences when posting preferences update fails', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Failed' }), {
        status: 500
      })

      const result = await updatePreferences(preferences)

      expect(result).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/update_credentials',
        expect.anything()
      )
    })

    it('returns false when reading preferences update fails', async () => {
      fetchMock
        .mockResponseOnce(JSON.stringify({ success: true }), { status: 200 })
        .mockResponseOnce(JSON.stringify({ error: 'Failed' }), { status: 500 })

      const result = await updatePreferences(preferences)

      expect(result).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('updateNavigationPreferences', () => {
    it('sends navigation preferences and returns true on success', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200
      })

      const input = {
        navOrder: ['timeline', 'notifications', 'messages'],
        navHidden: ['bookmarks']
      }

      const result = await updateNavigationPreferences(input)

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/navigation-preferences',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        }
      )
    })

    it('returns false when request fails', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Failed' }), {
        status: 400
      })

      const input = {
        navOrder: [],
        navHidden: []
      }

      const result = await updateNavigationPreferences(input)

      expect(result).toBe(false)
    })
  })
})

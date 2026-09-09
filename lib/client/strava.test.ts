import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  deleteStravaSettings,
  getStravaSettings,
  saveStravaSettings
} from './strava'

describe('strava client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getStravaSettings', () => {
    it('fetches Strava settings with Accept header', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          configured: true,
          actorId: 'https://local.example/users/alice',
          actorHandle: '@alice@local.example',
          clientId: '12345',
          connected: true,
          webhookUrl: 'https://local.example/api/v1/webhooks/strava/tok123',
          defaultVisibility: 'private'
        }),
        { status: 200 }
      )

      const result = await getStravaSettings()

      expect(result).toEqual({
        configured: true,
        actorId: 'https://local.example/users/alice',
        actorHandle: '@alice@local.example',
        clientId: '12345',
        connected: true,
        webhookUrl: 'https://local.example/api/v1/webhooks/strava/tok123',
        defaultVisibility: 'private'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/strava',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Accept: 'application/json'
          }
        })
      )
    })

    it('supports passing AbortSignal directly or via options object', async () => {
      fetchMock.mockResponse(
        JSON.stringify({
          configured: false,
          defaultVisibility: 'private'
        }),
        { status: 200 }
      )

      const controller1 = new AbortController()
      await getStravaSettings(controller1.signal)
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        '/api/v1/fitness/strava',
        expect.objectContaining({ signal: controller1.signal })
      )

      const controller2 = new AbortController()
      await getStravaSettings({ signal: controller2.signal })
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/v1/fitness/strava',
        expect.objectContaining({ signal: controller2.signal })
      )
    })

    it('throws server error message on non-ok response', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Session expired' }), {
        status: 401
      })

      await expect(getStravaSettings()).rejects.toThrow('Session expired')
    })

    it('falls back to default error on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Server error', { status: 500 })

      await expect(getStravaSettings()).rejects.toThrow(
        'Failed to load settings'
      )
    })

    it('propagates cancellation / abort errors', async () => {
      const abortError = new Error('The user aborted a request.')
      abortError.name = 'AbortError'
      fetchMock.mockRejectOnce(abortError)

      await expect(getStravaSettings()).rejects.toThrow(
        'The user aborted a request.'
      )
    })
  })

  describe('saveStravaSettings', () => {
    it('posts credentials and visibility, returning authorizeUrl', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          message: 'Strava settings saved successfully',
          authorizeUrl: '/api/v1/fitness/strava/authorize'
        }),
        { status: 200 }
      )

      const result = await saveStravaSettings({
        clientId: '12345',
        clientSecret: 'my-strava-secret',
        defaultVisibility: 'private'
      })

      expect(result).toEqual({
        success: true,
        message: 'Strava settings saved successfully',
        authorizeUrl: '/api/v1/fitness/strava/authorize'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/strava',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: '12345',
            clientSecret: 'my-strava-secret',
            defaultVisibility: 'private'
          })
        })
      )
    })

    it('posts only visibility when updating an already configured integration', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          message: 'Strava import visibility saved successfully'
        }),
        { status: 200 }
      )

      const result = await saveStravaSettings({
        defaultVisibility: 'public'
      })

      expect(result).toEqual({
        success: true,
        message: 'Strava import visibility saved successfully'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/strava',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultVisibility: 'public'
          })
        })
      )
    })

    it('forwards optional signal to save request', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          message: 'Saved'
        }),
        { status: 200 }
      )

      const controller = new AbortController()
      await saveStravaSettings({
        defaultVisibility: 'unlisted',
        signal: controller.signal
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/strava',
        expect.objectContaining({
          signal: controller.signal
        })
      )
    })

    it('throws server error message on validation failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          error: 'Client ID and Client Secret are required'
        }),
        { status: 400 }
      )

      await expect(
        saveStravaSettings({
          clientId: '12345'
        })
      ).rejects.toThrow('Client ID and Client Secret are required')
    })

    it('falls back to default error on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('502 Bad Gateway', { status: 502 })

      await expect(
        saveStravaSettings({
          defaultVisibility: 'private'
        })
      ).rejects.toThrow('Failed to save settings')
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network disconnected'))

      await expect(
        saveStravaSettings({
          defaultVisibility: 'private'
        })
      ).rejects.toThrow('Network disconnected')
    })
  })

  describe('deleteStravaSettings', () => {
    it('sends DELETE request and returns confirmation message', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          message: 'Strava settings removed successfully'
        }),
        { status: 200 }
      )

      const result = await deleteStravaSettings()

      expect(result).toEqual({
        success: true,
        message: 'Strava settings removed successfully'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/strava',
        expect.objectContaining({
          method: 'DELETE'
        })
      )
    })

    it('forwards optional signal to delete request', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          message: 'Strava settings removed successfully'
        }),
        { status: 200 }
      )

      const controller = new AbortController()
      await deleteStravaSettings({ signal: controller.signal })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/strava',
        expect.objectContaining({
          signal: controller.signal
        })
      )
    })

    it('throws server error message on 404 or other failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'No Strava settings to remove' }),
        { status: 404 }
      )

      await expect(deleteStravaSettings()).rejects.toThrow(
        'No Strava settings to remove'
      )
    })

    it('falls back to default error on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('500 Internal Error', { status: 500 })

      await expect(deleteStravaSettings()).rejects.toThrow(
        'Failed to remove settings'
      )
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network timeout'))

      await expect(deleteStravaSettings()).rejects.toThrow('Network timeout')
    })
  })
})

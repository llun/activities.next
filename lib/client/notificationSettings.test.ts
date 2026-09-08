import fetchMock from 'jest-fetch-mock'

import {
  getVapidKey,
  subscribePushNotifications,
  unsubscribePushNotifications,
  updateEmailNotifications,
  updatePushNotifications
} from './notificationSettings'

describe('notificationSettings client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getVapidKey', () => {
    it('fetches vapid public key successfully', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          vapidPublicKey: 'test-vapid-public-key-123'
        }),
        { status: 200 }
      )

      const result = await getVapidKey()
      expect(result).toBe('test-vapid-public-key-123')
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/push/vapid-key')
    })

    it('returns null when response is not ok (e.g. 404)', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Not configured' }), {
        status: 404
      })

      const result = await getVapidKey()
      expect(result).toBeNull()
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/push/vapid-key')
    })

    it('returns null when response is 500 server error', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Server error' }), {
        status: 500
      })

      const result = await getVapidKey()
      expect(result).toBeNull()
    })
  })

  describe('updateEmailNotifications', () => {
    it('posts email notification settings and returns true on success', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ status: 'OK' }), {
        status: 200
      })

      const settings = { follow: true, like: false, mention: true }
      const result = await updateEmailNotifications('actor-123', settings)

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/email-notifications',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actorId: 'actor-123',
            follow: true,
            like: false,
            mention: true
          })
        }
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403
      })

      const result = await updateEmailNotifications('actor-123', {
        follow: true
      })
      expect(result).toBe(false)
    })
  })

  describe('subscribePushNotifications', () => {
    it('posts push subscription details and returns true on success', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ id: 'sub-123' }), {
        status: 200
      })

      const endpoint = 'https://push.example.com/sub/1'
      const keys = { p256dh: 'test-p256dh-key', auth: 'test-auth-secret' }
      const result = await subscribePushNotifications(endpoint, keys)

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, keys })
      })
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Bad request' }), {
        status: 400
      })

      const result = await subscribePushNotifications(
        'https://push.example.com/sub/1',
        { p256dh: 'p256dh', auth: 'auth' }
      )
      expect(result).toBe(false)
    })
  })

  describe('unsubscribePushNotifications', () => {
    it('sends DELETE to push subscribe endpoint and returns true on success', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ status: 'OK' }), {
        status: 200
      })

      const endpoint = 'https://push.example.com/sub/1'
      const result = await unsubscribePushNotifications(endpoint)

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint })
      })
    })

    it('returns false when unsubscribe fails', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Invalid endpoint' }),
        {
          status: 400
        }
      )

      const result = await unsubscribePushNotifications(
        'https://push.example.com/sub/invalid'
      )
      expect(result).toBe(false)
    })
  })

  describe('updatePushNotifications', () => {
    it('posts push notification settings and returns true on success', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ status: 'OK' }), {
        status: 200
      })

      const settings = {
        follow: true,
        like: true,
        mention: false,
        activity_import: true
      }
      const result = await updatePushNotifications('actor-456', settings)

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/push-notifications',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actorId: 'actor-456',
            follow: true,
            like: true,
            mention: false,
            activity_import: true
          })
        }
      )
    })

    it('returns false when update push notifications fails', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Forbidden' }), {
        status: 403
      })

      const result = await updatePushNotifications('actor-456', { like: true })
      expect(result).toBe(false)
    })
  })
})

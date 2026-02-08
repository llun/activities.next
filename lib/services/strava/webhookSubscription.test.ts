import {
  StravaSubscription,
  createSubscription,
  deleteSubscription,
  ensureWebhookSubscription,
  getSubscription
} from './webhookSubscription'

const mockFetch = jest.fn()
global.fetch = mockFetch

describe('webhookSubscription', () => {
  const clientId = '12345'
  const clientSecret = 'secret123'
  const callbackUrl = 'https://example.com/webhook/strava/token123'
  const verifyToken = 'token123'

  beforeEach(() => {
    mockFetch.mockReset()
  })

  describe('getSubscription', () => {
    it('returns subscription when one exists', async () => {
      const subscription: StravaSubscription = {
        id: 1,
        callback_url: callbackUrl,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z'
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([subscription])
      })

      const result = await getSubscription(clientId, clientSecret)

      expect(result).toEqual(subscription)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('push_subscriptions'),
        { method: 'GET' }
      )
    })

    it('returns null when no subscription exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([])
      })

      const result = await getSubscription(clientId, clientSecret)

      expect(result).toBeNull()
    })

    it('throws error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized')
      })

      await expect(getSubscription(clientId, clientSecret)).rejects.toThrow(
        'Failed to get subscription: 401'
      )
    })
  })

  describe('deleteSubscription', () => {
    it('deletes subscription successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204
      })

      await expect(
        deleteSubscription(clientId, clientSecret, 1)
      ).resolves.not.toThrow()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('push_subscriptions/1'),
        { method: 'DELETE' }
      )
    })

    it('throws error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found')
      })

      await expect(
        deleteSubscription(clientId, clientSecret, 999)
      ).rejects.toThrow('Failed to delete subscription: 404')
    })
  })

  describe('createSubscription', () => {
    it('creates subscription and returns id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 42 })
      })

      const result = await createSubscription(
        clientId,
        clientSecret,
        callbackUrl,
        verifyToken
      )

      expect(result).toBe(42)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.strava.com/api/v3/push_subscriptions',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
      )
    })

    it('throws error with message from API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({ message: 'Callback URL validation failed' })
          )
      })

      await expect(
        createSubscription(clientId, clientSecret, callbackUrl, verifyToken)
      ).rejects.toThrow('Callback URL validation failed')
    })

    it('throws generic error when API returns non-JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error')
      })

      await expect(
        createSubscription(clientId, clientSecret, callbackUrl, verifyToken)
      ).rejects.toThrow('Failed to create subscription: 500')
    })
  })

  describe('ensureWebhookSubscription', () => {
    const params = {
      clientId,
      clientSecret,
      callbackUrl,
      verifyToken
    }

    it('returns success when subscription already exists with matching URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 1,
              callback_url: callbackUrl,
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-01T00:00:00Z'
            }
          ])
      })

      const result = await ensureWebhookSubscription(params)

      expect(result).toEqual({ success: true, subscriptionId: 1 })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('creates new subscription when none exists', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([])
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 42 })
        })

      const result = await ensureWebhookSubscription(params)

      expect(result).toEqual({ success: true, subscriptionId: 42 })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('deletes old subscription and creates new when URL differs', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                callback_url: 'https://old.example.com/webhook',
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z'
              }
            ])
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 204
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 99 })
        })

      const result = await ensureWebhookSubscription(params)

      expect(result).toEqual({ success: true, subscriptionId: 99 })
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('returns error when subscription creation fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([])
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: () =>
            Promise.resolve(
              JSON.stringify({ message: 'Callback validation failed' })
            )
        })

      const result = await ensureWebhookSubscription(params)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Callback validation failed')
    })
  })
})

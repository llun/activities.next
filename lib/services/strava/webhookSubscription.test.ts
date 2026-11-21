import { logger } from '@/lib/utils/logger'

import {
  StravaSubscription,
  createSubscription,
  deleteSubscription,
  ensureWebhookSubscription,
  getSubscription,
  redactWebhookCallbackUrl
} from './webhookSubscription'

const mockFetch = vi.fn()
global.fetch = mockFetch

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

const textResponse = (body: string, status: number) =>
  new Response(body, { status })

const emptyResponse = (status: number) => new Response(null, { status })

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
      mockFetch.mockResolvedValueOnce(jsonResponse([subscription]))

      const result = await getSubscription(clientId, clientSecret)

      expect(result).toEqual(subscription)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('push_subscriptions'),
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('returns null when no subscription exists', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]))

      const result = await getSubscription(clientId, clientSecret)

      expect(result).toBeNull()
    })

    it('throws error on API failure', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Unauthorized', 401))

      await expect(getSubscription(clientId, clientSecret)).rejects.toThrow(
        'Failed to get subscription: 401'
      )
    })
  })

  describe('deleteSubscription', () => {
    it('deletes subscription successfully', async () => {
      mockFetch.mockResolvedValueOnce(emptyResponse(204))

      await expect(
        deleteSubscription(clientId, clientSecret, 1)
      ).resolves.not.toThrow()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('push_subscriptions/1'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('throws error on API failure', async () => {
      mockFetch.mockResolvedValueOnce(textResponse('Not found', 404))

      await expect(
        deleteSubscription(clientId, clientSecret, 999)
      ).rejects.toThrow('Failed to delete subscription: 404')
    })
  })

  describe('createSubscription', () => {
    it('creates subscription and returns id', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 42 }))

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
      mockFetch.mockResolvedValueOnce(
        textResponse(
          JSON.stringify({ message: 'Callback URL validation failed' }),
          400
        )
      )

      await expect(
        createSubscription(clientId, clientSecret, callbackUrl, verifyToken)
      ).rejects.toThrow('Callback URL validation failed')
    })

    it('throws generic error when API returns non-JSON response', async () => {
      mockFetch.mockResolvedValueOnce(
        textResponse('Internal server error', 500)
      )

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
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          {
            id: 1,
            callback_url: callbackUrl,
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z'
          }
        ])
      )

      const result = await ensureWebhookSubscription(params)

      expect(result).toEqual({ success: true, subscriptionId: 1 })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('creates new subscription when none exists', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse({ id: 42 }))

      const result = await ensureWebhookSubscription(params)

      expect(result).toEqual({ success: true, subscriptionId: 42 })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('deletes old subscription and creates new when URL differs', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse([
            {
              id: 1,
              callback_url: 'https://old.example.com/webhook',
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-01T00:00:00Z'
            }
          ])
        )
        .mockResolvedValueOnce(emptyResponse(204))
        .mockResolvedValueOnce(jsonResponse({ id: 99 }))

      const result = await ensureWebhookSubscription(params)

      expect(result).toEqual({ success: true, subscriptionId: 99 })
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    // The token in the callback URL is the only credential on the
    // unauthenticated webhook endpoint; anyone reading logs could forge events.
    it('never logs the webhook token from either callback URL', async () => {
      const infoSpy = vi.spyOn(logger, 'info')
      const oldToken = 'old-webhook-token-value'
      const newToken = 'new-webhook-token-value'
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse([
            {
              id: 1,
              callback_url: `https://example.com/api/v1/webhooks/strava/${oldToken}`,
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-01T00:00:00Z'
            }
          ])
        )
        .mockResolvedValueOnce(emptyResponse(204))
        .mockResolvedValueOnce(jsonResponse({ id: 99 }))

      await ensureWebhookSubscription({
        ...params,
        callbackUrl: `https://example.com/api/v1/webhooks/strava/${newToken}`,
        verifyToken: newToken
      })

      expect(infoSpy).toHaveBeenCalled()
      const logged = JSON.stringify(infoSpy.mock.calls)
      expect(logged).not.toContain(oldToken)
      expect(logged).not.toContain(newToken)
      expect(logged).toContain(
        'https://example.com/api/v1/webhooks/strava/REDACTED'
      )
      infoSpy.mockRestore()
    })

    it('returns error when subscription creation fails', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(
          textResponse(
            JSON.stringify({ message: 'Callback validation failed' }),
            400
          )
        )

      const result = await ensureWebhookSubscription(params)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Callback validation failed')
    })
  })

  describe('redactWebhookCallbackUrl', () => {
    it('replaces only the trailing token segment', () => {
      expect(
        redactWebhookCallbackUrl('https://example.com/webhook/strava/token123')
      ).toBe('https://example.com/webhook/strava/REDACTED')
      expect(redactWebhookCallbackUrl('not a url')).toBe('REDACTED')
    })
  })
})

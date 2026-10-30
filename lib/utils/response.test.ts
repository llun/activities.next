import { apiResponse } from './response'

describe('response utilities', () => {
  describe('apiResponse', () => {
    it('preserves explicit content type headers', async () => {
      const response = apiResponse({
        req: new Request('https://example.com') as never,
        allowedMethods: ['GET'],
        data: { ok: true },
        additionalHeaders: [
          ['Content-Type', 'application/jrd+json; charset=utf-8']
        ]
      })

      expect(response.headers.get('content-type')).toBe(
        'application/jrd+json; charset=utf-8'
      )
      expect(await response.json()).toEqual({ ok: true })
    })
  })
})

import {
  DEFAULT_200,
  DEFAULT_202,
  ERROR_400,
  ERROR_401,
  ERROR_403,
  ERROR_404,
  ERROR_422,
  ERROR_500,
  apiResponse,
  codeMap,
  defaultStatusOption,
  statusText
} from './response'

describe('response utilities', () => {
  describe('codeMap', () => {
    it('maps status codes to responses', () => {
      expect(codeMap[200]).toEqual(DEFAULT_200)
      expect(codeMap[202]).toEqual(DEFAULT_202)
      expect(codeMap[400]).toEqual(ERROR_400)
      expect(codeMap[401]).toEqual(ERROR_401)
      expect(codeMap[403]).toEqual(ERROR_403)
      expect(codeMap[404]).toEqual(ERROR_404)
      expect(codeMap[422]).toEqual(ERROR_422)
      expect(codeMap[500]).toEqual(ERROR_500)
    })
  })

  describe('statusText', () => {
    it('returns status text for known codes', () => {
      expect(statusText(200)).toEqual('OK')
      expect(statusText(404)).toEqual('Not Found')
      expect(statusText(500)).toEqual('Internal Server Error')
    })
  })

  describe('defaultStatusOption', () => {
    it('returns object with status and statusText', () => {
      expect(defaultStatusOption(200)).toEqual({
        status: 200,
        statusText: 'OK'
      })
      expect(defaultStatusOption(404)).toEqual({
        status: 404,
        statusText: 'Not Found'
      })
    })
  })

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

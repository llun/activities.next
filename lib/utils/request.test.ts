import { request } from './request'

describe('request utility', () => {
  describe('request', () => {
    it('makes a GET request', async () => {
      // This test uses a mock server setup in jest-fetch-mock
      const response = await request({
        url: 'https://example.com/api/test'
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBeDefined()
    })

    it('makes a POST request with body', async () => {
      const response = await request({
        url: 'https://example.com/api/test',
        method: 'POST',
        body: JSON.stringify({ test: 'data' }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      expect(response).toBeDefined()
    })

    it('uses custom timeout', async () => {
      const response = await request({
        url: 'https://example.com/api/test',
        responseTimeout: 5000
      })

      expect(response).toBeDefined()
    })

    it('uses custom retry count', async () => {
      const response = await request({
        url: 'https://example.com/api/test',
        numberOfRetry: 0
      })

      expect(response).toBeDefined()
    })
  })
})

import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { externalRequest, request } from './request'

enableFetchMocks()

describe('request utility', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('request', () => {
    it('makes a GET request', async () => {
      // Mock the fetch response
      fetchMock.mockResponseOnce(JSON.stringify({ data: 'test' }), {
        status: 200
      })

      const response = await request({
        url: 'https://example.com/api/test'
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBeDefined()
      expect(response.statusCode).toBe(200)
    })

    it('makes a POST request with body', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200
      })

      const response = await request({
        url: 'https://example.com/api/test',
        method: 'POST',
        body: JSON.stringify({ test: 'data' }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(200)
    })

    it('uses custom timeout', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ data: 'timeout test' }), {
        status: 200
      })

      const response = await request({
        url: 'https://example.com/api/test',
        responseTimeout: 5000
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(200)
    })

    it('uses custom retry count', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ data: 'retry test' }), {
        status: 200
      })

      const response = await request({
        url: 'https://example.com/api/test',
        numberOfRetry: 0
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(200)
    })

    it('verifies that fetch mocks are used (no real network calls)', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ verified: true }), {
        status: 200
      })

      await request({
        url: 'https://example.com/api/test'
      })

      // Verify that fetch was called (proving the mock is active)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/test',
        expect.objectContaining({
          method: 'GET'
        })
      )
    })
  })

  describe('externalRequest', () => {
    it('makes a GET request without ActivityPub headers', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ data: 'external' }), {
        status: 200
      })

      const response = await externalRequest({
        url: 'https://api.strava.com/activities/123'
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.strava.com/activities/123',
        expect.objectContaining({
          method: 'GET'
        })
      )
    })

    it('makes a POST request with custom headers', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 201
      })

      const response = await externalRequest({
        url: 'https://api.strava.com/webhooks',
        method: 'POST',
        body: JSON.stringify({ client_id: '123' }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token123'
        }
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(201)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.strava.com/webhooks',
        expect.objectContaining({
          method: 'POST'
        })
      )
    })

    it('uses custom timeout', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ data: 'timeout test' }), {
        status: 200
      })

      const response = await externalRequest({
        url: 'https://api.strava.com/activities',
        responseTimeout: 5000
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(200)
    })

    it('uses custom retry count', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ data: 'retry test' }), {
        status: 200
      })

      const response = await externalRequest({
        url: 'https://api.strava.com/activities',
        numberOfRetry: 0
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(200)
    })

    it('makes DELETE request', async () => {
      fetchMock.mockResponseOnce('', {
        status: 204
      })

      const response = await externalRequest({
        url: 'https://api.strava.com/webhooks/123',
        method: 'DELETE'
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(204)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.strava.com/webhooks/123',
        expect.objectContaining({
          method: 'DELETE'
        })
      )
    })
  })
})

import { describe, expect, it } from 'vitest'

import { ApiRequestError, parseApiError, throwApiError } from './http'

describe('http client utilities', () => {
  describe('ApiRequestError', () => {
    it('creates an error with name and status', () => {
      const error = new ApiRequestError('Not found', 404)
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(ApiRequestError)
      expect(error.name).toBe('ApiRequestError')
      expect(error.message).toBe('Not found')
      expect(error.status).toBe(404)
    })
  })

  describe('throwApiError', () => {
    it('throws with the server error message if present in JSON', async () => {
      const response = new Response(
        JSON.stringify({ error: 'Text character limit of 100 exceeded' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )

      await expect(throwApiError(response, 'Default failure')).rejects.toThrow(
        'Text character limit of 100 exceeded'
      )
    })

    it('throws with fallback message if JSON has no error string', async () => {
      const response = new Response(JSON.stringify({ other: 123 }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })

      await expect(throwApiError(response, 'Default failure')).rejects.toThrow(
        'Default failure'
      )
    })

    it('throws with fallback message if body is not JSON', async () => {
      const response = new Response('Non-JSON HTML error page', {
        status: 502
      })

      await expect(throwApiError(response, 'Default failure')).rejects.toThrow(
        'Default failure'
      )
    })
  })

  describe('parseApiError', () => {
    it('returns parsed status field if present in JSON error', async () => {
      const response = new Response(
        JSON.stringify({ status: 'Invalid request' }),
        { status: 400 }
      )
      expect(await parseApiError(response, 'Fallback')).toBe('Invalid request')
    })

    it('returns parsed message field if present in JSON error', async () => {
      const response = new Response(
        JSON.stringify({ message: 'Item already exists' }),
        { status: 409 }
      )
      expect(await parseApiError(response, 'Fallback')).toBe(
        'Item already exists'
      )
    })

    it('returns parsed error field if present in JSON error', async () => {
      const response = new Response(
        JSON.stringify({ error: 'Record not found' }),
        { status: 404 }
      )
      expect(await parseApiError(response, 'Fallback')).toBe('Record not found')
    })

    it('returns raw text if body is not JSON', async () => {
      const response = new Response('500 Internal Server Error', {
        status: 500
      })
      expect(await parseApiError(response, 'Fallback')).toBe(
        '500 Internal Server Error'
      )
    })

    it('returns statusText or fallback if body is empty', async () => {
      const response = new Response('', {
        status: 404,
        statusText: 'Not Found'
      })
      expect(await parseApiError(response, 'Fallback')).toBe('Not Found')

      const responseNoStatusText = new Response('', {
        status: 500,
        statusText: ''
      })
      expect(await parseApiError(responseNoStatusText, 'Fallback')).toBe(
        'Fallback'
      )
    })
  })
})

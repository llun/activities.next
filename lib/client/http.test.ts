import { describe, expect, it } from 'vitest'

import {
  ApiRequestError,
  SESSION_EXPIRED_NOTICE,
  classifyFailedPost,
  isSessionExpiredError,
  parseApiError,
  throwApiError
} from './http'

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

  describe('classifyFailedPost', () => {
    const classify = (error: unknown, retryingLocked: boolean) =>
      classifyFailedPost(error, { retryingLocked, fallbackMessage: 'Failed' })

    it.each([503, 409])('locks a kept post (%i)', (status) => {
      expect(classify(new ApiRequestError('no', status), false).action).toBe(
        'lock'
      )
    })

    it('unlocks a locked retry only on 410, with the server message', () => {
      expect(classify(new ApiRequestError('Deleted', 410), true)).toEqual({
        action: 'unlock',
        message: 'Deleted'
      })
    })

    it.each([400, 404, 408, 422, 429, 500])(
      'keeps the lock on a locked retry that fails with %i, with the server message',
      (status) => {
        expect(classify(new ApiRequestError('Busy', status), true)).toEqual({
          action: 'lock',
          message: 'Busy'
        })
      }
    )

    it('keeps the lock on a locked retry that fails offline', () => {
      expect(classify(new Error('offline'), true)).toEqual({
        action: 'lock',
        message: 'offline'
      })
    })

    it.each([401, 403])(
      'keeps the lock and asks to sign in again on a locked %i',
      (status) => {
        expect(classify(new ApiRequestError('no', status), true)).toEqual({
          action: 'lock',
          message: SESSION_EXPIRED_NOTICE
        })
      }
    )

    it.each([400, 401, 410, 422])(
      'leaves an unlocked draft alone on %i',
      (status) => {
        expect(classify(new ApiRequestError('no', status), false)).toEqual({
          action: 'none',
          message: 'no'
        })
      }
    )

    it('does not lock an edit, where nothing is kept', () => {
      expect(
        classifyFailedPost(new ApiRequestError('no', 503), {
          retryingLocked: false,
          fallbackMessage: 'Failed',
          kept: false
        })
      ).toEqual({ action: 'none', message: 'no' })
    })
  })

  describe('isSessionExpiredError', () => {
    it.each([401, 403])('is true for a %i', (status) => {
      expect(isSessionExpiredError(new ApiRequestError('no', status))).toBe(
        true
      )
    })

    it.each([400, 410, 422, 500])('is false for a %i', (status) => {
      expect(isSessionExpiredError(new ApiRequestError('no', status))).toBe(
        false
      )
    })

    it('is false for a network error', () => {
      expect(isSessionExpiredError(new Error('offline'))).toBe(false)
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

    it('exposes the HTTP status on the thrown error', async () => {
      const response = new Response(JSON.stringify({ error: 'Busy' }), {
        status: 409
      })

      await expect(
        throwApiError(response, 'Default failure')
      ).rejects.toMatchObject({
        name: 'ApiRequestError',
        status: 409
      })
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

import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  cancelWahooHistory,
  deleteWahooSettings,
  getWahooFailedImports,
  getWahooHistory,
  getWahooSettings,
  retryWahooFailedImport,
  retryWahooHistory,
  saveWahooSettings,
  startWahooHistory
} from './wahoo'

describe('wahoo client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('readers', () => {
    it.each([
      ['getWahooSettings', getWahooSettings, '/api/v1/fitness/wahoo'],
      ['getWahooHistory', getWahooHistory, '/api/v1/fitness/wahoo/history'],
      [
        'getWahooFailedImports',
        getWahooFailedImports,
        '/api/v1/fitness/wahoo/imports'
      ]
    ])(
      '%s requests JSON, forwards the abort signal and returns the body',
      async (_, read, url) => {
        fetchMock.mockResponseOnce(JSON.stringify({ marker: 1 }))
        const controller = new AbortController()

        const result = await read(controller.signal)

        expect(result).toEqual({ marker: 1 })
        expect(fetchMock).toHaveBeenCalledWith(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal
        })
      }
    )

    it.each([
      ['getWahooSettings', getWahooSettings],
      ['getWahooHistory', getWahooHistory],
      ['getWahooFailedImports', getWahooFailedImports]
    ])('%s surfaces the server error message', async (_, read) => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Session expired' }), {
        status: 401
      })

      await expect(read()).rejects.toThrow('Session expired')
    })

    it.each([
      ['getWahooSettings', getWahooSettings, 'Failed to load Wahoo settings'],
      ['getWahooHistory', getWahooHistory, 'Failed to load import status'],
      [
        'getWahooFailedImports',
        getWahooFailedImports,
        'Failed to load Wahoo import errors'
      ]
    ])(
      '%s falls back to a readable message when the failure has no JSON body',
      async (_, read, fallback) => {
        fetchMock.mockResponseOnce('Bad gateway', { status: 502 })

        await expect(read()).rejects.toThrow(fallback)
      }
    )
  })

  describe('saveWahooSettings', () => {
    it('posts the settings as JSON and returns the result', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }))
      const settings = {
        clientId: 'client',
        clientSecret: 'secret',
        webhookToken: 'webhook-token',
        environment: 'production' as const,
        defaultVisibility: 'unlisted' as const
      }

      const result = await saveWahooSettings(settings)

      expect(result).toEqual({ success: true })
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fitness/wahoo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })
    })

    it('surfaces the server’s reason, such as a duplicate webhook binding', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          error: 'This Wahoo account and webhook token are already connected'
        }),
        { status: 409 }
      )

      await expect(saveWahooSettings({ clientId: 'x' })).rejects.toThrow(
        'This Wahoo account and webhook token are already connected'
      )
    })
  })

  describe('writers', () => {
    it.each([
      [
        'deleteWahooSettings',
        () => deleteWahooSettings(),
        '/api/v1/fitness/wahoo',
        { method: 'DELETE' },
        'Failed to disconnect Wahoo'
      ],
      [
        'startWahooHistory',
        () => startWahooHistory('2025-01-01', '2025-02-01'),
        '/api/v1/fitness/wahoo/history',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromDate: '2025-01-01', toDate: '2025-02-01' })
        },
        'Failed to start history import'
      ],
      [
        'cancelWahooHistory',
        () => cancelWahooHistory(),
        '/api/v1/fitness/wahoo/history',
        { method: 'DELETE' },
        'Failed to cancel history import'
      ],
      [
        'retryWahooHistory',
        () => retryWahooHistory(),
        '/api/v1/fitness/wahoo/history',
        { method: 'PATCH' },
        'Failed to retry history import'
      ],
      [
        'retryWahooFailedImport',
        () => retryWahooFailedImport('import-1'),
        '/api/v1/fitness/wahoo/imports',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ importId: 'import-1' })
        },
        'Failed to retry Wahoo workout'
      ]
    ])(
      '%s sends the request and resolves on success',
      async (_, run, url, init) => {
        fetchMock.mockResponseOnce(JSON.stringify({ success: true }))

        await expect(run()).resolves.toBeUndefined()

        expect(fetchMock).toHaveBeenCalledWith(url, init)
      }
    )

    it.each([
      [
        'deleteWahooSettings',
        () => deleteWahooSettings(),
        'Failed to disconnect Wahoo'
      ],
      [
        'startWahooHistory',
        () => startWahooHistory('2025-01-01', '2025-02-01'),
        'Failed to start history import'
      ],
      [
        'cancelWahooHistory',
        () => cancelWahooHistory(),
        'Failed to cancel history import'
      ],
      [
        'retryWahooHistory',
        () => retryWahooHistory(),
        'Failed to retry history import'
      ],
      [
        'retryWahooFailedImport',
        () => retryWahooFailedImport('import-1'),
        'Failed to retry Wahoo workout'
      ]
    ])(
      '%s rejects with a readable message when the server fails without a body',
      async (_, run, fallback) => {
        fetchMock.mockResponseOnce('', { status: 500 })

        await expect(run()).rejects.toThrow(fallback)
      }
    )

    it('rejects with the server message when a retry is refused', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Conflict' }), {
        status: 409
      })

      await expect(retryWahooFailedImport('import-1')).rejects.toThrow(
        'Conflict'
      )
    })

    it('propagates a network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Failed to fetch'))

      await expect(cancelWahooHistory()).rejects.toThrow('Failed to fetch')
    })
  })
})

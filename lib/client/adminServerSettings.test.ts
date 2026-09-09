import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ResolvedServerSettings } from '@/lib/config/serverSettings'

import {
  type AdminServerSettingsResponse,
  getAdminServerSettings,
  updateAdminServerSettings
} from './adminServerSettings'

describe('adminServerSettings client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  const mockResponse: AdminServerSettingsResponse = {
    settings: {
      serverTitle: 'My ActivityPub Server',
      serverDescription: 'A test server'
    } as unknown as ResolvedServerSettings,
    locks: {
      serverTitle: { locked: false }
    }
  }

  describe('getAdminServerSettings', () => {
    it('fetches server settings successfully', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockResponse), { status: 200 })

      const result = await getAdminServerSettings()

      expect(result).toEqual(mockResponse)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/server_settings', {
        headers: { Accept: 'application/json' }
      })
    })

    it('throws error when response is not ok', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(getAdminServerSettings()).rejects.toThrow(
        'Failed to load server settings'
      )
    })
  })

  describe('updateAdminServerSettings', () => {
    it('updates server settings with PATCH', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockResponse), { status: 200 })

      const patch = { serverTitle: 'Updated Server' }
      const result = await updateAdminServerSettings(patch)

      expect(result).toEqual(mockResponse)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/server_settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })
    })

    it('throws custom error message from server', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Server title is locked by env' }),
        { status: 422 }
      )

      await expect(
        updateAdminServerSettings({ serverTitle: 'Blocked' })
      ).rejects.toThrow('Server title is locked by env')
    })

    it('throws default error message when server error has no json error payload', async () => {
      fetchMock.mockResponseOnce('Non-JSON error', { status: 500 })

      await expect(
        updateAdminServerSettings({ serverTitle: 'Blocked' })
      ).rejects.toThrow('Failed to save server settings')
    })
  })
})

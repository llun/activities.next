import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Passkey, getPasskeys } from './passkeys'

describe('passkeys client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  const mockPasskey: Passkey = {
    id: 'passkey-1',
    name: 'My MacBook',
    domain: 'example.com',
    deviceType: 'singleDevice',
    backedUp: false,
    createdAt: '2026-01-01T00:00:00Z',
    aaguid: null
  }

  describe('getPasskeys', () => {
    it('fetches and returns passkeys array', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([mockPasskey]), { status: 200 })

      const result = await getPasskeys()

      expect(result).toEqual([mockPasskey])
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/passkeys', {
        method: 'GET',
        credentials: 'include'
      })
    })

    it('returns empty array when response payload is not an array', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ notAnArray: true }), {
        status: 200
      })

      const result = await getPasskeys()

      expect(result).toEqual([])
    })

    it('throws error when response is not ok', async () => {
      fetchMock.mockResponseOnce('Unauthorized', { status: 401 })

      await expect(getPasskeys()).rejects.toThrow('Failed to load passkeys')
    })
  })
})

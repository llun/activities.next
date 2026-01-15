import { NextRequest, NextResponse } from 'next/server'

import { ACTIVITIES_SHARED_KEY } from '../../constants'
import { AppRouterSharedKeyGuard } from './AppRouterSharedKeyGuard'

const mockGetConfig = jest.fn()
jest.mock('../../config', () => ({
  getConfig: () => mockGetConfig()
}))

describe('AppRouterSharedKeyGuard', () => {
  const createRequest = (sharedKey?: string) => {
    const headers: Record<string, string> = {}
    if (sharedKey) {
      headers[ACTIVITIES_SHARED_KEY] = sharedKey
    }
    return new NextRequest('https://llun.test/api/internal', {
      method: 'POST',
      headers
    })
  }

  const mockHandler = jest.fn().mockImplementation(() => {
    return NextResponse.json({ success: true }, { status: 200 })
  })

  beforeEach(() => {
    mockHandler.mockClear()
    mockGetConfig.mockReset()
  })

  describe('with valid shared key', () => {
    it('calls handler when key matches', async () => {
      mockGetConfig.mockReturnValue({
        internalApi: { sharedKey: 'valid-shared-key' }
      })

      const guard = AppRouterSharedKeyGuard(mockHandler)
      const req = createRequest('valid-shared-key')
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(mockHandler).toHaveBeenCalled()
    })
  })

  describe('with invalid shared key', () => {
    it('returns 403 when key does not match', async () => {
      mockGetConfig.mockReturnValue({
        internalApi: { sharedKey: 'valid-shared-key' }
      })

      const guard = AppRouterSharedKeyGuard(mockHandler)
      const req = createRequest('wrong-key')
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(403)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    it('returns 403 when no key provided', async () => {
      mockGetConfig.mockReturnValue({
        internalApi: { sharedKey: 'valid-shared-key' }
      })

      const guard = AppRouterSharedKeyGuard(mockHandler)
      const req = createRequest()
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(403)
      expect(mockHandler).not.toHaveBeenCalled()
    })
  })

  describe('without shared key config', () => {
    it('returns 403 when shared key not configured', async () => {
      mockGetConfig.mockReturnValue({})

      const guard = AppRouterSharedKeyGuard(mockHandler)
      const req = createRequest('any-key')
      const response = await guard(req, { params: Promise.resolve({}) })

      expect(response.status).toBe(403)
      expect(mockHandler).not.toHaveBeenCalled()
    })
  })
})

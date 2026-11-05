import { NextRequest } from 'next/server'

import { resetTrustProxyIpHeadersConfigCacheForTests } from '@/lib/config/trustProxyIpHeaders'
import { Database } from '@/lib/database/types'
import {
  PASSWORD_RESET_LIMIT,
  resetRouteRateLimitsForTests
} from '@/lib/services/auth/routeRateLimits'

import { POST } from './route'

const mockBcryptHash = vi.fn()
vi.mock('bcrypt', () => ({
  __esModule: true,
  default: {
    hash: (...args: unknown[]) => mockBcryptHash(...args)
  }
}))

type MockDatabase = Pick<
  Database,
  'validatePasswordResetCode' | 'resetPasswordWithCode'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('POST /api/v1/accounts/password/reset', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    validatePasswordResetCode: vi.fn(),
    resetPasswordWithCode: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetRouteRateLimitsForTests()
    mockBcryptHash.mockResolvedValue('new-password-hash')
    mockDb.validatePasswordResetCode.mockResolvedValue('account-1')
    mockDb.resetPasswordWithCode.mockResolvedValue({
      id: 'account-1',
      email: 'test@llun.test',
      twoFactorEnabled: false,
      emailVerified: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  })

  afterEach(() => {
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    resetTrustProxyIpHeadersConfigCacheForTests()
    resetRouteRateLimitsForTests()
  })

  it('answers 429 past 5 requests per trusted client IP while another IP passes', async () => {
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = 'true'
    resetTrustProxyIpHeadersConfigCacheForTests()

    const call = (ip: string) =>
      POST(
        new NextRequest('http://llun.test/api/v1/accounts/password/reset', {
          method: 'POST',
          body: JSON.stringify({
            code: 'valid-code-123',
            newPassword: 'new-password-123'
          }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://client.llun.test',
            'x-forwarded-for': ip
          }
        }),
        { params: Promise.resolve({}) }
      )

    for (let i = 0; i < PASSWORD_RESET_LIMIT; i += 1) {
      expect((await call('198.51.100.30')).status).toBe(200)
    }

    const limited = await call('198.51.100.30')
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: 'Too many requests' })
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(limited.headers.get('access-control-allow-origin')).toBe(
      'https://client.llun.test'
    )
    expect(mockDb.validatePasswordResetCode).toHaveBeenCalledTimes(
      PASSWORD_RESET_LIMIT
    )

    expect((await call('198.51.100.31')).status).toBe(200)
  })

  it('returns a CORS-aware bad request response for malformed JSON bodies', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/password/reset',
      {
        method: 'POST',
        body: '{',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://client.llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Bad Request' })
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://client.llun.test'
    )
    expect(mockDb.validatePasswordResetCode).not.toHaveBeenCalled()
    expect(mockDb.resetPasswordWithCode).not.toHaveBeenCalled()
  })

  it('resets password successfully with valid code and password', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/password/reset',
      {
        method: 'POST',
        body: JSON.stringify({
          code: 'valid-code-123',
          newPassword: 'new-password-123'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://client.llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      message: 'Password reset successfully'
    })
    expect(mockDb.validatePasswordResetCode).toHaveBeenCalledTimes(1)
    expect(mockBcryptHash).toHaveBeenCalledWith('new-password-123', 10)
    expect(mockDb.resetPasswordWithCode).toHaveBeenCalledWith({
      accountId: 'account-1',
      passwordResetCode: expect.any(String),
      newPasswordHash: 'new-password-hash'
    })
  })

  it('returns 400 when reset code is invalid or expired', async () => {
    mockDb.validatePasswordResetCode.mockResolvedValueOnce(null)

    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/password/reset',
      {
        method: 'POST',
        body: JSON.stringify({
          code: 'invalid-or-expired-code',
          newPassword: 'new-password-123'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://client.llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Invalid or expired reset code' })
    expect(mockBcryptHash).not.toHaveBeenCalled()
    expect(mockDb.resetPasswordWithCode).not.toHaveBeenCalled()
  })

  it('returns 400 when resetPasswordWithCode fails', async () => {
    mockDb.resetPasswordWithCode.mockResolvedValueOnce(null)

    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/password/reset',
      {
        method: 'POST',
        body: JSON.stringify({
          code: 'valid-code',
          newPassword: 'new-password-123'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://client.llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Invalid or expired reset code' })
  })

  it('returns 422 when password is less than 8 characters', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/password/reset',
      {
        method: 'POST',
        body: JSON.stringify({
          code: 'valid-code',
          newPassword: 'short'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://client.llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(422)
    expect(mockDb.validatePasswordResetCode).not.toHaveBeenCalled()
  })
})

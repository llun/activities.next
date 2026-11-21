import { NextRequest } from 'next/server'

import { createInMemoryRateLimitDatabase } from '@/lib/database/testing/inMemoryRateLimit'
import { hashPasswordResetCode } from '@/lib/services/auth/passwordResetCode'
import { resetRouteRateLimitsForTests } from '@/lib/services/auth/routeRateLimits'

import { POST } from './route'

// A code in the shape the app mails: 32 random bytes as base64url.
const VALID_CODE = 'a'.repeat(43)

const mockVerifyEmailChange = vi.fn()

type MockDatabase = ReturnType<typeof createInMemoryRateLimitDatabase> & {
  verifyEmailChange: typeof mockVerifyEmailChange
}
const buildMockDatabase = (): MockDatabase => ({
  ...createInMemoryRateLimitDatabase(),
  verifyEmailChange: mockVerifyEmailChange
})
let mockDatabase: MockDatabase | null = buildMockDatabase()

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const createRequest = (
  fields: Record<string, string>,
  origin: string | null = 'https://llun.test'
) => {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value)
  }
  return new NextRequest(
    'https://llun.test/api/v1/accounts/email/verify/confirm',
    {
      method: 'POST',
      headers: origin ? { origin } : {},
      body: form
    }
  )
}

// The native form posts `application/x-www-form-urlencoded`.
const createUrlEncodedRequest = (
  fields: Record<string, string>,
  origin: string | null = 'https://llun.test'
) =>
  new NextRequest('https://llun.test/api/v1/accounts/email/verify/confirm', {
    method: 'POST',
    headers: {
      ...(origin ? { origin } : {}),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(fields).toString()
  })

const post = (fields: Record<string, string>, origin?: string | null) =>
  POST(createRequest(fields, origin), { params: Promise.resolve({}) })

describe('POST /api/v1/accounts/email/verify/confirm', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetRouteRateLimitsForTests()
    mockDatabase = buildMockDatabase()
    mockVerifyEmailChange.mockResolvedValue({ email: 'new@llun.test' })
  })

  it('rejects a request without same-origin proof', async () => {
    const response = await post({ code: VALID_CODE }, null)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockVerifyEmailChange).not.toHaveBeenCalled()
  })

  it('applies the change and redirects to the verified state', async () => {
    const response = await post({ code: VALID_CODE })

    expect(response.status).toBe(303)
    // Root-relative: the browser resolves it against the host it reached.
    expect(response.headers.get('location')).toBe(
      '/account/verify-email?status=verified'
    )
    expect(mockVerifyEmailChange).toHaveBeenCalledWith({
      emailChangeCode: hashPasswordResetCode(VALID_CODE)
    })
  })

  it('accepts the urlencoded body the native form sends', async () => {
    const response = await POST(createUrlEncodedRequest({ code: VALID_CODE }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      '/account/verify-email?status=verified'
    )
    expect(mockVerifyEmailChange).toHaveBeenCalledWith({
      emailChangeCode: hashPasswordResetCode(VALID_CODE)
    })
  })

  it('redirects to the invalid state when the code does not match', async () => {
    mockVerifyEmailChange.mockResolvedValue(null)

    const response = await post({ code: VALID_CODE })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      '/account/verify-email?status=invalid'
    )
  })

  it('redirects to the invalid state when the form carries no code', async () => {
    const response = await post({})

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      '/account/verify-email?status=invalid'
    )
    expect(mockVerifyEmailChange).not.toHaveBeenCalled()
  })

  it('rejects a malformed code before any database call', async () => {
    const response = await post({ code: 'not-a-real-code' })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      '/account/verify-email?status=invalid'
    )
    expect(mockVerifyEmailChange).not.toHaveBeenCalled()
  })

  it('answers 500 when the database is unavailable', async () => {
    mockDatabase = null

    const response = await post({ code: VALID_CODE })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Internal Server Error'
    })
  })
})

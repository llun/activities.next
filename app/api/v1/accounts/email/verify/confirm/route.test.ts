import { NextRequest } from 'next/server'

import { hashPasswordResetCode } from '@/lib/services/auth/passwordResetCode'

import { POST } from './route'

const mockVerifyEmailChange = vi.fn()

vi.mock('@/lib/database', () => ({
  getDatabase: () => ({ verifyEmailChange: mockVerifyEmailChange })
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

const post = (fields: Record<string, string>, origin?: string | null) =>
  POST(createRequest(fields, origin), { params: Promise.resolve({}) })

describe('POST /api/v1/accounts/email/verify/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyEmailChange.mockResolvedValue({ email: 'new@llun.test' })
  })

  it('rejects a request without same-origin proof', async () => {
    const response = await post({ code: 'good-code' }, null)

    expect(response.status).toBe(403)
    expect(mockVerifyEmailChange).not.toHaveBeenCalled()
  })

  it('applies the change and redirects to the verified state', async () => {
    const response = await post({ code: 'good-code' })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'https://llun.test/account/verify-email?status=verified'
    )
    expect(mockVerifyEmailChange).toHaveBeenCalledWith({
      emailChangeCode: hashPasswordResetCode('good-code')
    })
  })

  it('redirects to the invalid state when the code does not match', async () => {
    mockVerifyEmailChange.mockResolvedValue(null)

    const response = await post({ code: 'stale-code' })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'https://llun.test/account/verify-email?status=invalid'
    )
  })

  it('redirects to the invalid state when the form carries no code', async () => {
    const response = await post({})

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'https://llun.test/account/verify-email?status=invalid'
    )
    expect(mockVerifyEmailChange).not.toHaveBeenCalled()
  })
})

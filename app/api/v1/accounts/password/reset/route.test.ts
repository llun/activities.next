import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'

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
    mockBcryptHash.mockResolvedValue('new-password-hash')
    mockDb.validatePasswordResetCode.mockResolvedValue('account-1')
    mockDb.resetPasswordWithCode.mockResolvedValue({
      id: 'account-1'
    })
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
    expect(data).toEqual({ status: 'Bad Request' })
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://client.llun.test'
    )
    expect(mockDb.validatePasswordResetCode).not.toHaveBeenCalled()
    expect(mockDb.resetPasswordWithCode).not.toHaveBeenCalled()
  })
})

import { NextRequest } from 'next/server'

import { GET } from './route'

const mockDatabase = {
  getActorFromId: vi.fn(),
  getAttachmentsForActor: vi.fn()
}

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('GET /api/v1/accounts/:id/media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getActorFromId.mockResolvedValue({
      id: 'https://llun.test/users/llun'
    })
  })

  it('returns 422 when media query parameters fail schema validation', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v1/accounts/llun.test:users:llun/media?limit=0',
      { method: 'GET' }
    )

    const response = await GET(request, {
      params: Promise.resolve({ id: 'llun.test:users:llun' })
    })
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.status).toBe('Unprocessable entity')
    expect(mockDatabase.getAttachmentsForActor).not.toHaveBeenCalled()
  })
})

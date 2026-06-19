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

  it('clamps an out-of-range limit instead of rejecting the request', async () => {
    mockDatabase.getAttachmentsForActor.mockResolvedValue([])
    const request = new NextRequest(
      'https://llun.test/api/v1/accounts/llun.test:users:llun/media?limit=0',
      { method: 'GET' }
    )

    const response = await GET(request, {
      params: Promise.resolve({ id: 'llun.test:users:llun' })
    })

    expect(response.status).toBe(200)
    expect(mockDatabase.getAttachmentsForActor).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 })
    )
  })
})

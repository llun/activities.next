import { NextRequest } from 'next/server'

import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockDatabase = {}
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn(() => ({
    id: ACTOR1_ID,
    account: { id: 'account-1' }
  }))
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn(async () => ({
    posts: { maxCharacters: 500 }
  }))
}))

const mockSaveFitnessFile = vi.fn()
vi.mock('@/lib/services/fitness-files', () => ({
  saveFitnessFile: (...args: unknown[]) => mockSaveFitnessFile(...args)
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: []
  })
}))

const upload = (description?: string) => {
  const form = new FormData()
  form.set(
    'file',
    new File(['<gpx></gpx>'], 'ride.gpx', { type: 'application/gpx+xml' })
  )
  if (description !== undefined) form.set('description', description)
  return new NextRequest('https://llun.test/api/v1/fitness-files', {
    method: 'POST',
    headers: { Origin: 'https://llun.test' },
    body: form
  })
}

describe('POST /api/v1/fitness-files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockSaveFitnessFile.mockResolvedValue({ id: 'fitness-1' })
  })

  it('stores a description within the instance post length', async () => {
    const response = await POST(upload('a'.repeat(500)), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      mockDatabase,
      expect.anything(),
      expect.objectContaining({ description: 'a'.repeat(500) })
    )
  })

  it('rejects an over-long description with 400 and saves nothing', async () => {
    const response = await POST(upload('a'.repeat(501)), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(400)
    expect(mockSaveFitnessFile).not.toHaveBeenCalled()
  })

  it('still accepts an upload with no description', async () => {
    const response = await POST(upload(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockSaveFitnessFile).toHaveBeenCalledWith(
      mockDatabase,
      expect.anything(),
      expect.objectContaining({ description: undefined })
    )
  })
})

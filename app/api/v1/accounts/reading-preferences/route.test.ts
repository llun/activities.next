import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: []
  })
}))

type MockDatabase = Pick<
  Database,
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'getActorFromId'
  | 'getActorSettings'
  | 'updateActor'
>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

const actor = { ...seedActor1, id: ACTOR1_ID }

const buildRequest = (body: string) =>
  new NextRequest('http://localhost/api/v1/accounts/reading-preferences', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://llun.test'
    }
  })

describe('POST /api/v1/accounts/reading-preferences', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: jest.fn(),
    getActorsForAccount: jest.fn(),
    getActorFromId: jest.fn(),
    getActorSettings: jest.fn(),
    updateActor: jest.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockDb.getAccountFromEmail.mockResolvedValue({
      id: 'account1',
      email: seedActor1.email,
      defaultActorId: ACTOR1_ID
    })
    mockDb.getActorsForAccount.mockResolvedValue([actor])
    mockDb.getActorFromId.mockResolvedValue(actor)
    mockDb.getActorSettings.mockResolvedValue(null)
    mockDb.updateActor.mockResolvedValue(undefined as never)
  })

  it('returns 400 for invalid JSON body', async () => {
    const res = await POST(buildRequest('not-json'), {
      params: Promise.resolve({})
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for body failing schema validation', async () => {
    const res = await POST(
      buildRequest(JSON.stringify({ readingExpandMedia: 'sometimes' })),
      { params: Promise.resolve({}) }
    )
    expect(res.status).toBe(400)
  })

  it('persists reading preferences for the current actor', async () => {
    const res = await POST(
      buildRequest(
        JSON.stringify({
          readingExpandMedia: 'show_all',
          readingExpandSpoilers: true,
          readingAutoplayGifs: false
        })
      ),
      { params: Promise.resolve({}) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('OK')
    expect(mockDb.updateActor).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      readingExpandMedia: 'show_all',
      readingExpandSpoilers: true,
      readingAutoplayGifs: false
    })
  })

  it('accepts a partial update', async () => {
    const res = await POST(
      buildRequest(JSON.stringify({ readingAutoplayGifs: true })),
      { params: Promise.resolve({}) }
    )
    expect(res.status).toBe(200)
    expect(mockDb.updateActor).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      readingAutoplayGifs: true
    })
  })
})

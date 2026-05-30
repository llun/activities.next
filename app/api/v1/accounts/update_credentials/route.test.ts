import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { PATCH } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('PATCH /api/v1/accounts/update_credentials', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const createRequest = (form: FormData) => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: { origin: 'https://llun.test' }
      }
    )
    // jest / undici cannot materialise a multipart body from a FormData object
    // passed to NextRequest — mock formData() directly, matching the pattern
    // used in app/api/v1/statuses/route.test.ts.
    Object.defineProperty(req, 'formData', {
      value: jest.fn().mockResolvedValue(form)
    })
    return req
  }

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const form = new FormData()
    form.set('display_name', 'Nope')
    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(401)
  })

  it('updates display name and note and returns the credential account', async () => {
    const updateActor = jest.spyOn(database, 'updateActor')
    const form = new FormData()
    form.set('display_name', 'New Name')
    form.set('note', 'New bio')
    form.set('locked', 'true')

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR1_ID,
        name: 'New Name',
        summary: 'New bio',
        manuallyApprovesFollowers: true
      })
    )
    const data = await response.json()
    expect(data).toEqual(expect.objectContaining({ id: expect.any(String) }))
    updateActor.mockRestore()
  })

  it('accepts a request with no recognized fields without error', async () => {
    const response = await PATCH(createRequest(new FormData()), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
  })

  it('accepts avatar file part and ignores it, updating only text fields', async () => {
    const updateActor = jest.spyOn(database, 'updateActor')
    const form = new FormData()
    form.set('display_name', 'With Avatar')
    form.set(
      'avatar',
      new Blob(['fake-image'], { type: 'image/png' }),
      'avatar.png'
    )

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'With Avatar' })
    )
    expect(updateActor).toHaveBeenCalledWith(
      expect.not.objectContaining({
        iconUrl: expect.anything(),
        headerImageUrl: expect.anything()
      })
    )
    updateActor.mockRestore()
  })

  it('unlocks the account when locked=false', async () => {
    const updateActor = jest.spyOn(database, 'updateActor')
    const form = new FormData()
    form.set('locked', 'false')

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR1_ID,
        manuallyApprovesFollowers: false
      })
    )
    updateActor.mockRestore()
  })

  it('accepts a JSON body with boolean locked', async () => {
    const updateActor = jest.spyOn(database, 'updateActor')
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({ display_name: 'JSON Name', locked: true })
      }
    )

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'JSON Name',
        manuallyApprovesFollowers: true
      })
    )
    updateActor.mockRestore()
  })

  it('rejects malformed JSON body with 400', async () => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: 'not json'
      }
    )

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
  })

  it('ignores unknown/unexpected fields (no mass assignment)', async () => {
    const updateActor = jest.spyOn(database, 'updateActor')
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({
          display_name: 'Safe',
          id: 'attacker',
          role: 'admin',
          privateKey: 'x',
          publicKey: 'y'
        })
      }
    )

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Safe' })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.anything() })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ role: expect.anything() })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ privateKey: expect.anything() })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ publicKey: expect.anything() })
    )
    updateActor.mockRestore()
  })

  it('accepts an empty JSON body as a no-op (200)', async () => {
    const updateActor = jest.spyOn(database, 'updateActor')
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: ''
      }
    )

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.anything()
      })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.anything()
      })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({
        manuallyApprovesFollowers: expect.anything()
      })
    )
    updateActor.mockRestore()
  })
})

import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret',
    allowEmails: [],
    allowActorDomains: []
  })
}))

describe('/api/v1/gallery/gears/[id]/retire', () => {
  const { database, prepare } = getTestDatabaseWithInstance()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const post = (id: string, body: unknown, raw = false) =>
    POST(
      new NextRequest(`https://llun.test/api/v1/gallery/gears/${id}/retire`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: raw ? (body as string) : JSON.stringify(body)
      }),
      { params: Promise.resolve({ id }) }
    )

  const createGear = (name: string, actorId = ACTOR1_ID) =>
    database.createGalleryGear({ actorId, kind: 'lens', name })

  it('retires and unretires the gear', async () => {
    const gear = await createGear('Toggle')

    const retired = await post(gear.id, { retired: true })
    expect(retired.status).toBe(200)
    expect((await retired.json()).gear).toMatchObject({
      id: gear.id,
      retiredAt: expect.any(Number)
    })

    const unretired = await post(gear.id, { retired: false })
    expect(unretired.status).toBe(200)
    expect((await unretired.json()).gear.retiredAt).toBeNull()
  })

  it('is idempotent and keeps the first retirement date', async () => {
    const gear = await createGear('Idempotent')

    const first = (await (await post(gear.id, { retired: true })).json()).gear
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await post(gear.id, { retired: true })

    expect(second.status).toBe(200)
    expect((await second.json()).gear.retiredAt).toBe(first.retiredAt)

    // Unretiring what is not retired is a no-op success, too.
    await post(gear.id, { retired: false })
    const again = await post(gear.id, { retired: false })
    expect(again.status).toBe(200)
    expect((await again.json()).gear.retiredAt).toBeNull()
  })

  it('answers 404 for a missing id and for another actor’s gear', async () => {
    const foreign = await createGear('Foreign', ACTOR2_ID)

    expect((await post('missing', { retired: true })).status).toBe(404)
    expect((await post(foreign.id, { retired: true })).status).toBe(404)
    expect(
      (await database.getGalleryGear({ id: foreign.id, actorId: ACTOR2_ID }))
        ?.retiredAt
    ).toBeUndefined()
  })

  it.each([
    ['a missing flag', {}],
    ['a non-boolean flag', { retired: 'yes' }],
    ['a non-object body', []]
  ])('answers 422 for %s', async (_, body) => {
    const gear = await createGear('Validated retire')

    const response = await post(gear.id, body)

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'Unprocessable entity' })
  })

  it('answers 400 for a body that is not JSON', async () => {
    const gear = await createGear('Bad json retire')

    expect((await post(gear.id, '{nope', true)).status).toBe(400)
  })

  it('redirects to sign-in without a session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    expect((await post('any', { retired: true })).status).toBe(307)
  })
})

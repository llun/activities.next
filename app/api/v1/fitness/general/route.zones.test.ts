import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret-for-encryption',
    allowEmails: [],
    allowActorDomains: []
  })
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

// The training zone inputs through POST and GET /api/v1/fitness/general,
// validated at the boundary and stored on the actor's `general` row.
describe('Fitness general settings: training zones', () => {
  const { database, db, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    await db
      .deleteFrom('fitness_settings')
      .where('actorId', '=', ACTOR1_ID)
      .execute()
  })

  const post = (body: unknown) =>
    POST(
      new NextRequest('http://llun.test/api/v1/fitness/general', {
        method: 'POST',
        headers: { Origin: 'https://llun.test' },
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({}) }
    )

  const get = () =>
    GET(
      new NextRequest('http://llun.test/api/v1/fitness/general', {
        method: 'GET'
      }),
      { params: Promise.resolve({}) }
    )

  const storedZones = async () =>
    db
      .selectFrom('fitness_settings')
      .select(['maxHeartRate', 'restingHeartRate', 'functionalThresholdPower'])
      .where('actorId', '=', ACTOR1_ID)
      .where('serviceType', '=', 'general')
      .where('deletedAt', 'is', null)
      .executeTakeFirst()

  const ZONES = {
    maxHeartRate: 186,
    restingHeartRate: 52,
    functionalThresholdPower: 260
  }

  it('answers null zones before any are set', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      maxHeartRate: null,
      restingHeartRate: null,
      functionalThresholdPower: null
    })
  })

  it('creates the general row with the zones and reads them back', async () => {
    const response = await post(ZONES)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      privacyLocations: [],
      ...ZONES
    })
    expect(await storedZones()).toEqual(ZONES)
    await expect((await get()).json()).resolves.toMatchObject(ZONES)
  })

  it('updates an existing row and clears a field with null', async () => {
    await post({ generateRouteDescription: true })
    await post(ZONES)

    const response = await post({
      ...ZONES,
      restingHeartRate: null,
      functionalThresholdPower: 280
    })
    expect(response.status).toBe(200)
    expect(await storedZones()).toEqual({
      maxHeartRate: 186,
      restingHeartRate: null,
      functionalThresholdPower: 280
    })
    // Saving zones leaves the other settings alone, and the reverse.
    await post({ generateRouteDescription: false })
    await expect((await get()).json()).resolves.toMatchObject({
      generateRouteDescription: false,
      maxHeartRate: 186,
      functionalThresholdPower: 280
    })
  })

  it('clears every field', async () => {
    await post(ZONES)
    const response = await post({
      maxHeartRate: null,
      restingHeartRate: null,
      functionalThresholdPower: null
    })
    expect(response.status).toBe(200)
    expect(await storedZones()).toEqual({
      maxHeartRate: null,
      restingHeartRate: null,
      functionalThresholdPower: null
    })
  })

  it.each([
    [{ ...ZONES, maxHeartRate: 99 }, 'Max heart rate must be 100–240 bpm'],
    [{ ...ZONES, maxHeartRate: 241 }, 'Max heart rate must be 100–240 bpm'],
    [
      { ...ZONES, maxHeartRate: 180.5 },
      'Max heart rate must be a whole number'
    ],
    [
      { ...ZONES, restingHeartRate: 29 },
      'Resting heart rate must be 30–120 bpm'
    ],
    [
      { ...ZONES, restingHeartRate: 121 },
      'Resting heart rate must be 30–120 bpm'
    ],
    [
      { ...ZONES, maxHeartRate: 110, restingHeartRate: 110 },
      'Resting heart rate must be below max heart rate'
    ],
    [
      { ...ZONES, functionalThresholdPower: 49 },
      'Functional threshold power must be 50–700 W'
    ],
    [
      { ...ZONES, functionalThresholdPower: 701 },
      'Functional threshold power must be 50–700 W'
    ]
  ])('rejects %o with 422', async (body, error) => {
    const response = await post(body)
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error })
    expect(await storedZones()).toBeUndefined()
  })

  it.each([
    [{ maxHeartRate: 186 }],
    [{ ...ZONES, maxHeartRate: '186' }],
    [{ ...ZONES, generateRouteDescription: true }]
  ])('rejects a partial or mixed zones payload %o', async (body) => {
    const response = await post(body)
    expect(response.status).toBe(422)
    expect(await storedZones()).toBeUndefined()
  })

  it('accepts the range edges', async () => {
    const response = await post({
      maxHeartRate: 240,
      restingHeartRate: 120,
      functionalThresholdPower: 700
    })
    expect(response.status).toBe(200)
    const lower = await post({
      maxHeartRate: 100,
      restingHeartRate: 30,
      functionalThresholdPower: 50
    })
    expect(lower.status).toBe(200)
    expect(await storedZones()).toEqual({
      maxHeartRate: 100,
      restingHeartRate: 30,
      functionalThresholdPower: 50
    })
  })
})

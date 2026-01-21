import { getConfig } from '@/lib/config'
import { getTestSQLDatabase, seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

import { GET } from './route'

jest.mock('@/lib/config')

describe('GET /api/v1/accounts/media', () => {
  const database = getTestSQLDatabase()
  const { actors } = DatabaseSeed

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    ;(getConfig as jest.Mock).mockReturnValue({
      mediaStorage: { quotaPerAccount: 1_073_741_824 }
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('returns 401 when not authenticated', async () => {
    const request = new Request('http://localhost/api/v1/accounts/media')

    const response = await GET(request, {
      database,
      currentActor: null as any,
      account: null
    })

    expect(response.status).toBe(401)
  })

  it('returns media list with quota information', async () => {
    const actor = actors.primary
    const actorData = await database.getActorFromId({ id: actor.id })
    expect(actorData).toBeDefined()

    // Create test media
    await database.createMedia({
      actorId: actor.id,
      original: {
        path: '/test/test-media.jpg',
        bytes: 5000,
        mimeType: 'image/jpeg',
        metaData: { width: 800, height: 600 }
      }
    })

    const request = new Request('http://localhost/api/v1/accounts/media')

    const response = await GET(request, {
      database,
      currentActor: actor,
      account: actorData?.account ?? null
    })

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('used')
    expect(data).toHaveProperty('limit')
    expect(data).toHaveProperty('medias')

    expect(data.used).toBeNumber()
    expect(data.limit).toBe(1_073_741_824)
    expect(data.medias).toBeArray()
  })

  it('includes media details in response', async () => {
    const actor = actors.replyAuthor
    const actorData = await database.getActorFromId({ id: actor.id })

    // Create media with description
    await database.createMedia({
      actorId: actor.id,
      original: {
        path: '/test/described-media.jpg',
        bytes: 3000,
        mimeType: 'image/png',
        metaData: { width: 640, height: 480 }
      },
      description: 'Test description'
    })

    const request = new Request('http://localhost/api/v1/accounts/media')

    const response = await GET(request, {
      database,
      currentActor: actor,
      account: actorData?.account ?? null
    })

    const data = await response.json()

    const media = data.medias.find((m: any) =>
      m.description?.includes('Test description')
    )
    expect(media).toBeDefined()
    expect(media.mimeType).toBe('image/png')
    expect(media.width).toBe(640)
    expect(media.height).toBe(480)
  })

  it('aggregates storage across all actors in account', async () => {
    const actor = actors.followAuthor
    const actorData = await database.getActorFromId({ id: actor.id })

    // Create media for this actor
    await database.createMedia({
      actorId: actor.id,
      original: {
        path: '/test/actor-media-1.jpg',
        bytes: 2000,
        mimeType: 'image/jpeg',
        metaData: { width: 400, height: 400 }
      }
    })

    const request = new Request('http://localhost/api/v1/accounts/media')

    const response = await GET(request, {
      database,
      currentActor: actor,
      account: actorData?.account ?? null
    })

    const data = await response.json()

    expect(data.used).toBeGreaterThanOrEqual(2000)
  })
})

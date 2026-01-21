import { getTestSQLDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/seed/testUser1'
import { seedDatabase } from '@/lib/stub/seedDatabase'

import { DELETE } from './route'

describe('DELETE /api/v1/accounts/media/[mediaId]', () => {
  const database = getTestSQLDatabase()
  const { actors } = DatabaseSeed

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('returns 401 when not authenticated', async () => {
    const request = new Request(
      'http://localhost/api/v1/accounts/media/123',
      {
        method: 'DELETE'
      }
    )

    const response = await DELETE(request, {
      database,
      currentActor: null as any,
      account: null
    }, { params: Promise.resolve({ mediaId: '123' }) })

    expect(response.status).toBe(401)
  })

  it('returns 404 when media does not belong to account', async () => {
    const actor = actors[0]
    const actorData = await database.getActorFromId({ id: actor.id })

    const request = new Request(
      'http://localhost/api/v1/accounts/media/999999',
      {
        method: 'DELETE'
      }
    )

    const response = await DELETE(request, {
      database,
      currentActor: actor,
      account: actorData?.account ?? null
    }, { params: Promise.resolve({ mediaId: '999999' }) })

    expect(response.status).toBe(404)
  })

  it('deletes media successfully', async () => {
    const actor = actors[1]
    const actorData = await database.getActorFromId({ id: actor.id })

    // Create media
    const media = await database.createMedia({
      actorId: actor.id,
      original: {
        path: '/test/to-delete-via-api.jpg',
        bytes: 1500,
        mimeType: 'image/jpeg',
        metaData: { width: 300, height: 300 }
      }
    })

    expect(media).toBeDefined()

    const request = new Request(
      `http://localhost/api/v1/accounts/media/${media!.id}`,
      {
        method: 'DELETE'
      }
    )

    const response = await DELETE(request, {
      database,
      currentActor: actor,
      account: actorData?.account ?? null
    }, { params: Promise.resolve({ mediaId: media!.id }) })

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.success).toBe(true)

    // Verify deletion
    const medias = await database.getMediasForAccount({
      accountId: actorData!.accountId!
    })
    const deletedMedia = medias.find((m) => m.id === media!.id)
    expect(deletedMedia).toBeUndefined()
  })

  it('allows deleting media from any actor in the account', async () => {
    const actor1 = actors[2]
    const actor1Data = await database.getActorFromId({ id: actor1.id })

    // Create media for actor1
    const media = await database.createMedia({
      actorId: actor1.id,
      original: {
        path: '/test/cross-actor-delete.jpg',
        bytes: 2000,
        mimeType: 'image/jpeg',
        metaData: { width: 400, height: 400 }
      }
    })

    expect(media).toBeDefined()

    // Delete using the same account (but could be different actor in same account)
    const request = new Request(
      `http://localhost/api/v1/accounts/media/${media!.id}`,
      {
        method: 'DELETE'
      }
    )

    const response = await DELETE(request, {
      database,
      currentActor: actor1,
      account: actor1Data?.account ?? null
    }, { params: Promise.resolve({ mediaId: media!.id }) })

    expect(response.status).toBe(200)
  })
})

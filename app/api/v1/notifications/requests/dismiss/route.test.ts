import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { actorPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { NotificationType } from '@/lib/types/database/operations'

import { POST } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

// The OAuth guard is covered by its own tests; here the caller is always actor1.
vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: { currentActor: { id: string }; params: Promise<{}> }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) =>
      handle(req, {
        currentActor: { id: 'https://llun.test/users/test1' },
        params: context.params
      })
}))

describe('POST /api/v1/notifications/requests/dismiss', () => {
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

  beforeEach(async () => {
    for (const actorId of [ACTOR1_ID, ACTOR2_ID]) {
      const existing = await database.getNotifications({
        actorId,
        limit: 1000,
        includeFiltered: true
      })
      for (const n of existing) await database.deleteNotification(n.id)
    }
  })

  afterEach(() => {
    mockDatabase = database
  })

  const postJson = (body: unknown) =>
    POST(
      new NextRequest(
        'https://llun.test/api/v1/notifications/requests/dismiss',
        {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' }
        }
      ),
      { params: Promise.resolve({}) }
    )

  const postForm = (entries: [string, string][]) =>
    POST(
      new NextRequest(
        'https://llun.test/api/v1/notifications/requests/dismiss',
        {
          method: 'POST',
          body: new URLSearchParams(entries).toString(),
          headers: { 'content-type': 'application/x-www-form-urlencoded' }
        }
      ),
      { params: Promise.resolve({}) }
    )

  const create = (
    sourceActorId: string,
    { filtered = true, actorId = ACTOR1_ID } = {}
  ) =>
    database.createNotification({
      actorId,
      type: NotificationType.enum.follow,
      sourceActorId,
      filtered
    })

  const sourcesOf = async (actorId = ACTOR1_ID) =>
    (
      await database.getNotifications({
        actorId,
        limit: 100,
        includeFiltered: true
      })
    )
      .map((n) => n.sourceActorId)
      .sort()

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null

    const response = await postJson({ 'id[]': ['x'] })

    expect(response.status).toBe(500)
  })

  it('deletes every filtered notification from the dismissed sender', async () => {
    await create(ACTOR2_ID)
    await create(ACTOR2_ID)
    await create(ACTOR3_ID)

    const response = await postJson({
      'id[]': [await actorPublicId(database, ACTOR2_ID)]
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(await sourcesOf()).toEqual([ACTOR3_ID])
  })

  it('dismisses several requests in one call', async () => {
    await create(ACTOR2_ID)
    await create(ACTOR3_ID)
    await create(ACTOR4_ID)

    await postJson({
      'id[]': [
        await actorPublicId(database, ACTOR2_ID),
        await actorPublicId(database, ACTOR4_ID)
      ]
    })

    expect(await sourcesOf()).toEqual([ACTOR3_ID])
  })

  it('keeps notifications from the same sender that were already visible', async () => {
    await create(ACTOR2_ID, { filtered: true })
    await create(ACTOR2_ID, { filtered: false })

    await postJson({ 'id[]': [await actorPublicId(database, ACTOR2_ID)] })

    const remaining = await database.getNotifications({
      actorId: ACTOR1_ID,
      limit: 10,
      includeFiltered: true
    })
    expect(remaining.map((n) => n.filtered)).toEqual([false])
  })

  it("does not delete another recipient's notifications from that sender", async () => {
    await create(ACTOR3_ID, { actorId: ACTOR2_ID })

    await postJson({ 'id[]': [await actorPublicId(database, ACTOR3_ID)] })

    expect(await sourcesOf(ACTOR2_ID)).toEqual([ACTOR3_ID])
  })

  it('accepts a single id and raw actor uris', async () => {
    await create(ACTOR2_ID)
    await create(ACTOR3_ID)

    await postJson({ id: await actorPublicId(database, ACTOR2_ID) })
    await postJson({ 'id[]': [ACTOR3_ID] })

    expect(await sourcesOf()).toEqual([])
  })

  it('reads id[] from a form body', async () => {
    await create(ACTOR2_ID)
    await create(ACTOR3_ID)

    const response = await postForm([
      ['id[]', await actorPublicId(database, ACTOR2_ID)],
      ['id[]', await actorPublicId(database, ACTOR3_ID)]
    ])

    expect(response.status).toBe(200)
    expect(await sourcesOf()).toEqual([])
  })

  it('reads a single id from a form body', async () => {
    await create(ACTOR2_ID)

    await postForm([['id', await actorPublicId(database, ACTOR2_ID)]])

    expect(await sourcesOf()).toEqual([])
  })

  it('does nothing and succeeds when no ids are given', async () => {
    await create(ACTOR2_ID)

    const response = await postJson({})

    expect(response.status).toBe(200)
    expect(await sourcesOf()).toEqual([ACTOR2_ID])
  })

  it('treats an unparseable form body as having no ids', async () => {
    await create(ACTOR2_ID)

    const response = await POST(
      new NextRequest(
        'https://llun.test/api/v1/notifications/requests/dismiss',
        {
          method: 'POST',
          body: 'not a multipart body',
          headers: { 'content-type': 'multipart/form-data; boundary=missing' }
        }
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(await sourcesOf()).toEqual([ACTOR2_ID])
  })

  it.each([
    ['ids that are not strings', { 'id[]': [1, 2] }],
    [
      'more than 100 ids',
      { 'id[]': Array.from({ length: 101 }, (_, i) => `${i}`) }
    ]
  ])('rejects %s with 422 and deletes nothing', async (_, body) => {
    await create(ACTOR2_ID)

    const response = await postJson(body)

    expect(response.status).toBe(422)
    expect(await sourcesOf()).toEqual([ACTOR2_ID])
  })
})

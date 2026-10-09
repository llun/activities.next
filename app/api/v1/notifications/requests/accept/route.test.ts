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

describe('POST /api/v1/notifications/requests/accept', () => {
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
    const existing = await database.getNotifications({
      actorId: ACTOR1_ID,
      limit: 1000,
      includeFiltered: true
    })
    for (const n of existing) await database.deleteNotification(n.id)
    await database.updateActor({
      actorId: ACTOR1_ID,
      notificationAcceptedSenders: []
    })
  })

  afterEach(() => {
    mockDatabase = database
  })

  const postJson = (body: unknown) =>
    POST(
      new NextRequest(
        'https://llun.test/api/v1/notifications/requests/accept',
        {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' }
        }
      ),
      { params: Promise.resolve({}) }
    )

  const postForm = (
    entries: [string, string][],
    type = 'application/x-www-form-urlencoded'
  ) => {
    const body =
      type === 'multipart/form-data'
        ? (() => {
            const form = new FormData()
            entries.forEach(([k, v]) => form.append(k, v))
            return form
          })()
        : new URLSearchParams(entries).toString()
    return POST(
      new NextRequest(
        'https://llun.test/api/v1/notifications/requests/accept',
        {
          method: 'POST',
          body,
          ...(type === 'multipart/form-data'
            ? {}
            : { headers: { 'content-type': type } })
        }
      ),
      { params: Promise.resolve({}) }
    )
  }

  const filteredFrom = (sourceActorId: string, actorId = ACTOR1_ID) =>
    database.createNotification({
      actorId,
      type: NotificationType.enum.follow,
      sourceActorId,
      filtered: true
    })

  const filteredIds = async (actorId = ACTOR1_ID) =>
    (
      await database.getNotifications({
        actorId,
        limit: 100,
        includeFiltered: true
      })
    )
      .filter((n) => n.filtered)
      .map((n) => n.sourceActorId)
      .sort()

  const acceptedSenders = async () =>
    (await database.getActorSettings({ actorId: ACTOR1_ID }))
      ?.notificationAcceptedSenders ?? []

  it('returns 500 when the database is unavailable', async () => {
    mockDatabase = null

    const response = await postJson({ 'id[]': ['x'] })

    expect(response.status).toBe(500)
  })

  it('surfaces the sender notifications and allow-lists the sender', async () => {
    await filteredFrom(ACTOR2_ID)
    await filteredFrom(ACTOR2_ID)
    await filteredFrom(ACTOR3_ID)

    const response = await postJson({
      'id[]': [await actorPublicId(database, ACTOR2_ID)]
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    // Only actor3's request is still pending; actor2's notifications are now visible.
    expect(await filteredIds()).toEqual([ACTOR3_ID])
    const visible = await database.getNotifications({
      actorId: ACTOR1_ID,
      limit: 10
    })
    expect(visible.map((n) => n.sourceActorId)).toEqual([ACTOR2_ID, ACTOR2_ID])
    expect(await acceptedSenders()).toEqual([ACTOR2_ID])
  })

  it('accepts several requests in one call', async () => {
    await filteredFrom(ACTOR2_ID)
    await filteredFrom(ACTOR3_ID)
    await filteredFrom(ACTOR4_ID)

    await postJson({
      'id[]': [
        await actorPublicId(database, ACTOR2_ID),
        await actorPublicId(database, ACTOR3_ID)
      ]
    })

    expect(await filteredIds()).toEqual([ACTOR4_ID])
    expect((await acceptedSenders()).sort()).toEqual([ACTOR2_ID, ACTOR3_ID])
  })

  it('accepts a single id sent as `id`', async () => {
    await filteredFrom(ACTOR2_ID)

    await postJson({ id: await actorPublicId(database, ACTOR2_ID) })

    expect(await filteredIds()).toEqual([])
  })

  it('does not allow-list a sender that has no pending request', async () => {
    await filteredFrom(ACTOR2_ID)

    const response = await postJson({
      'id[]': [
        await actorPublicId(database, ACTOR2_ID),
        await actorPublicId(database, ACTOR3_ID)
      ]
    })

    expect(response.status).toBe(200)
    expect(await acceptedSenders()).toEqual([ACTOR2_ID])
  })

  it("does not accept another recipient's pending requests", async () => {
    await filteredFrom(ACTOR3_ID, ACTOR2_ID)

    await postJson({ 'id[]': [await actorPublicId(database, ACTOR3_ID)] })

    expect(await filteredIds(ACTOR2_ID)).toEqual([ACTOR3_ID])
    expect(await acceptedSenders()).toEqual([])
  })

  it('accepts raw actor uris as ids', async () => {
    await filteredFrom(ACTOR2_ID)

    await postJson({ 'id[]': [ACTOR2_ID] })

    expect(await filteredIds()).toEqual([])
  })

  it.each([
    ['urlencoded', 'application/x-www-form-urlencoded'],
    ['multipart', 'multipart/form-data']
  ])('reads id[] from a %s form body', async (_, type) => {
    await filteredFrom(ACTOR2_ID)
    await filteredFrom(ACTOR3_ID)

    const response = await postForm(
      [
        ['id[]', await actorPublicId(database, ACTOR2_ID)],
        ['id[]', await actorPublicId(database, ACTOR3_ID)]
      ],
      type
    )

    expect(response.status).toBe(200)
    expect(await filteredIds()).toEqual([])
  })

  it('reads a single id from a form body', async () => {
    await filteredFrom(ACTOR2_ID)

    await postForm([['id', await actorPublicId(database, ACTOR2_ID)]])

    expect(await filteredIds()).toEqual([])
  })

  it('does nothing and succeeds when no ids are given', async () => {
    await filteredFrom(ACTOR2_ID)

    const response = await postJson({})

    expect(response.status).toBe(200)
    expect(await filteredIds()).toEqual([ACTOR2_ID])
    expect(await acceptedSenders()).toEqual([])
  })

  it('treats an unparseable form body as having no ids', async () => {
    await filteredFrom(ACTOR2_ID)

    const response = await POST(
      new NextRequest(
        'https://llun.test/api/v1/notifications/requests/accept',
        {
          method: 'POST',
          body: 'not a multipart body',
          headers: { 'content-type': 'multipart/form-data; boundary=missing' }
        }
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(await filteredIds()).toEqual([ACTOR2_ID])
    expect(await acceptedSenders()).toEqual([])
  })

  it.each([
    ['ids that are not strings', { 'id[]': [1, 2] }],
    [
      'more than 100 ids',
      { 'id[]': Array.from({ length: 101 }, (_, i) => `${i}`) }
    ]
  ])('rejects %s with 422', async (_, body) => {
    await filteredFrom(ACTOR2_ID)

    const response = await postJson(body)

    expect(response.status).toBe(422)
    expect(await filteredIds()).toEqual([ACTOR2_ID])
  })
})

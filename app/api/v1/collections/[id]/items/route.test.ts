import { NextRequest } from 'next/server'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { CollectionLimitError } from '@/lib/services/collections/limits'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { generatePublicId } from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

import { DELETE, GET, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() =>
    Promise.resolve({
      get: () => undefined
    })
  )
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  }),
  getBaseURL: () => 'https://llun.test'
}))

describe('/api/v1/collections/[id]/items', () => {
  const database = getTestSQLDatabase()

  // publicIds are minted at insert and random per run: read the emitted id back
  // off the stored row rather than hard-coding one.
  const emittedActorId = async (actorId: string) => {
    const publicIds = await database.getActorPublicIds({ actorIds: [actorId] })
    return publicIds.get(actorId) ?? urlToId(actorId)
  }
  let collectionId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const collection = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Items'
    })
    collectionId = collection.id
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const postRequest = (body: unknown) =>
    new NextRequest(
      `https://llun.test/api/v1/collections/${collectionId}/items`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify(body)
      }
    )
  const context = () => ({ params: Promise.resolve({ id: collectionId }) })

  it('adds a single account (spec form) and returns WrappedCollectionItem', async () => {
    const response = await POST(
      postRequest({ account_id: urlToId(ACTOR2_ID) }),
      context()
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.collection_item).toMatchObject({
      account_id: await emittedActorId(ACTOR2_ID),
      state: 'pending'
    })
    expect(typeof data.collection_item.id).toBe('string')
    expect(typeof data.collection_item.created_at).toBe('string')
  })

  it('keeps the bulk account_ids extension returning an empty object', async () => {
    const response = await POST(
      postRequest({ account_ids: [urlToId(ACTOR2_ID)] }),
      context()
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  })

  it('answers 422 when the collection is already at its member ceiling', async () => {
    vi.spyOn(database, 'addCollectionMembers').mockRejectedValue(
      new CollectionLimitError('members')
    )
    const response = await POST(
      postRequest({ account_ids: [urlToId(ACTOR2_ID)] }),
      context()
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: new CollectionLimitError('members').message
    })
  })

  it('rejects a body with neither account_id nor account_ids', async () => {
    const response = await POST(postRequest({}), context())
    expect(response.status).toBe(422)
  })

  it('answers 422 for an unknown publicId account id without writing a member row', async () => {
    const unknownPublicId = generatePublicId()
    const response = await POST(
      postRequest({ account_id: unknownPublicId }),
      context()
    )
    expect(response.status).toBe(422)
    expect(
      await database.getCollectionItemByAccount({
        collectionId,
        targetActorId: unknownPublicId
      })
    ).toBeNull()
  })

  it('ignores unknown publicId account ids in the bulk form and adds the rest', async () => {
    const unknownPublicId = generatePublicId()
    const response = await POST(
      postRequest({ account_ids: [unknownPublicId, urlToId(ACTOR3_ID)] }),
      context()
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(
      await database.getCollectionItemByAccount({
        collectionId,
        targetActorId: unknownPublicId
      })
    ).toBeNull()
    expect(
      await database.getCollectionItemByAccount({
        collectionId,
        targetActorId: ACTOR3_ID
      })
    ).toMatchObject({ targetActorId: ACTOR3_ID })
  })

  it('answers 422 for an empty account_ids list', async () => {
    const response = await POST(postRequest({ account_ids: [] }), context())
    expect(response.status).toBe(422)
  })

  it('is idempotent for the spec form: adding the same account twice returns the same item', async () => {
    const first = await (
      await POST(postRequest({ account_id: urlToId(ACTOR4_ID) }), context())
    ).json()
    const second = await (
      await POST(postRequest({ account_id: urlToId(ACTOR4_ID) }), context())
    ).json()

    expect(second.collection_item.id).toBe(first.collection_item.id)
  })

  it("cannot add members to another account's collection", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const response = await POST(
      postRequest({ account_id: urlToId(ACTOR1_ID) }),
      context()
    )

    expect(response.status).toBe(404)
    expect(
      await database.getCollectionItemByAccount({
        collectionId,
        targetActorId: ACTOR1_ID
      })
    ).toBeNull()
  })

  it('answers 404 for an unknown collection', async () => {
    const response = await POST(postRequest({ account_ids: ['x'] }), {
      params: Promise.resolve({ id: 'missing' })
    })
    expect(response.status).toBe(404)
  })

  describe('GET and DELETE', () => {
    let ownedId: string
    const memberIds = [ACTOR2_ID, ACTOR3_ID, ACTOR4_ID]

    beforeAll(async () => {
      const collection = await database.createCollection({
        actorId: ACTOR1_ID,
        title: 'Managed members'
      })
      ownedId = collection.id
    })

    // The DELETE tests remove members, so every test starts from the full set
    // (re-adding an existing member is idempotent) and file order is free.
    beforeEach(async () => {
      await database.addCollectionMembers({
        id: ownedId,
        actorId: ACTOR1_ID,
        targetActorIds: memberIds
      })
    })

    const ownedContext = () => ({ params: Promise.resolve({ id: ownedId }) })
    const itemsUrl = (query = '') =>
      `https://llun.test/api/v1/collections/${ownedId}/items${query}`
    const getRequest = (query = '') =>
      new NextRequest(itemsUrl(query), {
        headers: { origin: 'https://llun.test' }
      })
    const deleteRequest = (body: string) =>
      new NextRequest(itemsUrl(), {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body
      })
    const memberOf = (actorId: string) =>
      database.getCollectionItemByAccount({
        collectionId: ownedId,
        targetActorId: actorId
      })
    const nextCursor = (response: Response) =>
      new URL(
        (response.headers.get('Link') ?? '').match(
          /<([^>]+)>; rel="next"/
        )?.[1] ?? 'https://none.test/'
      ).searchParams.get('max_id')

    describe('GET', () => {
      it("lists the collection's accounts for its owner", async () => {
        const response = await GET(getRequest(), ownedContext())

        expect(response.status).toBe(200)
        const accounts = (await response.json()) as { id: string }[]
        expect(new Set(accounts.map((account) => account.id))).toEqual(
          new Set(await Promise.all(memberIds.map(emittedActorId)))
        )
      })

      it('pages through members with Link cursors without repeating or skipping any', async () => {
        const firstPage = await GET(getRequest('?limit=2'), ownedContext())
        const firstAccounts = (await firstPage.json()) as { id: string }[]
        expect(firstAccounts).toHaveLength(2)
        const cursor = nextCursor(firstPage)
        expect(cursor).toBeTruthy()

        const secondPage = await GET(
          getRequest(`?limit=2&max_id=${cursor}`),
          ownedContext()
        )
        const secondAccounts = (await secondPage.json()) as { id: string }[]

        expect(secondAccounts).toHaveLength(1)
        expect(nextCursor(secondPage)).toBeNull()
        expect(
          new Set([...firstAccounts, ...secondAccounts].map((a) => a.id))
        ).toEqual(new Set(await Promise.all(memberIds.map(emittedActorId))))
      })

      it.each([
        {
          description: 'a non-numeric limit',
          query: '?limit=abc',
          expected: PER_PAGE_LIMIT
        },
        {
          description: 'a negative limit',
          query: '?limit=-5',
          expected: PER_PAGE_LIMIT
        },
        {
          description: 'a limit above the maximum',
          query: '?limit=1000',
          expected: 80
        }
      ])(
        'falls back to a safe page size for $description',
        async ({ query, expected }) => {
          const spy = vi.spyOn(database, 'getCollectionMembers')

          await GET(getRequest(query), ownedContext())

          expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({ limit: expected, projection: 'owner' })
          )
        }
      )

      it('accepts min_id as an alias for since_id', async () => {
        const spy = vi.spyOn(database, 'getCollectionMembers')

        await GET(getRequest('?min_id=item-1'), ownedContext())

        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({ sinceId: 'item-1' })
        )
      })

      it("answers 404 for someone else's collection", async () => {
        mockGetServerSession.mockResolvedValue({
          user: { email: seedActor2.email }
        })

        const response = await GET(getRequest(), ownedContext())

        expect(response.status).toBe(404)
      })

      it('answers 404 for an unknown collection', async () => {
        const response = await GET(getRequest(), {
          params: Promise.resolve({ id: 'missing' })
        })

        expect(response.status).toBe(404)
      })
    })

    describe('DELETE', () => {
      it('removes only the listed accounts, addressed by publicId or legacy id', async () => {
        const response = await DELETE(
          deleteRequest(
            JSON.stringify({
              account_ids: [await emittedActorId(ACTOR2_ID), urlToId(ACTOR3_ID)]
            })
          ),
          ownedContext()
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({})
        expect(await memberOf(ACTOR2_ID)).toBeNull()
        expect(await memberOf(ACTOR3_ID)).toBeNull()
        expect(await memberOf(ACTOR4_ID)).not.toBeNull()
      })

      // Each body names the row we then check, so only the validation (not an
      // unrelated body) is what keeps it in the collection.
      it.each([
        {
          description: 'a missing account_ids',
          body: () => JSON.stringify({ account_id: urlToId(ACTOR4_ID) })
        },
        {
          description: 'an account_ids that is not a list',
          body: () => JSON.stringify({ account_ids: urlToId(ACTOR4_ID) })
        },
        {
          description: 'an empty account id next to a valid one',
          body: () => JSON.stringify({ account_ids: [urlToId(ACTOR4_ID), ''] })
        },
        {
          description: 'malformed JSON',
          body: () => `{"account_ids":["${urlToId(ACTOR4_ID)}"`
        }
      ])(
        'answers 422 and removes nothing for $description',
        async ({ body }) => {
          const response = await DELETE(deleteRequest(body()), ownedContext())

          expect(response.status).toBe(422)
          expect(await memberOf(ACTOR4_ID)).not.toBeNull()
        }
      )

      it('answers 422 for an empty account_ids', async () => {
        const response = await DELETE(
          deleteRequest('{"account_ids":[]}'),
          ownedContext()
        )

        expect(response.status).toBe(422)
      })

      it("cannot remove members from someone else's collection", async () => {
        mockGetServerSession.mockResolvedValue({
          user: { email: seedActor2.email }
        })

        const response = await DELETE(
          deleteRequest(JSON.stringify({ account_ids: [urlToId(ACTOR4_ID)] })),
          ownedContext()
        )

        expect(response.status).toBe(404)
        expect(await memberOf(ACTOR4_ID)).not.toBeNull()
      })
    })
  })
})

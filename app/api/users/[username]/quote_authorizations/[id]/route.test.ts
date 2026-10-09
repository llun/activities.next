import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { buildQuoteAuthorizationUri } from '@/lib/services/quotes/quoteAuthorization'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { QuoteState } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const database = getTestSQLDatabase()

// The guard resolves the local actor from the host and username; its own
// behaviour is covered elsewhere, so stand in for it with the seeded actor.
let guardActorId = ACTOR1_ID
vi.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
  OnlyLocalUserGuard:
    (
      handle: (
        database: Database,
        actor: unknown,
        req: NextRequest,
        query: unknown
      ) => Promise<Response> | Response
    ) =>
    async (req: NextRequest, query: unknown) => {
      const actor = await database.getActorFromId({ id: guardActorId })
      return handle(database, actor, req, query)
    }
}))

const QUOTING_STATUS_ID = 'https://remote.test/users/quoter/statuses/quoting'

describe('GET /api/users/[username]/quote_authorizations/[id]', () => {
  let counter = 0

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (database) await database.destroy()
  })

  beforeEach(() => {
    guardActorId = ACTOR1_ID
  })

  // Seeds a quoted status owned by `quotedOwnerId` (skipped with `createQuoted:
  // false`, leaving the edge pointing at a status that does not exist) plus a
  // quote edge in `state` whose stamp lives under ACTOR1 (the actor the guard
  // resolves).
  const seedEdge = async (
    state: QuoteState,
    {
      quotedOwnerId = ACTOR1_ID,
      createQuoted = true
    }: { quotedOwnerId?: string; createQuoted?: boolean } = {}
  ) => {
    counter += 1
    const quotedStatusId = `${quotedOwnerId}/statuses/quoted-${counter}`
    const statusId = `${QUOTING_STATUS_ID}-${counter}`
    if (createQuoted) {
      await database.createNote({
        id: quotedStatusId,
        url: quotedStatusId,
        actorId: quotedOwnerId,
        text: 'quoted note',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
    }
    const stampUri = buildQuoteAuthorizationUri(ACTOR1_ID, statusId)
    await database.createStatusQuote({
      statusId,
      quotedStatusId,
      state,
      authorizationUri: stampUri
    })
    return { stampUri, statusId, quotedStatusId }
  }

  const get = (stampUri: string, accept?: string) => {
    const id = stampUri.split('/').pop() as string
    return GET(
      new NextRequest(`https://llun.test${new URL(stampUri).pathname}`, {
        headers: accept ? { accept } : {}
      }),
      { params: Promise.resolve({ username: 'test1', id }) }
    )
  }

  it('serves the QuoteAuthorization stamp for an accepted quote of the actor own status', async () => {
    const { stampUri, statusId, quotedStatusId } = await seedEdge('accepted')

    const response = await get(stampUri)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/activity+json'
    )
    await expect(response.json()).resolves.toMatchObject({
      id: stampUri,
      type: 'QuoteAuthorization',
      attributedTo: ACTOR1_ID,
      interactingObject: statusId,
      interactionTarget: quotedStatusId
    })
  })

  it('honours a JSON-LD Accept header with the ActivityStreams profile', async () => {
    const { stampUri } = await seedEdge('accepted')

    const response = await get(
      stampUri,
      'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
    )
  })

  it('still serves ActivityPub JSON when the client only accepts HTML', async () => {
    const { stampUri } = await seedEdge('accepted')

    const response = await get(stampUri, 'text/html')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/activity+json'
    )
  })

  it('returns 404 for a stamp id that was never issued', async () => {
    const response = await get(`${ACTOR1_ID}/quote_authorizations/unknown`)

    expect(response.status).toBe(404)
  })

  it.each(['pending', 'rejected', 'revoked', 'deleted'] as const)(
    'returns 404 once the quote edge is %s so third parties stop trusting it',
    async (state) => {
      const { stampUri } = await seedEdge(state)

      const response = await get(stampUri)

      expect(response.status).toBe(404)
    }
  )

  it('returns 404 when the stamp was issued for a status another actor owns', async () => {
    const { stampUri } = await seedEdge('accepted', {
      quotedOwnerId: ACTOR2_ID
    })

    const response = await get(stampUri)

    expect(response.status).toBe(404)
  })

  it('returns 404 when the quoted status is missing', async () => {
    // An accepted edge pointing at a status that was never created, so the
    // state check passes and only the missing-status branch can answer 404.
    const { stampUri } = await seedEdge('accepted', { createQuoted: false })

    const response = await get(stampUri)

    expect(response.status).toBe(404)
  })

  it('does not serve another actor stamp under this actor path', async () => {
    const { stampUri } = await seedEdge('accepted')
    guardActorId = ACTOR2_ID

    const response = await get(stampUri)

    expect(response.status).toBe(404)
  })
})

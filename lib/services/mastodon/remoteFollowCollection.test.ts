import {
  BlockedFederationDomainError,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import { getActorCollections } from '@/lib/activities/getActorCollections'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { createDeferred } from '@/lib/testing/deferred'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'

import {
  MAX_CACHED_PAGES,
  MAX_IN_FLIGHT_REMOTE_READS,
  MAX_PAGE_ITEMS,
  MAX_UNKNOWN_ACTORS_PER_PAGE,
  REMOTE_FOLLOW_PAGE_TTL_MS,
  RemoteFollowCollectionResult,
  UNKNOWN_ACTOR_CONCURRENCY,
  getRemoteFollowCollectionPage,
  resetRemoteFollowCollectionCacheForTests
} from './remoteFollowCollection'

vi.mock('@/lib/activities/getActorCollections', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/activities/getActorCollections')
  >()),
  getActorCollections: vi.fn()
}))

vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: vi.fn()
}))

// Partial: the real BlockedFederationDomainError class is what the service
// tests errors against with instanceof.
vi.mock('@/lib/actions/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/actions/utils')>()),
  recordActorIfNeeded: vi.fn()
}))

const REMOTE_ACTOR_ID = 'https://remote.test/users/verge'
const NEW_ACTOR_ID = 'https://elsewhere.test/users/new'

const person = MockActivityPubPerson({ id: REMOTE_ACTOR_ID })
const signingActor = { id: 'https://llun.test/users/__instance__' } as never

const mockCollectionPage = (
  orderedItems: unknown,
  extra: { next?: string; prev?: string; totalItems?: number } = {}
) => {
  vi.mocked(getActorCollections).mockResolvedValue({
    page: {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'OrderedCollectionPage' as const,
      orderedItems: orderedItems as string[],
      next: extra.next,
      prev: extra.prev
    },
    totalItems:
      extra.totalItems ??
      (Array.isArray(orderedItems) ? orderedItems.length : 0)
  })
}

const accountUris = (result: RemoteFollowCollectionResult) =>
  result.status === 'ok'
    ? result.page.accounts.map((account) => account.uri)
    : result.status

const unknownActorIds = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `https://many.test/users/u${index}`
  )

describe('getRemoteFollowCollectionPage', () => {
  const database = getTestSQLDatabase()

  const insertActor = async (actorId: string) =>
    database.createActor({
      actorId,
      username: 'new',
      domain: new URL(actorId).host,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `${actorId}/inbox`,
      followersUrl: `${actorId}/followers`,
      publicKey: 'public key',
      createdAt: Date.now()
    })

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.mocked(getActorCollections).mockReset()
    vi.mocked(getActorPerson).mockReset()
    vi.mocked(recordActorIfNeeded).mockReset()
    vi.mocked(getActorPerson).mockResolvedValue(person)
    resetRemoteFollowCollectionCacheForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns stored actors as accounts in the order the remote page listed them', async () => {
    mockCollectionPage([ACTOR3_ID, EXTERNAL_ACTOR1, ACTOR2_ID], {
      next: `${REMOTE_ACTOR_ID}/followers?page=2`,
      prev: `${REMOTE_ACTOR_ID}/followers?page=1`,
      totalItems: 42
    })

    const result = await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers',
      signingActor
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.page.accounts.map((account) => account.uri)).toEqual([
      ACTOR3_ID,
      EXTERNAL_ACTOR1,
      ACTOR2_ID
    ])
    expect(result.page.nextPageUrl).toBe(`${REMOTE_ACTOR_ID}/followers?page=2`)
    expect(result.page.prevPageUrl).toBe(`${REMOTE_ACTOR_ID}/followers?page=1`)
    expect(result.page.totalItems).toBe(42)
    // Every listed actor was already stored, so nothing is fetched.
    expect(recordActorIfNeeded).not.toHaveBeenCalled()
    // The Person and the collection are both fetched with the signer given.
    expect(getActorPerson).toHaveBeenCalledWith({
      actorId: REMOTE_ACTOR_ID,
      signingActor
    })
    expect(getActorCollections).toHaveBeenCalledWith({
      person,
      field: 'followers',
      signingActor,
      pageUrl: undefined
    })
  })

  it('records an unknown actor once and places it where the page listed it', async () => {
    vi.mocked(recordActorIfNeeded).mockImplementation(
      async ({ actorId }) => (await insertActor(actorId)) ?? undefined
    )
    mockCollectionPage([ACTOR2_ID, NEW_ACTOR_ID, ACTOR3_ID])

    const result = await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'following',
      signingActor
    })

    expect(accountUris(result)).toEqual([ACTOR2_ID, NEW_ACTOR_ID, ACTOR3_ID])
    expect(recordActorIfNeeded).toHaveBeenCalledTimes(1)
    expect(recordActorIfNeeded).toHaveBeenCalledWith({
      actorId: NEW_ACTOR_ID,
      database,
      signingActor
    })
  })

  it('drops an actor that cannot be recorded instead of failing the page', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined)
    vi.mocked(recordActorIfNeeded).mockImplementation(async ({ actorId }) => {
      if (actorId === 'https://blocked.test/users/x') {
        throw new BlockedFederationDomainError(actorId)
      }
      if (actorId === 'https://broken.test/users/z') {
        throw new Error('insert failed')
      }
      return undefined
    })
    mockCollectionPage([
      ACTOR2_ID,
      'https://blocked.test/users/x',
      'https://gone.test/users/y',
      'https://broken.test/users/z'
    ])

    const result = await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })

    expect(accountUris(result)).toEqual([ACTOR2_ID])
    // A blocked domain is policy, logged at debug; a real failure is a warn.
    expect(debug).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatchObject({
      actorId: 'https://broken.test/users/z'
    })
  })

  it('keeps an actor whose insert lost a race but whose row now exists', async () => {
    const racedActorId = 'https://raced.test/users/r'
    vi.mocked(recordActorIfNeeded).mockImplementation(async ({ actorId }) => {
      // Someone else inserted the row between our read and our insert.
      await insertActor(actorId)
      throw new Error('UNIQUE constraint failed: actors.id')
    })
    mockCollectionPage([racedActorId, ACTOR2_ID])

    const result = await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })

    expect(accountUris(result)).toEqual([racedActorId, ACTOR2_ID])
  })

  it('resolves at most MAX_UNKNOWN_ACTORS_PER_PAGE unknown actors per page, in page order', async () => {
    vi.mocked(recordActorIfNeeded).mockResolvedValue(undefined)
    const ids = unknownActorIds(MAX_UNKNOWN_ACTORS_PER_PAGE + 5)
    mockCollectionPage(ids)

    await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })

    expect(recordActorIfNeeded).toHaveBeenCalledTimes(
      MAX_UNKNOWN_ACTORS_PER_PAGE
    )
    // The first N in page order, so a client paging through sees the head of
    // the page rather than an arbitrary sample of it.
    expect(
      vi.mocked(recordActorIfNeeded).mock.calls.map((call) => call[0].actorId)
    ).toEqual(ids.slice(0, MAX_UNKNOWN_ACTORS_PER_PAGE))
  })

  it('records unknown actors at most UNKNOWN_ACTOR_CONCURRENCY at a time', async () => {
    const pending: Array<ReturnType<typeof createDeferred<Actor | undefined>>> =
      []
    vi.mocked(recordActorIfNeeded).mockImplementation(() => {
      const deferred = createDeferred<Actor | undefined>()
      pending.push(deferred)
      return deferred.promise
    })
    mockCollectionPage(unknownActorIds(MAX_UNKNOWN_ACTORS_PER_PAGE))

    const result = getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })
    // Let the Person, collection and batch lookup settle so the workers start.
    await vi.waitFor(() =>
      expect(pending.length).toBe(UNKNOWN_ACTOR_CONCURRENCY)
    )

    // Settling one frees exactly one slot.
    pending[0].resolve(undefined)
    await vi.waitFor(() =>
      expect(pending.length).toBe(UNKNOWN_ACTOR_CONCURRENCY + 1)
    )
    expect(recordActorIfNeeded).toHaveBeenCalledTimes(
      UNKNOWN_ACTOR_CONCURRENCY + 1
    )

    // Let the rest through and finish the page.
    vi.mocked(recordActorIfNeeded).mockResolvedValue(undefined)
    for (const deferred of pending) deferred.resolve(undefined)
    expect((await result).status).toBe('ok')
  })

  it('serves at most MAX_PAGE_ITEMS actors from one remote page', async () => {
    const lookup = vi.spyOn(database, 'getMastodonActorsFromIds')
    vi.mocked(recordActorIfNeeded).mockResolvedValue(undefined)
    mockCollectionPage(unknownActorIds(MAX_PAGE_ITEMS + 50))

    await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })

    // One bounded batch lookup: never a whereIn over the whole remote page.
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup.mock.calls[0][0].ids).toHaveLength(MAX_PAGE_ITEMS)
  })

  it.each([
    {
      description: 'an object item carrying an id',
      items: [{ type: 'Person', id: ACTOR2_ID }],
      expected: [ACTOR2_ID]
    },
    {
      description: 'a blank node id',
      items: ['_:b0'],
      expected: []
    },
    {
      description: 'an object without an id',
      items: [{ type: 'Person' }],
      expected: []
    },
    {
      description: 'a duplicate of an earlier item',
      items: [ACTOR3_ID, ACTOR3_ID],
      expected: [ACTOR3_ID]
    }
  ])('reads $description', async ({ items, expected }) => {
    vi.mocked(recordActorIfNeeded).mockResolvedValue(undefined)
    mockCollectionPage(items)

    const result = await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })

    expect(accountUris(result)).toEqual(expected)
    expect(recordActorIfNeeded).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'a page of the same collection',
      pageUrl: `${REMOTE_ACTOR_ID}/followers?page=2`,
      expectedStatus: 'ok'
    },
    {
      description: "a page of the actor's other collection",
      pageUrl: `${REMOTE_ACTOR_ID}/following?page=2`,
      expectedStatus: 'invalid-page'
    },
    {
      description: 'a page on another host',
      pageUrl: 'https://evil.test/users/verge/followers?page=2',
      expectedStatus: 'invalid-page'
    }
  ])(
    'accepts a page URL only for this collection: $description',
    async ({ pageUrl, expectedStatus }) => {
      mockCollectionPage([ACTOR2_ID])

      const result = await getRemoteFollowCollectionPage({
        database,
        actorId: REMOTE_ACTOR_ID,
        field: 'followers',
        pageUrl
      })

      expect(result.status).toBe(expectedStatus)
      if (expectedStatus === 'ok') {
        expect(getActorCollections).toHaveBeenCalledWith(
          expect.objectContaining({ pageUrl })
        )
      } else {
        expect(getActorCollections).not.toHaveBeenCalled()
      }
    }
  )

  it.each([
    {
      description: 'the actor document cannot be fetched',
      arrange: () => {
        vi.mocked(getActorPerson).mockResolvedValue(null)
        mockCollectionPage([ACTOR2_ID])
      }
    },
    {
      description: 'the actor document names no such collection',
      arrange: () => {
        vi.mocked(getActorPerson).mockResolvedValue({
          ...person,
          followers: undefined
        })
        mockCollectionPage([ACTOR2_ID])
      }
    },
    {
      description: 'there is no collection at all',
      arrange: () => vi.mocked(getActorCollections).mockResolvedValue(null)
    },
    {
      description: 'the collection has a size but no page',
      arrange: () =>
        vi
          .mocked(getActorCollections)
          .mockResolvedValue({ page: null, totalItems: 12 })
    },
    {
      description: 'the page carries no orderedItems array',
      arrange: () => mockCollectionPage(undefined)
    },
    {
      description: 'the page carries orderedItems that is not an array',
      arrange: () => mockCollectionPage({ items: [ACTOR2_ID] })
    }
  ])('answers unavailable when $description', async ({ arrange }) => {
    arrange()

    await expect(
      getRemoteFollowCollectionPage({
        database,
        actorId: REMOTE_ACTOR_ID,
        field: 'followers'
      })
    ).resolves.toEqual({ status: 'unavailable' })
    // ...and caches it: an unreadable page is not retried on every open.
    await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })
    expect(getActorPerson).toHaveBeenCalledTimes(1)
  })

  it('shares one fetch between concurrent callers and serves it for the TTL', async () => {
    const deferred =
      createDeferred<Awaited<ReturnType<typeof getActorCollections>>>()
    vi.mocked(getActorCollections).mockReturnValue(deferred.promise)

    const first = getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })
    const second = getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })
    // The Person fetch is inside the cached work: one, not two.
    await Promise.resolve()
    expect(getActorPerson).toHaveBeenCalledTimes(1)

    deferred.resolve({
      page: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'OrderedCollectionPage',
        orderedItems: [ACTOR2_ID]
      },
      totalItems: 1
    })
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toBe(secondResult)
    expect(getActorCollections).toHaveBeenCalledTimes(1)

    // Still cached: a third call fetches neither the Person nor the page.
    await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })
    expect(getActorPerson).toHaveBeenCalledTimes(1)
    expect(getActorCollections).toHaveBeenCalledTimes(1)

    // A different page, field, or actor is its own entry.
    await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers',
      pageUrl: `${REMOTE_ACTOR_ID}/followers?page=2`
    })
    await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'following'
    })
    expect(getActorCollections).toHaveBeenCalledTimes(3)
  })

  it.each([
    {
      description: 'query parameters in another order',
      spelling: `${REMOTE_ACTOR_ID}/followers?page=2&limit=40`,
      respelling: `${REMOTE_ACTOR_ID}/followers?limit=40&page=2`
    },
    {
      description: 'a fragment',
      spelling: `${REMOTE_ACTOR_ID}/followers?page=2`,
      respelling: `${REMOTE_ACTOR_ID}/followers?page=2#top`
    }
  ])(
    'keys the cache on the page, not on its spelling: $description',
    async ({ spelling, respelling }) => {
      mockCollectionPage([ACTOR2_ID])

      await getRemoteFollowCollectionPage({
        database,
        actorId: REMOTE_ACTOR_ID,
        field: 'followers',
        pageUrl: spelling
      })
      await getRemoteFollowCollectionPage({
        database,
        actorId: REMOTE_ACTOR_ID,
        field: 'followers',
        pageUrl: respelling
      })

      expect(getActorCollections).toHaveBeenCalledTimes(1)
    }
  )

  it('refetches once the TTL has passed', async () => {
    vi.useFakeTimers()
    mockCollectionPage([ACTOR2_ID])

    await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })
    vi.advanceTimersByTime(REMOTE_FOLLOW_PAGE_TTL_MS + 1)
    await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })

    expect(getActorCollections).toHaveBeenCalledTimes(2)
  })

  it('evicts the oldest entry past MAX_CACHED_PAGES', async () => {
    mockCollectionPage([ACTOR2_ID])
    const readPage = (index: number) =>
      getRemoteFollowCollectionPage({
        database,
        actorId: REMOTE_ACTOR_ID,
        field: 'followers',
        pageUrl: `${REMOTE_ACTOR_ID}/followers?page=${index}`
      })

    for (let index = 0; index <= MAX_CACHED_PAGES; index += 1) {
      await readPage(index)
    }
    expect(getActorCollections).toHaveBeenCalledTimes(MAX_CACHED_PAGES + 1)

    // Page 1 is still cached; page 0, the oldest, was evicted by the insert
    // that overflowed the map.
    await readPage(1)
    expect(getActorCollections).toHaveBeenCalledTimes(MAX_CACHED_PAGES + 1)
    await readPage(0)
    expect(getActorCollections).toHaveBeenCalledTimes(MAX_CACHED_PAGES + 2)
  })

  it('answers unavailable, uncached, past MAX_IN_FLIGHT_REMOTE_READS uncached reads', async () => {
    const deferred =
      createDeferred<Awaited<ReturnType<typeof getActorCollections>>>()
    vi.mocked(getActorCollections).mockReturnValue(deferred.promise)
    const readPage = (index: number) =>
      getRemoteFollowCollectionPage({
        database,
        actorId: REMOTE_ACTOR_ID,
        field: 'followers',
        pageUrl: `${REMOTE_ACTOR_ID}/followers?page=${index}`
      })

    const inFlight = Array.from(
      { length: MAX_IN_FLIGHT_REMOTE_READS },
      (_, index) => readPage(index)
    )
    // One past the cap: refused at once, without touching the network.
    await expect(readPage(MAX_IN_FLIGHT_REMOTE_READS)).resolves.toEqual({
      status: 'unavailable'
    })
    expect(getActorPerson).toHaveBeenCalledTimes(MAX_IN_FLIGHT_REMOTE_READS)
    // A cached page is still served while the cap is reached: the very
    // promise already in flight, not a refusal.
    expect(readPage(0)).toBe(inFlight[0])

    deferred.resolve({ page: null, totalItems: 0 })
    await Promise.all(inFlight)

    // The refusal was not cached: with the slots free, the same page is read.
    await readPage(MAX_IN_FLIGHT_REMOTE_READS)
    expect(getActorPerson).toHaveBeenCalledTimes(MAX_IN_FLIGHT_REMOTE_READS + 1)
  })

  it('does not cache a failure and frees its in-flight slot', async () => {
    vi.mocked(getActorCollections).mockRejectedValue(new Error('boom'))

    for (let index = 0; index <= MAX_IN_FLIGHT_REMOTE_READS; index += 1) {
      await expect(
        getRemoteFollowCollectionPage({
          database,
          actorId: REMOTE_ACTOR_ID,
          field: 'followers'
        })
      ).rejects.toThrow('boom')
    }

    mockCollectionPage([ACTOR2_ID])
    const result = await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })
    expect(accountUris(result)).toEqual([ACTOR2_ID])
    // Every failed read was a real attempt, and none of them held a slot.
    expect(getActorCollections).toHaveBeenCalledTimes(
      MAX_IN_FLIGHT_REMOTE_READS + 2
    )
  })
})

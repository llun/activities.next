import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getActorCollections } from '@/lib/activities/getActorCollections'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { createDeferred } from '@/lib/testing/deferred'

import {
  MAX_UNKNOWN_ACTORS_PER_PAGE,
  REMOTE_FOLLOW_PAGE_TTL_MS,
  RemoteFollowCollectionResult,
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

vi.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: vi.fn()
}))

const REMOTE_ACTOR_ID = 'https://remote.test/users/verge'
const NEW_ACTOR_ID = 'https://elsewhere.test/users/new'

const person = MockActivityPubPerson({ id: REMOTE_ACTOR_ID })
const signingActor = { id: 'https://llun.test/users/__instance__' } as never

const mockCollectionPage = (
  orderedItems: unknown[],
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
    totalItems: extra.totalItems ?? orderedItems.length
  })
}

const accountUris = (result: RemoteFollowCollectionResult) =>
  result.status === 'ok'
    ? result.page.accounts.map((account) => account.uri)
    : result.status

describe('getRemoteFollowCollectionPage', () => {
  const database = getTestSQLDatabase()

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
    vi.useRealTimers()
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
    vi.mocked(recordActorIfNeeded).mockImplementation(async ({ actorId }) => {
      const actor = await database.createActor({
        actorId,
        username: 'new',
        domain: new URL(actorId).host,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `${actorId}/inbox`,
        followersUrl: `${actorId}/followers`,
        publicKey: 'public key',
        createdAt: Date.now()
      })
      return actor ?? undefined
    })
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
    vi.mocked(recordActorIfNeeded).mockImplementation(async ({ actorId }) => {
      if (actorId === 'https://blocked.test/users/x') {
        throw new Error('Federation with actor domain is blocked')
      }
      return undefined
    })
    mockCollectionPage([
      ACTOR2_ID,
      'https://blocked.test/users/x',
      'https://gone.test/users/y'
    ])

    const result = await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })

    expect(accountUris(result)).toEqual([ACTOR2_ID])
  })

  it('resolves at most MAX_UNKNOWN_ACTORS_PER_PAGE unknown actors per page', async () => {
    vi.mocked(recordActorIfNeeded).mockResolvedValue(undefined)
    const unknownIds = Array.from(
      { length: MAX_UNKNOWN_ACTORS_PER_PAGE + 5 },
      (_, index) => `https://many.test/users/u${index}`
    )
    mockCollectionPage(unknownIds)

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
    ).toEqual(unknownIds.slice(0, MAX_UNKNOWN_ACTORS_PER_PAGE))
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

  it('does not cache a failure', async () => {
    vi.mocked(getActorCollections).mockRejectedValueOnce(new Error('boom'))

    await expect(
      getRemoteFollowCollectionPage({
        database,
        actorId: REMOTE_ACTOR_ID,
        field: 'followers'
      })
    ).rejects.toThrow('boom')

    mockCollectionPage([ACTOR2_ID])
    const result = await getRemoteFollowCollectionPage({
      database,
      actorId: REMOTE_ACTOR_ID,
      field: 'followers'
    })
    expect(accountUris(result)).toEqual([ACTOR2_ID])
    expect(getActorCollections).toHaveBeenCalledTimes(2)
  })
})

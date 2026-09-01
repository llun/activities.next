import { enableFetchMocks } from 'jest-fetch-mock'

import { getNote } from '@/lib/activities'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { createDeferred } from '@/lib/testing/deferred'
import { Actor } from '@/lib/types/activitypub'
import { Note } from '@/lib/types/activitypub/objects'

import {
  ATOM_FEED_FETCH_CONCURRENCY,
  MAX_ATOM_FEED_ENTRIES,
  getActorPostsFromAtomFeed
} from './getActorPostsFromAtomFeed'

enableFetchMocks()

vi.mock('@/lib/activities', () => ({
  getNote: vi.fn()
}))

describe('getActorPostsFromAtomFeed', () => {
  const getNoteMock = getNote as jest.Mock

  beforeEach(() => {
    fetchMock.resetMocks()
    // getNote is a vi.mock-factory fn — restoreAllMocks/clearAllMocks do not
    // reset its implementation. Reset it explicitly so no test inherits a
    // neighbour's implementation.
    vi.mocked(getNote).mockReset()
  })

  it('returns empty array when actor URL is malformed', async () => {
    const person = { id: 'invalid-url' } as Actor
    const result = await getActorPostsFromAtomFeed({ person })
    expect(result).toEqual([])
  })

  it('returns empty array when Atom feed returns 404', async () => {
    const actorId = 'https://pixelfed.example/users/testuser'
    const person = MockActivityPubPerson({ id: actorId }) as Actor

    fetchMock.mockResponse(async () => ({
      status: 404,
      body: 'Not Found'
    }))

    const result = await getActorPostsFromAtomFeed({ person })
    expect(result).toEqual([])
  })

  it('returns empty array when Atom feed is invalid XML', async () => {
    const actorId = 'https://pixelfed.example/users/testuser'
    const person = MockActivityPubPerson({ id: actorId }) as Actor

    fetchMock.mockResponse(async () => ({
      status: 200,
      body: '<html><body>not atom xml</body></html>'
    }))

    const result = await getActorPostsFromAtomFeed({ person })
    expect(result).toEqual([])
  })

  it('fetches posts from Atom feed with multiple entries', async () => {
    const actorId = 'https://pixelfed.example/users/testuser'
    const person = MockActivityPubPerson({ id: actorId }) as Actor

    const post1Url = 'https://pixelfed.example/p/testuser/1001'
    const post2Url = 'https://pixelfed.example/p/testuser/1002'

    const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <id>${actorId}.atom</id>
      <title>testuser on pixelfed.example</title>
      <entry>
        <id>${post1Url}</id>
        <title>Photo 1</title>
        <link rel="alternate" href="${post1Url}" />
      </entry>
      <entry>
        <id>${post2Url}</id>
        <title>Photo 2</title>
        <link rel="alternate" href="${post2Url}" />
      </entry>
    </feed>`

    fetchMock.mockResponse(async (req) => {
      if (req.url === `${actorId}.atom`) {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/atom+xml' },
          body: atomXml
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    getNoteMock.mockImplementation(
      async ({ statusId }: { statusId: string }) => {
        if (statusId === post1Url) {
          return MockMastodonActivityPubNote({
            id: post1Url,
            from: actorId,
            content: 'Post 1 content',
            withContext: true
          }) as Note
        }
        if (statusId === post2Url) {
          return MockMastodonActivityPubNote({
            id: post2Url,
            from: actorId,
            content: 'Post 2 content',
            withContext: true
          }) as Note
        }
        return null
      }
    )

    const statuses = await getActorPostsFromAtomFeed({ person })

    expect(statuses).toHaveLength(2)
    expect(statuses[0].id).toBe(post1Url)
    expect(statuses[0].type === 'Note' && statuses[0].text).toContain(
      'Post 1 content'
    )
    expect(statuses[1].id).toBe(post2Url)
    expect(statuses[1].type === 'Note' && statuses[1].text).toContain(
      'Post 2 content'
    )
  })

  it('handles single entry Atom feeds and resolves link attribute if id is not a URL', async () => {
    const actorId = 'https://pixelfed.example/users/testuser'
    const person = MockActivityPubPerson({ id: actorId }) as Actor

    const postUrl = 'https://pixelfed.example/p/testuser/2001'

    const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <id>${actorId}.atom</id>
      <title>testuser on pixelfed.example</title>
      <entry>
        <id>tag:pixelfed.example,2026:post-2001</id>
        <title>Single Photo</title>
        <link rel="alternate" href="${postUrl}" />
      </entry>
    </feed>`

    fetchMock.mockResponse(async (req) => {
      if (req.url === `${actorId}.atom`) {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/atom+xml' },
          body: atomXml
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    getNoteMock.mockResolvedValue(
      MockMastodonActivityPubNote({
        id: postUrl,
        from: actorId,
        content: 'Single photo caption',
        withContext: true
      }) as Note
    )

    const statuses = await getActorPostsFromAtomFeed({ person })

    expect(statuses).toHaveLength(1)
    expect(statuses[0].id).toBe(postUrl)
  })

  it('skips entries whose note cannot be fetched or parsed', async () => {
    const actorId = 'https://pixelfed.example/users/testuser'
    const person = MockActivityPubPerson({ id: actorId }) as Actor

    const post1Url = 'https://pixelfed.example/p/testuser/3001'
    const post2Url = 'https://pixelfed.example/p/testuser/3002'

    const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <id>${actorId}.atom</id>
      <entry>
        <id>${post1Url}</id>
        <title>Valid Photo</title>
      </entry>
      <entry>
        <id>${post2Url}</id>
        <title>Failing Photo</title>
      </entry>
    </feed>`

    fetchMock.mockResponse(async () => ({
      status: 200,
      headers: { 'Content-Type': 'application/atom+xml' },
      body: atomXml
    }))

    getNoteMock.mockImplementation(
      async ({ statusId }: { statusId: string }) => {
        if (statusId === post1Url) {
          return MockMastodonActivityPubNote({
            id: post1Url,
            from: actorId,
            content: 'Valid content',
            withContext: true
          }) as Note
        }
        return null
      }
    )

    const statuses = await getActorPostsFromAtomFeed({ person })

    expect(statuses).toHaveLength(1)
    expect(statuses[0].id).toBe(post1Url)
  })

  const actorId = 'https://pixelfed.example/users/testuser'

  const buildAtomFeed = (entryUrls: string[]) =>
    `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <id>${actorId}.atom</id>
      ${entryUrls
        .map(
          (url) =>
            `<entry><id>${url}</id><link rel="alternate" href="${url}" /></entry>`
        )
        .join('')}
    </feed>`

  const serveFeed = (entryUrls: string[]) => {
    const atomXml = buildAtomFeed(entryUrls)
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${actorId}.atom`) {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/atom+xml' },
          body: atomXml
        }
      }
      return { status: 404, body: 'Not Found' }
    })
  }

  it('fetches at most MAX_ATOM_FEED_ENTRIES entries from a large feed', async () => {
    const person = MockActivityPubPerson({ id: actorId }) as Actor
    const entryUrls = Array.from(
      { length: MAX_ATOM_FEED_ENTRIES + 10 },
      (_unused, index) => `https://pixelfed.example/p/testuser/${5000 + index}`
    )
    serveFeed(entryUrls)

    getNoteMock.mockImplementation(
      async ({ statusId }: { statusId: string }) =>
        MockMastodonActivityPubNote({
          id: statusId,
          from: actorId,
          content: 'content',
          withContext: true
        }) as Note
    )

    const statuses = await getActorPostsFromAtomFeed({ person })

    expect(getNoteMock).toHaveBeenCalledTimes(MAX_ATOM_FEED_ENTRIES)
    expect(statuses).toHaveLength(MAX_ATOM_FEED_ENTRIES)
  })

  it('caps fan-out concurrency at ATOM_FEED_FETCH_CONCURRENCY', async () => {
    const person = MockActivityPubPerson({ id: actorId }) as Actor
    const total = ATOM_FEED_FETCH_CONCURRENCY * 2 + 3
    const entryUrls = Array.from(
      { length: total },
      (_unused, index) => `https://pixelfed.example/p/testuser/${6000 + index}`
    )
    serveFeed(entryUrls)

    let inFlight = 0
    let peak = 0
    const pending: Array<() => void> = []
    getNoteMock.mockImplementation(({ statusId }: { statusId: string }) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      // A real deferred, not Promise.resolve: the point is to hold the fan-out
      // open so the in-flight count is observable batch by batch.
      const deferred = createDeferred<Note | null>()
      pending.push(() =>
        deferred.resolve(
          MockMastodonActivityPubNote({
            id: statusId,
            from: actorId,
            content: 'content',
            withContext: true
          }) as Note
        )
      )
      return deferred.promise.finally(() => {
        inFlight -= 1
      })
    })

    const resultPromise = getActorPostsFromAtomFeed({ person })

    // Macrotask flush drains microtasks so the next chunk's getNote calls land.
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

    // Wait for the first chunk to fire, then assert it saturated at — not past —
    // the concurrency ceiling.
    while (pending.length === 0) await flush()
    expect(peak).toBeLessThanOrEqual(ATOM_FEED_FETCH_CONCURRENCY)
    expect(inFlight).toBe(ATOM_FEED_FETCH_CONCURRENCY)

    // Resolve the fan-out one chunk at a time; the next chunk only starts once
    // the current one fully settles.
    while (pending.length > 0) {
      const wave = pending.splice(0)
      wave.forEach((resolve) => resolve())
      await flush()
    }

    const statuses = await resultPromise
    expect(peak).toBeLessThanOrEqual(ATOM_FEED_FETCH_CONCURRENCY)
    expect(statuses).toHaveLength(total)
  })
})

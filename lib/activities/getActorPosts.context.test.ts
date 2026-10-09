import { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { clearServerSoftwareCache } from '@/lib/services/federation/serverSoftware'
import { ACTIVITY_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { Actor } from '@/lib/types/activitypub'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { MAX_OUTBOX_PAGE_ITEMS, getActorPosts } from './getActorPosts'

enableFetchMocks()

describe('getActorPosts', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    clearServerSoftwareCache()
  })

  describe('context inheritance', () => {
    it('inherits root-only context definitions into items and embedded objects', async () => {
      const actorId = 'https://root-context.example/users/actor'
      const statusId = `${actorId}/statuses/root-1`
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor

      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        if (req.url === `${actorId}/outbox`) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify({
              '@context': [
                'https://www.w3.org/ns/activitystreams',
                { rootText: 'https://www.w3.org/ns/activitystreams#content' }
              ],
              id: `${actorId}/outbox`,
              type: 'OrderedCollection',
              totalItems: 1,
              orderedItems: [
                {
                  id: `${statusId}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: statusId,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    rootText: 'Hello from root-only context definition',
                    published: new Date().toISOString()
                  }
                }
              ]
            })
          }
        }
        return { status: 404, body: 'Not Found' }
      })

      const response = await getActorPosts({ database, person })
      expect(response.statuses).toHaveLength(1)
      const status = response.statuses[0]
      expect(status.type).toBe(StatusType.enum.Note)
      if (status.type !== StatusType.enum.Note) {
        throw new Error('Expected Note status')
      }
      expect(status.id).toBe(statusId)
      expect(status.text).toBe('Hello from root-only context definition')
      expect(response.statusesCount).toBe(1)
    })

    it('inherits page-only context definitions into items on separately fetched pages', async () => {
      const actorId = 'https://page-context.example/users/actor'
      const statusId = `${actorId}/statuses/page-1`
      const pageUrl = `${actorId}/outbox?page=1`
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor

      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        if (req.url === `${actorId}/outbox`) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify({
              id: `${actorId}/outbox`,
              type: 'OrderedCollection',
              totalItems: 5,
              first: pageUrl
            })
          }
        }
        if (req.url === pageUrl) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify({
              '@context': [
                'https://www.w3.org/ns/activitystreams',
                { pageText: 'https://www.w3.org/ns/activitystreams#content' }
              ],
              id: pageUrl,
              type: 'OrderedCollectionPage',
              partOf: `${actorId}/outbox`,
              next: `${actorId}/outbox?page=2`,
              prev: null,
              orderedItems: [
                {
                  id: `${statusId}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: statusId,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    pageText: 'Hello from page-only context definition',
                    published: new Date().toISOString()
                  }
                }
              ]
            })
          }
        }
        return { status: 404, body: 'Not Found' }
      })

      const response = await getActorPosts({ database, person })
      expect(response.statuses).toHaveLength(1)
      const status = response.statuses[0]
      expect(status.type).toBe(StatusType.enum.Note)
      if (status.type !== StatusType.enum.Note) {
        throw new Error('Expected Note status')
      }
      expect(status.text).toBe('Hello from page-only context definition')
      expect(response.statusesCount).toBe(5)
      expect(response.nextPageUrl).toBe(`${actorId}/outbox?page=2`)
    })

    it('allows item-level context definitions to override inherited definitions', async () => {
      const actorId = 'https://override-context.example/users/actor'
      const statusId = `${actorId}/statuses/override-1`
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor

      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        if (req.url === `${actorId}/outbox`) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify({
              '@context': [
                'https://www.w3.org/ns/activitystreams',
                { customText: 'https://example.com/unrelated#text' }
              ],
              id: `${actorId}/outbox`,
              type: 'OrderedCollection',
              totalItems: 1,
              orderedItems: [
                {
                  '@context': {
                    customText: 'https://www.w3.org/ns/activitystreams#content'
                  },
                  id: `${statusId}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: statusId,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    customText:
                      'Overridden definition successfully parsed as content',
                    published: new Date().toISOString()
                  }
                }
              ]
            })
          }
        }
        return { status: 404, body: 'Not Found' }
      })

      const response = await getActorPosts({ database, person })
      expect(response.statuses).toHaveLength(1)
      const status = response.statuses[0]
      expect(status.type).toBe(StatusType.enum.Note)
      if (status.type !== StatusType.enum.Note) {
        throw new Error('Expected Note status')
      }
      expect(status.text).toBe(
        'Overridden definition successfully parsed as content'
      )
    })

    it('resets context inheritance when an item specifies @context: null', async () => {
      const actorId = 'https://null-reset.example/users/actor'
      const status1Id = `${actorId}/statuses/item-1`
      const status2Id = `${actorId}/statuses/item-2`
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor

      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        if (req.url === `${actorId}/outbox`) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify({
              '@context': [
                'https://www.w3.org/ns/activitystreams',
                { rootText: 'https://www.w3.org/ns/activitystreams#content' }
              ],
              id: `${actorId}/outbox`,
              type: 'OrderedCollection',
              totalItems: 2,
              orderedItems: [
                // Item 1 inherits root context -> rootText becomes content
                {
                  id: `${status1Id}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: status1Id,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    rootText: 'Item 1 inherits root context',
                    published: new Date().toISOString()
                  }
                },
                // Item 2 resets inheritance via null -> rootText is unrecognized and stripped,
                // leaving only standard content
                {
                  '@context': null,
                  id: `${status2Id}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: status2Id,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    rootText: 'Ignored because inheritance was reset',
                    content: 'Item 2 plain content',
                    published: new Date().toISOString()
                  }
                }
              ]
            })
          }
        }
        return { status: 404, body: 'Not Found' }
      })

      const response = await getActorPosts({ database, person })
      expect(response.statuses).toHaveLength(2)
      const [status1, status2] = response.statuses
      expect(status1.type).toBe(StatusType.enum.Note)
      expect(status2.type).toBe(StatusType.enum.Note)
      if (
        status1.type !== StatusType.enum.Note ||
        status2.type !== StatusType.enum.Note
      ) {
        throw new Error('Expected Note statuses')
      }
      expect(status1.text).toBe('Item 1 inherits root context')
      expect(status2.text).toBe('Item 2 plain content')
    })

    it('preserves extension terms like quote and sensitive under inherited context', async () => {
      const actorId = 'https://extension-terms.example/users/actor'
      const statusId = `${actorId}/statuses/extension-1`
      const quotedStatusId = 'https://other.example/statuses/quoted-1'
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor

      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        if (req.url === `${actorId}/outbox`) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify({
              '@context': [
                'https://www.w3.org/ns/activitystreams',
                {
                  toot: 'http://joinmastodon.org/ns#'
                }
              ],
              id: `${actorId}/outbox`,
              type: 'OrderedCollection',
              totalItems: 1,
              orderedItems: [
                {
                  id: `${statusId}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: statusId,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    content: 'Post with sensitive and quote',
                    sensitive: true,
                    quoteUrl: quotedStatusId,
                    published: new Date().toISOString()
                  }
                }
              ]
            })
          }
        }
        return { status: 404, body: 'Not Found' }
      })

      const response = await getActorPosts({ database, person })
      expect(response.statuses).toHaveLength(1)
      const status = response.statuses[0]
      expect(status.type).toBe(StatusType.enum.Note)
      if (status.type !== StatusType.enum.Note) {
        throw new Error('Expected Note status')
      }
      expect(status.text).toBe('Post with sensitive and quote')
    })
  })

  describe('bounded work per outbox page', () => {
    const createItem = (actorId: string, index: number) => ({
      id: `${actorId}/statuses/${index}/activity`,
      type: 'Create',
      actor: actorId,
      published: new Date().toISOString(),
      object: {
        id: `${actorId}/statuses/${index}`,
        type: 'Note',
        attributedTo: actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        content: `post ${index}`,
        published: new Date().toISOString()
      }
    })

    const serveInlineOutbox = (
      actorId: string,
      orderedItems: unknown[],
      context: unknown = 'https://www.w3.org/ns/activitystreams'
    ) => {
      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) =>
        req.url === `${actorId}/outbox`
          ? {
              status: 200,
              headers: ACTIVITY_JSON_HEADERS,
              body: JSON.stringify({
                '@context': context,
                id: `${actorId}/outbox`,
                type: 'OrderedCollection',
                totalItems: orderedItems.length,
                orderedItems
              })
            }
          : { status: 404, body: 'Not Found' }
      )
    }

    it('processes no more than a page worth of items', async () => {
      const actorId = 'https://long-page.example/users/actor'
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor
      serveInlineOutbox(
        actorId,
        Array.from({ length: MAX_OUTBOX_PAGE_ITEMS + 20 }, (_, index) =>
          createItem(actorId, index)
        )
      )

      const response = await getActorPosts({ database, person })

      expect(response.statuses).toHaveLength(MAX_OUTBOX_PAGE_ITEMS)
    })

    it('refuses a page whose context would be copied into every item', async () => {
      // 1,000 empty context entries cost nothing to send but are copied into
      // each item's own context before it is compacted.
      const actorId = 'https://huge-context.example/users/actor'
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor
      serveInlineOutbox(
        actorId,
        [{ ...createItem(actorId, 0), '@context': {} }],
        [
          'https://www.w3.org/ns/activitystreams',
          ...Array.from({ length: 1000 }, () => ({}))
        ]
      )

      const response = await getActorPosts({ database, person })

      expect(response.statuses).toHaveLength(0)
    })

    it('resolves string-referenced objects a few at a time', async () => {
      const actorId = 'https://many-refs.example/users/actor'
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor
      let inFlight = 0
      let maxInFlight = 0
      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        if (req.url === `${actorId}/outbox`) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify({
              '@context': 'https://www.w3.org/ns/activitystreams',
              id: `${actorId}/outbox`,
              type: 'OrderedCollection',
              totalItems: 12,
              orderedItems: Array.from({ length: 12 }, (_, index) => ({
                ...createItem(actorId, index),
                object: `${actorId}/statuses/${index}`
              }))
            })
          }
        }
        const match = req.url.match(/\/statuses\/(\d+)$/)
        if (!match) return { status: 404, body: 'Not Found' }
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 20))
        inFlight -= 1
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            ...createItem(actorId, Number(match[1])).object
          })
        }
      })

      const response = await getActorPosts({ database, person })

      expect(response.statuses).toHaveLength(12)
      expect(maxInFlight).toBeGreaterThan(0)
      expect(maxInFlight).toBeLessThanOrEqual(4)
    })
  })
})

import { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { clearServerSoftwareCache } from '@/lib/services/federation/serverSoftware'
import { ACTIVITY_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { Actor } from '@/lib/types/activitypub'
import { StatusType } from '@/lib/types/domain/status'

import { getActorPosts } from './getActorPosts'

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

  it('falls back to Atom feed when outbox has totalItems but no items', async () => {
    const actorId = 'https://pixelfed.example/users/actor'
    const statusId = 'https://pixelfed.example/p/actor/12345'
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <id>${actorId}.atom</id>
      <entry>
        <id>${statusId}</id>
        <title>Pixelfed Post</title>
        <link rel="alternate" href="${statusId}" />
      </entry>
    </feed>`

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://pixelfed.example/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: 'https://pixelfed.example/api/nodeinfo/2.0.json'
              }
            ]
          })
        }
      }

      if (req.url === 'https://pixelfed.example/api/nodeinfo/2.0.json') {
        return {
          status: 200,
          body: JSON.stringify({
            software: { name: 'pixelfed' }
          })
        }
      }

      if (req.url === `${actorId}/outbox`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 413
          })
        }
      }

      if (req.url === `${actorId}.atom`) {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/atom+xml' },
          body: atomXml
        }
      }

      if (req.url === statusId) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify(
            MockMastodonActivityPubNote({
              id: statusId,
              from: actorId,
              content: 'Atom resolved post',
              withContext: true
            })
          )
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response.statusesCount).toBe(413)
    expect(response.statuses).toHaveLength(1)
    const status = response.statuses[0]
    expect(status.type).toBe(StatusType.enum.Note)
    if (status.type !== StatusType.enum.Note) {
      throw new Error('Expected Note status')
    }
    expect(status.id).toBe(statusId)
    expect(status.text).toContain('Atom resolved post')
  })

  it('does not fall back to Atom feed for non-Pixelfed instances', async () => {
    const actorId = 'https://mastodon.example/users/actor'
    const statusId = 'https://mastodon.example/p/actor/999'
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <id>${actorId}.atom</id>
      <entry>
        <id>${statusId}</id>
        <title>Mastodon Post</title>
      </entry>
    </feed>`

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://mastodon.example/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: 'https://mastodon.example/nodeinfo/2.0'
              }
            ]
          })
        }
      }

      if (req.url === 'https://mastodon.example/nodeinfo/2.0') {
        return {
          status: 200,
          body: JSON.stringify({
            software: { name: 'mastodon' }
          })
        }
      }

      if (req.url === `${actorId}/outbox`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 10
          })
        }
      }

      if (req.url === `${actorId}.atom`) {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/atom+xml' },
          body: atomXml
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response.statusesCount).toBe(10)
    expect(response.statuses).toEqual([])
  })

  it('handles outbox with totalItems only when Atom feed is also 404', async () => {
    const actorId = 'https://pixelfed.example/users/noatom'
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
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 413
          })
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response.statusesCount).toBe(413)
    expect(response.statuses).toEqual([])
    expect(response.nextPageUrl).toBeNull()
    expect(response.prevPageUrl).toBeNull()
  })

  it('returns null statusesCount when remote outbox has no totalItems', async () => {
    const actorId = 'https://blob.cat/users/critical'
    const statusId = `${actorId}/statuses/1`
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
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            first: `${actorId}/outbox?page=true`
          })
        }
      }

      if (req.url === `${actorId}/outbox?page=true`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            id: `${actorId}/outbox?page=true`,
            type: 'OrderedCollectionPage',
            partOf: `${actorId}/outbox`,
            orderedItems: [
              {
                id: `${statusId}/activity`,
                type: 'Create',
                actor: actorId,
                published: new Date().toISOString(),
                object: MockMastodonActivityPubNote({
                  id: statusId,
                  from: actorId,
                  content: 'Test post content',
                  withContext: true
                })
              }
            ]
          })
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response.statusesCount).toBeNull()
    expect(response.statuses).toHaveLength(1)
    expect(response.statuses[0].id).toBe(statusId)
  })
})
